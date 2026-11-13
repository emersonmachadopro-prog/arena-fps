// =====================================================================
//  physics.js — Collisions et lancer de rayons, sans dépendance à Three.js
//  (utilisable aussi bien dans le navigateur que sur le serveur Node).
//  Les vecteurs sont de simples objets { x, y, z }.
// =====================================================================

import { PLAYER, HITBOX } from './constants.js';

// Est-ce que la boîte du joueur (pieds en pos) chevauche la boîte b ?
function overlaps(pos, halfW, height, b) {
  return (
    pos.x + halfW > b.min[0] && pos.x - halfW < b.max[0] &&
    pos.y + height > b.min[1] && pos.y < b.max[1] &&
    pos.z + halfW > b.min[2] && pos.z - halfW < b.max[2]
  );
}

function collidesAny(pos, halfW, height, boxes) {
  for (const b of boxes) if (overlaps(pos, halfW, height, b)) return true;
  return false;
}

/**
 * Déplace le joueur en gérant les collisions axe par axe.
 * - Glisse le long des murs
 * - Monte automatiquement les petites marches
 * - Retombe sur le sol / les caisses
 * Retourne true si le joueur touche le sol.
 */
export function moveAndCollide(pos, vel, dt, height, boxes, wasGrounded) {
  const halfW = PLAYER.HALF_WIDTH;

  // --- Axes horizontaux (X puis Z) ---
  for (const axis of ['x', 'z']) {
    const idx = axis === 'x' ? 0 : 2;
    pos[axis] += vel[axis] * dt;
    for (const b of boxes) {
      if (!overlaps(pos, halfW, height, b)) continue;
      // Marche : si l'obstacle est bas et qu'on est au sol, on monte dessus
      const stepUp = b.max[1] - pos.y;
      if (wasGrounded && stepUp > 0 && stepUp <= PLAYER.STEP_HEIGHT) {
        const test = { x: pos.x, y: b.max[1] + 0.001, z: pos.z };
        if (!collidesAny(test, halfW, height, boxes)) {
          pos.y = test.y;
          continue;
        }
      }
      // Sinon on repousse le joueur hors de la boîte
      if (vel[axis] > 0) pos[axis] = b.min[idx] - halfW - 0.001;
      else if (vel[axis] < 0) pos[axis] = b.max[idx] + halfW + 0.001;
    }
  }

  // --- Axe vertical ---
  pos.y += vel.y * dt;
  let grounded = false;
  if (pos.y <= 0) { pos.y = 0; vel.y = 0; grounded = true; }
  for (const b of boxes) {
    if (!overlaps(pos, halfW, height, b)) continue;
    if (vel.y <= 0) { pos.y = b.max[1]; grounded = true; }   // atterrit dessus
    else { pos.y = b.min[1] - height - 0.001; }               // se cogne la tête
    vel.y = 0;
  }
  // Petit test "suis-je posé ?" pour ne pas osciller entre sol/air
  if (!grounded) {
    const probe = { x: pos.x, y: pos.y - 0.05, z: pos.z };
    if (pos.y <= 0.001 || collidesAny(probe, halfW, height, boxes)) grounded = vel.y <= 0;
  }
  return grounded;
}

/** Vérifie qu'on peut se relever (rien au-dessus de la tête). */
export function canStand(pos, boxes) {
  return !collidesAny({ x: pos.x, y: pos.y + 0.01, z: pos.z }, PLAYER.HALF_WIDTH, PLAYER.HEIGHT - 0.02, boxes);
}

/**
 * Intersection rayon / boîte (méthode des "slabs").
 * Retourne la distance t, ou Infinity si pas touché.
 */
export function rayBox(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < min[i] || os[i] > max[i]) return Infinity;
    } else {
      let t1 = (min[i] - os[i]) / ds[i];
      let t2 = (max[i] - os[i]) / ds[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/** Distance jusqu'au premier mur/caisse touché par un rayon. */
export function raycastWorld(o, d, boxes, maxDist = 500) {
  let best = maxDist;
  for (const b of boxes) {
    const t = rayBox(o, d, b.min, b.max);
    if (t < best) best = t;
  }
  // Le sol
  if (d.y < 0) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

const ZONES = ['head', 'torso', 'legs'];
/** Calcule les 3 hitbox (tête, torse, jambes) d'un joueur — les mêmes pour tous les skins. */
export function playerHitboxes(p, pad = 0) {
  const hb = p.crouch ? HITBOX.crouch : HITBOX.stand;
  const out = {};
  for (const z of ZONES) {
    const { y, half } = hb[z];
    out[z] = {
      min: [p.x - half - pad, p.y + y[0] - pad, p.z - half - pad],
      max: [p.x + half + pad, p.y + y[1] + pad, p.z + half + pad],
    };
  }
  return out;
}

/**
 * Teste un tir contre une liste de joueurs.
 * targets : [{ id, x, y, z, crouch }]
 * Retourne { id, zone, headshot, dist } du joueur touché le plus proche (ou null)
 * en tenant compte des murs qui bloquent la balle. zone = 'head' | 'torso' | 'legs'.
 */
export function traceShot(origin, dir, targets, boxes, range, pad = 0) {
  const wallDist = raycastWorld(origin, dir, boxes, range);
  let best = null;
  for (const t of targets) {
    const hb = playerHitboxes(t, pad);
    // La tête passe en premier à distance égale (zones qui se touchent)
    for (const zone of ZONES) {
      const d = rayBox(origin, dir, hb[zone].min, hb[zone].max);
      if (d < wallDist && (!best || d < best.dist - 1e-6)) best = { id: t.id, zone, headshot: zone === 'head', dist: d };
    }
  }
  return { hit: best, wallDist };
}

/** Direction de visée à partir du yaw (gauche/droite) et du pitch (haut/bas). */
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}
