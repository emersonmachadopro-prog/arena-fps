// =====================================================================
//  Bot.js — Intelligence des bots en multijoueur (calculée par le serveur)
//  Trois niveaux : débutant, intermédiaire, fort (voir BOT_LEVELS dans
//  shared/constants.js pour régler leur temps de réaction, leur précision…)
// =====================================================================
import { PLAYER, BOT_LEVELS } from '../shared/constants.js';
import { MAP_BOXES, BOT_WAYPOINTS } from '../shared/map.js';
import { moveAndCollide, raycastWorld, dirFromAngles } from '../shared/physics.js';

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class BotBrain {
  constructor(level) {
    this.cfg = BOT_LEVELS[level] || BOT_LEVELS.medium;
    this.reset();
  }

  reset() {
    this.target = null;      // id de l'ennemi visé
    this.reaction = 0;       // temps depuis qu'il voit l'ennemi
    this.shootCd = 0;
    this.wp = null;          // point de passage visé
    this.repath = 0;
    this.strafe = 1; this.strafeTimer = 0;
    this.stuckTimer = 0; this.lastPos = null;
    this.grounded = true;
  }

  /** Appelé 30 fois par seconde par Room.tick() */
  update(room, p, dt) {
    const cfg = this.cfg;
    if (!p.vel) p.vel = { x: 0, y: 0, z: 0 };
    const canAct = room.phase === 'live';

    const eye = { x: p.x, y: p.y + PLAYER.EYE, z: p.z };
    const enemies = [...room.players.values()].filter(o => o.alive && o.team && o.team !== p.team);

    // --- Cherche l'ennemi visible le plus proche ---
    let best = null, bestDist = Infinity;
    for (const e of enemies) {
      const chest = { x: e.x, y: e.y + (e.crouch ? 0.8 : 1.25), z: e.z };
      const d = { x: chest.x - eye.x, y: chest.y - eye.y, z: chest.z - eye.z };
      const dist = Math.hypot(d.x, d.y, d.z);
      const dir = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
      const visible = raycastWorld(eye, dir, MAP_BOXES, dist) >= dist - 0.3;
      if (visible && dist < bestDist) { best = e; bestDist = dist; }
    }
    if (best?.id !== this.target) { this.target = best?.id || null; this.reaction = 0; }

    let wishX = 0, wishZ = 0;
    if (best && canAct) {
      // --- Combat : vise, se décale, tire ---
      this.reaction += dt;
      const aimHead = Math.random() < cfg.headChance;
      const ay = best.y + (best.crouch ? (aimHead ? 1.15 : 0.7) : (aimHead ? 1.65 : 1.15));
      const dx = best.x - eye.x, dy = ay - eye.y, dz = best.z - eye.z;
      const yawTo = Math.atan2(-dx, -dz);
      const pitchTo = Math.atan2(dy, Math.hypot(dx, dz));
      const turn = Math.min(1, dt * (cfg === BOT_LEVELS.hard ? 14 : cfg === BOT_LEVELS.medium ? 9 : 5));
      p.yaw += angleDiff(yawTo, p.yaw) * turn;
      p.pitch += (pitchTo - p.pitch) * turn;

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeTimer = 0.5 + Math.random() * 1.2; }
      wishX = Math.cos(p.yaw) * this.strafe * 0.7;
      wishZ = -Math.sin(p.yaw) * this.strafe * 0.7;

      // Rechargement automatique
      if (p.mag <= 0 && !p.reloadEnd) room.onReload(p.id);

      this.shootCd -= dt;
      const aimed = Math.abs(angleDiff(yawTo, p.yaw)) < 0.12;
      if (this.reaction > cfg.reaction && this.shootCd <= 0 && aimed && p.mag > 0 && !p.reloadEnd) {
        const s = cfg.spread * (0.6 + Math.random() * 0.8);
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
        const dir = dirFromAngles(p.yaw + Math.cos(a) * r, p.pitch + Math.sin(a) * r);
        p.lastShot = 0; // la cadence est gérée ici
        room.fire(p, 'ak', dir);
        this.shootCd = cfg.fireDelay[0] + Math.random() * (cfg.fireDelay[1] - cfg.fireDelay[0]);
      }
    } else if (canAct) {
      // --- Patrouille : se dirige vers l'ennemi le plus proche en passant par les points de passage ---
      this.reaction = Math.max(0, this.reaction - dt);
      this.repath -= dt;
      if (!this.wp || this.repath <= 0 || Math.hypot(this.wp[0] - p.x, this.wp[1] - p.z) < 1) {
        const e = enemies[Math.floor(Math.random() * enemies.length)];
        const goal = e ? [e.x, e.z] : [0, 0];
        // Point de passage pas trop loin de nous qui nous rapproche du but
        // On ne garde que les points qu'il peut atteindre en ligne droite (pas de mur entre les deux)
        const from = { x: p.x, y: p.y + 0.9, z: p.z };
        let reachable = BOT_WAYPOINTS.filter(w => {
          const dx = w[0] - p.x, dz = w[1] - p.z, d = Math.hypot(dx, dz);
          if (d < 1.5) return false;
          return raycastWorld(from, { x: dx / d, y: 0, z: dz / d }, MAP_BOXES, d) >= d - 0.4;
        });
        if (!reachable.length) reachable = BOT_WAYPOINTS;
        const options = reachable
          .map(w => ({ w, score: Math.hypot(w[0] - goal[0], w[1] - goal[1]) + Math.hypot(w[0] - p.x, w[1] - p.z) * 0.6 + Math.random() * 6 }))
          .sort((a, b) => a.score - b.score);
        this.wp = options[0].w;
        this.repath = 3 + Math.random() * 3;
      }
      const dx = this.wp[0] - p.x, dz = this.wp[1] - p.z, l = Math.hypot(dx, dz) || 1;
      wishX = dx / l; wishZ = dz / l;
      p.yaw += angleDiff(Math.atan2(-wishX, -wishZ), p.yaw) * Math.min(1, dt * 6);
      p.pitch *= 0.8;
    }

    // --- Déplacement avec collisions (même physique que les joueurs) ---
    p.vel.x = wishX * cfg.speed;
    p.vel.z = wishZ * cfg.speed;
    p.vel.y -= PLAYER.GRAVITY * dt;
    this.grounded = moveAndCollide(p, p.vel, dt, PLAYER.HEIGHT, MAP_BOXES, this.grounded);
    p.crouch = false;
    p.weapon = 'ak';

    // Bloqué contre un mur ? Saute et change de chemin
    this.stuckTimer += dt;
    if (this.stuckTimer > 1) {
      if (this.lastPos && Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) < 0.6 && (wishX || wishZ) && !best) {
        this.wp = null;
        if (this.grounded) p.vel.y = PLAYER.JUMP_SPEED;
      }
      this.lastPos = { x: p.x, z: p.z }; this.stuckTimer = 0;
    }
  }
}

