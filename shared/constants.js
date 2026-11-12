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

// Zones touchables (hitbox) : tronc + tête, relatives aux pieds du joueur
export const HITBOX = {
  stand:  { body: [0, 1.45], head: [1.45, 1.85], bodyHalf: 0.38, headHalf: 0.22 },
  crouch: { body: [0, 0.95], head: [0.95, 1.35], bodyHalf: 0.38, headHalf: 0.22 },
};

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
    reloadTime: 2.3,
    range: 200,
    hipSpread: 0.045,      // sans viser
    adsSpread: 0.002,      // en visant
    moveSpread: 0.035,     // en plus quand on bouge
    airSpread: 0.1,        // en plus en l'air
    burstSpread: 0.0035,   // en plus à chaque balle tirée d'affilée
    recoilKick: 0.012,     // recul vertical par balle
    adsZoom: 1.3,          // zoom en visant
    adsSpeed: 8,           // vitesse de mise en joue
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
    reloadTime: 3.0,
    range: 300,
    hipSpread: 0.11,       // sans viser : vraiment pas précis
    adsSpread: 0,          // dans la lunette immobile : parfait
    moveSpread: 0.06,
    airSpread: 0.2,
    burstSpread: 0,
    recoilKick: 0.06,
    adsZoom: 4,            // lunette x4
    adsSpeed: 5,
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

// Armes principales qu'on peut choisir (touche M)
export const PRIMARIES = ['ak', 'kar98k'];

export const MATCH = {
  WIN_SCORE: 6,          // première équipe à 6 manches gagne
  FREEZE_TIME: 3,        // secondes d'attente au début de chaque manche
  ROUND_TIME: 90,        // durée max d'une manche
  ROUND_END_TIME: 4,     // pause après une manche
  TICK_RATE: 20,         // mises à jour réseau par seconde
};

export const TEAMS = {
  A: { name: 'Violet', color: 0xa855f7, css: '#a855f7' },
  B: { name: 'Orange', color: 0xff8a1f, css: '#ff8a1f' },
};
