// =====================================================================
//  constants.js — Règles du jeu partagées entre le client et le serveur
//  (un seul endroit pour régler l'équilibrage !)
// =====================================================================

export const PLAYER = {
  MAX_HP: 100,
  HALF_WIDTH: 0.35,       // demi-largeur de la "boîte" du joueur (mètres)
  HEIGHT: 1.8,            // hauteur debout
  CROUCH_HEIGHT: 1.2,     // hauteur accroupi
  EYE: 1.65,              // hauteur des yeux debout
  CROUCH_EYE: 1.05,       // hauteur des yeux accroupi
  SPEED: 6.0,             // vitesse de course (m/s)
  CROUCH_SPEED: 2.8,
  SPRINT_SPEED: 8.6,      // vitesse en courant (touche Courir)
  SLIDE_SPEED: 12,        // vitesse au début d'une glissade
  SLIDE_TIME: 0.8,        // durée max d'une glissade (secondes)
  SLIDE_COOLDOWN: 0.6,    // délai avant de pouvoir re-glisser
  JUMP_SPEED: 7.2,
  GRAVITY: 22,
  STEP_HEIGHT: 0.45,      // hauteur de marche franchissable automatiquement
};

// ---------------------------------------------------------------------
//  HITBOX COMMUNE À TOUS LES SKINS : 3 zones (tête / torse / jambes), debout et accroupi.
//  Boîtes centrées sur le joueur (pieds = 0), indépendantes du modèle 3D :
//  un skin ne change JAMAIS la hitbox. Alignées sur character.glb (casquette ≈ 1,84 m,
//  épaules ≈ 1,48 m, hanches ≈ 0,93 m ; accroupi = un genou au sol, bassin descendu de 0,5 m).
//  y = [bas, haut] en mètres, half = demi-largeur (x et z).
// ---------------------------------------------------------------------
export const HITBOX = {
  stand: {
    head: { y: [1.5, 1.86], half: 0.15 },
    torso: { y: [0.9, 1.5], half: 0.25 },
    legs: { y: [0, 0.9], half: 0.19 },
  },
  crouch: {
    head: { y: [0.98, 1.36], half: 0.18 },  // un peu plus large : le buste penche en avant
    torso: { y: [0.46, 0.98], half: 0.28 },
    legs: { y: [0, 0.46], half: 0.3 },      // genou en avant, l'autre au sol
  },
};
export const LEG_DAMAGE = 0.75; // dégâts aux jambes = 75 % des dégâts au corps
/** Dégâts d'une balle selon la zone touchée ('head' | 'torso' | 'legs') */
export function zoneDamage(w, zone) {
  return zone === 'head' ? w.headDamage : w.damage * (zone === 'legs' ? LEG_DAMAGE : 1);
}

// ---------------------------------------------------------------------
//  Armes. La dispersion (spread) est en radians :
//    hipSpread = sans viser (même immobile, c'est imprécis)
//    adsSpread = en visant (clic droit) → très précis
// ---------------------------------------------------------------------
export const WEAPONS = {
  ak: {
    name: 'AK-47',
    slot: 'primary',
    damage: 26,            // dégâts au corps
    headDamage: 85,        // dégâts à la tête
    fireInterval: 0.1,     // 600 coups/min
    auto: true,            // tir automatique
    magSize: 30,
    reserve: 90,           // balles de réserve par manche
    reloadTime: 2.0,       // rechargement "tactique" (il reste des balles)
    reloadEmptyTime: 2.6,  // rechargement à vide (+ armer le levier)
    range: 200,
    hipSpread: 0.045,      // sans viser
    adsSpread: 0.002,      // en visant
    moveSpread: 0.035,     // en plus quand on bouge
    airSpread: 0.1,        // en plus en l'air
    burstSpread: 0.0035,   // en plus à chaque balle tirée d'affilée
    recoilKick: 0.012,     // recul vertical par balle
    adsSpeed: 12,          // vitesse de mise en joue (plus grand = plus rapide)
  },
  kar98k: {
    name: 'Kar98k',
    slot: 'primary',
    damage: 85,            // un tir au corps + n'importe quelle balle = mort
    headDamage: 200,       // un tir à la tête = mort
    fireInterval: 1.25,    // fusil à verrou : il faut réarmer après chaque tir
    auto: false,
    magSize: 5,
    reserve: 20,
    // Rechargement balle par balle : ouvrir + une poussée par balle + fermer
    reloadOpen: 0.45,
    reloadPerRound: 0.42,
    reloadClose: 0.4,
    range: 300,
    hipSpread: 0.11,       // sans viser : vraiment pas précis
    adsSpread: 0,          // dans la lunette immobile : parfait
    moveSpread: 0.06,
    airSpread: 0.2,
    burstSpread: 0,
    recoilKick: 0.06,
    adsSpeed: 13,          // mise en joue rapide
  },
  mp5: {
    name: 'MP5',
    slot: 'primary',
    damage: 21,
    headDamage: 62,
    fireInterval: 0.075,   // 800 coups/min
    auto: true,
    magSize: 30,
    reserve: 120,
    reloadTime: 1.9,
    reloadEmptyTime: 2.4,
    range: 120,
    hipSpread: 0.03,       // précis même sans viser (mitraillette)
    adsSpread: 0.003,
    moveSpread: 0.02,
    airSpread: 0.07,
    burstSpread: 0.0028,
    recoilKick: 0.0075,
    adsSpeed: 16,
    moveSpeed: 1.05,       // un peu plus rapide en courant
  },
  shotgun: {
    name: 'M870',
    slot: 'primary',
    pellets: 9,            // plombs par tir
    pelletSpread: 0.055,   // ouverture de la gerbe
    damage: 13,            // par plomb (au corps)
    headDamage: 24,        // par plomb (à la tête)
    falloff: [7, 26, 0.3], // pleine puissance jusqu'à 7 m, 30 % à 26 m
    fireInterval: 0.9,     // pompe entre deux tirs
    auto: false,
    magSize: 6,
    reserve: 24,
    reloadOpen: 0.3,       // cartouche par cartouche
    reloadPerRound: 0.5,
    reloadClose: 0.35,
    range: 45,
    hipSpread: 0.012,
    adsSpread: 0.004,
    moveSpread: 0.01,
    airSpread: 0.03,
    burstSpread: 0,
    recoilKick: 0.05,
    adsSpeed: 12,
  },
  glock: {
    name: 'Glock 18',
    slot: 'secondary',
    damage: 22,
    headDamage: 70,
    fireInterval: 0.11,    // semi-automatique rapide
    auto: false,
    magSize: 17,
    reserve: 51,
    reloadTime: 1.5,
    reloadEmptyTime: 1.85,
    range: 120,
    hipSpread: 0.022,
    adsSpread: 0.004,
    moveSpread: 0.02,
    airSpread: 0.06,
    burstSpread: 0.004,
    recoilKick: 0.018,
    adsSpeed: 16,
  },
  knife: {
    name: 'Couteau',
    slot: 'melee',
    damage: 55,
    headDamage: 55,
    fireInterval: 0.55,
    range: 2.2,
  },
};

// Armes qu'on peut choisir dans les loadouts
export const PRIMARIES = ['ak', 'mp5', 'shotgun', 'kar98k'];
export const SECONDARIES = ['glock'];
export const GUNS = [...PRIMARIES, ...SECONDARIES];

// ---------------------------------------------------------------------
//  Viseurs (accessoires). zoom = grossissement en visant.
//  overlay = image plein écran en visée (lunettes) au lieu de l'arme.
// ---------------------------------------------------------------------
export const OPTICS = {
  iron:   { name: 'Mire', desc: 'Les organes de visée de l\'arme', zoom: 1.35 },
  reddot: { name: 'Point rouge', desc: 'Viseur rapide et dégagé', zoom: 1.45 },
  mid:    { name: 'Lunette x2.5', desc: 'Moyenne distance', zoom: 2.5, overlay: 'mid' },
  scope:  { name: 'Lunette sniper x4', desc: 'Longue distance', zoom: 4, overlay: 'scope' },
};
// Viseurs disponibles pour chaque arme (le premier = celui par défaut)
export const WEAPON_OPTICS = {
  ak: ['iron', 'reddot', 'mid'],
  kar98k: ['iron', 'reddot', 'mid', 'scope'],
  glock: ['iron'],
  mp5: ['iron', 'reddot', 'mid'],
  shotgun: ['iron', 'reddot'],
};

/**
 * Directions des plombs d'un fusil à pompe : un motif FIXE (le même chez le client
 * et le serveur) autour de la direction visée. Plus juste qu'un tirage au hasard.
 */
export function pelletDirs(dir, spread, count = 9) {
  const up = Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  // deux axes perpendiculaires à la visée
  let rx = dir.y * up.z - dir.z * up.y, ry = dir.z * up.x - dir.x * up.z, rz = dir.x * up.y - dir.y * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * dir.z - rz * dir.y, uy = rz * dir.x - rx * dir.z, uz = rx * dir.y - ry * dir.x;
  const out = [];
  for (let i = 0; i < count; i++) {
    // 1 au centre, puis deux anneaux
    const ring = i === 0 ? 0 : i <= 4 ? 0.5 : 1;
    const a = i * 2.39996 + (i > 4 ? 0.4 : 0);
    const ox = Math.cos(a) * ring * spread, oy = Math.sin(a) * ring * spread;
    const x = dir.x + rx * ox + ux * oy, y = dir.y + ry * ox + uy * oy, z = dir.z + rz * ox + uz * oy;
    const l = Math.hypot(x, y, z);
    out.push({ x: x / l, y: y / l, z: z / l });
  }
  return out;
}
/** Dégâts d'un plomb selon la distance (zone = 'head' | 'torso' | 'legs', ou true = tête) */
export function pelletDamage(w, dist, zone) {
  const [near, far, min] = w.falloff;
  const k = dist <= near ? 1 : dist >= far ? min : 1 - (1 - min) * (dist - near) / (far - near);
  return zoneDamage(w, zone === true ? 'head' : zone === false ? 'torso' : zone) * k;
}
export function validOptic(weapon, optic) {
  return WEAPON_OPTICS[weapon]?.includes(optic) ? optic : WEAPON_OPTICS[weapon]?.[0] || 'iron';
}

// Niveaux des bots
export const BOT_LEVELS = {
  easy:   { name: 'Débutant', reaction: 1.0, spread: 0.075, fireDelay: [0.35, 0.6], headChance: 0.05, speed: 3.6 },
  medium: { name: 'Intermédiaire', reaction: 0.55, spread: 0.04, fireDelay: [0.18, 0.35], headChance: 0.15, speed: 4.5 },
  hard:   { name: 'Fort', reaction: 0.28, spread: 0.018, fireDelay: [0.11, 0.2], headChance: 0.35, speed: 5.5 },
};

export const MATCH = {
  WIN_SCORE: 6,          // première équipe à 6 manches gagne
  FREEZE_TIME: 3,        // secondes d'attente au début de chaque manche
  ROUND_TIME: 90,        // durée max d'une manche
  ROUND_END_TIME: 4,     // pause après une manche
  TICK_RATE: 30,         // mises à jour réseau par seconde
};

export const TEAMS = {
  A: { name: 'Violet', color: 0xa855f7, css: '#a855f7' },
  B: { name: 'Orange', color: 0xff8a1f, css: '#ff8a1f' },
};

/**
 * Durée d'un rechargement selon l'arme et le nombre de balles à mettre.
 * Retourne { time, rounds } (rounds = balles ajoutées).
 */
export function reloadPlan(weaponId, mag, reserve) {
  const w = WEAPONS[weaponId];
  const rounds = Math.min(w.magSize - mag, reserve);
  if (w.reloadPerRound) return { time: w.reloadOpen + rounds * w.reloadPerRound + w.reloadClose, rounds, perRound: true };
  return { time: mag === 0 ? w.reloadEmptyTime : w.reloadTime, rounds, empty: mag === 0 };
}

/** Balles déjà insérées après `elapsed` secondes d'un rechargement balle par balle */
export function roundsInserted(weaponId, elapsed, rounds) {
  const w = WEAPONS[weaponId];
  if (!w.reloadPerRound) return 0;
  return Math.max(0, Math.min(rounds, Math.floor((elapsed - w.reloadOpen) / w.reloadPerRound + 0.15)));
}
