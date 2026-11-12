// =====================================================================
//  net.js — Mode multijoueur : connexion au serveur Socket.io,
//  lobby, synchronisation des joueurs, manches et score.
//  Le serveur a toujours le dernier mot (PV, kills, score).
// =====================================================================
import { PLAYER, WEAPONS, TEAMS, MATCH } from '/shared/constants.js';
import { MAP_BOXES } from '/shared/map.js';
import { raycastWorld, traceShot } from '/shared/physics.js';
import { Avatar } from './avatars.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';

export class NetGame {
  /**
   * ctx = { scene, camera, effects, hud, player, weapons }
   * ui  = callbacks vers l'interface : onLobby, onMatchStart, onMatchEnd, onBackToLobby, onError
   */
  constructor(ctx, ui) {
    this.ctx = ctx;
    this.ui = ui;
    this.socket = io(); // se connecte au serveur qui a servi la page
    this.avatars = new Map();
    this.state = null;      // dernier état reçu du serveur
    this.lobby = null;
    this.inMatch = false;
    this.lastPhase = null;
    this.sendTimer = 0;
    this.spectating = null;

    const s = this.socket;
    s.on('connect_error', () => ui.onError('Impossible de joindre le serveur.'));
    s.on('disconnect', () => { if (this.lobby) ui.onError('Déconnecté du serveur.'); });
    s.on('lobby', (l) => { this.lobby = l; ui.onLobby(l); });
    s.on('matchStart', () => this.onMatchStart());
    s.on('spawn', (sp) => this.onSpawn(sp));
    s.on('state', (st) => this.onState(st));
    s.on('correct', (p) => Object.assign(ctx.player.pos, p));
    s.on('loadout', (e) => {
      if (e.applied) { ctx.weapons.reset(e.primary); ctx.weapons.setVisible(true); }
      ctx.hud.info(e.applied ? `Arme : ${WEAPONS[e.primary].name}` : `${WEAPONS[e.primary].name} à la prochaine manche`);
    });
    s.on('shot', (e) => this.onShot(e));
    s.on('hitConfirm', (e) => this.onHitConfirm(e));
    s.on('damaged', (e) => this.onDamaged(e));
    s.on('feed', (e) => this.onFeed(e));
    s.on('roundEnd', (e) => this.onRoundEnd(e));
    s.on('matchEnd', (e) => { this.inMatch = false; ui.onMatchEnd(e, this.myTeam); });
    s.on('backToLobby', (e) => { this.inMatch = false; this.clearAvatars(); ui.onBackToLobby(e); });
  }

  get myId() { return this.socket.id; }
  get myTeam() { return this.lobby?.players.find(p => p.id === this.myId)?.team; }

  // ---------------- Lobby ----------------
  create(name) { return new Promise(r => this.socket.emit('createRoom', { name, skins: settings.skins, primary: settings.primary }, r)); }
  join(code, name) { return new Promise(r => this.socket.emit('joinRoom', { code, name, skins: settings.skins, primary: settings.primary }, r)); }
  setSkins(skins) { this.socket.emit('setSkins', skins); }
  setMode(m) { this.socket.emit('setMode', m); }
  setTeam(t) { this.socket.emit('setTeam', t); }
  setReady(r) { this.socket.emit('setReady', r); }
  playAgain() { this.socket.emit('playAgain'); }
  leave() { this.socket.emit('leaveRoom'); this.lobby = null; this.inMatch = false; this.clearAvatars(); }
  destroy() { this.leave(); this.socket.disconnect(); }

  // ---------------- Partie ----------------
  onMatchStart() {
    this.inMatch = true;
    this.lastPhase = null;
    this.ctx.hud.clearFeed();
    this.ui.onMatchStart();
  }

  onSpawn(sp) {
    const { player, weapons } = this.ctx;
    player.spawn(sp);
    weapons.reset(sp.primary || 'ak');
    weapons.setVisible(true);
    this.spectating = null;
  }

  onState(st) {
    this.state = st;
    const { player, weapons, hud } = this.ctx;

    // Messages de début de manche
    if (st.phase !== this.lastPhase) {
      if (st.phase === 'freeze') hud.message(`Manche ${st.round}`, `${TEAMS.A.name} ${st.score.A} — ${st.score.B} ${TEAMS.B.name}`, MATCH.FREEZE_TIME * 1000);
      if (st.phase === 'live' && this.lastPhase === 'freeze') { hud.message('GO !', '', 800, '#22d3ee'); sfx.roundStart(); }
      this.lastPhase = st.phase;
    }

    const seen = new Set();
    for (const p of st.players) {
      if (p.id === this.myId) {
        // Le serveur décide des PV et de la mort
        player.hp = p.hp;
        if (player.alive && !p.alive) this.onLocalDeath();
        player.alive = p.alive;
        // Resynchronise les munitions si on ne tire pas en ce moment
        if (!weapons.reloading && !p.reloading && weapons.sinceShot > 0.5 && p.weapon === weapons.current && p.primary === weapons.primary && p.weapon !== 'knife') {
          weapons.mag = p.mag; weapons.reserve = p.reserve;
        }
        continue;
      }
      seen.add(p.id);
      let av = this.avatars.get(p.id);
      if (!av) {
        const lp = this.lobby?.players.find(l => l.id === p.id);
        av = new Avatar(this.ctx.scene, p.name, p.team, { skins: lp?.skins, weapon: p.weapon });
        this.avatars.set(p.id, av); av.setTarget(p, true);
      }
      av.setWeapon(p.weapon);
      av.setTarget(p, av.wasDead && p.alive); // téléportation au respawn
      av.wasDead = !p.alive;
      av.alive = p.alive;
      av.team = p.team;
    }
    for (const [id, av] of this.avatars) if (!seen.has(id)) { av.dispose(); this.avatars.delete(id); }
  }

  onLocalDeath() {
    this.ctx.weapons.setVisible(false);
    this.ctx.hud.message('Éliminé', 'Tu regardes un coéquipier jusqu\'à la fin de la manche', 3000, '#ff4d6d');
  }

  onShot(e) {
    if (e.id === this.myId) return; // nos tirs sont déjà affichés localement
    const from = e.from;
    const to = { x: from.x + e.dir.x * e.dist, y: from.y + e.dir.y * e.dist, z: from.z + e.dir.z * e.dist };
    const p = this.ctx.player.pos;
    const d = Math.hypot(from.x - p.x, from.z - p.z);
    if (e.weapon !== 'knife') {
      this.ctx.effects.tracer({ x: from.x + e.dir.x * 0.7, y: from.y - 0.25, z: from.z + e.dir.z * 0.7 }, to);
      if (e.hitWall) this.ctx.effects.impact(to);
      (e.weapon === 'kar98k' ? sfx.sniper : sfx.shot)(Math.max(0.1, 1 - d / (e.weapon === 'kar98k' ? 80 : 45)));
    } else {
      sfx.knife(Math.max(0.1, 1 - d / 15));
    }
  }

  onHitConfirm(e) {
    this.ctx.hud.hitmarker(e.headshot);
    if (e.kill) sfx.kill(); else sfx.hit(e.headshot);
  }

  onDamaged(e) {
    const pl = this.ctx.player;
    sfx.hurt();
    const yawTo = Math.atan2(-(e.from.x - pl.pos.x), -(e.from.z - pl.pos.z));
    this.ctx.hud.damage(-(yawTo - pl.yaw));
  }

  onFeed(e) {
    if (e.type === 'kill') {
      const mine = this.lobby?.players.some(p => p.id === this.myId && (p.name === e.killer || p.name === e.victim));
      this.ctx.hud.kill(e, mine);
    } else if (e.type === 'leave') this.ctx.hud.info(`${e.name} a quitté la partie`);
  }

  onRoundEnd(e) {
    const win = e.winner && e.winner === this.myTeam;
    const title = e.winner ? `Manche : ${TEAMS[e.winner].name}` : 'Manche nulle';
    const sub = `${e.reason === 'time' ? 'Temps écoulé — ' : ''}${TEAMS.A.name} ${e.score.A} — ${e.score.B} ${TEAMS.B.name}`;
    this.ctx.hud.message(title, sub, 3500, e.winner ? TEAMS[e.winner].css : '#fff');
    sfx.roundEnd(win);
  }

  // ----- Interface commune avec le mode solo -----
  get phase() { return this.state?.phase; }
  canMove() { return this.inMatch && this.ctx.player.alive && this.phase !== 'freeze'; }
  canFire() { return this.inMatch && this.ctx.player.alive && this.phase === 'live'; }
  reload() { this.socket.emit('reload'); }
  setLoadout(w) { settings.primary = w; this.socket.emit('setLoadout', w); return false; }
  switchWeapon(w) { this.socket.emit('switch', w); }

  fire(origin, dir, weapon) {
    this.socket.emit('shoot', { dir, weapon });
    // Estimation locale pour les effets visuels (le serveur confirmera les touches)
    const w = WEAPONS[weapon];
    const targets = [];
    for (const [id, av] of this.avatars) {
      if (av.alive && av.team !== this.myTeam) {
        const g = av.group.position;
        targets.push({ id, x: g.x, y: g.y, z: g.z, crouch: av.crouch });
      }
    }
    const { hit, wallDist } = traceShot(origin, dir, targets, MAP_BOXES, w.range);
    if (hit) return { dist: hit.dist, hitPlayer: true };
    return { dist: Math.min(wallDist, w.range), hitWall: wallDist < w.range };
  }

  update(dt) {
    const { player, camera } = this.ctx;

    // Envoi de notre position au serveur (20 fois par seconde)
    this.sendTimer -= dt;
    if (this.inMatch && player.alive && this.sendTimer <= 0) {
      this.sendTimer = 1 / MATCH.TICK_RATE;
      this.socket.volatile.emit('move', {
        x: player.pos.x, y: player.pos.y, z: player.pos.z,
        yaw: player.yaw, pitch: player.pitch, crouch: player.crouch,
      });
    }

    // Avatars des autres joueurs
    let spectate = null;
    for (const av of this.avatars.values()) {
      av.update(dt);
      av.setVisible(av.alive);
      if (!player.alive && av.alive && av.team === this.myTeam && !spectate) spectate = av;
    }

    // Mort : la caméra suit un coéquipier vivant
    if (!player.alive && spectate) {
      spectate.setVisible(false);
      const g = spectate.group.position, t = spectate.target;
      camera.position.set(g.x, g.y + (spectate.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE), g.z);
      camera.rotation.set(t.pitch, t.yaw, 0);
    }
  }

  hudState() {
    const st = this.state;
    if (!st) return {};
    let timerLabel;
    if (st.phase === 'freeze') timerLabel = `⏳ ${Math.ceil(st.timeLeft)}`;
    return {
      score: st.score,
      timeLeft: st.phase === 'live' ? st.timeLeft : st.phase === 'roundEnd' ? 0 : undefined,
      timerLabel,
      roundLabel: `Manche ${st.round} · premier à ${MATCH.WIN_SCORE}`,
    };
  }

  scoreboardPlayers() { return this.state?.players || []; }

  clearAvatars() {
    for (const av of this.avatars.values()) av.dispose();
    this.avatars.clear();
  }

  dispose() { this.clearAvatars(); }
}
