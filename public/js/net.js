// =====================================================================
//  net.js — Mode multijoueur : connexion au serveur Socket.io,
//  lobby, synchronisation des joueurs, manches et score.
//  Le serveur a toujours le dernier mot (PV, kills, score).
//
//  Fluidité & précision :
//  - on estime l'horloge du serveur pour rejouer les mouvements des autres
//    avec 100 ms de retard (interpolation = mouvements fluides)
//  - chaque tir envoie l'instant affiché à l'écran : le serveur "remonte
//    le temps" pour vérifier la touche (compensation de latence)
// =====================================================================
import { PLAYER, WEAPONS, TEAMS, MATCH } from '/shared/constants.js';
import { MAP_BOXES } from '/shared/map.js';
import { raycastWorld, traceShot } from '/shared/physics.js';
import { Avatar } from './avatars.js';
import { sfx } from './audio.js';
import { settings, saveSettings, activeLoadout } from './settings.js';

const INTERP_DELAY = 100;

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
    this.spectating = null; // id du coéquipier qu'on regarde une fois mort
    this.clockOffset = null; // horloge serveur - horloge locale (ms)
    this.specCam = null;

    const s = this.socket;
    s.on('connect_error', () => ui.onError('Impossible de joindre le serveur.'));
    s.on('disconnect', () => { if (this.lobby) ui.onError('Déconnecté du serveur.'); });
    s.on('lobby', (l) => { this.lobby = l; ui.onLobby(l); });
    s.on('matchStart', () => this.onMatchStart());
    s.on('spawn', (sp) => this.onSpawn(sp));
    s.on('state', (st) => this.onState(st));
    s.on('correct', (p) => Object.assign(ctx.player.pos, p));
    s.on('loadout', (e) => {
      if (e.applied) { ctx.weapons.reset(e); ctx.weapons.setVisible(true); }
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

  /** Heure du serveur estimée (ms) */
  serverNow() { return performance.now() + (this.clockOffset ?? 0); }

  // ---------------- Lobby ----------------
  create(name) { return new Promise(r => this.socket.emit('createRoom', { name, skins: settings.skins, loadout: activeLoadout() }, r)); }
  join(code, name) { return new Promise(r => this.socket.emit('joinRoom', { code, name, skins: settings.skins, loadout: activeLoadout() }, r)); }
  addBot(team, level) { this.socket.emit('addBot', { team, level }); }
  removeBot(id) { this.socket.emit('removeBot', id); }
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
    weapons.reset({ primary: sp.primary || 'ak', optic: sp.optic }, { rack: true }); // animation d'armement (D2)
    weapons.setVisible(true);
    this.spectating = null;
    this.specCam = null;
  }

  onState(st) {
    // Horloge : on garde l'estimation la plus "rapide" (paquets les moins retardés)
    const sample = st.t - performance.now();
    this.clockOffset = this.clockOffset === null ? sample : Math.max(sample, this.clockOffset - 2);
    this.state = st;
    const { player, weapons, hud } = this.ctx;

    // Messages de début de manche
    if (st.phase !== this.lastPhase) {
      if (st.phase === 'freeze') hud.message(`Manche ${st.round}`, `${TEAMS.A.name} ${st.score.A} — ${st.score.B} ${TEAMS.B.name}`, MATCH.FREEZE_TIME * 1000);
      if (st.phase === 'live' && this.lastPhase === 'freeze') { hud.message('GO !', '', 800, '#f5b83d'); sfx.roundStart(); }
      this.lastPhase = st.phase;
    }

    const seen = new Set();
    for (const p of st.players) {
      if (p.id === this.myId) {
        // Le serveur décide des PV et de la mort
        player.hp = p.hp;
        if (player.alive && !p.alive) this.onLocalDeath();
        player.alive = p.alive;
        // Resynchronise les munitions si on ne tire / recharge pas en ce moment
        if (!weapons.reloading && !p.reloading && weapons.sinceShot > 0.5 && p.weapon === weapons.current && p.primary === weapons.primary && p.weapon !== 'knife' && !this.spectating) {
          weapons.mag = p.mag; weapons.reserve = p.reserve;
        }
        continue;
      }
      seen.add(p.id);
      let av = this.avatars.get(p.id);
      const lp = this.lobby?.players.find(l => l.id === p.id);
      if (!av) {
        av = new Avatar(this.ctx.scene, p.name, p.team, { skins: lp?.skins, weapon: p.weapon, optic: p.optic, ally: p.team === this.myTeam });
        av.onStep = (pos, loud) => sfx.step({ x: pos.x, y: pos.y + 0.1, z: pos.z }, loud);
        this.avatars.set(p.id, av);
        av.pushSnapshot(st.t, p, true);
      } else {
        av.pushSnapshot(st.t, p, av.dead && p.alive); // téléportation au respawn
      }
      av.setWeapon(p.weapon, p.weapon === p.primary ? p.optic : 'iron');
      // Rechargement (F4) + son positionné
      if (p.reloading && av.reloadT < 0 && p.alive) sfx.remoteReload({ x: p.x, y: p.y + 1.2, z: p.z }, p.weapon);
      av.setReloading(p.reloading);
      if (!p.alive && !av.dead) av.die();       // chute (F5)
      if (p.alive && av.dead) av.revive();
      av.info = p;
      av.team = p.team;
    }
    for (const [id, av] of this.avatars) if (!seen.has(id)) { av.dispose(); this.avatars.delete(id); }
  }

  onLocalDeath() {
    this.ctx.weapons.setVisible(false);
    this.ctx.hud.message('Éliminé', 'Tu regardes un coéquipier jusqu\'à la fin de la manche', 2500, '#ff4d6d');
  }

  onShot(e) {
    const mine = e.id === this.myId;
    // Sang : seulement si le serveur a confirmé la touche
    if (e.hitPlayer) this.ctx.effects.blood(e.point);
    if (mine) return; // notre traçante et notre son sont déjà joués localement
    const av = this.avatars.get(e.id);
    const to = e.point;
    const from = av && !av.dead ? av.muzzleWorld() : { x: e.from.x + e.dir.x * 0.7, y: e.from.y - 0.25, z: e.from.z + e.dir.z * 0.7 }; // depuis le canon de l'arme
    if (e.weapon !== 'knife') {
      this.ctx.effects.tracer(from, to);
      if (e.hitWall) { this.ctx.effects.impact(to); sfx.impact(to); }
      (e.weapon === 'kar98k' ? sfx.sniper : sfx.shot).call(sfx, from);
    } else {
      sfx.knife(from);
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
      const me = this.lobby?.players.find(p => p.id === this.myId);
      this.ctx.hud.kill(e, me && (me.name === e.killer || me.name === e.victim));
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
  reloadCancel() { this.socket.emit('reloadCancel'); }
  switchWeapon(w) { this.socket.emit('switch', w); }
  /** Choix du loadout (index 0..4) : envoyé au serveur qui l'applique au bon moment */
  setLoadout(index) { settings.activeLoadout = index; saveSettings(); this.socket.emit('setLoadout', activeLoadout()); return false; }
  sendLoadout() { this.socket.emit('setLoadout', activeLoadout()); }

  fire(origin, dir, weapon) {
    // rt = instant (horloge serveur) des positions affichées à l'écran
    this.socket.emit('shoot', { dir, weapon, origin, rt: Math.round(this.serverNow() - INTERP_DELAY) });
    // Estimation locale pour la traçante (le serveur confirmera les touches)
    const w = WEAPONS[weapon];
    const targets = [];
    for (const [id, av] of this.avatars) {
      if (!av.dead && av.team !== this.myTeam) {
        const g = av.group.position;
        targets.push({ id, x: g.x, y: g.y, z: g.z, crouch: av.crouch });
      }
    }
    const { hit, wallDist } = traceShot(origin, dir, targets, MAP_BOXES, w.range, 0.1);
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

    // Avatars : mouvement interpolé (fluide) + silhouettes des alliés cachés derrière un mur
    const now = this.serverNow();
    const camPos = camera.position;
    for (const [id, av] of this.avatars) {
      av.update(dt, now);
      av.setVisible(av.info?.team != null && (!av.dead || this.phase !== 'freeze') && id !== this.spectating);
      if (av.ally && !av.dead && id !== this.spectating) {
        const g = av.group.position;
        const to = { x: g.x - camPos.x, y: g.y + 1.2 - camPos.y, z: g.z - camPos.z };
        const d = Math.hypot(to.x, to.y, to.z) || 1;
        const hidden = raycastWorld(camPos, { x: to.x / d, y: to.y / d, z: to.z / d }, MAP_BOXES, d) < d - 0.5;
        av.setXray(hidden);
      } else av.setXray(false);
    }

    // Mort : on suit un coéquipier vivant (caméra lissée, son arme et son HUD)
    if (!player.alive && this.inMatch) {
      let target = this.avatars.get(this.spectating);
      if (!target || target.dead || target.team !== this.myTeam) {
        target = [...this.avatars.entries()].find(([, a]) => !a.dead && a.team === this.myTeam && a.info?.alive);
        this.spectating = target ? target[0] : null;
        target = target ? target[1] : null;
        this.specCam = null;
      }
      if (target) {
        const g = target.group.position;
        const eye = { x: g.x, y: g.y + (target.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE), z: g.z };
        const yaw = target.group.rotation.y, pitch = target.target.pitch || 0;
        if (!this.specCam) this.specCam = { ...eye, yaw, pitch };
        const c = this.specCam, k = Math.min(1, dt * 20);
        c.x += (eye.x - c.x) * k; c.y += (eye.y - c.y) * k; c.z += (eye.z - c.z) * k;
        c.yaw += Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw)) * k;
        c.pitch += (pitch - c.pitch) * k;
        camera.position.set(c.x, c.y, c.z);
        camera.rotation.set(c.pitch, c.yaw, 0);
      }
    }
  }

  /** Infos du coéquipier regardé (pour le HUD et son arme en main) */
  spectateInfo() {
    if (this.ctx.player.alive || !this.spectating) return null;
    const av = this.avatars.get(this.spectating);
    if (!av?.info) return null;
    const lp = this.lobby?.players.find(l => l.id === this.spectating);
    return { ...av.info, skins: lp?.skins, speed: av.speed };
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
