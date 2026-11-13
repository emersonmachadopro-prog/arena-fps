// =====================================================================
//  Room.js — Une partie (un "salon") côté serveur.
//  C'est ICI que se décident les PV, les kills et le score :
//  le client ne fait qu'envoyer ses intentions (je bouge, je tire...).
// =====================================================================

import { PLAYER, WEAPONS, MATCH, TEAMS, PRIMARIES, SECONDARIES, BOT_LEVELS, validOptic, reloadPlan, roundsInserted, pelletDirs, pelletDamage, zoneDamage } from '../shared/constants.js';
import { BotBrain } from './Bot.js';
import { sanitizeSkins } from '../shared/skins.js';
import { MAP_BOXES, SPAWNS } from '../shared/map.js';
import { traceShot } from '../shared/physics.js';

const MODES = { '1v1': 1, '2v2': 2 };

export class Room {
  constructor(code, io, onEmpty) {
    this.code = code;
    this.io = io;
    this.onEmpty = onEmpty;
    this.players = new Map();   // socket.id -> données du joueur
    this.hostId = null;
    this.mode = '1v1';
    this.state = 'lobby';       // 'lobby' | 'playing' | 'ended'
    this.phase = null;          // pendant la partie : 'freeze' | 'live' | 'roundEnd'
    this.phaseEnd = 0;          // timestamp (ms) de fin de la phase en cours
    this.score = { A: 0, B: 0 };
    this.round = 0;
    this.winner = null;
    this.tickTimer = setInterval(() => this.tick(), 1000 / MATCH.TICK_RATE);
  }

  // ---------------------------------------------------------------
  //  Gestion des joueurs
  // ---------------------------------------------------------------
  get teamSize() { return MODES[this.mode]; }

  teamCount(team) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team) n++;
    return n;
  }

  get humans() { return [...this.players.values()].filter(p => !p.isBot); }

  /** Crée les données d'un joueur (humain ou bot) */
  makePlayer(id, name, skins, loadout) {
    const lo = sanitizeLoadout(loadout);
    return {
      id,
      name: String(name || 'Joueur').slice(0, 16),
      team: null, ready: false,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false,
      hp: PLAYER.MAX_HP, alive: false,
      skins: sanitizeSkins(skins),
      primary: lo.primary, optic: lo.optic, secondary: lo.secondary, // loadout utilisé cette manche
      ammo: {}, ping: 0,
      nextLoadout: null,                    // loadout choisi pour la prochaine apparition
      weapon: 'ak', mag: 0, reserve: 0, reloadEnd: 0, lastShot: 0,
      kills: 0, deaths: 0, lastMove: Date.now(),
    };
  }

  addPlayer(socket, name, skins, loadout) {
    if (this.state !== 'lobby') return 'La partie a déjà commencé.';
    if (this.humans.length >= 4) return 'Le salon est plein.';
    // Plus de place ? On retire un bot pour laisser la place à un vrai joueur
    if (this.players.size >= 4) {
      const bot = [...this.players.values()].find(b => b.isBot);
      if (bot) this.players.delete(bot.id);
    }
    const p = this.makePlayer(socket.id, name, skins, loadout);
    // Place automatiquement le joueur dans l'équipe la moins remplie
    for (const t of ['A', 'B']) {
      if (this.teamCount(t) < this.teamSize && (!p.team || this.teamCount(t) < this.teamCount(p.team))) p.team = t;
    }
    this.players.set(socket.id, p);
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.code);
    this.sendLobby();
    return null;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    // Plus aucun vrai joueur : on ferme le salon (les bots ne jouent pas seuls)
    if (this.humans.length === 0) return this.destroy();
    if (this.hostId === id) this.hostId = this.humans[0].id;

    this.feed({ type: 'leave', name: p.name });
    if (this.state === 'playing') {
      // Si une équipe n'a plus personne, la partie s'arrête
      if (this.teamCount('A') === 0 || this.teamCount('B') === 0) {
        this.backToLobby('Un joueur a quitté la partie.');
      } else {
        this.checkRoundOver();
      }
    } else {
      this.sendLobby();
    }
  }

  setMode(id, mode) {
    if (id !== this.hostId || this.state !== 'lobby' || !MODES[mode]) return;
    this.mode = mode;
    // Si on passe en 1v1, on retire de l'équipe les joueurs en trop
    for (const t of ['A', 'B']) {
      let n = 0;
      for (const p of [...this.players.values()]) {
        if (p.team === t && ++n > this.teamSize) {
          if (p.isBot) this.players.delete(p.id); // bot en trop : supprimé
          else { p.team = null; p.ready = false; }
        }
      }
    }
    for (const p of this.players.values()) if (!p.isBot) p.ready = false;
    this.sendLobby();
  }

  setTeam(id, team) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby') return;
    if (team !== null && !TEAMS[team]) return;
    if (team && p.team !== team && this.teamCount(team) >= this.teamSize) return; // équipe pleine
    p.team = team;
    p.ready = false;
    this.sendLobby();
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby' || !p.team) return;
    p.ready = !!ready;
    this.sendLobby();
    this.tryStart();
  }

  // La partie démarre quand les deux équipes sont complètes et tout le monde est prêt
  tryStart() {
    const n = this.teamSize;
    if (this.teamCount('A') !== n || this.teamCount('B') !== n) return;
    for (const p of this.players.values()) if (p.team && !p.ready) return;
    this.startMatch();
  }

  // ---------------------------------------------------------------
  //  Bots (ajoutés par l'hôte pour compléter une équipe)
  // ---------------------------------------------------------------
  addBot(id, team, level) {
    if (id !== this.hostId || this.state !== 'lobby' || !TEAMS[team] || !BOT_LEVELS[level]) return;
    if (this.teamCount(team) >= this.teamSize || this.players.size >= 4) return;
    const n = [...this.players.values()].filter(p => p.isBot).length + 1;
    const skinsList = ['desert', 'jungle', 'arctic', 'shadow', 'royal'];
    const bot = this.makePlayer(`bot-${Date.now()}-${n}`, `Bot ${BOT_LEVELS[level].name}`,
      { character: skinsList[Math.floor(Math.random() * skinsList.length)] }, { primary: 'ak', optic: 'iron' });
    Object.assign(bot, { name: `Bot ${BOT_LEVELS[level].name}`, isBot: true, level, team, ready: true, brain: new BotBrain(level) });
    this.players.set(bot.id, bot);
    this.sendLobby();
    this.tryStart();
  }

  removeBot(id, botId) {
    const b = this.players.get(botId);
    if (id !== this.hostId || this.state !== 'lobby' || !b?.isBot) return;
    this.players.delete(botId);
    this.sendLobby();
  }

  /** Skins choisis dans le casier */
  setSkins(id, skins) {
    const p = this.players.get(id);
    if (!p) return;
    p.skins = sanitizeSkins(skins);
    this.sendLobby();
  }

  /**
   * Choix de l'arme principale (touche M).
   * - Au lobby ou pendant la préparation de manche : appliqué tout de suite
   * - Sinon : appliqué à la prochaine apparition
   */
  setLoadout(id, data) {
    const p = this.players.get(id);
    if (!p) return;
    const lo = sanitizeLoadout(data);
    if (this.state !== 'playing') { p.primary = lo.primary; p.optic = lo.optic; p.secondary = lo.secondary; p.nextLoadout = null; this.sendLobby(); return; }
    if (this.phase === 'freeze' && p.alive) {
      this.equip(p, lo);
      this.io.to(id).emit('loadout', { ...lo, applied: true });
    } else {
      p.nextLoadout = lo;
      this.io.to(id).emit('loadout', { ...lo, applied: false });
    }
  }

  /** Donne une arme principale (+ viseur) avec chargeur plein */
  equip(p, lo) {
    p.primary = lo.primary;
    p.optic = lo.optic;
    p.secondary = lo.secondary || 'glock';
    p.nextLoadout = null;
    p.weapon = lo.primary;
    // Munitions de chaque arme (mag/reserve = celles de l'arme en main)
    p.ammo = {};
    for (const w of [p.primary, p.secondary]) p.ammo[w] = { mag: WEAPONS[w].magSize, reserve: WEAPONS[w].reserve };
    p.mag = p.ammo[p.primary].mag;
    p.reserve = p.ammo[p.primary].reserve;
    p.reloadEnd = 0; p.reload = null;
  }

  sendLobby() {
    this.io.to(this.code).emit('lobby', {
      code: this.code,
      mode: this.mode,
      hostId: this.hostId,
      state: this.state,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, team: p.team, ready: p.ready, skins: p.skins,
        primary: p.primary, optic: p.optic, secondary: p.secondary, isBot: !!p.isBot, level: p.level || null,
      })),
    });
  }

  // ---------------------------------------------------------------
  //  Déroulement de la partie
  // ---------------------------------------------------------------
  startMatch() {
    this.state = 'playing';
    this.score = { A: 0, B: 0 };
    this.round = 0;
    this.winner = null;
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; }
    this.io.to(this.code).emit('matchStart', { mode: this.mode });
    this.startRound();
  }

  startRound() {
    this.round++;
    const used = { A: 0, B: 0 };
    for (const p of this.players.values()) {
      if (!p.team) { p.alive = false; continue; }
      const s = SPAWNS[p.team][used[p.team]++ % SPAWNS[p.team].length];
      Object.assign(p, {
        x: s.x, y: 0, z: s.z, yaw: s.yaw, pitch: 0, crouch: false,
        hp: PLAYER.MAX_HP, alive: true, lastMove: Date.now(),
      });
      p.vel = { x: 0, y: 0, z: 0 };
      p.brain?.reset();
      this.equip(p, p.nextLoadout || { primary: p.primary, optic: p.optic, secondary: p.secondary });
      // On force la position côté client (téléportation au spawn)
      if (!p.isBot) this.io.to(p.id).emit('spawn', { x: s.x, y: 0, z: s.z, yaw: s.yaw, primary: p.primary, optic: p.optic, secondary: p.secondary });
    }
    this.setPhase('freeze', MATCH.FREEZE_TIME);
  }

  setPhase(phase, seconds) {
    this.phase = phase;
    this.phaseEnd = Date.now() + seconds * 1000;
  }

  // Une manche est finie si une équipe n'a plus de survivant
  checkRoundOver() {
    if (this.state !== 'playing' || this.phase !== 'live') return;
    const alive = { A: 0, B: 0 };
    for (const p of this.players.values()) if (p.alive && p.team) alive[p.team]++;
    if (alive.A === 0 || alive.B === 0) {
      this.endRound(alive.A === 0 && alive.B === 0 ? null : alive.A > 0 ? 'A' : 'B', 'elimination');
    }
  }

  endRound(winnerTeam, reason) {
    if (winnerTeam) this.score[winnerTeam]++;
    this.io.to(this.code).emit('roundEnd', { winner: winnerTeam, reason, score: this.score });
    if (winnerTeam && this.score[winnerTeam] >= MATCH.WIN_SCORE) {
      this.winner = winnerTeam;
      this.setPhase('roundEnd', 2.5); // petite pause avant l'écran de fin
    } else {
      this.setPhase('roundEnd', MATCH.ROUND_END_TIME);
    }
  }

  // Temps écoulé : l'équipe avec le plus de survivants gagne, puis le plus de PV
  timeUp() {
    const alive = { A: 0, B: 0 }, hp = { A: 0, B: 0 };
    for (const p of this.players.values()) {
      if (p.alive && p.team) { alive[p.team]++; hp[p.team] += p.hp; }
    }
    let w = null;
    if (alive.A !== alive.B) w = alive.A > alive.B ? 'A' : 'B';
    else if (hp.A !== hp.B) w = hp.A > hp.B ? 'A' : 'B';
    this.endRound(w, 'time');
  }

  endMatch() {
    this.state = 'ended';
    this.phase = null;
    this.io.to(this.code).emit('matchEnd', {
      winner: this.winner,
      score: this.score,
      players: [...this.players.values()].map(p => ({ name: p.name, team: p.team, kills: p.kills, deaths: p.deaths })),
    });
  }

  // "Rejouer" : tout le monde revient au lobby avec les mêmes équipes
  backToLobby(message) {
    this.state = 'lobby';
    this.phase = null;
    for (const p of this.players.values()) { p.ready = !!p.isBot; p.alive = false; }
    this.io.to(this.code).emit('backToLobby', { message: message || null });
    this.sendLobby();
  }

  // ---------------------------------------------------------------
  //  Actions envoyées par les joueurs
  // ---------------------------------------------------------------

  // Le client envoie sa position. On vérifie qu'il ne va pas trop vite (anti-téléportation).
  onMove(id, data) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.state !== 'playing') return;
    const now = Date.now();
    const nums = [data.x, data.y, data.z, data.yaw, data.pitch];
    if (nums.some(n => typeof n !== 'number' || !isFinite(n))) return;

    if (this.phase === 'freeze') { p.yaw = data.yaw; p.pitch = data.pitch; return; }

    const dt = Math.min((now - p.lastMove) / 1000, 0.5);
    const dist = Math.hypot(data.x - p.x, data.z - p.z);
    const maxDist = PLAYER.SLIDE_SPEED * 1.3 * dt + 0.6; // vitesse max = glissade // marge pour la latence
    if (dist > maxDist || Math.abs(data.y - p.y) > 8 * dt + 1.5) {
      // Mouvement suspect : on renvoie le joueur à sa dernière position valide
      this.io.to(id).emit('correct', { x: p.x, y: p.y, z: p.z });
      p.lastMove = now;
      return;
    }
    p.x = data.x; p.y = data.y; p.z = data.z;
    p.yaw = data.yaw;
    p.pitch = Math.max(-1.55, Math.min(1.55, data.pitch));
    p.crouch = !!data.crouch;
    p.ads = !!data.ads; p.insp = !!data.insp; p.spr = !!data.spr; p.sl = !!data.sl; // pour les animations vues par les autres
    p.lastMove = now;
  }

  onSwitch(id, weapon) {
    const p = this.players.get(id);
    if (!p || (weapon !== p.primary && weapon !== p.secondary && weapon !== 'knife')) return;
    if (weapon === p.weapon) return;
    // On range les munitions de l'arme qu'on lâche et on prend celles de la nouvelle
    if (p.reloadEnd) this.cancelReload(p);
    if (p.ammo[p.weapon]) p.ammo[p.weapon] = { mag: p.mag, reserve: p.reserve };
    p.weapon = weapon;
    if (p.ammo[weapon]) { p.mag = p.ammo[weapon].mag; p.reserve = p.ammo[weapon].reserve; }
  }

  onReload(id) {
    const p = this.players.get(id);
    if (!p || !p.alive || !p.ammo[p.weapon]) return;
    const w = WEAPONS[p.weapon];
    if (p.reloadEnd || p.mag >= w.magSize || p.reserve <= 0) return;
    const plan = reloadPlan(p.weapon, p.mag, p.reserve);
    const now = Date.now();
    p.reload = { start: now, rounds: plan.rounds };
    p.reloadEnd = now + plan.time * 1000;
  }

  /** Interrompt un rechargement (Kar98k : on garde les balles déjà poussées) */
  cancelReload(p) {
    if (!p.reloadEnd) return;
    const n = roundsInserted(p.weapon, (Date.now() - p.reload.start) / 1000, p.reload.rounds);
    p.mag += n; p.reserve -= n;
    p.reloadEnd = 0; p.reload = null;
    p.reloadLock = Date.now() + 250; // le temps de refermer la culasse
  }

  onReloadCancel(id) {
    const p = this.players.get(id);
    if (p) this.cancelReload(p);
  }

  // ---------------------------------------------------------------
  //  Compensation de latence : on garde l'historique des positions
  //  (1 seconde) pour vérifier un tir là où le tireur VOYAIT sa cible.
  // ---------------------------------------------------------------
  recordHistory(now) {
    for (const p of this.players.values()) {
      if (!p.hist) p.hist = [];
      p.hist.push({ t: now, x: p.x, y: p.y, z: p.z, crouch: p.crouch });
      while (p.hist.length > 40) p.hist.shift(); // ~1,3 s d'historique
    }
  }

  positionAt(p, t) {
    const h = p.hist;
    if (!h || !h.length || t >= h[h.length - 1].t) return { x: p.x, y: p.y, z: p.z, crouch: p.crouch };
    if (t <= h[0].t) return h[0];
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (t >= a.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: k < 0.5 ? a.crouch : b.crouch };
      }
    }
    return h[0];
  }

  // Le client dit "je tire dans cette direction". Le serveur vérifie tout le reste.
  onShoot(id, data) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.state !== 'playing' || this.phase !== 'live') return;
    const w = WEAPONS[data.weapon];
    if (!w || data.weapon !== p.weapon) return;
    const d = data.dir;
    if (!d || ![d.x, d.y, d.z].every(n => typeof n === 'number' && isFinite(n))) return;
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 0.5) return;
    const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
    const o = data.origin;
    const origin = o && [o.x, o.y, o.z].every(n => typeof n === 'number' && isFinite(n)) ? o : null;
    const rt = typeof data.rt === 'number' && isFinite(data.rt) ? data.rt : null;

    this.fire(p, data.weapon, dir, { origin, rt });
  }

  /**
   * Tir validé (joueur ou bot) : munitions, cadence, trajectoire, dégâts.
   * opts.origin = position des yeux envoyée par le client (acceptée si proche de celle du serveur)
   * opts.rt     = instant (horloge serveur) que le tireur voyait à l'écran → compensation de latence
   */
  fire(p, weaponId, dir, opts = {}) {
    const w = WEAPONS[weaponId];
    const now = Date.now();
    // Cadence de tir (avec une petite tolérance réseau)
    if (now - p.lastShot < w.fireInterval * 1000 * 0.8) return;
    if (weaponId !== 'knife') {
      if (p.reloadEnd || p.mag <= 0 || (p.reloadLock && now < p.reloadLock)) return;
      p.mag--;
    }
    p.lastShot = now;

    // Point de départ : les yeux du tireur (sa position client si elle est cohérente)
    let eye = { x: p.x, y: p.y + (p.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE), z: p.z };
    if (opts.origin && Math.hypot(opts.origin.x - eye.x, opts.origin.y - eye.y, opts.origin.z - eye.z) < 2) eye = opts.origin;

    // Les cibles sont replacées là où le tireur les voyait (max 400 ms en arrière)
    const t = opts.rt ? Math.max(now - 400, Math.min(now, opts.rt)) : now;
    const enemies = [...this.players.values()]
      .filter(o => o.alive && o.team && o.team !== p.team)
      .map(o => ({ id: o.id, ...this.positionAt(o, t) }));
    // Fusil à pompe : plusieurs plombs (motif fixe), dégâts additionnés par cible
    if (w.pellets) {
      const dirs = pelletDirs(dir, w.pelletSpread, w.pellets);
      const per = new Map();
      let first = null;
      for (const d of dirs) {
        const r = traceShot(eye, d, enemies, MAP_BOXES, w.range, 0.1);
        if (!first) first = r;
        if (r.hit) {
          const e = per.get(r.hit.id) || { dmg: 0, head: false, dist: r.hit.dist, d };
          e.dmg += pelletDamage(w, r.hit.dist, r.hit.zone);
          e.head ||= r.hit.headshot;
          per.set(r.hit.id, e);
        }
      }
      const endDist = first.hit ? first.hit.dist : Math.min(first.wallDist, w.range);
      const point = { x: eye.x + dir.x * endDist, y: eye.y + dir.y * endDist, z: eye.z + dir.z * endDist };
      this.io.to(this.code).emit('shot', { id: p.id, weapon: weaponId, from: eye, dir, dist: endDist, point, hitPlayer: per.size > 0, hitWall: !first.hit && first.wallDist < w.range });
      for (const [id, e] of per) {
        const pt = { x: eye.x + e.d.x * e.dist, y: eye.y + e.d.y * e.dist, z: eye.z + e.d.z * e.dist };
        this.damage(p, this.players.get(id), Math.round(e.dmg), e.head, weaponId, pt);
      }
      return;
    }
    const { hit, wallDist } = traceShot(eye, dir, enemies, MAP_BOXES, w.range, 0.1);

    // Tout le monde voit le tir (traçante, son, sang si touché)
    const endDist = hit ? hit.dist : Math.min(wallDist, w.range);
    const point = { x: eye.x + dir.x * endDist, y: eye.y + dir.y * endDist, z: eye.z + dir.z * endDist };
    this.io.to(this.code).emit('shot', { id: p.id, weapon: weaponId, from: eye, dir, dist: endDist, point, hitPlayer: !!hit, hitWall: !hit && wallDist < w.range });

    if (hit) this.damage(p, this.players.get(hit.id), zoneDamage(w, hit.zone), hit.headshot, weaponId, point); // tête / torse / jambes (×0,75)
  }

  damage(attacker, victim, amount, headshot, weapon, point) {
    if (!victim || !victim.alive) return;
    victim.hp = Math.max(0, victim.hp - amount);
    this.io.to(attacker.id).emit('hitConfirm', { headshot, kill: victim.hp <= 0, point });
    this.io.to(victim.id).emit('damaged', { from: { x: attacker.x, z: attacker.z }, hp: victim.hp });
    if (victim.hp <= 0) {
      victim.alive = false;
      victim.deaths++;
      attacker.kills++;
      this.feed({ type: 'kill', killer: attacker.name, killerTeam: attacker.team, victim: victim.name, victimTeam: victim.team, weapon, headshot });
      this.checkRoundOver();
    }
  }

  feed(entry) { this.io.to(this.code).emit('feed', entry); }

  // ---------------------------------------------------------------
  //  Boucle serveur : timers + envoi de l'état aux clients
  // ---------------------------------------------------------------
  tick() {
    if (this.state !== 'playing') return;
    const now = Date.now();

    // Rechargements terminés
    for (const p of this.players.values()) {
      if (p.reloadEnd && now >= p.reloadEnd) {
        const take = Math.min(p.reload?.rounds ?? WEAPONS[p.weapon].magSize - p.mag, p.reserve);
        p.mag += take; p.reserve -= take; p.reloadEnd = 0; p.reload = null;
      }
    }
    this.recordHistory(now);

    // Intelligence des bots
    for (const p of this.players.values()) {
      if (p.isBot && p.alive) p.brain.update(this, p, 1 / MATCH.TICK_RATE);
    }

    // Changements de phase
    if (now >= this.phaseEnd) {
      if (this.phase === 'freeze') this.setPhase('live', MATCH.ROUND_TIME);
      else if (this.phase === 'live') this.timeUp();
      else if (this.phase === 'roundEnd') {
        if (this.winner) return this.endMatch();
        this.startRound();
      }
    }

    // Snapshot envoyé à tout le monde
    this.io.to(this.code).volatile.emit('state', {
      t: now, // horloge du serveur (pour l'interpolation et la compensation de latence)
      phase: this.phase,
      timeLeft: Math.max(0, (this.phaseEnd - now) / 1000),
      round: this.round,
      score: this.score,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, team: p.team,
        x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
        yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
        crouch: p.crouch, ads: !!p.ads, insp: !!p.insp, spr: !!p.spr, sl: !!p.sl, alive: p.alive, hp: p.hp, weapon: p.weapon, primary: p.primary, optic: p.optic, isBot: !!p.isBot,
        mag: p.mag, reserve: p.reserve, reloading: !!p.reloadEnd, secondary: p.secondary, ping: p.isBot ? -1 : p.ping,
        kills: p.kills, deaths: p.deaths,
      })),
    });
  }

  destroy() {
    clearInterval(this.tickTimer);
    this.onEmpty(this.code);
  }
}

/** Vérifie un loadout reçu : { primary, optic } (accepte aussi juste le nom de l'arme) */
function sanitizeLoadout(data) {
  const primary = PRIMARIES.includes(data?.primary) ? data.primary : PRIMARIES.includes(data) ? data : 'ak';
  const secondary = SECONDARIES.includes(data?.secondary) ? data.secondary : 'glock';
  return { primary, optic: validOptic(primary, data?.optic), secondary };
}
