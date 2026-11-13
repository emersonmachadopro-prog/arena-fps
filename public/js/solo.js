// =====================================================================
//  solo.js — Mode entraînement hors-ligne avec des bots.
//  Tout est calculé dans le navigateur (pas besoin du multijoueur).
// =====================================================================
import { PLAYER, WEAPONS, pelletDirs, pelletDamage } from '/shared/constants.js';
import { MAP_BOXES, SPAWNS, BOT_WAYPOINTS } from '/shared/map.js';
import { moveAndCollide, raycastWorld, traceShot, dirFromAngles } from '/shared/physics.js';
import { Avatar } from './avatars.js';
import { sfx } from './audio.js';
import { settings, saveSettings, activeLoadout } from './settings.js';
import { CHARACTER_SKINS } from '/shared/skins.js';

const SKIN_IDS = Object.keys(CHARACTER_SKINS);

const BOT_NAMES = ['Bot Alpha', 'Bot Bravo', 'Bot Charlie'];
const BOT_SPEED = 3.6;

export class SoloSession {
  /**
   * ctx = { scene, effects, hud, player, weapons }
   * botsShoot = true si les bots tirent sur le joueur
   */
  constructor(ctx, botsShoot) {
    this.ctx = ctx;
    this.botsShoot = botsShoot;
    this.kills = 0;
    this.streak = 0;
    this.deaths = 0;
    this.respawnTimer = 0;
    this.bots = BOT_NAMES.map((name, i) => this.makeBot(name, i));
    this.spawnPlayer();
    ctx.hud.message('Entraînement', botsShoot ? 'Les bots ripostent !' : 'Bots passifs — entraîne ta visée', 2500);
  }

  makeBot(name, i) {
    const bot = {
      name, team: 'B', hp: PLAYER.MAX_HP, alive: true,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0, crouch: false, grounded: true,
      wp: null, stuck: 0, lastPos: null,
      reaction: 0, shootCd: 0, strafe: 1, strafeTimer: 0,
      respawn: 0, kills: 0, deaths: 0,
      avatar: null,
      _avatar: new Avatar(this.ctx.scene, name, 'B', { skins: { character: SKIN_IDS[(i + 1) % SKIN_IDS.length] }, weapon: 'ak' }),
    };
    bot.avatar = bot._avatar; delete bot._avatar;
    bot.avatar.onStep = (pos, loud) => sfx.step({ x: pos.x, y: pos.y + 0.1, z: pos.z }, loud);
    this.respawnBot(bot, BOT_WAYPOINTS[6 + i * 4] || BOT_WAYPOINTS[i]);
    return bot;
  }

  respawnBot(bot, at) {
    // On choisit un point de passage loin du joueur
    if (!at) {
      const p = this.ctx.player.pos;
      const far = BOT_WAYPOINTS.filter(([x, z]) => Math.hypot(x - p.x, z - p.z) > 12);
      at = far[Math.floor(Math.random() * far.length)] || BOT_WAYPOINTS[0];
    }
    Object.assign(bot, { hp: PLAYER.MAX_HP, alive: true, reaction: 0, wp: null, stuck: 0 });
    bot.pos = { x: at[0], y: 0, z: at[1] };
    bot.vel = { x: 0, y: 0, z: 0 };
    bot.avatar.revive();
    bot.avatar.setTarget({ ...bot.pos, yaw: bot.yaw, pitch: 0 }, true);
    bot.avatar.setVisible(true);
  }

  spawnPlayer() {
    const s = SPAWNS.A[Math.floor(Math.random() * SPAWNS.A.length)];
    this.ctx.player.spawn(s);
    this.ctx.weapons.reset(activeLoadout(), { rack: true }); // loadout choisi avec M + animation d'armement
    this.ctx.weapons.setVisible(true);
  }

  // ----- Interface commune avec le mode multijoueur -----
  canMove() { return this.ctx.player.alive; }
  canFire() { return this.ctx.player.alive; }
  reload() {}
  switchWeapon() {}

  /** Choix d'arme (touche M) : appliqué à la prochaine apparition. Retourne true si appliqué tout de suite. */
  /** Choix du loadout (touche M). En entraînement : changement immédiat si on est en vie. */
  setLoadout(index) {
    settings.activeLoadout = index; saveSettings();
    if (this.ctx.player.alive) { this.ctx.weapons.reset(activeLoadout()); this.ctx.weapons.setVisible(true); return true; }
    return false;
  }

  /** Le joueur tire : on calcule directement les dégâts ici */
  fire(origin, dir, weapon) {
    const w = WEAPONS[weapon];
    const targets = this.bots.filter(b => b.alive).map(b => ({ id: b, x: b.pos.x, y: b.pos.y, z: b.pos.z, crouch: false }));
    if (w.pellets) {
      // Fusil à pompe : on additionne les plombs par bot, puis un seul "coup" par bot touché
      const per = new Map();
      const pellets = pelletDirs(dir, w.pelletSpread, w.pellets).map(d => {
        const r = traceShot(origin, d, targets, MAP_BOXES, w.range);
        if (!r.hit) return { dir: d, dist: Math.min(r.wallDist, w.range), hitWall: r.wallDist < w.range };
        const e = per.get(r.hit.id) || { dmg: 0, head: false };
        e.dmg += pelletDamage(w, r.hit.dist, r.hit.headshot); e.head ||= r.hit.headshot;
        per.set(r.hit.id, e);
        return { dir: d, dist: r.hit.dist, hitPlayer: true, confirmed: true };
      });
      for (const [bot, e] of per) this.hitBot(bot, Math.round(e.dmg), e.head, weapon);
      return { pellets, dist: pellets[0].dist };
    }
    const { hit, wallDist } = traceShot(origin, dir, targets, MAP_BOXES, w.range);
    if (hit) {
      this.hitBot(hit.id, hit.headshot ? w.headDamage : w.damage, hit.headshot, weapon);
      return { dist: hit.dist, hitPlayer: true, confirmed: true }; // en solo, la touche est sûre
    }
    return { dist: Math.min(wallDist, w.range), hitWall: wallDist < w.range };
  }

  /** Dégâts sur un bot (+ marqueur, kill, killfeed) */
  hitBot(bot, amount, headshot, weapon) {
    const hit = { headshot };
    {
      bot.hp -= amount;
      bot.reaction = Math.max(bot.reaction, 0.4); // le bot réagit quand on le touche
      const kill = bot.hp <= 0;
      sfx.hit(hit.headshot);
      this.ctx.hud.hitmarker(hit.headshot);
      if (kill) {
        bot.alive = false; bot.deaths++; bot.respawn = 3;
        bot.avatar.die(); // il tombe au sol
        this.kills++;
        this.streak++;
        sfx.killStreak(this.streak, settings.killSound);
        this.ctx.hud.kill({ killer: 'Toi', killerTeam: 'A', victim: bot.name, victimTeam: 'B', weapon, headshot: hit.headshot }, true);
        this.ctx.hud.killBanner(bot.name, hit.headshot, this.streak);
      }
    }
  }

  update(dt) {
    const player = this.ctx.player;

    // Réapparition du joueur après sa mort
    if (!player.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) { this.spawnPlayer(); this.ctx.hud.message(''); }
    }

    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.avatar.update(dt); // animation de chute
        bot.respawn -= dt;
        if (bot.respawn <= 0) this.respawnBot(bot);
        continue;
      }
      this.updateBot(bot, dt);
      bot.avatar.setTarget({ ...bot.pos, yaw: bot.yaw, pitch: bot.pitch, crouch: false });
      bot.avatar.update(dt);
    }
  }

  updateBot(bot, dt) {
    const player = this.ctx.player;
    const eye = { x: bot.pos.x, y: bot.pos.y + PLAYER.EYE, z: bot.pos.z };
    const pe = player.eye();
    const to = { x: pe.x - eye.x, y: pe.y - 0.25 - eye.y, z: pe.z - eye.z };
    const dist = Math.max(1e-4, Math.hypot(to.x, to.y, to.z)); // jamais de division par 0 (→ NaN)
    const dir = { x: to.x / dist, y: to.y / dist, z: to.z / dist };
    const sees = player.alive && dist < 45 && raycastWorld(eye, dir, MAP_BOXES, dist) >= dist - 0.3;

    let wishX = 0, wishZ = 0;
    if (sees) {
      // Il voit le joueur : il le vise et se décale sur les côtés
      bot.reaction += dt;
      const targetYaw = Math.atan2(-dir.x, -dir.z);
      let dy = Math.atan2(Math.sin(targetYaw - bot.yaw), Math.cos(targetYaw - bot.yaw));
      bot.yaw += dy * Math.min(1, dt * 8);
      bot.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y))); // un arrondi > 1 donnerait NaN
      if (!Number.isFinite(bot.yaw)) bot.yaw = 0;
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) { bot.strafe = Math.random() < 0.5 ? -1 : 1; bot.strafeTimer = 0.6 + Math.random(); }
      wishX = Math.cos(bot.yaw) * bot.strafe;
      wishZ = -Math.sin(bot.yaw) * bot.strafe;

      bot.shootCd -= dt;
      if (this.botsShoot && bot.reaction > 0.7 && bot.shootCd <= 0) {
        this.botShoot(bot, eye, dist);
        bot.shootCd = 0.18 + Math.random() * 0.25;
      }
    } else {
      bot.reaction = Math.max(0, bot.reaction - dt);
      // Patrouille entre les points de passage
      if (!bot.wp || Math.hypot(bot.wp[0] - bot.pos.x, bot.wp[1] - bot.pos.z) < 1) {
        bot.wp = BOT_WAYPOINTS[Math.floor(Math.random() * BOT_WAYPOINTS.length)];
      }
      const dx = bot.wp[0] - bot.pos.x, dz = bot.wp[1] - bot.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      wishX = dx / l; wishZ = dz / l;
      const targetYaw = Math.atan2(-wishX, -wishZ);
      bot.yaw += Math.atan2(Math.sin(targetYaw - bot.yaw), Math.cos(targetYaw - bot.yaw)) * Math.min(1, dt * 6);
      bot.pitch = 0;
    }

    bot.vel.x = wishX * BOT_SPEED;
    bot.vel.z = wishZ * BOT_SPEED;
    bot.vel.y -= PLAYER.GRAVITY * dt;
    bot.grounded = moveAndCollide(bot.pos, bot.vel, dt, PLAYER.HEIGHT, MAP_BOXES, bot.grounded);

    // Bloqué contre un mur ? On saute et on change de destination
    bot.stuck += dt;
    if (bot.stuck > 1) {
      if (bot.lastPos && Math.hypot(bot.pos.x - bot.lastPos.x, bot.pos.z - bot.lastPos.z) < 0.8 && !sees) {
        bot.wp = null;
        if (bot.grounded) bot.vel.y = PLAYER.JUMP_SPEED;
      }
      bot.lastPos = { ...bot.pos }; bot.stuck = 0;
    }
  }

  botShoot(bot, eye, dist) {
    const player = this.ctx.player;
    const spread = 0.035 + dist * 0.0015;
    const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
    const d = dirFromAngles(bot.yaw + Math.cos(a) * r, bot.pitch + Math.sin(a) * r);
    const target = [{ id: 'me', x: player.pos.x, y: player.pos.y, z: player.pos.z, crouch: player.crouch }];
    const { hit, wallDist } = traceShot(eye, d, target, MAP_BOXES, 200);
    const end = hit ? hit.dist : wallDist;
    const muzzle = bot.avatar.muzzleWorld(); // la traçante part du canon de son arme
    this.ctx.effects.tracer(muzzle, { x: eye.x + d.x * end, y: eye.y + d.y * end, z: eye.z + d.z * end });
    sfx.shot(muzzle);
    if (bot.avatar.muzzleWorld) {
      const len = Math.hypot(d.x, d.z) || 1;
      this.ctx.effects.shell('ak', { x: muzzle.x - d.x * 0.42, y: muzzle.y + 0.03, z: muzzle.z - d.z * 0.42 }, { x: -d.z / len * 1.8, y: 1.7, z: d.x / len * 1.8 }, bot.avatar.group.position.y);
    }
    if (!hit) return;

    player.hp -= hit.headshot ? 40 : 14; // les bots font moins mal que l'AK du joueur
    sfx.hurt();
    const yawTo = Math.atan2(-(bot.pos.x - player.pos.x), -(bot.pos.z - player.pos.z));
    this.ctx.hud.damage(-(yawTo - player.yaw));
    if (player.hp <= 0) {
      player.hp = 0; player.alive = false;
      this.deaths++; bot.kills++; this.streak = 0;
      this.respawnTimer = 3;
      this.ctx.weapons.setVisible(false);
      this.ctx.hud.kill({ killer: bot.name, killerTeam: 'B', victim: 'Toi', victimTeam: 'A', weapon: 'ak', headshot: hit.headshot }, true);
      this.ctx.hud.message('Éliminé', 'Réapparition dans 3 secondes…', 3000, '#ff4d6d');
    }
  }

  /** Infos pour le HUD */
  hudState() {
    return {
      score: { A: this.kills, B: this.deaths },
      timerLabel: 'SOLO',
      roundLabel: 'Kills (violet) / Morts (orange)',
    };
  }

  scoreboardPlayers() {
    return [
      { name: 'Toi', team: 'A', kills: this.kills, deaths: this.deaths, alive: this.ctx.player.alive, ping: 0 },
      ...this.bots.map(b => ({ name: b.name, team: 'B', kills: b.kills, deaths: b.deaths, alive: b.alive, ping: -1 })),
    ];
  }

  dispose() { for (const b of this.bots) b.avatar.dispose(); }
}
