// =====================================================================
//  weapons.js — Armes du joueur local, vues à la première personne :
//  modèles 3D détaillés (formes arrondies/extrudées) avec mains à doigts,
//  viseurs, tir, visée, recul, et animations :
//   - rechargement tactique / à vide (AK), balle par balle (Kar98k)
//   - inspection (Y) : vérif de la chambre (AK), culasse + lunette (Kar),
//     couteau papillon
//   - sortie : couteau lancé et rattrapé, armement au début de manche
//   - balancement en 8, inertie de la souris, atterrissage, course, glissade
// =====================================================================
import * as THREE from 'three';
import { WEAPONS, PLAYER, OPTICS, validOptic, reloadPlan, roundsInserted, pelletDirs } from '/shared/constants.js';
import { WEAPON_SKINS, CHARACTER_SKINS } from '/shared/skins.js';
import { dirFromAngles } from '/shared/physics.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { mat, box, rbox, cyl, capsule, extrude, makeHand, orientHand, skinMaterials } from './models.js';
import { fabricTex } from './textures.js';

// Position de l'arme à l'écran sans viser (hip) + distance en visée (adsZ)
const POSES = {
  ak:     { hip: [0.17, -0.17, -0.62], adsZ: { iron: -0.52, reddot: -0.44, mid: -0.38 } },
  kar98k: { hip: [0.19, -0.2, -0.7],   adsZ: { iron: -0.68, reddot: -0.56, mid: -0.5, scope: -0.3 } },
  mp5:    { hip: [0.16, -0.16, -0.5],   adsZ: { iron: -0.47, reddot: -0.38, mid: -0.33 } },
  shotgun: { hip: [0.17, -0.16, -0.6], adsZ: { iron: -0.62, reddot: -0.5 } },
  glock:  { hip: [0.115, -0.135, -0.4], adsZ: { iron: -0.36 } },
};
const INSPECT_TIME = { butterfly: 3.4, ak: 3.0, mp5: 2.8, shotgun: 3.2, kar98k: 3.6, glock: 2.6, knife: 2.8 };

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Animation par "images clés" : keys = [[t, {valeurs}], ...] (t de 0 à 1).
 * Retourne les valeurs interpolées en douceur au temps t.
 */
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i], [t1, b] = keys[i + 1];
    if (t <= t1) {
      const k = ease((t - t0) / (t1 - t0 || 1));
      const out = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) out[key] = (a[key] || 0) + ((b[key] || 0) - (a[key] || 0)) * k;
      return out;
    }
  }
  return keys[keys.length - 1][1];
}

// ---------------------------------------------------------------------
//  Images clés (décalages par rapport au repos)
//  px/py/pz, rx/ry/rz = arme · magY/magR = chargeur · hx/hy/hz = main gauche
//  ch = levier d'armement tiré (0..1) · bolt = culasse ouverte (0..1)
// ---------------------------------------------------------------------
const TILT = { rz: 0.42, rx: 0.1, py: -0.03, px: -0.02 };
const ANIMS = {
  // A1 : il reste des balles → chargeur sorti, nouveau chargeur, claque
  akTactical: {
    keys: [
      [0, {}],
      [0.12, { ...TILT, hy: -0.06, hz: 0.24 }],
      [0.22, { ...TILT, hy: -0.08, hz: 0.24, magY: -0.02 }],
      [0.36, { ...TILT, hy: -0.5, hz: 0.24, magY: -0.42, magR: 0.6 }],
      [0.5, { ...TILT, hy: -0.5, hz: 0.24, magY: -0.42, magR: 0.6 }],
      [0.68, { ...TILT, hy: -0.12, hz: 0.24, magY: -0.04, magR: 0.1 }],
      [0.76, { rz: 0.36, rx: 0.06, py: -0.022, px: -0.015, hy: -0.07, hz: 0.24 }], // clac !
      [1, {}],
    ],
    events: [[0.2, 'magOut'], [0.72, 'magIn']],
  },
  // A2 : à vide → pareil + on tire le levier d'armement
  akEmpty: {
    keys: [
      [0, {}],
      [0.1, { ...TILT, hy: -0.06, hz: 0.24 }],
      [0.17, { ...TILT, hy: -0.08, hz: 0.24, magY: -0.02 }],
      [0.28, { ...TILT, hy: -0.5, hz: 0.24, magY: -0.42, magR: 0.6 }],
      [0.38, { ...TILT, hy: -0.5, hz: 0.24, magY: -0.42, magR: 0.6 }],
      [0.52, { ...TILT, hy: -0.12, hz: 0.24, magY: -0.04, magR: 0.1 }],
      [0.58, { rz: 0.36, rx: 0.06, py: -0.022, hy: -0.07, hz: 0.24 }],
      [0.68, { rz: 0.15, rx: 0.04, ry: 0.15, py: -0.015, hx: 0.085, hy: 0.055, hz: 0.33 }], // main sur le levier
      [0.76, { rz: 0.14, rx: 0.05, ry: 0.15, py: -0.015, pz: 0.02, hx: 0.085, hy: 0.055, hz: 0.43, ch: 1 }], // on tire
      [0.8, { rz: 0.12, rx: 0.08, ry: 0.15, py: -0.012, hx: 0.085, hy: 0.06, hz: 0.36 }], // on lâche
      [1, {}],
    ],
    events: [[0.15, 'magOut'], [0.55, 'magIn'], [0.72, 'chargeBack'], [0.78, 'chargeRelease']],
  },
  // C2 : vérification de la chambre (on tire un peu le levier pour regarder)
  akInspect: {
    keys: [
      [0, {}],
      [0.16, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.65, rz: -0.25, rx: 0.08 }],             // on montre le côté droit
      [0.28, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.7, rz: -0.22, rx: 0.08, hx: 0.085, hy: 0.055, hz: 0.33 }],
      [0.4, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.72, rz: -0.22, rx: 0.08, hx: 0.085, hy: 0.055, hz: 0.38, ch: 0.45 }], // on entrouvre
      [0.62, { px: -0.07, py: 0.055, pz: 0.13, ry: 0.8, rz: -0.18, rx: 0.12, hx: 0.085, hy: 0.055, hz: 0.38, ch: 0.45 }], // on regarde
      [0.7, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.7, rz: -0.22, rx: 0.08, hx: 0.085, hy: 0.055, hz: 0.33 }],
      [0.82, { px: -0.03, py: 0.02, pz: 0.05, ry: 0.3, rz: -0.1 }],
      [1, {}],
    ],
    events: [[0.05, 'cloth'], [0.34, 'chargeBack'], [0.68, 'chargeRelease']],
  },
  // C3 : Kar → on ouvre la culasse, on regarde, on referme, on caresse la lunette
  karInspect: {
    keys: [
      [0, {}],
      [0.14, { px: -0.1, py: 0.05, pz: 0.14, ry: -0.9, rz: 0.25 }],
      [0.3, { px: -0.1, py: 0.05, pz: 0.14, ry: -1.0, rz: 0.22 }],
      [0.4, { px: -0.05, py: 0.06, pz: 0.12, ry: 0.4, rz: -0.35, rx: 0.15 }],
      [0.46, { px: -0.05, py: 0.06, pz: 0.12, ry: 0.4, rz: -0.35, rx: 0.15, bolt: 1 }],
      [0.6, { px: -0.05, py: 0.065, pz: 0.13, ry: 0.45, rz: -0.38, rx: 0.18, bolt: 1 }],
      [0.66, { px: -0.05, py: 0.06, pz: 0.12, ry: 0.4, rz: -0.35, rx: 0.15 }],
      [0.74, { px: -0.03, py: 0.04, pz: 0.08, ry: 0.15, rz: -0.12, hx: 0.01, hy: 0.15, hz: 0.25 }], // main sur la lunette
      [0.88, { px: -0.03, py: 0.04, pz: 0.08, ry: 0.15, rz: -0.12, hx: 0.01, hy: 0.15, hz: 0.42 }], // caresse
      [1, {}],
    ],
    events: [[0.05, 'cloth'], [0.42, 'boltUp'], [0.45, 'boltBack'], [0.62, 'boltForward'], [0.65, 'boltDown'], [0.76, 'cloth']],
  },
  // Couteau de combat : animations simples (on regarde la lame d'un côté puis de l'autre)
  knifeInspect: {
    keys: [
      [0, {}],
      [0.2, { px: -0.1, py: 0.06, pz: 0.1, ry: -0.9, rz: 0.5, rx: -0.2 }],
      [0.45, { px: -0.1, py: 0.06, pz: 0.1, ry: -0.95, rz: 0.5, rx: -0.2 }],
      [0.62, { px: -0.08, py: 0.06, pz: 0.1, ry: 0.4, rz: -0.6, rx: 0.2 }],
      [0.85, { px: -0.08, py: 0.06, pz: 0.1, ry: 0.42, rz: -0.6, rx: 0.2 }],
      [1, {}],
    ],
    events: [[0.05, 'cloth'], [0.55, 'cloth']],
  },
  knifeDraw: {
    keys: [[0, { py: -0.2, rx: -0.6 }], [0.6, { py: 0.01 }], [1, {}]],
    events: [[0.05, 'cloth']],
  },
  // ---- Couteau papillon ----
  // bs = rotation autour de l'annulaire, ha / hb = ouverture des deux manches (0 = ouvert, π = fermé)
  bflyDraw: {
    keys: [
      [0, { py: -0.2, rx: -0.5, ha: Math.PI, hb: Math.PI }],
      [0.2, { py: 0, ha: Math.PI, hb: Math.PI }],
      [0.4, { ha: 0, hb: Math.PI, bs: Math.PI }],             // le manche "sûr" s'ouvre en tournant
      [0.62, { ha: 0, hb: 0, bs: Math.PI * 2 }],               // puis l'autre : lame sortie
      [0.8, { bs: Math.PI * 2, rz: 0.1 }],
      [1, { bs: Math.PI * 2 }],
    ],
    events: [[0.05, 'cloth'], [0.36, 'knifeFlip'], [0.58, 'knifeFlip'], [0.64, 'magIn']],
  },
  bflyInspect: {
    keys: [
      [0, {}],
      [0.08, { px: -0.08, py: 0.06, pz: 0.08, ry: -0.5, rz: 0.35 }],
      // rotations autour de l'annulaire : fermé, ouvert, fermé, ouvert…
      [0.18, { px: -0.08, py: 0.06, pz: 0.08, ry: -0.5, rz: 0.35, bs: Math.PI, hb: Math.PI }],
      [0.28, { px: -0.08, py: 0.06, pz: 0.08, ry: -0.5, rz: 0.35, bs: Math.PI * 2, ha: Math.PI, hb: Math.PI }],
      [0.38, { px: -0.08, py: 0.06, pz: 0.08, ry: -0.5, rz: 0.35, bs: Math.PI * 3, ha: 0, hb: Math.PI }],
      [0.48, { px: -0.08, py: 0.06, pz: 0.08, ry: -0.5, rz: 0.35, bs: Math.PI * 4, ha: 0, hb: 0 }],
      // "aerial" : le couteau tourne sur lui-même au-dessus de la main
      [0.6, { px: -0.06, py: 0.1, pz: 0.08, ry: -0.3, rz: 0.2, bs: Math.PI * 6, ha: Math.PI * 0.5, hb: Math.PI * 1.5 }],
      [0.7, { px: -0.08, py: 0.06, pz: 0.08, ry: -0.5, rz: 0.35, bs: Math.PI * 8, ha: 0, hb: 0 }],
      [0.82, { px: -0.07, py: 0.05, pz: 0.07, ry: -1.1, rz: 0.6, bs: Math.PI * 8 }],       // on admire la lame
      [1, { bs: Math.PI * 8 }],
    ],
    events: [[0.04, 'cloth'], [0.16, 'knifeFlip'], [0.26, 'knifeFlip'], [0.36, 'knifeFlip'], [0.46, 'knifeFlip'], [0.47, 'magIn'], [0.56, 'knifeFlip'], [0.68, 'knifeFlip'], [0.7, 'magIn']],
  },
  knifeInspectOld: {
    keys: [
      [0, {}],
      [0.12, { px: -0.1, py: 0.06, pz: 0.08, ry: -0.6, rz: 0.4 }],
      [0.3, { px: -0.1, py: 0.07, pz: 0.08, ry: -0.6, rz: 0.4, kspin: Math.PI * 2 }],
      [0.48, { px: -0.1, py: 0.07, pz: 0.08, ry: -0.6, rz: 0.4, kspin: Math.PI * 4, kflip: Math.PI }],
      [0.66, { px: -0.1, py: 0.07, pz: 0.08, ry: -0.6, rz: 0.4, kspin: Math.PI * 6, kflip: Math.PI * 2 }],
      [0.82, { px: -0.08, py: 0.05, pz: 0.06, ry: -1.1, rz: 0.6, kspin: Math.PI * 6, kflip: Math.PI * 2 }],
      [1, { kspin: Math.PI * 6, kflip: Math.PI * 2 }],
    ],
    events: [[0.18, 'knifeFlip'], [0.27, 'knifeFlip'], [0.38, 'knifeFlip'], [0.46, 'knifeFlip'], [0.56, 'knifeFlip'], [0.64, 'knifeFlip']],
  },
  knifeDrawOld: {
    keys: [
      [0, { py: -0.2, rx: -0.5 }],
      [0.25, { py: -0.02 }],
      [0.32, { py: 0, ktoss: 0 }],
      [0.6, { ktoss: 0.22, kflip: Math.PI * 1.2 }],
      [0.88, { ktoss: 0, kflip: Math.PI * 2 }],
      [1, { kflip: Math.PI * 2 }],
    ],
    events: [[0.05, 'cloth'], [0.3, 'knifeFlip'], [0.88, 'magIn']],
  },
  // D2 : armement au début de la manche
  akRack: {
    keys: [
      [0, { py: -0.15, rx: -0.4 }],
      [0.25, { rz: 0.15, ry: 0.15, hx: 0.085, hy: 0.055, hz: 0.33 }],
      [0.45, { rz: 0.14, ry: 0.15, pz: 0.02, hx: 0.085, hy: 0.055, hz: 0.43, ch: 1 }],
      [0.55, { rz: 0.12, ry: 0.15, rx: 0.06, hx: 0.085, hy: 0.06, hz: 0.36 }],
      [1, {}],
    ],
    events: [[0.02, 'cloth'], [0.4, 'chargeBack'], [0.5, 'chargeRelease']],
  },
  karRack: {
    keys: [
      [0, { py: -0.15, rx: -0.4 }],
      [0.25, { rz: -0.15 }],
      [0.4, { rz: -0.15, bolt: 1 }],
      [0.6, { rz: -0.15, bolt: 1 }],
      [0.75, { rz: -0.1 }],
      [1, {}],
    ],
    events: [[0.02, 'cloth'], [0.28, 'boltUp'], [0.38, 'boltBack'], [0.62, 'boltForward'], [0.72, 'boltDown']],
  },
};
// ---- Glock 18 ----
const GTILT = { rz: 0.62, rx: 0.32, py: 0.04, px: -0.1, pz: 0.05 }; // pistolet penché : on voit le bas de la poignée
Object.assign(ANIMS, {
  glockTactical: {
    keys: [
      [0, {}],
      [0.14, { ...GTILT, magY: -0.02 }],
      [0.24, { ...GTILT, magY: -0.3, magR: 0.25, hy: -0.06 }],                      // le chargeur vide tombe
      [0.36, { ...GTILT, magY: -0.3, magR: 0.25, hy: -0.32, hx: -0.02, hz: 0.02 }], // la main gauche va chercher un chargeur
      [0.48, { ...GTILT, magY: -0.16, magR: 0.12, hy: -0.2, hx: 0.03, hz: -0.01 }], // elle l'amène sous la poignée
      [0.6, { ...GTILT, magY: -0.06, magR: 0.02, hy: -0.1, hx: 0.035, hz: -0.01 }], // on l'engage…
      [0.68, { ...GTILT, magY: 0, hy: -0.055, hx: 0.035, hz: -0.01, rx: 0.4 }],     // …et on le claque dedans
      [0.8, { rz: 0.2, rx: 0.06, py: -0.01 }],
      [1, {}],
    ],
    events: [[0.16, 'pistolMagOut'], [0.67, 'pistolMagIn']],
  },
  glockEmpty: {
    keys: [
      [0, { sl: 1 }],
      [0.1, { ...GTILT, magY: -0.02, sl: 1 }],
      [0.2, { ...GTILT, magY: -0.3, magR: 0.25, hy: -0.06, sl: 1 }],
      [0.3, { ...GTILT, magY: -0.3, magR: 0.25, hy: -0.32, hx: -0.02, hz: 0.02, sl: 1 }],
      [0.4, { ...GTILT, magY: -0.16, magR: 0.12, hy: -0.2, hx: 0.03, hz: -0.01, sl: 1 }],
      [0.5, { ...GTILT, magY: -0.06, magR: 0.02, hy: -0.1, hx: 0.035, hz: -0.01, sl: 1 }],
      [0.56, { ...GTILT, magY: 0, hy: -0.055, hx: 0.035, hz: -0.01, rx: 0.4, sl: 1 }],
      // la main gauche passe par-dessus et attrape l'arrière de la culasse…
      [0.68, { rz: 0.15, ry: -0.3, rx: 0.08, px: -0.07, py: 0.02, hx: 0.03, hy: 0.1, hz: 0.0, sl: 1 }],
      // …la tire en arrière…
      [0.76, { rz: 0.15, ry: -0.32, rx: 0.08, px: -0.07, py: 0.02, hx: 0.03, hy: 0.1, hz: 0.06, sl: 1.15 }],
      // …et la lâche : elle repart en avant et chambre une balle
      [0.8, { rz: 0.1, ry: -0.25, rx: 0.12, hx: 0.03, hy: 0.12, hz: 0.09, sl: 0 }],
      [0.9, { rz: 0.04, hx: 0.01, hy: 0.04, hz: 0.03 }],
      [1, {}],
    ],
    events: [[0.12, 'pistolMagOut'], [0.55, 'pistolMagIn'], [0.79, 'pistolSlide']],
  },
  glockInspect: {
    keys: [
      [0, {}],
      [0.18, { px: -0.06, py: 0.05, pz: 0.08, ry: 0.9, rz: -0.2 }],
      [0.4, { px: -0.06, py: 0.05, pz: 0.08, ry: 1.0, rz: -0.15, sl: 0.35 }],       // vérif de la chambre
      [0.55, { px: -0.06, py: 0.05, pz: 0.08, ry: 0.95, rz: -0.15 }],
      [0.72, { px: -0.05, py: 0.06, pz: 0.08, ry: -0.9, rz: 0.3 }],                  // on regarde l'autre côté
      [0.86, { px: -0.05, py: 0.06, pz: 0.08, ry: -0.95, rz: 0.3 }],
      [1, {}],
    ],
    events: [[0.05, 'cloth'], [0.32, 'pistolSlide'], [0.62, 'cloth']],
  },
  glockDraw: {
    keys: [[0, { py: -0.18, rx: -0.6, rz: 0.4 }], [0.6, { rz: -0.05 }], [1, {}]],
    events: [[0.02, 'cloth']],
  },
  // Réarmement du Kar98k après un tir : la main droite lâche la poignée,
  // lève le levier, tire la culasse (la douille sort), repousse et rabaisse.
  karCycle: {
    keys: [
      [0, {}],
      [0.14, { rhw: 1, rz: -0.05 }],                          // la main droite va sur la boule du levier
      [0.26, { rhw: 1, bolt: 0.5, rz: -0.1 }],                // lève
      [0.4, { rhw: 1, bolt: 1, rz: -0.2, rx: -0.06, pz: 0.03 }],  // tire en arrière (la douille sort)
      [0.54, { rhw: 1, bolt: 0.5, rz: -0.1 }],                // repousse
      [0.64, { rhw: 1, bolt: 0, rz: -0.05 }],                 // rabaisse
      [0.82, {}],                                              // retour sur la poignée
    ],
    events: [[0.22, 'boltUp'], [0.5, 'boltForward']],
  },
});

// ---- MP5 : rechargement à vide avec la "claque" du levier (à gauche, au-dessus du garde-main) ----
const MTILT = { rz: 0.3, rx: 0.08, py: -0.015 };
Object.assign(ANIMS, {
  mp5Empty: {
    keys: [
      [0, {}],
      [0.08, { rz: -0.12, ry: 0.1, hx: -0.035, hy: 0.075, hz: 0.06 }],                 // main gauche sur le levier
      [0.16, { rz: -0.14, ry: 0.12, hx: -0.035, hy: 0.075, hz: 0.16, ch: 1 }],          // levier tiré et bloqué en haut
      [0.24, { ...MTILT, hy: -0.06, hz: 0.12, ch: 1, magY: -0.02 }],
      [0.36, { ...MTILT, hy: -0.48, hz: 0.12, ch: 1, magY: -0.4, magR: 0.4 }],
      [0.48, { ...MTILT, hy: -0.48, hz: 0.12, ch: 1, magY: -0.4, magR: 0.4 }],
      [0.62, { ...MTILT, hy: -0.08, hz: 0.12, ch: 1, magY: -0.03 }],
      [0.68, { rz: 0.24, rx: 0.05, py: -0.01, hy: -0.05, hz: 0.12, ch: 1 }],
      [0.76, { rz: -0.1, ry: 0.12, hx: -0.035, hy: 0.09, hz: 0.18, ch: 1 }],           // la main remonte...
      [0.8, { rz: -0.18, ry: 0.14, rx: 0.05, hx: -0.035, hy: 0.075, hz: 0.12, ch: 0 }],  // ...et claque le levier !
      [0.9, { rz: -0.05, hx: -0.02, hy: 0.04, hz: 0.06 }],
      [1, {}],
    ],
    events: [[0.12, 'chargeBack'], [0.3, 'magOut'], [0.64, 'magIn'], [0.79, 'chargeRelease']],
  },
  mp5Inspect: {
    keys: [
      [0, {}],
      [0.18, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.7, rz: -0.25, rx: 0.08 }],
      [0.4, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.72, rz: -0.22, rx: 0.08 }],
      [0.55, { px: -0.05, py: 0.06, pz: 0.12, ry: -0.6, rz: 0.3, hx: -0.035, hy: 0.075, hz: 0.06 }],
      [0.66, { px: -0.05, py: 0.06, pz: 0.12, ry: -0.62, rz: 0.3, hx: -0.035, hy: 0.075, hz: 0.11, ch: 0.5 }],   // on vérifie la chambre
      [0.78, { px: -0.05, py: 0.06, pz: 0.12, ry: -0.6, rz: 0.3, hx: -0.035, hy: 0.075, hz: 0.06, ch: 0 }],
      [1, {}],
    ],
    events: [[0.05, 'cloth'], [0.62, 'chargeBack'], [0.74, 'chargeRelease']],
  },
  // ---- Fusil à pompe ----
  pumpCycle: {
    keys: [
      [0, {}],
      [0.14, { rx: 0.06, pz: 0.02 }],
      [0.3, { pump: 1, rz: -0.08, rx: 0.04, pz: 0.03 }],     // pompe en arrière : la douille rouge sort
      [0.46, { pump: 0, rz: -0.03 }],                        // et en avant
      [0.62, {}],
    ],
    events: [[0.16, 'pumpBack'], [0.38, 'pumpForward']],
  },
  shotgunInspect: {
    keys: [
      [0, {}],
      [0.2, { px: -0.07, py: 0.05, pz: 0.14, ry: 0.7, rz: -0.25, rx: 0.08 }],
      [0.36, { px: -0.07, py: 0.05, pz: 0.14, ry: 0.72, rz: -0.22, rx: 0.08, pump: 0.45 }], // pompe entrouverte
      [0.5, { px: -0.07, py: 0.05, pz: 0.14, ry: 0.7, rz: -0.25, rx: 0.08, pump: 0 }],
      [0.72, { px: -0.04, py: 0.04, pz: 0.12, ry: -0.3, rz: 1.1, rx: 0.1 }],                 // on regarde le dessous
      [0.86, { px: -0.04, py: 0.04, pz: 0.12, ry: -0.3, rz: 1.15, rx: 0.1 }],
      [1, {}],
    ],
    events: [[0.05, 'cloth'], [0.3, 'pumpBack'], [0.46, 'pumpForward'], [0.66, 'cloth']],
  },
});
// Réarmement après un tir : quelle animation, à quel moment la douille sort
const CYCLES = {
  kar98k: { anim: 'karCycle', eject: 0.4 },
  shotgun: { anim: 'pumpCycle', eject: 0.3 },
};
/** Animation de rechargement selon l'arme */
function reloadAnim(weapon, empty) {
  return { kar98k: 'kar', shotgun: 'shotgun', glock: empty ? 'glockEmpty' : 'glockTactical', mp5: empty ? 'mp5Empty' : 'akTactical' }[weapon] || (empty ? 'akEmpty' : 'akTactical');
}
const INSPECTS = { ak: 'akInspect', mp5: 'mp5Inspect', shotgun: 'shotgunInspect', kar98k: 'karInspect', glock: 'glockInspect' };
// Motif de recul horizontal de l'AK et du MP5 (toujours le même : on peut apprendre à le contrôler)
const RECOIL_PATTERN = [0, 0, 0.1, 0.2, 0.15, -0.1, -0.35, -0.5, -0.4, -0.1, 0.25, 0.5, 0.6, 0.45, 0.1, -0.25, -0.45, -0.3, 0, 0.3];

const DRAW_TIME = { knifeDraw: 0.75, akRack: 1.0, karRack: 1.0, glockDraw: 0.45 };
// La main droite manœuvre aussi la culasse pendant l'armement du Kar
ANIMS.karRack.keys = ANIMS.karCycle.keys.map(([t, k]) => [t, { ...k, rz: (k.rz || 0) - 0.08 }]);
ANIMS.karRack.keys[0] = [0, { py: -0.15, rx: -0.4 }];

export class WeaponSystem {
  constructor(vmScene, vmCamera, camera, effects) {
    this.vmCamera = vmCamera;
    this.camera = camera;
    this.effects = effects;
    this.root = new THREE.Group();         // suit la caméra de l'arme
    vmScene.add(vmCamera);
    vmCamera.add(this.root);
    this.models = {};
    this.primary = 'ak';
    this.secondary = 'glock';
    this.optic = 'iron';
    this.ammo = {};
    this.lookDown = 0;
    this.reset(settings.loadouts?.[settings.activeLoadout]);
  }

  /** (Re)construit les modèles avec les skins + le viseur choisis */
  rebuild(skins = settings.skins) {
    for (const m of Object.values(this.models)) this.root.remove(m);
    const sk = (w) => WEAPON_SKINS[skins?.[w]] || WEAPON_SKINS.default;
    this.models = {
      ak: buildAK(sk('ak'), this.primary === 'ak' ? this.optic : 'iron', skins),
      kar98k: buildKar(sk('kar98k'), this.primary === 'kar98k' ? this.optic : 'iron', skins),
      mp5: buildMP5(sk('mp5'), this.primary === 'mp5' ? this.optic : 'iron', skins),
      shotgun: buildShotgun(sk('shotgun'), this.primary === 'shotgun' ? this.optic : 'iron', skins),
      glock: buildGlock(sk('glock'), skins),
      knife: buildKnife(sk('knife'), skins?.knife, skins),
      butterfly: buildButterfly(sk('knife'), skins?.knife, skins),
    };
    for (const m of Object.values(this.models)) this.root.add(m);
    this.showModel();
  }
  applySkins() { this.rebuild(); }

  /**
   * Remise à zéro au début de chaque manche / réapparition.
   * loadout = { primary, optic } · rack = jouer l'animation d'armement
   */
  reset(loadout, { rack = false, skins } = {}) {
    if (loadout) {
      this.primary = WEAPONS[loadout.primary] ? loadout.primary : 'ak';
      this.optic = validOptic(this.primary, loadout.optic);
      this.secondary = WEAPONS[loadout.secondary] ? loadout.secondary : 'glock';
      this.knifeType = loadout.knife === 'butterfly' ? 'butterfly' : 'combat';
    }
    this.current = this.primary;
    // Munitions de chaque arme
    this.ammo = {};
    for (const id of [this.primary, this.secondary]) this.ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserve };
    this.spent = false;       // une douille vide attend d'être éjectée (Kar98k)
    this.slideBack = 0;       // recul de la culasse du Glock
    this.cycle = null;        // réarmement du Kar98k { t, fired, ejected }
    this.reload = null;     // rechargement en cours { t, total, plan, anim, fired }
    this.cooldown = 0;
    this.shotsInRow = 0;
    this.sinceShot = 1;
    this.recoil = 0;        // recul accumulé (récupéré quand on arrête de tirer)
    this.kick = 0;          // animation de recul de l'arme
    this.swing = 0;         // animation du coup de couteau
    this.sprintAnim = 0;    // arme en diagonale quand on court
    this.slideAnim = 0;     // arme penchée pendant la glissade
    this.boltAnim = 0;      // réarmement du Kar98k après un tir
    this.inspect = null;    // inspection { t, fired }
    this.draw = null;       // animation de sortie { name, t, fired }
    this.ads = 0;           // 0 = hanche, 1 = en visée
    this.overlay = null;    // lunette affichée en plein écran ('mid' / 'scope')
    this.lastSpread = 0;
    this.sway = { x: 0, y: 0, vx: 0, vy: 0 }; // inertie (souris)
    this.landing = 0;       // l'arme descend à l'atterrissage
    this.specKey = null;
    this.rebuild(skins);
    if (rack) this.startDraw(this.primary === 'kar98k' ? 'karRack' : 'akRack');
  }

  get isGun() { return this.current !== 'knife'; }
  /** Modèle affiché : le couteau papillon remplace le couteau de combat si choisi */
  get mk() { return this.current === 'knife' && this.knifeType === 'butterfly' ? 'butterfly' : this.current; }
  // Munitions de l'arme en main
  get mag() { return this.ammo[this.current]?.mag ?? 0; }
  set mag(v) { if (this.ammo[this.current]) this.ammo[this.current].mag = v; }
  get reserve() { return this.ammo[this.current]?.reserve ?? 0; }
  set reserve(v) { if (this.ammo[this.current]) this.ammo[this.current].reserve = v; }
  get weapon() { return WEAPONS[this.current]; }
  get reloading() { return !!this.reload; }
  get scoped() { return !!this.overlay; }
  get currentOptic() { return this.isGun ? (this.current === this.primary ? this.optic : 'iron') : null; }
  get busy() { return (!!this.draw && this.draw.name !== 'knifeDraw') || !!this.cycle; }

  showModel() {
    if (!this.current || !this.models[this.mk]) return;
    for (const [k, m] of Object.entries(this.models)) m.visible = k === this.mk && !this.overlay;
    for (const m of Object.values(this.models)) if (m.userData.flash) m.userData.flash.visible = false;
  }

  setVisible(v) { this.root.visible = v; }

  startDraw(name) { this.draw = { name, t: 0, fired: 0 }; }

  switchTo(w, session) {
    if (w === this.current) return;
    if (this.reload) this.cancelReload(session);
    this.current = w;
    this.inspect = null;
    this.cooldown = w === 'knife' ? 0.45 : 0.35;
    this.ads = 0;
    this.overlay = null;
    this.cycle = null;
    this.draw = { name: w === 'knife' ? 'knifeDraw' : w === 'glock' ? 'glockDraw' : 'switch', t: 0, fired: 0 };
    this.showModel();
    if (w === 'ak' || w === 'kar98k') sfx.switchWeapon();
    session.switchWeapon(w);
  }

  startReload(session) {
    const w = WEAPONS[this.current];
    if (!this.isGun || this.reload || this.mag >= w.magSize || this.reserve <= 0) return;
    const plan = reloadPlan(this.current, this.mag, this.reserve);
    const anim = reloadAnim(this.current, plan.empty);
    this.reload = { t: 0, total: plan.time, plan, anim, fired: 0, roundsDone: 0, wasEmpty: this.mag === 0 };
    this.inspect = null;
    session.reload();
  }

  /** Arrête le rechargement (Kar : les balles déjà poussées restent) */
  cancelReload(session) {
    if (!this.reload) return;
    const n = roundsInserted(this.current, this.reload.t, this.reload.plan.rounds);
    this.mag += n; this.reserve -= n;
    if (this.current === 'kar98k') { sfx.boltForward(); setTimeout(() => sfx.boltDown(), 120); }
    this.reload = null;
    // Fusil à pompe vide : il faut pomper pour chambrer la première cartouche
    if (this.current === 'shotgun' && this.mag > 0 && this.chamberEmpty) { this.cycle = { t: 0, fired: 0, ejected: true, w: 'shotgun' }; this.chamberEmpty = false; }
    this.cooldown = Math.max(this.cooldown, 0.3);
    session.reloadCancel?.();
  }

  /** Dispersion actuelle (en radians). En visant : précis, même en bougeant ou en sautant. */
  spread(player) {
    const w = this.weapon;
    if (!this.isGun) return 0;
    const a = ease(this.ads);
    const burst = Math.min(this.shotsInRow, 12) * w.burstSpread;
    let hip = w.hipSpread + burst;
    hip += Math.min(player.speed / PLAYER.SPEED, 1.4) * w.moveSpread;
    if (!player.grounded) hip += w.airSpread;
    if (player.crouch && !player.sliding) hip *= 0.75;
    const ads = w.adsSpread + burst * 0.4;
    return hip + (ads - hip) * a;
  }

  /** Mouvement de souris → l'arme traîne un peu (inertie, E2) */
  addLook(dx, dy) {
    const k = 1 - this.ads * 0.8;
    this.sway.vx += Math.max(-40, Math.min(40, dx)) * 0.00012 * k;
    this.sway.vy += Math.max(-40, Math.min(40, dy)) * 0.00012 * k;
  }

  /** Atterrissage après un saut / une chute (E3) */
  land(impact) { this.landing = Math.min(1, this.landing + impact); }

  /** Appelé à chaque image. canFire = false pendant la préparation de manche ou mort. */
  update(dt, input, player, session, canFire) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    this.boltAnim = Math.max(0, this.boltAnim - dt);

    // --- Changement d'arme : touches 1 / 2 ou molette ---
    if (input.was('weapon1')) this.switchTo(this.primary, session);
    if (input.was('weapon2')) this.switchTo(this.secondary, session);
    if (input.was('weapon3')) this.switchTo('knife', session);
    const wheel = input.was('nextWeapon') ? 1 : input.was('prevWeapon') ? -1 : 0;
    if (wheel !== 0) {
      const order = [this.primary, this.secondary, 'knife'];
      const i = order.indexOf(this.current);
      this.switchTo(order[(i + (wheel > 0 ? 1 : 2)) % 3], session);
    }

    // --- Réarmement du Kar98k (main droite sur le levier) ---
    if (this.cycle) {
      const c = this.cycle, wid = c.w || 'kar98k', cy = CYCLES[wid];
      c.t += dt / WEAPONS[wid].fireInterval;
      this.fireEvents(c, ANIMS[cy.anim].events, c.t);
      if (!c.ejected && c.t >= cy.eject) { c.ejected = true; this.ejectShell(wid, player); }
      if (c.t >= 1 || this.current !== wid) this.cycle = null;
    }

    // --- Animation de sortie / armement ---
    if (this.draw) {
      const total = DRAW_TIME[this.draw.name] || 0.35;
      this.draw.t += dt / total;
      const anim = ANIMS[this.draw.name];
      if (anim) this.fireEvents(this.draw, anim.events, this.draw.t);
      if (this.draw.t >= 1) this.draw = null;
    }

    // --- Rechargement ---
    if (input.was('reload')) this.startReload(session);
    if (this.reload) {
      const r = this.reload;
      r.t += dt;
      if (r.anim === 'kar') this.karReloadSounds(r);
      else if (r.anim === 'shotgun') this.shotgunReloadSounds(r);
      else this.fireEvents(r, ANIMS[r.anim].events, r.t / r.total);
      // Kar98k / pompe : un clic interrompt le rechargement (on garde les balles déjà mises)
      if ((r.anim === 'kar' || r.anim === 'shotgun') && input.mouseClicked && (this.mag + roundsInserted(this.current, r.t, r.plan.rounds)) > 0) {
        this.cancelReload(session);
      } else if (r.t >= r.total) {
        this.mag += r.plan.rounds; this.reserve -= r.plan.rounds;
        if (r.anim === 'shotgun') this.chamberEmpty = false;
        this.reload = null;
      }
    }

    // --- Inspection (touche Y) ---
    if (input.was('inspect') && !this.inspect && !this.reload && !this.draw) { this.inspect = { t: 0, fired: 0 }; }
    if (this.inspect) {
      this.inspect.t += dt / INSPECT_TIME[this.current];
      const anim = ANIMS[INSPECTS[this.current] || (this.mk === 'butterfly' ? 'bflyInspect' : 'knifeInspect')];
      this.fireEvents(this.inspect, anim.events, this.inspect.t);
      // Annulée si on tire, vise ou recharge (on peut inspecter en courant)
      if (this.inspect.t >= 1 || input.mouseDown || input.mouseRight || this.reload) this.inspect = null;
    }

    // --- Visée (clic droit) ---
    const wantAds = input.mouseRight && this.isGun && !this.reload && !player.sprinting && player.alive && !this.busy;
    const adsSpeed = this.isGun ? this.weapon.adsSpeed : 10;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * adsSpeed);
    if (!wantAds && this.ads < 0.01) this.ads = 0;
    if (wantAds && this.ads > 0.995) this.ads = 1;
    const optic = OPTICS[this.currentOptic];
    const newOverlay = optic?.overlay && this.ads > 0.85 ? optic.overlay : null;
    if (newOverlay !== this.overlay) { this.overlay = newOverlay; this.showModel(); }

    // Zoom transmis au joueur (champ de vision + sensibilité)
    let zoom = 1;
    if (optic) zoom = optic.overlay ? (this.overlay ? optic.zoom : 1 + 0.25 * this.ads) : 1 + (optic.zoom - 1) * ease(this.ads);
    player.zoom = zoom;
    player.ads = this.ads;

    // --- Tir ---
    if (canFire && this.cooldown <= 0 && this.sprintAnim < 0.5 && !this.busy) {
      if (this.isGun && !this.reload) {
        const trigger = this.weapon.auto ? input.mouseDown : input.mouseClicked;
        if (trigger) {
          if (this.mag > 0) this.fireGun(player, session);
          else { sfx.empty(); this.startReload(session); }
        }
      } else if (this.current === 'knife' && input.mouseDown && !this.draw) {
        this.stab(player, session);
      }
    }
    if (!input.mouseDown) this.shotsInRow = Math.max(0, this.shotsInRow - dt * 25);

    // --- Récupération du recul quand on ne tire plus ---
    if (this.sinceShot > 0.12 && this.recoil > 0) {
      const r = Math.min(this.recoil, dt * (this.current === 'kar98k' ? 0.5 : 0.35));
      this.recoil -= r;
      player.pitch -= r;
    }

    this.lastSpread = this.spread(player);
    this.animate(dt, player);
  }

  /** Joue les sons d'une animation au bon moment */
  fireEvents(state, events, t) {
    while (state.fired < events.length && t >= events[state.fired][0]) {
      sfx[events[state.fired][1]]?.();
      state.fired++;
    }
  }

  /** Sons du rechargement balle par balle */
  karReloadSounds(r) {
    const w = WEAPONS.kar98k;
    if (this.spent && r.t > 0.32) { this.spent = false; this.ejectShell('kar98k', this._player); }
    const ev = [[0.15, 'boltUp'], [0.3, 'boltBack']];
    for (let i = 0; i < r.plan.rounds; i++) ev.push([w.reloadOpen + i * w.reloadPerRound + w.reloadPerRound * 0.55, 'roundIn']);
    const close = w.reloadOpen + r.plan.rounds * w.reloadPerRound;
    ev.push([close + 0.05, 'boltForward'], [close + 0.25, 'boltDown']);
    this.fireEvents(r, ev, r.t);
  }

  /** Douille éjectée par la fenêtre d'éjection de l'arme (côté droit) */
  ejectShell(type, player) {
    const m = this.models[type];
    if (!m || !player) return;
    const port = m.userData.ejectPort;
    const p = new THREE.Vector3();
    (port || m).getWorldPosition(p);           // position dans l'espace de la caméra de l'arme
    this.camera.updateMatrixWorld();
    p.applyMatrix4(this.camera.matrixWorld);  // → position dans le monde
    const q = this.camera.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const v = right.multiplyScalar(1.6 + Math.random() * 0.8).add(up.multiplyScalar(1.4 + Math.random() * 0.6)).add(back.multiplyScalar(0.4));
    v.x += player.vel?.x || 0; v.z += player.vel?.z || 0;
    this.effects.shell(type, p, v, player.pos?.y ?? 0);
  }

  fireGun(player, session) {
    const w = this.weapon;
    this.mag--;
    this.cooldown = w.fireInterval;
    this.sinceShot = 0;
    this.inspect = null;

    // Direction = regard + dispersion aléatoire (répartie dans un disque)
    const s = this.spread(player);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
    const dir = dirFromAngles(player.yaw + Math.cos(a) * r, player.pitch + Math.sin(a) * r);
    const eye = player.eye();
    const res = session.fire(eye, dir, this.current);

    // Effets : traçante depuis le canon, étincelles sur le mur
    // (le sang n'apparaît que si le serveur confirme la touche)
    const from = this.overlay ? { x: eye.x + dir.x * 0.5, y: eye.y - 0.15, z: eye.z + dir.z * 0.5 } : this.muzzleWorld();
    const results = res.pellets || [{ ...res, dir }];
    results.forEach((r, i) => {
      const d = r.dir || dir;
      const end = { x: eye.x + d.x * r.dist, y: eye.y + d.y * r.dist, z: eye.z + d.z * r.dist };
      if (!w.pellets || i % 2 === 0) this.effects.tracer(from, end);
      if (r.hitWall) { this.effects.impact(end); if (i < 2) sfx.impact(end); }
      if (r.hitPlayer && (r.confirmed || res.confirmed)) this.effects.blood(end);
    });

    // Recul : la vue monte (moins en visant), et part un peu sur les côtés
    const adsMul = 1 - 0.35 * this.ads;
    const kick = w.recoilKick * (this.shotsInRow < 3 ? 0.6 : 1) * adsMul * (this.current === 'kar98k' ? 1.6 : 1);
    player.pitch = Math.min(1.55, player.pitch + kick);
    if (this.current === 'ak' || this.current === 'mp5') {
      // Motif de recul fixe (+ un tout petit peu d'aléatoire)
      const pat = RECOIL_PATTERN[Math.min(this.shotsInRow, RECOIL_PATTERN.length - 1)];
      player.yaw -= (pat * 0.006 + (Math.random() - 0.5) * 0.0015) * adsMul * (this.current === 'mp5' ? 0.6 : 1);
    } else player.yaw += (Math.random() - 0.5) * 0.008 * Math.min(this.shotsInRow + 1, 8) / 4 * adsMul;
    this.recoil += kick * (this.current === 'kar98k' ? 0.85 : 0.6);
    this.shotsInRow++;
    this.kick = 1;

    const flash = this.models[this.current].userData.flash;
    if (flash && !this.overlay) {
      flash.visible = true; flash.rotation.z = Math.random() * Math.PI;
      setTimeout(() => { flash.visible = false; }, 40);
    }
    if (this.current === 'kar98k') {
      sfx.sniper();
      this.spent = true;
      if (this.mag > 0) { this.cycle = { t: -0.12, fired: 0, ejected: false, w: 'kar98k' }; this.spent = false; } // la douille sort pendant le réarmement
    } else if (this.current === 'shotgun') {
      sfx.shotgun();
      if (this.mag > 0) this.cycle = { t: -0.1, fired: 0, ejected: false, w: 'shotgun' };
      else this.chamberEmpty = true; // la douille reste dedans jusqu'au rechargement
    } else if (this.current === 'mp5') {
      sfx.smg();
      this.ejectShell('mp5', player);
    } else if (this.current === 'glock') {
      sfx.pistol();
      this.slideBack = 1;
      this.ejectShell('glock', player);
    } else {
      sfx.shot();
      this.ejectShell('ak', player);
    }
    if (this.mag === 0) setTimeout(() => { if (this.mag === 0) this.startReload(session); }, this.current === 'kar98k' ? 1100 : 120);
  }

  stab(player, session) {
    this.cooldown = WEAPONS.knife.fireInterval;
    this.swing = 1;
    this.inspect = null;
    const dir = dirFromAngles(player.yaw, player.pitch);
    session.fire(player.eye(), dir, 'knife');
    sfx.knife();
  }

  /** Position approximative du bout du canon dans le monde */
  muzzleWorld() {
    this.camera.updateMatrixWorld();
    const z = this.current === 'kar98k' ? -0.95 : -0.75;
    const v = new THREE.Vector3(0.14 * (1 - this.ads), -0.12 * (1 - this.ads) - 0.03, z).applyMatrix4(this.camera.matrixWorld);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Valeurs d'animation du rechargement balle par balle du Kar98k */
  karReloadPose(r) {
    const w = WEAPONS.kar98k;
    const t = r.t, n = r.plan.rounds;
    const close = w.reloadOpen + n * w.reloadPerRound;
    // L'arme est ramenée vers soi, canon un peu baissé : on voit bien la fenêtre et les balles
    const k = { ...TILT, rz: 0.4, rx: -0.05, ry: -0.12, py: -0.05, pz: 0.13, px: -0.07 };
    // ouverture puis fermeture de la culasse
    k.bolt = t < close ? clamp01((t - 0.12) / 0.3) : 1 - clamp01((t - close) / 0.3);
    // la main droite reste sur le levier pendant tout le rechargement
    k.rhw = clamp01(t / 0.12) * (1 - clamp01((t - close - 0.32) / 0.18));
    // la main gauche va au-dessus de l'arme et pousse chaque balle
    const handIn = clamp01((t - 0.2) / 0.2) * (1 - clamp01((t - close) / 0.25));
    let dip = 0;
    if (t > w.reloadOpen && t < close) {
      const phase = ((t - w.reloadOpen) % w.reloadPerRound) / w.reloadPerRound;
      dip = Math.sin(phase * Math.PI);
      k.cart = phase < 0.55 ? 1 : 0; // la balle est visible dans la main jusqu'à ce qu'elle entre
    } else if (t > 0.25 && t <= w.reloadOpen) k.cart = 1;
    k.hx = 0.02 * handIn; k.hy = (0.13 - dip * 0.06) * handIn; k.hz = 0.33 * handIn;
    // retour en douceur à la fin
    const out = clamp01((t - (r.total - 0.25)) / 0.25);
    for (const key of ['rz', 'rx', 'ry', 'py', 'px', 'pz']) k[key] *= 1 - out;
    const inn = ease(clamp01(t / 0.2));
    for (const key of ['rz', 'rx', 'ry', 'py', 'px', 'pz']) k[key] *= inn;
    return k;
  }

  /** Fusil à pompe : arme penchée pour montrer la fenêtre de chargement (dessous),
   *  la main gauche lâche la pompe, va chercher une cartouche rouge et la pousse dedans. */
  shotgunReloadPose(r) {
    const w = WEAPONS.shotgun;
    const t = r.t, n = r.plan.rounds;
    const close = w.reloadOpen + n * w.reloadPerRound;
    const k = { rz: 0.5, rx: 0.05, ry: -0.12, py: 0.035, pz: 0.06, px: -0.07 };
    let dip = 0, fetch = 0;
    if (t > w.reloadOpen && t < close) {
      const phase = ((t - w.reloadOpen) % w.reloadPerRound) / w.reloadPerRound;
      fetch = phase < 0.35 ? 1 - phase / 0.35 : 0;          // va chercher la cartouche (à la ceinture)
      dip = phase > 0.35 && phase < 0.7 ? Math.sin((phase - 0.35) / 0.35 * Math.PI) : 0; // pousse
      k.cart = phase < 0.6 ? 1 : 0;
    }
    const handIn = clamp01((t - 0.05) / 0.25) * (1 - clamp01((t - close) / 0.2));
    k.hx = (0.0 - fetch * 0.05) * handIn; k.hy = (0.0 + dip * 0.025 - fetch * 0.16) * handIn; k.hz = (0.24 + fetch * 0.1) * handIn;
    // Arme vide au départ : on pompe à la fin pour chambrer
    if (r.wasEmpty && t > close) { const u = clamp01((t - close) / w.reloadClose); k.pump = Math.sin(u * Math.PI); }
    const out = clamp01((t - (r.total - 0.25)) / 0.25), inn = ease(clamp01(t / 0.2));
    for (const key of ['rz', 'rx', 'ry', 'py', 'px', 'pz']) k[key] *= (1 - out) * inn;
    return k;
  }
  shotgunReloadSounds(r) {
    const w = WEAPONS.shotgun;
    const ev = [];
    for (let i = 0; i < r.plan.rounds; i++) ev.push([w.reloadOpen + i * w.reloadPerRound + w.reloadPerRound * 0.55, 'shellIn']);
    const close = w.reloadOpen + r.plan.rounds * w.reloadPerRound;
    if (r.wasEmpty) ev.push([close + 0.04, 'pumpBack'], [close + 0.2, 'pumpForward']);
    this.fireEvents(r, ev, r.t);
  }

  /** Animations de l'arme en main */
  animate(dt, player) {
    this.kick = Math.max(0, this.kick - dt * (this.current === 'kar98k' ? 6 : 12));
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.landing = Math.max(0, this.landing - dt * 3);
    const sp = player.sprinting && !this.reload ? 1 : 0;
    this.sprintAnim += (sp - this.sprintAnim) * Math.min(1, dt * 9);
    this.slideAnim += ((player.sliding ? 1 : 0) - this.slideAnim) * Math.min(1, dt * 10);
    const sa = this.sprintAnim * (this.inspect ? 0.3 : 1), sl = this.slideAnim; // on peut inspecter en courant
    this._player = player;
    this.slideBack = Math.max(0, this.slideBack - dt * 14);

    // Inertie : ressort amorti qui ramène l'arme au centre
    const sw = this.sway;
    sw.vx += -sw.x * 120 * dt; sw.vy += -sw.y * 120 * dt;
    sw.vx *= Math.max(0, 1 - 14 * dt); sw.vy *= Math.max(0, 1 - 14 * dt);
    sw.x += sw.vx * dt * 60; sw.y += sw.vy * dt * 60;
    sw.x = Math.max(-0.06, Math.min(0.06, sw.x)); sw.y = Math.max(-0.06, Math.min(0.06, sw.y));

    const t = performance.now() / 1000;
    const a = ease(this.ads);
    const free = 1 - a * 0.9; // presque pas de balancement en visée
    const moving = player.grounded && !player.sliding ? Math.min(player.speed / PLAYER.SPEED, 1.5) : 0;
    // Balancement en forme de 8 (E1) : gauche/droite à la fréquence du pas, haut/bas deux fois plus vite
    const amp = 0.011 * (1 + sa * 0.8);
    const bobX = Math.sin(player.bob) * amp * moving * free;
    const bobY = (Math.sin(player.bob * 2) * amp * 0.6 * moving + Math.sin(t * 1.4) * 0.0018) * free;
    const land = Math.sin(this.landing * Math.PI) * 0.05 * free;

    const m = this.models[this.mk];
    const ud = m.userData;

    if (this.isGun) {
      const w = this.weapon;
      const pose = POSES[this.current];
      // Animation en cours : sortie > rechargement > inspection
      let k = {};
      let drawLower = 0;
      if (this.draw && ANIMS[this.draw.name]) k = track(clamp01(this.draw.t), ANIMS[this.draw.name].keys);
      else if (this.draw) drawLower = 1 - ease(clamp01(this.draw.t)); // simple changement d'arme
      else if (this.reload) k = this.reload.anim === 'kar' ? this.karReloadPose(this.reload) : this.reload.anim === 'shotgun' ? this.shotgunReloadPose(this.reload) : track(this.reload.t / this.reload.total, ANIMS[this.reload.anim].keys);
      else if (this.cycle) k = track(clamp01(this.cycle.t), ANIMS[CYCLES[this.cycle.w || 'kar98k'].anim].keys);
      else if (this.inspect) k = track(this.inspect.t, ANIMS[INSPECTS[this.current]].keys);
      const bolt = 0;

      const adsY = -ud.sightY, adsZ = pose.adsZ[this.currentOptic] ?? pose.adsZ.iron;
      const px = pose.hip[0] * (1 - a);
      const py = pose.hip[1] + (adsY - pose.hip[1]) * a;
      const pz = pose.hip[2] + (adsZ - pose.hip[2]) * a;
      // En regardant ses pieds, l'arme se range sur le côté pour laisser voir les jambes
      this.lookDown += ((player ? clamp01((-player.pitch - 0.6) / 0.6) : 0) * (1 - a) * (this.reload || this.inspect ? 0.4 : 1) - this.lookDown) * Math.min(1, dt * 8);
      const ld = ease(this.lookDown);
      m.position.set(
        ld * 0.13 + px + bobX - sw.x - sa * 0.07 + (k.px || 0) + bolt * 0.02 * (1 - a),
        ld * -0.04 + py - bobY + sw.y - land - drawLower * 0.25 - sa * 0.06 - sl * 0.03 + (k.py || 0) - bolt * 0.03 * (1 - a),
        pz + this.kick * (this.current === 'kar98k' ? 0.12 : 0.05) * (1 - a * 0.5) + sa * 0.06 + (k.pz || 0),
      );
      // Course (E4) : arme tenue en diagonale · Glissade (E5) : arme penchée
      m.rotation.set(
        this.kick * (this.current === 'kar98k' ? 0.15 : 0.06) * (1 - a * 0.6) - sa * 0.22 + (k.rx || 0) - drawLower * 0.4 + sw.y * 2 + land * 1.5,
        (0.04 + sa * 0.95) * (1 - a) + (k.ry || 0) + sw.x * 2 + ld * 0.75,
        ld * 0.35 + sa * 0.55 - sl * 0.4 + (k.rz || 0) + bolt * 0.3 * (1 - a) + drawLower * 0.3,
      );
      // Chargeur (AK)
      if (ud.mag) {
        ud.mag.position.set(ud.magHome.x, ud.magHome.y + (k.magY || 0), ud.magHome.z);
        ud.mag.rotation.x = k.magR || 0;
      }
      // Levier d'armement (AK)
      if (ud.charge) ud.charge.position.z = ud.chargeZ + (k.ch || 0) * (ud.chargeTravel || 0.1);
      if (ud.forend) ud.forend.position.z = ud.forendZ + (k.pump || 0) * 0.09; // pompe (la main gauche suit)
      // Mains
      if (ud.leftHand) ud.leftHand.position.set(ud.leftHome.x + (k.hx || 0), ud.leftHome.y + (k.hy || 0), ud.leftHome.z + (k.hz || 0));
      if (ud.rightHand) ud.rightHand.position.set(ud.rightHome.x + (k.rhx || 0), ud.rightHome.y + (k.rhy || 0), ud.rightHome.z + (k.rhz || 0));
      if (ud.rightHand) ud.rightHand.rotation.set(0, 0, 0);
      if (ud.cartridge) ud.cartridge.visible = !!k.cart;
      // Culasse du Glock : recule à chaque tir, reste bloquée en arrière quand le chargeur est vide
      if (ud.slide) {
        this.slideLocked = this.current === 'glock' && this.mag === 0 && !this.reload;
        const back = Math.max(this.slideBack, this.slideLocked ? 1 : 0, k.sl || 0);
        ud.slide.position.z = ud.slideZ + back * 0.03;
      }
      // Culasse (Kar98k) : levier relevé puis tiré en arrière
      if (ud.bolt) {
        const open = Math.max(k.bolt || 0, bolt * (1 - a));
        const up = Math.min(1, open * 2), back = Math.max(0, open * 2 - 1);
        ud.bolt.rotation.z = up * 1.35;
        ud.bolt.position.z = ud.boltZ + back * 0.09;
        if (ud.boltBody) {
          ud.boltBody.position.z = ud.boltBodyZ + back * 0.09;
          ud.boltBody.rotation.z = up * 0.25;
          // Balles visibles dans le magasin quand la fenêtre est ouverte
          const inMag = this.current === 'kar98k' ? this.mag + (this.reload?.anim === 'kar' ? roundsInserted('kar98k', this.reload.t, this.reload.plan.rounds) : 0) : 5;
          const closing = back < (this._prevBack ?? 0) - 1e-5;
          const chambering = closing && back > 0.03 && inMag > 0;
          ud.magRounds[0].visible = back > 0.35 && inMag - (chambering ? 1 : 0) > 0;
          ud.magRounds[1].visible = back > 0.35 && inMag - (chambering ? 1 : 0) > 1;
          // La balle du dessus est poussée vers l'avant par la culasse, puis entre dans la chambre
          const cr = ud.chamberRound;
          cr.visible = chambering;
          if (chambering) cr.position.set(0, 0.0405 - (1 - back) * 0.008, ud.boltBodyZ - 0.075 + back * 0.09);
          this._prevBack = back;
        }
        // La main droite suit la boule du levier (c'est elle qui manœuvre la culasse)
        const hw = ease(clamp01(k.rhw || 0));
        if (ud.rightHand && hw > 0) {
          const ang = up * 1.35, kx = 0.065, ky = -0.012;
          const knob = new THREE.Vector3(
            ud.bolt.position.x + kx * Math.cos(ang) - ky * Math.sin(ang),
            ud.bolt.position.y + kx * Math.sin(ang) + ky * Math.cos(ang),
            ud.bolt.position.z);
          const target = knob.add(ud.knobGrip); // la main pince la boule
          ud.rightHand.position.lerpVectors(ud.rightHome, target, hw);
          ud.rightHand.rotation.set(-0.5 * hw, 0.25 * hw, 0.5 * hw + ang * 0.35 * hw);
        }
      }
      // L'avant-bras droit suit le poignet
      if (ud.rightArm) {
        const A = ud.rightArm;
        const w = A.wristLocal.clone().applyEuler(ud.rightHand.rotation).add(ud.rightHand.position);
        const d = A.elbow.clone().sub(w);
        A.mesh.position.copy(w).add(A.elbow).multiplyScalar(0.5);
        A.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
        A.mesh.scale.set(1, w.distanceTo(A.elbow) / A.len0, 1);
      }
    } else {
      // Couteau : coup, lancé à la sortie (D1), papillon à l'inspection (C4)
      const swg = Math.sin(this.swing * Math.PI);
      let k = {};
      const bf = this.mk === 'butterfly';
      if (this.draw?.name === 'knifeDraw') k = track(clamp01(this.draw.t), ANIMS[bf ? 'bflyDraw' : 'knifeDraw'].keys);
      else if (this.inspect) k = track(this.inspect.t, ANIMS[bf ? 'bflyInspect' : 'knifeInspect'].keys);
      m.position.set(0.22 + bobX - sw.x - swg * 0.2 + (k.px || 0), -0.16 - bobY + sw.y - land - sa * 0.05 + (k.py || 0), -0.46 - swg * 0.15 + (k.pz || 0));
      m.rotation.set(0.5 - swg * 0.9 + (k.rx || 0) + sw.y * 2, -0.35 + swg * 1.0 + (k.ry || 0) + sw.x * 2, -0.25 + (k.rz || 0) - sl * 0.3);
      // La lame seule tourne dans la main / s'envole
      if (bf) {
        // Papillon : tourne autour de l'annulaire, les manches s'ouvrent / se ferment
        ud.spin.rotation.x = -(k.bs || 0);
        ud.handleA.rotation.x = k.ha || 0;
        ud.handleB.rotation.x = -(k.hb || 0);
      } else {
        ud.blade.position.set(0, (k.ktoss || 0), 0);
        ud.blade.rotation.set(-(k.kflip || 0), 0, k.kspin || 0);
      }
      ud.hand.visible = true;
    }
  }

  // ---------------------------------------------------------------------
  //  Mode spectateur : on affiche l'arme du coéquipier qu'on regarde
  // ---------------------------------------------------------------------
  spectate(info, dt, moving) {
    if (!info) return;
    const key = `${info.primary}:${info.optic}:${JSON.stringify(info.skins || {})}`;
    if (key !== this.specKey) {
      this.specKey = key;
      this.primary = info.primary; this.optic = validOptic(info.primary, info.optic); this.secondary = info.secondary || 'glock';
      this.rebuild(info.skins || {});
    }
    if (info.weapon !== this.current) { this.current = info.weapon; this.showModel(); this.draw = { name: info.weapon === 'knife' ? 'knifeDraw' : info.weapon === 'glock' ? 'glockDraw' : 'switch', t: 0, fired: 0 }; }
    // Rechargement vu de l'extérieur : on lance l'animation quand il commence
    if (info.reloading && !this.reload && this.isGun) {
      const plan = reloadPlan(this.current, Math.max(0, info.mag), info.reserve + 1);
      this.reload = { t: 0, total: plan.time, plan, anim: reloadAnim(this.current, plan.empty), fired: 999 };
    }
    if (this.reload) { this.reload.t += dt; if (this.reload.t >= this.reload.total || !info.reloading) this.reload = null; }
    if (this.draw) { this.draw.t += dt / (DRAW_TIME[this.draw.name] || 0.35); if (this.draw.t >= 1) this.draw = null; }
    // Visée, inspection et sprint du joueur regardé
    const target = info.ads && this.isGun && !this.reload ? 1 : 0;
    this.ads += (target - this.ads) * Math.min(1, dt * (WEAPONS[this.current]?.adsSpeed || 10));
    const opt = OPTICS[this.currentOptic];
    const ov = opt?.overlay && this.ads > 0.85 ? opt.overlay : null;
    if (ov !== this.overlay) { this.overlay = ov; this.showModel(); }
    this.specZoom = !opt ? 1 : opt.overlay ? (this.overlay ? opt.zoom : 1 + 0.25 * this.ads) : 1 + (opt.zoom - 1) * ease(this.ads);
    if (info.insp && !this.inspect && !this.reload && INSPECT_TIME[this.current]) this.inspect = { t: 0, fired: 999 };
    if (this.inspect) { this.inspect.t += dt / INSPECT_TIME[this.current]; if (this.inspect.t >= 1 || !info.insp) this.inspect = null; }
    if (this.cycle) { this.cycle.t += dt / WEAPONS[this.cycle.w].fireInterval; if (this.cycle.t >= 1) this.cycle = null; }
    this.sprintAnim += ((info.spr ? 1 : 0) - this.sprintAnim) * Math.min(1, dt * 8);
    this.animate(dt, { speed: moving, grounded: true, sliding: false, sprinting: !!info.spr, pitch: 0, bob: (this._specBob = (this._specBob || 0) + dt * moving * 1.6) });
  }

  /** Le joueur regardé tire : recul, éclair, douille, réarmement */
  spectateShot() {
    if (!this.isGun) { this.swing = 1; return; }
    this.kick = 1;
    const flash = this.models[this.current]?.userData.flash;
    if (flash && !this.overlay) { flash.visible = true; flash.rotation.z = Math.random() * Math.PI; setTimeout(() => { flash.visible = false; }, 40); }
    if (this.current === 'glock') this.slideBack = 1;
    if (CYCLES[this.current]) this.cycle = { t: -0.1, fired: 999, ejected: true, w: this.current };
  }
}

// ---------------------------------------------------------------------
//  Modèles (formes extrudées et arrondies, aucun fichier 3D).
//  Chaque arme inclut les mains (avec doigts) et les avant-bras.
// ---------------------------------------------------------------------
const GLOVE = 0x5d4f40; // gants tactiques couleur sable
const SKIN = 0xc99a72;

function armMaterials(skins = settings.skins) {
  // La manche prend la couleur de la tenue choisie dans le casier
  const suit = CHARACTER_SKINS[skins?.character]?.suit ?? 0x3a4560;
  return {
    sleeve: mat(suit, { map: fabricTex(), roughness: 0.95 }),
    glove: mat(GLOVE, { roughness: 0.75 }),
    knuckle: mat(0x3e352b, { roughness: 0.6 }),
  };
}

/** Main droite sur une poignée (paume sur la droite, doigts autour, index sur la détente) */
function rightGripHand(g, M, pos, forearmEnd, tilt = 0.3) {
  const hand = makeHand(M.glove, { curl: [-1.25, -1.05, -0.7], indexCurl: [-0.3, -0.75, -0.5], thumbCurl: -0.55, thumbSpread: -0.4 });
  hand.scale.x = -1; // main droite = main gauche en miroir
  orientHand(hand, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  // Groupe animable (main + avant-bras) : la main peut lâcher la poignée
  const group = new THREE.Group();
  group.position.set(...pos);
  const holder = new THREE.Group();
  holder.rotation.x = -tilt; // suit l'inclinaison de la poignée
  holder.add(hand);
  group.add(holder);
  const rel = (p) => [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const wrist = [0.02, -0.035, 0.08];
  group.add(capsule([0, -0.012, 0.025], wrist, 0.033, M.glove));     // poignet (gant)
  // Avant-bras : relié au coude (fixe) et au poignet (qui bouge avec la main) → il pivote naturellement
  const fa = capsule([pos[0] + wrist[0], pos[1] + wrist[1], pos[2] + wrist[2]], forearmEnd, 0.05, M.sleeve);
  g.add(fa);
  g.add(group);
  g.userData.rightHand = group;
  g.userData.rightHome = group.position.clone();
  const elbow = new THREE.Vector3(...forearmEnd), w0 = new THREE.Vector3(...wrist).add(group.position);
  g.userData.rightArm = { mesh: fa, elbow, wristLocal: new THREE.Vector3(...wrist), len0: w0.distanceTo(elbow) };
}

/** Main gauche sous le garde-main (groupe animable : main + avant-bras) */
function leftSupportHand(g, M, pos, forearmEnd) {
  const group = new THREE.Group();
  group.position.set(...pos);
  const hand = makeHand(M.glove, { curl: [-1.15, -0.95, -0.6], thumbCurl: -0.25 });
  orientHand(hand, [0, 0, -1], [0, -1, 0], [-1, 0, 0]); // paume vers le haut, doigts vers la droite
  hand.position.set(-0.012, 0, 0);
  group.add(hand);
  const rel = (p) => [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const wrist = [-0.07, -0.05, 0.05];
  group.add(capsule([-0.025, -0.012, 0.005], wrist, 0.033, M.glove));
  group.add(capsule(wrist, rel(forearmEnd), 0.052, M.sleeve));
  g.add(group);
  g.userData.leftHand = group;
  g.userData.leftHome = group.position.clone();
}

/**
 * Main gauche en prise "pouces vers l'avant" sur un pistolet : la paume contre le côté
 * gauche de la poignée, les doigts enroulés par-dessus ceux de la main droite,
 * le pouce allongé le long de la carcasse, vers l'avant.
 */
function pistolSupportHand(g, M, pos, forearmEnd) {
  const group = new THREE.Group();
  group.position.set(...pos);
  const hand = makeHand(M.glove, { curl: [-1.35, -1.15, -0.8], thumbCurl: -0.05, thumbSpread: 0.15 });
  const d = new THREE.Vector3(0, -0.62, -0.78).normalize();      // direction des doigts (vers l'avant et le bas)
  const zAxis = d.clone().negate();                               // le poignet est à l'opposé
  const yAxis = new THREE.Vector3(-1, 0, 0);                      // dos de la main vers la gauche
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);   // pouce vers le haut / l'avant
  orientHand(hand, xAxis.toArray(), yAxis.toArray(), zAxis.toArray());
  group.add(hand);
  const wrist = zAxis.clone().multiplyScalar(0.075).add(new THREE.Vector3(-0.012, 0, 0));
  group.add(capsule([zAxis.x * 0.03, zAxis.y * 0.03, zAxis.z * 0.03], wrist.toArray(), 0.033, M.glove));
  const rel = [forearmEnd[0] - pos[0], forearmEnd[1] - pos[1], forearmEnd[2] - pos[2]];
  group.add(capsule(wrist.toArray(), rel, 0.05, M.sleeve));
  g.add(group);
  g.userData.leftHand = group;
  g.userData.leftHome = group.position.clone();
}

let flashTex = null;
/** Texture d'éclair de bouche : étoile lumineuse avec un cœur blanc */
function flashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64);
  const grad = x.createRadialGradient(0, 0, 0, 0, 0, 60);
  grad.addColorStop(0, 'rgba(255,255,240,1)'); grad.addColorStop(0.25, 'rgba(255,214,120,0.95)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.45)'); grad.addColorStop(1, 'rgba(255,90,0,0)');
  x.fillStyle = grad;
  for (let i = 0; i < 7; i++) {        // branches de l'étoile
    x.rotate((Math.PI * 2) / 7);
    x.beginPath(); x.moveTo(-9, 0); x.lineTo(0, -60 + (i % 2) * 18); x.lineTo(9, 0); x.closePath(); x.fill();
  }
  x.beginPath(); x.arc(0, 0, 22, 0, Math.PI * 2); x.fill();
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

function muzzleFlash(g, z, size = 0.22) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
  );
  flash.position.set(0, 0.02, z);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;
}

/**
 * Ajoute un viseur sur le rail (mountY = hauteur du rail, z = position).
 * Retourne la hauteur du centre de visée (null = pas de viseur → mire).
 */
function addOptic(g, optic, mountY, z) {
  const body = mat(0x1b1d22, { metalness: 0.55, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.16, metalness: 0.9, roughness: 0.05, depthWrite: false });
  if (optic === 'reddot') {
    const c = mountY + 0.042;
    g.add(
      rbox(0.034, 0.014, 0.07, body, 0, mountY + 0.007, z, 0.004),
      rbox(0.008, 0.052, 0.018, body, -0.022, c, z - 0.02, 0.003),
      rbox(0.008, 0.052, 0.018, body, 0.022, c, z - 0.02, 0.003),
      rbox(0.052, 0.01, 0.018, body, 0, c + 0.028, z - 0.02, 0.003),
      cyl(0.008, 0.016, body, 0.022, mountY + 0.022, z + 0.02),
    );
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.046), glass);
    lens.position.set(0, c, z - 0.02);
    g.add(lens);
    return c;
  }
  if (optic === 'mid') {
    const c = mountY + 0.038;
    g.add(
      rbox(0.03, 0.02, 0.1, body, 0, mountY + 0.01, z, 0.004),
      cyl(0.019, 0.14, body, 0, c, z),
      cyl(0.026, 0.05, body, 0, c, z - 0.09, 0.019),
      cyl(0.022, 0.03, body, 0, c, z + 0.08, 0.019),
      cyl(0.01, 0.016, body, 0, c + 0.024, z),
    );
    return c;
  }
  if (optic === 'scope') {
    const c = mountY + 0.05;
    g.add(
      rbox(0.02, 0.035, 0.025, body, 0, mountY + 0.018, z - 0.06, 0.004),
      rbox(0.02, 0.035, 0.025, body, 0, mountY + 0.018, z + 0.07, 0.004),
      cyl(0.022, 0.24, body, 0, c, z),
      cyl(0.032, 0.07, body, 0, c, z - 0.15, 0.022),
      cyl(0.027, 0.05, body, 0, c, z + 0.14, 0.022),
      cyl(0.011, 0.02, body, 0, c + 0.028, z),
    );
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.6 }));
    lens.position.set(0, c, z - 0.186); lens.rotation.y = Math.PI;
    g.add(lens);
    return c;
  }
  return null;
}

/** Cylindre posé "debout" (axe y) */
function vcyl(r, h, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), material);
  m.position.set(x, y, z);
  return m;
}

function buildAK(skin, optic, skins) {
  const g = new THREE.Group();
  const { body: metal, accent: wood, dark } = skinMaterials(skin);
  const M = armMaterials(skins);

  // Boîte de culasse + couvercle bombé avec nervures
  g.add(rbox(0.054, 0.072, 0.42, metal, 0, 0, 0, 0.008));
  const cover = cyl(0.026, 0.32, dark, 0, 0.034, 0.03); cover.scale.set(1, 1, 0.55); // couvercle arrondi
  g.add(cover);
  for (let i = 0; i < 4; i++) g.add(rbox(0.05, 0.004, 0.006, metal, 0, 0.049, 0.12 - i * 0.025, 0.002));
  // Hausse à planchette (comme une vraie AK) : base, planchette graduée, curseur, et lame à encoche en U
  const leaf = new THREE.Group();
  leaf.add(
    rbox(0.034, 0.006, 0.075, dark, 0, 0, 0.03, 0.002),                         // planchette
    rbox(0.04, 0.012, 0.016, metal, 0, 0.004, 0.035, 0.003),                    // curseur
    rbox(0.014, 0.012, 0.006, dark, -0.0105, 0.012, 0.066, 0.0015),             // lame : moitié gauche…
    rbox(0.014, 0.012, 0.006, dark, 0.0105, 0.012, 0.066, 0.0015),              // …moitié droite (encoche au centre)
    rbox(0.007, 0.004, 0.006, dark, 0, 0.0075, 0.066, 0.001),                   // fond de l'encoche
  );
  for (let i = 0; i < 6; i++) leaf.add(rbox(0.036, 0.0015, 0.002, mat(0xd9d4c4), 0, 0.0032, 0.0 + i * 0.01, 0.0005)); // graduations
  leaf.position.set(0, 0.066, 0.06); leaf.rotation.x = -0.04;
  g.add(leaf, rbox(0.05, 0.02, 0.05, dark, 0, 0.045, -0.17, 0.005), rbox(0.04, 0.018, 0.04, dark, 0, 0.056, 0.07, 0.004));
  // Garde-mains en bois (extrudés, bords arrondis)
  g.add(extrude([[-0.2, -0.04], [-0.42, -0.034], [-0.43, -0.02], [-0.43, 0.012], [-0.2, 0.012]], 0.052, wood, 0.006));
  g.add(extrude([[-0.21, 0.018], [-0.4, 0.018], [-0.41, 0.03], [-0.4, 0.05], [-0.22, 0.05], [-0.21, 0.035]], 0.042, wood, 0.006));
  // Tube de gaz, canon, guidon, frein de bouche
  g.add(
    cyl(0.011, 0.24, metal, 0, 0.034, -0.48),
    cyl(0.0125, 0.4, metal, 0, 0.012, -0.58),
    rbox(0.03, 0.035, 0.03, dark, 0, 0.022, -0.62, 0.005),        // bloc de guidon
    rbox(0.02, 0.022, 0.02, dark, 0, 0.048, -0.62, 0.004),        // embase
    rbox(0.0045, 0.03, 0.0045, dark, 0, 0.069, -0.62, 0.001),     // guidon fin (pointe à 0,084)
    rbox(0.0035, 0.04, 0.014, dark, -0.012, 0.066, -0.62, 0.001), // "oreilles" de protection
    rbox(0.0035, 0.04, 0.014, dark, 0.012, 0.066, -0.62, 0.001),
    cyl(0.019, 0.07, dark, 0, 0.012, -0.8),                        // frein de bouche
  );
  // Crosse en bois (profil d'AK) + plaque de couche
  g.add(extrude([[0.17, 0.028], [0.45, -0.005], [0.46, -0.012], [0.46, -0.1], [0.44, -0.105], [0.3, -0.062], [0.19, -0.036], [0.17, -0.03]], 0.044, wood, 0.007));
  g.add(rbox(0.05, 0.1, 0.012, dark, 0, -0.054, 0.46, 0.004));
  // Poignée pistolet + pontet + détente
  g.add(extrude([[0.085, -0.035], [0.14, -0.035], [0.17, -0.15], [0.165, -0.16], [0.13, -0.163], [0.12, -0.15], [0.095, -0.05]], 0.034, wood, 0.006));
  g.add(extrude([[0.0, -0.034], [0.08, -0.034], [0.085, -0.04], [0.08, -0.075], [0.02, -0.075], [0.0, -0.06], [0.006, -0.06], [0.022, -0.068], [0.074, -0.068], [0.076, -0.04], [0.0, -0.04]], 0.012, dark, 0.002));
  g.add(rbox(0.006, 0.026, 0.008, dark, 0, -0.05, 0.045, 0.002));
  // Levier d'armement (côté droit, animable)
  const charge = new THREE.Group();
  charge.add(rbox(0.024, 0.012, 0.03, dark, 0.034, 0.03, 0, 0.004));
  charge.position.z = -0.04;
  g.add(charge);
  g.userData.charge = charge; g.userData.chargeZ = -0.04;

  // Chargeur courbe "banane" (séparé pour l'animation de rechargement)
  const mag = new THREE.Group();
  mag.add(extrude([[-0.03, 0], [0.03, 0], [0.045, -0.06], [0.03, -0.13], [0.0, -0.19], [-0.06, -0.185], [-0.04, -0.12], [-0.03, -0.06]], 0.034, dark, 0.005));
  mag.position.set(0, -0.034, -0.07);
  g.add(mag);
  g.userData.mag = mag; g.userData.magHome = mag.position.clone();

  // Rail + viseur
  if (optic !== 'iron') g.add(rbox(0.026, 0.01, 0.15, dark, 0, 0.055, 0.02, 0.003));
  g.userData.sightY = addOptic(g, optic, 0.06, 0.02) ?? 0.084;

  // --- Détails ---
  const steel = mat(0x2a2d33, { metalness: 0.75, roughness: 0.35 });
  // Rivets du boîtier (des deux côtés)
  for (const x of [-0.028, 0.028]) for (const [y, z] of [[-0.02, -0.15], [-0.02, -0.1], [0.015, -0.17], [-0.02, 0.14], [0.012, 0.16], [-0.025, 0.06]]) {
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), steel); r.position.set(x, y, z); r.scale.x = 0.5; g.add(r);
  }
  // Sélecteur de tir (levier sur le côté droit) + fenêtre d'éjection
  g.add(extrude([[-0.12, 0.022], [0.08, 0.026], [0.1, 0.01], [0.09, 0.004], [-0.12, 0.012]], 0.004, steel, 0.0015));
  g.children[g.children.length - 1].position.x = 0.03;
  g.add(rbox(0.004, 0.018, 0.09, mat(0x0e0f12, { roughness: 0.9 }), 0.0275, 0.018, -0.02, 0.001)); // fenêtre d'éjection
  // Nervures du chargeur + bouton de chargeur
  for (let i = 0; i < 3; i++) mag.add(rbox(0.038, 0.006, 0.05, dark, 0, -0.04 - i * 0.045, -0.006 - i * 0.008, 0.002));
  g.add(rbox(0.03, 0.012, 0.012, steel, 0, -0.04, -0.03, 0.003)); // arrêtoir de chargeur
  // Fentes du frein de bouche, bague de garde-main, anneaux de bretelle
  for (let i = 0; i < 3; i++) g.add(rbox(0.04, 0.004, 0.008, mat(0x0b0c0e), 0, 0.022, -0.79 - i * 0.016, 0.001));
  g.add(cyl(0.032, 0.012, steel, 0, -0.008, -0.2, 0.032));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 14), steel).translateX(-0.028).translateY(-0.03).translateZ(0.38));
  g.children[g.children.length - 1].rotation.y = Math.PI / 2;
  // Vis du garde-main + baïonnette (tenon)
  g.add(cyl(0.006, 0.054, steel, 0, -0.012, -0.3).rotateY(Math.PI / 2));
  g.add(rbox(0.012, 0.012, 0.05, steel, 0, -0.008, -0.7, 0.003));
  // Fenêtre d'éjection (point de sortie des douilles)
  const port = new THREE.Object3D(); port.position.set(0.035, 0.02, -0.02); g.add(port); g.userData.ejectPort = port;

  rightGripHand(g, M, [0.032, -0.09, 0.128], [0.17, -0.36, 0.58], 0.35);
  leftSupportHand(g, M, [0, -0.062, -0.31], [-0.26, -0.44, 0.08]);
  muzzleFlash(g, -0.85);
  return g;
}

function buildKar(skin, optic, skins) {
  const g = new THREE.Group();
  const { body: metal, accent: wood, dark } = skinMaterials(skin);
  const M = armMaterials(skins);

  // Crosse complète en une pièce (profil classique du Kar98k)
  g.add(extrude([
    [0.47, -0.012], [0.3, -0.006], [0.2, -0.016], [0.14, -0.012], [-0.62, -0.006], [-0.645, -0.02], [-0.645, -0.044],
    [-0.5, -0.052], [-0.1, -0.058], [0.03, -0.062], [0.11, -0.058], [0.19, -0.072], [0.47, -0.152],
  ], 0.05, wood, 0.008));
  g.add(rbox(0.054, 0.14, 0.012, dark, 0, -0.082, 0.472, 0.004)); // plaque de couche
  // Boîtier rond, canon, bagues, guidon
  g.add(
    cyl(0.021, 0.3, metal, 0, 0.012, 0.0),
    cyl(0.013, 0.42, metal, 0, 0.012, -0.78),
    cyl(0.016, 0.04, dark, 0, 0.012, -0.98),
    cyl(0.03, 0.02, dark, 0, -0.01, -0.45, 0.03),   // bague
    cyl(0.03, 0.025, dark, 0, -0.008, -0.6, 0.03),  // bague avant
    rbox(0.022, 0.03, 0.04, dark, 0, -0.002, 0.07, 0.004),
  );
  // Pontet + détente
  g.add(extrude([[0.0, -0.06], [0.09, -0.06], [0.095, -0.07], [0.08, -0.1], [0.02, -0.1], [0.0, -0.08], [0.008, -0.08], [0.024, -0.093], [0.076, -0.093], [0.085, -0.068], [0.0, -0.068]], 0.012, dark, 0.002));
  g.add(rbox(0.006, 0.026, 0.008, dark, 0, -0.075, 0.05, 0.002));

  // Levier de culasse avec boule (bouge pendant le réarmement / rechargement)
  const bolt = new THREE.Group();
  bolt.add(capsule([0, 0, 0], [0.06, -0.01, 0], 0.006, metal));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), metal);
  knob.position.set(0.065, -0.012, 0);
  bolt.add(knob);
  bolt.position.set(0.02, 0.012, 0.07);
  g.add(bolt);
  g.userData.bolt = bolt;
  g.userData.boltZ = 0.07;

  // Fenêtre de chargement sur le dessus : quand la culasse recule, on voit les balles
  // dans le magasin, et celle du dessus partir dans la chambre quand on referme.
  const shiny = mat(0xb9bec6, { metalness: 0.9, roughness: 0.22 });
  const brassM = mat(0xc9a04a, { metalness: 0.85, roughness: 0.3 });
  const tipM = mat(0xa8652f, { metalness: 0.7, roughness: 0.35 });
  g.add(
    rbox(0.02, 0.003, 0.085, dark, 0, 0.034, -0.005, 0.001),            // fond de la fenêtre
    rbox(0.004, 0.013, 0.085, metal, 0.0115, 0.04, -0.005, 0.0015),     // bords
    rbox(0.004, 0.013, 0.085, metal, -0.0115, 0.04, -0.005, 0.0015),
  );
  const makeRound = () => {
    const r = new THREE.Group();
    r.add(cyl(0.0052, 0.042, brassM, 0, 0, 0.006), cyl(0.0034, 0.018, tipM, 0, 0, -0.024, 0.0014));
    return r;
  };
  const magRounds = [makeRound(), makeRound()];
  magRounds[0].position.set(0.0028, 0.0405, -0.005);
  magRounds[1].position.set(-0.0035, 0.0385, -0.003);
  for (const r of magRounds) { r.visible = false; g.add(r); }
  const chamberRound = makeRound(); chamberRound.visible = false; g.add(chamberRound);
  // Corps de culasse brillant qui glisse au-dessus de la fenêtre
  const boltBody = new THREE.Group();
  boltBody.add(rbox(0.021, 0.012, 0.1, shiny, 0, 0, 0, 0.004), rbox(0.006, 0.003, 0.08, dark, 0.006, 0.006, 0, 0.001));
  boltBody.position.set(0, 0.039, -0.005); // le dessus reste sous la ligne de visée
  g.add(boltBody);
  Object.assign(g.userData, { magRounds, chamberRound, boltBody, boltBodyZ: -0.005 });

  // Organes de visée d'origine (mire)
  if (optic === 'iron') {
    g.add(
      rbox(0.034, 0.012, 0.05, dark, 0, 0.031, -0.12, 0.004),                     // base de la hausse
      rbox(0.03, 0.005, 0.04, metal, 0, 0.039, -0.115, 0.0015),                   // planchette
    );
    // Hausse à cran en V : deux demi-lames inclinées
    for (const sx of [-1, 1]) {
      const half = rbox(0.016, 0.012, 0.005, dark, sx * 0.0085, 0.046, -0.1, 0.001);
      half.rotation.z = sx * -0.45;
      g.add(half);
    }
    // Guidon "grain d'orge" (triangle fin) sous un tunnel de protection
    g.add(rbox(0.03, 0.014, 0.024, dark, 0, 0.027, -0.96, 0.004));
    const post = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.02, 4), dark);
    post.position.set(0, 0.039, -0.96); post.rotation.y = Math.PI / 4; g.add(post);   // pointe à 0,049
    const hoodK = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0025, 6, 16, Math.PI), dark);
    hoodK.position.set(0, 0.034, -0.96); g.add(hoodK);
  }
  g.userData.sightY = addOptic(g, optic, 0.054, -0.02) ?? 0.049; // le montage passe au-dessus de la culasse

  // --- Détails ---
  const steel = mat(0x2a2d33, { metalness: 0.75, roughness: 0.35 });
  g.add(
    cyl(0.017, 0.06, steel, 0, 0.012, 0.18),                         // arrière de culasse (manchon)
    rbox(0.012, 0.016, 0.03, steel, 0, 0.028, 0.2, 0.003),            // sûreté à drapeau
    rbox(0.004, 0.02, 0.07, mat(0x0e0f12, { roughness: 0.9 }), 0.021, 0.02, 0.02, 0.001), // fenêtre d'éjection
    cyl(0.004, 0.32, steel, 0, -0.024, -0.82),                       // baguette de nettoyage
    rbox(0.02, 0.008, 0.18, steel, 0, -0.06, 0.01, 0.002),            // plaque de fond de magasin
  );
  // Anneaux de bretelle + vis
  for (const z of [-0.45, 0.32]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 14), steel);
    ring.position.set(-0.03, -0.055, z); ring.rotation.y = Math.PI / 2; g.add(ring);
  }
  for (const z of [-0.03, 0.12]) g.add(cyl(0.005, 0.054, steel, 0, -0.048, z).rotateY(Math.PI / 2));
  // Balle tenue par la main gauche pendant le rechargement (une par une)
  const brass = mat(0xc9a04a, { metalness: 0.85, roughness: 0.3 });
  const cart = new THREE.Group();
  cart.add(cyl(0.0062, 0.057, brass, 0, 0, 0), cyl(0.004, 0.022, mat(0xb07a3a, { metalness: 0.7, roughness: 0.35 }), 0, 0, -0.038, 0.0018));
  cart.rotation.y = 0.15;
  // Fenêtre d'éjection
  const port = new THREE.Object3D(); port.position.set(0.03, 0.022, 0.03); g.add(port); g.userData.ejectPort = port;

  rightGripHand(g, M, [0.032, -0.058, 0.155], [0.17, -0.36, 0.6], 0.15);
  leftSupportHand(g, M, [0, -0.075, -0.33], [-0.26, -0.45, 0.04]);
  cart.position.set(0.012, 0.028, 0.0);
  cart.visible = false;
  g.userData.leftHand.add(cart);
  g.userData.cartridge = cart;
  g.userData.knobGrip = new THREE.Vector3(0.012, -0.022, 0.012);
  muzzleFlash(g, -1.02, 0.28);
  return g;
}

// ---------------------------------------------------------------------
//  MP5 : mitraillette compacte. Boîtier en tôle, garde-main nervuré,
//  levier d'armement à gauche (la fameuse "claque"), crosse rétractable.
// ---------------------------------------------------------------------
function buildMP5(skin, optic, skins) {
  const g = new THREE.Group();
  const { body: metal, accent, dark } = skinMaterials(skin);
  const M = armMaterials(skins);
  const black = mat(0x15171b, { roughness: 0.75 });
  const steel = mat(0x2a2d33, { metalness: 0.75, roughness: 0.35 });
  const poly = skin === WEAPON_SKINS.default ? mat(0x202329, { roughness: 0.7 }) : accent; // polymère noir d'origine

  // Boîtier en tôle emboutie + arête supérieure + soudures
  g.add(rbox(0.05, 0.062, 0.34, metal, 0, 0.018, -0.02, 0.01));
  g.add(rbox(0.024, 0.014, 0.33, metal, 0, 0.054, -0.025, 0.005));
  for (const x of [-0.0255, 0.0255]) for (const z of [-0.15, -0.06, 0.05, 0.12]) g.add(rbox(0.002, 0.012, 0.012, steel, x, 0.012, z, 0.002));
  // Garde-main nervuré (polymère)
  g.add(rbox(0.058, 0.056, 0.17, poly, 0, -0.006, -0.28, 0.014));
  for (const x of [-0.029, 0.029]) for (let i = 0; i < 4; i++) g.add(rbox(0.004, 0.006, 0.13, black, x, -0.022 + i * 0.012, -0.28, 0.002));
  // Tube d'armement au-dessus du canon, canon, tri-lug, guidon cerclé
  g.add(cyl(0.011, 0.24, metal, 0, 0.048, -0.27));
  g.add(cyl(0.01, 0.12, steel, 0, 0.012, -0.41), cyl(0.016, 0.036, dark, 0, 0.012, -0.45));
  for (let i = 0; i < 3; i++) { const lug = rbox(0.01, 0.012, 0.03, dark, 0, 0, 0, 0.003); const a = i * 2.09; lug.position.set(Math.cos(a) * 0.017, 0.012 + Math.sin(a) * 0.017, -0.45); lug.rotation.z = a; g.add(lug); }
  g.add(rbox(0.016, 0.03, 0.02, dark, 0, 0.066, -0.365, 0.004));
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0035, 6, 18), dark); hood.position.set(0, 0.085, -0.365); g.add(hood);
  g.add(rbox(0.003, 0.016, 0.003, dark, 0, 0.08, -0.365, 0.001));             // guidon dans le cercle (pointe à 0,088)
  // Hausse à tambour : on vise à travers le petit trou (iron)
  if (optic === 'iron') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0085, 0.0035, 8, 20), dark);
    ring.position.set(0, 0.088, 0.11); g.add(ring);
    g.add(rbox(0.026, 0.024, 0.016, dark, 0, 0.068, 0.11, 0.004));
    for (const x of [-0.011, 0.011]) g.add(rbox(0.004, 0.022, 0.012, dark, x, 0.082, 0.11, 0.001));
  }
  // Levier d'armement à gauche, à l'avant (animable)
  const charge = new THREE.Group();
  charge.add(rbox(0.032, 0.01, 0.012, black, -0.026, 0.048, 0, 0.004), rbox(0.012, 0.014, 0.016, black, -0.044, 0.048, 0, 0.004));
  charge.position.z = -0.33;
  g.add(charge);
  Object.assign(g.userData, { charge, chargeZ: -0.33, chargeTravel: 0.07 });
  // Puits de chargeur + chargeur légèrement courbé (animable)
  g.add(rbox(0.04, 0.04, 0.06, metal, 0, -0.025, -0.12, 0.006));
  const mag = new THREE.Group();
  mag.add(extrude([[-0.024, 0], [0.024, 0], [0.032, -0.08], [0.03, -0.17], [-0.018, -0.17], [-0.016, -0.08]], 0.026, black, 0.004));
  for (let i = 0; i < 3; i++) mag.add(rbox(0.028, 0.004, 0.036, dark, 0, -0.05 - i * 0.04, 0.004 + i * 0.002, 0.0015));
  mag.position.set(0, -0.04, -0.12);
  g.add(mag);
  g.userData.mag = mag; g.userData.magHome = mag.position.clone();
  // Poignée + pontet + détente + sélecteur
  g.add(extrude([[0.04, -0.012], [0.095, -0.012], [0.12, -0.13], [0.115, -0.14], [0.08, -0.142], [0.07, -0.13], [0.05, -0.03]], 0.036, poly, 0.006));
  g.add(extrude([[-0.02, -0.012], [0.05, -0.012], [0.05, -0.02], [0.045, -0.06], [-0.01, -0.06], [-0.02, -0.04], [-0.012, -0.04], [0.0, -0.052], [0.04, -0.052], [0.042, -0.02], [-0.02, -0.02]], 0.014, poly, 0.002));
  g.add(rbox(0.006, 0.024, 0.008, dark, 0, -0.03, 0.02, 0.002));
  g.add(rbox(0.004, 0.014, 0.022, steel, 0.027, -0.002, 0.06, 0.002));
  // Crosse rétractable : 2 rails + plaque de couche
  for (const x of [-0.019, 0.019]) g.add(cyl(0.0055, 0.2, steel, x, 0.02, 0.24));
  g.add(rbox(0.06, 0.1, 0.022, black, 0, -0.01, 0.345, 0.008), rbox(0.05, 0.012, 0.03, steel, 0, 0.022, 0.15, 0.003));
  // Fenêtre d'éjection (droite)
  g.add(rbox(0.004, 0.018, 0.05, black, 0.0255, 0.03, -0.06, 0.001));
  const port = new THREE.Object3D(); port.position.set(0.035, 0.03, -0.06); g.add(port); g.userData.ejectPort = port;

  // Montage pour viseur (griffes)
  if (optic !== 'iron') g.add(rbox(0.03, 0.012, 0.12, dark, 0, 0.066, 0.0, 0.003));
  g.userData.sightY = addOptic(g, optic, 0.072, 0.0) ?? 0.088;
  rightGripHand(g, M, [0.032, -0.07, 0.088], [0.17, -0.36, 0.52], 0.35);
  leftSupportHand(g, M, [0, -0.052, -0.28], [-0.26, -0.42, 0.02]);
  muzzleFlash(g, -0.48, 0.17);
  return g;
}

// ---------------------------------------------------------------------
//  M870 : fusil à pompe. La pompe (avec la main gauche) glisse d'avant en
//  arrière ; cartouches rouges chargées une par une par-dessous.
// ---------------------------------------------------------------------
function buildShotgun(skin, optic, skins) {
  const g = new THREE.Group();
  const { body: metal, accent: wood, dark } = skinMaterials(skin);
  const M = armMaterials(skins);
  const black = mat(0x121418, { roughness: 0.8 });
  const steel = mat(0x2a2d33, { metalness: 0.75, roughness: 0.35 });

  // Carcasse + fenêtre d'éjection + fenêtre de chargement dessous
  g.add(rbox(0.052, 0.074, 0.22, metal, 0, 0.004, 0.0, 0.01));
  g.add(rbox(0.004, 0.026, 0.07, black, 0.026, 0.012, -0.02, 0.001));
  g.add(rbox(0.03, 0.004, 0.11, black, 0, -0.033, 0.0, 0.001));
  g.add(cyl(0.004, 0.06, steel, 0, 0.042, 0.0));                                // rainure du dessus
  // Canon + guidon à bille + tube magasin + collier
  g.add(cyl(0.0135, 0.52, steel, 0, 0.026, -0.37));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), mat(0xe8e4d8, { metalness: 0.8, roughness: 0.2 }));
  bead.position.set(0, 0.043, -0.62); g.add(bead);
  g.add(cyl(0.0125, 0.44, metal, 0, -0.008, -0.33), cyl(0.014, 0.03, dark, 0, -0.008, -0.56));
  g.add(rbox(0.03, 0.05, 0.02, dark, 0, 0.012, -0.55, 0.005));                   // collier canon/magasin
  // Pompe en bois nervurée (animable) + barres de liaison
  const forend = new THREE.Group();
  forend.add(rbox(0.054, 0.05, 0.17, wood, 0, -0.01, 0, 0.016));
  for (let i = 0; i < 7; i++) for (const x of [-0.0272, 0.0272]) forend.add(rbox(0.003, 0.034, 0.006, dark, x, -0.01, -0.07 + i * 0.023, 0.001));
  for (const x of [-0.017, 0.017]) forend.add(cyl(0.003, 0.17, steel, x, -0.004, 0.16));
  forend.position.z = -0.25;
  g.add(forend);
  Object.assign(g.userData, { forend, forendZ: -0.25 });
  // Crosse (bois) + poignée + plaque de couche
  // (le dessus de la crosse reste sous la ligne de visée)
  g.add(extrude([[0.1, 0.03], [0.16, 0.012], [0.44, -0.012], [0.45, -0.022], [0.45, -0.13], [0.43, -0.135], [0.24, -0.085], [0.16, -0.08], [0.12, -0.05], [0.1, -0.035]], 0.044, wood, 0.008));
  g.add(rbox(0.05, 0.115, 0.014, black, 0, -0.077, 0.456, 0.005));
  // Pontet + détente + sécurité
  g.add(extrude([[0.02, -0.032], [0.1, -0.032], [0.105, -0.04], [0.095, -0.07], [0.035, -0.07], [0.02, -0.055], [0.028, -0.055], [0.04, -0.062], [0.09, -0.062], [0.095, -0.04], [0.02, -0.04]], 0.014, dark, 0.002));
  g.add(rbox(0.006, 0.024, 0.008, dark, 0, -0.045, 0.062, 0.002), rbox(0.04, 0.006, 0.006, steel, 0, -0.035, 0.09, 0.002));
  // Fenêtre d'éjection (douilles rouges)
  const port = new THREE.Object3D(); port.position.set(0.034, 0.014, -0.02); g.add(port); g.userData.ejectPort = port;

  // Cartouche tenue par la main gauche pendant le rechargement
  const hull = new THREE.Group();
  hull.add(cyl(0.0105, 0.05, mat(0xb3261e, { roughness: 0.55 }), 0, 0, -0.006), cyl(0.011, 0.014, mat(0xc9a04a, { metalness: 0.85, roughness: 0.3 }), 0, 0, 0.024));
  hull.visible = false;

  if (optic !== 'iron') g.add(rbox(0.026, 0.01, 0.14, dark, 0, 0.044, 0.0, 0.003));
  g.userData.sightY = addOptic(g, optic, 0.048, 0.0) ?? 0.043;
  rightGripHand(g, M, [0.03, -0.055, 0.165], [0.17, -0.36, 0.6], 0.75);
  leftSupportHand(g, M, [0, -0.058, -0.25], [-0.26, -0.44, 0.04]);
  // La main gauche suit la pompe : on la rattache au groupe de la pompe
  const lh = g.userData.leftHand;
  g.remove(lh); forend.add(lh);
  lh.position.set(0, -0.048, 0);
  g.userData.leftHome = lh.position.clone();
  hull.position.set(0.0, 0.03, 0.0);
  lh.add(hull);
  g.userData.cartridge = hull;
  muzzleFlash(g, -0.65, 0.3);
  return g;
}

function buildGlock(skin, skins) {
  const g = new THREE.Group();
  const { body: poly, dark } = skinMaterials(skin);
  const M = armMaterials(skins);
  const steel = mat(0x23262b, { metalness: 0.7, roughness: 0.38 });
  const black = mat(0x0c0d10, { roughness: 0.9 });

  // Culasse (animée : recule à chaque tir)
  const slide = new THREE.Group();
  slide.add(rbox(0.026, 0.03, 0.19, steel, 0, 0, 0, 0.004));
  // Stries de préhension à l'arrière (des deux côtés)
  for (const x of [-0.0132, 0.0132]) for (let i = 0; i < 7; i++) slide.add(rbox(0.002, 0.022, 0.0025, black, x, -0.001, 0.07 - i * 0.006, 0.0005));
  // Fenêtre d'éjection + canon visible, guidon et hausse
  slide.add(
    rbox(0.012, 0.004, 0.04, black, 0.004, 0.0145, -0.01, 0.001),
    rbox(0.004, 0.008, 0.006, steel, 0, 0.019, -0.088, 0.001),                 // guidon
    rbox(0.008, 0.009, 0.008, steel, -0.0075, 0.0195, 0.085, 0.001),           // hausse (2 montants → encoche)
    rbox(0.008, 0.009, 0.008, steel, 0.0075, 0.0195, 0.085, 0.001),
    rbox(0.002, 0.002, 0.002, mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }), 0, 0.023, -0.088, 0.0005), // point blanc
    // hausse : contour blanc de l'encoche en U (comme les vraies mires Glock)
    rbox(0.0022, 0.0022, 0.002, mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5 }), -0.0062, 0.0205, 0.0811, 0.0005),
    rbox(0.0022, 0.0022, 0.002, mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5 }), 0.0062, 0.0205, 0.0811, 0.0005),
  );
  const bore = cyl(0.0045, 0.004, black, 0, -0.004, -0.0955); slide.add(bore);
  // Stries avant, extracteur, chanfrein du nez de culasse, gravure
  for (const x of [-0.0132, 0.0132]) for (let i = 0; i < 5; i++) slide.add(rbox(0.002, 0.016, 0.0022, black, x, 0.001, -0.06 - i * 0.006, 0.0005));
  slide.add(rbox(0.0022, 0.004, 0.022, steel, 0.0133, 0.006, 0.0, 0.0008));                  // extracteur
  slide.add(rbox(0.024, 0.004, 0.014, black, 0, -0.012, -0.089, 0.001));                     // chanfrein
  slide.add(rbox(0.0015, 0.006, 0.03, mat(0x4a4f58, { metalness: 0.6 }), -0.0133, 0.002, 0.03, 0.0005)); // gravure (côté gauche)
  slide.position.set(0, 0.012, -0.02);
  g.add(slide);
  g.userData.slide = slide; g.userData.slideZ = -0.02;
  const port = new THREE.Object3D(); port.position.set(0.016, 0.016, -0.01); slide.add(port); g.userData.ejectPort = port;

  // Carcasse en polymère : rail, pontet, poignée inclinée avec texture
  g.add(extrude([
    [-0.11, -0.003], [0.075, -0.003], [0.08, -0.012], [0.1, -0.115], [0.094, -0.125], [0.045, -0.125], [0.04, -0.112],
    [0.03, -0.035], [0.0, -0.032], [-0.005, -0.05], [-0.038, -0.05], [-0.042, -0.024], [-0.11, -0.02],
  ], 0.027, poly, 0.004));
  g.add(extrude([[-0.034, -0.044], [0.0, -0.044], [0.0, -0.05], [-0.036, -0.05]], 0.022, poly, 0.002)); // bas du pontet
  g.add(rbox(0.005, 0.02, 0.007, black, 0, -0.03, -0.012, 0.0015));       // détente (avec sécurité)
  g.add(rbox(0.016, 0.006, 0.045, poly, 0, -0.022, -0.08, 0.002));        // rail
  for (let i = 0; i < 3; i++) g.add(rbox(0.018, 0.004, 0.004, black, 0, -0.026, -0.065 - i * 0.012, 0.001));
  g.add(rbox(0.006, 0.006, 0.012, black, 0.014, -0.022, 0.005, 0.0015));  // arrêtoir de culasse
  g.add(rbox(0.01, 0.008, 0.008, black, 0.013, -0.035, 0.034, 0.002));    // bouton de chargeur
  g.add(rbox(0.03, 0.004, 0.01, black, 0, -0.012, -0.02, 0.001));          // levier de démontage
  // Ondulations pour les doigts sur l'avant de la poignée + queue de castor
  for (let i = 0; i < 3; i++) { const bump = rbox(0.024, 0.012, 0.008, poly, 0, -0.05 - i * 0.024, 0.04 + i * 0.005, 0.004); bump.rotation.x = -0.2; g.add(bump); }
  g.add(rbox(0.024, 0.008, 0.02, poly, 0, -0.006, 0.085, 0.004));
  // Texture du dos de la poignée
  for (let i = 0; i < 6; i++) { const t = rbox(0.022, 0.002, 0.004, dark, 0, -0.03 - i * 0.014, 0.096 + i * 0.0028, 0.0006); t.rotation.x = -0.2; g.add(t); }
  // Texture granuleuse de la poignée (plaquettes)
  for (const x of [-0.0138, 0.0138]) {
    const grip = rbox(0.002, 0.07, 0.04, dark, x, -0.07, 0.065, 0.001);
    grip.rotation.x = -0.2; g.add(grip);
  }
  // Chargeur (séparé pour le rechargement) avec talon
  const mag = new THREE.Group();
  mag.add(rbox(0.02, 0.1, 0.03, black, 0, -0.05, 0, 0.003), rbox(0.026, 0.012, 0.04, poly, 0, -0.104, 0.002, 0.003));
  mag.rotation.x = -0.2;
  mag.position.set(0, -0.02, 0.058);
  g.add(mag);
  g.userData.mag = mag; g.userData.magHome = mag.position.clone();

  g.userData.sightY = 0.034;
  // Prise à deux mains : la main droite sur la poignée, la gauche par-dessus
  rightGripHand(g, M, [0.03, -0.06, 0.078], [0.13, -0.3, 0.42], 0.2);
  pistolSupportHand(g, M, [-0.036, -0.074, 0.06], [-0.17, -0.32, 0.36]);
  muzzleFlash(g, -0.13, 0.14);
  return g;
}

/**
 * Couteau papillon (balisong) : une lame et deux manches ajourés qui pivotent
 * sur deux goupilles. Tout l'ensemble peut tourner autour de l'annulaire.
 */
function buildButterfly(skin, skinId, skins) {
  const g = new THREE.Group();
  const M = armMaterials(skins);
  const { body, accent, dark } = skinMaterials(skin);
  const std = !skinId || skinId === 'default';
  const bladeMat = std ? mat(0xd9dee6, { metalness: 0.95, roughness: 0.16 }) : body;
  const handleMat = std ? mat(0x2b2f37, { metalness: 0.8, roughness: 0.3 }) : accent;
  const pinMat = mat(0xc9a04a, { metalness: 0.9, roughness: 0.25 });

  // Pivot = l'annulaire : tout tourne autour
  const spin = new THREE.Group();
  spin.position.set(0, -0.004, 0.06);
  g.add(spin);
  const knife = new THREE.Group();
  knife.position.set(0, 0.004, -0.06);
  spin.add(knife);

  // Lame "tanto" avec gorge (fuller) et dos aiguisé
  knife.add(
    extrude([[0.0, 0.009], [0.0, -0.009], [-0.12, -0.009], [-0.15, 0.0], [-0.135, 0.009]], 0.0045, bladeMat, 0.001),
    rbox(0.0048, 0.003, 0.08, mat(0x9aa3b0, { metalness: 0.9, roughness: 0.3 }), 0, 0.002, -0.055, 0.0008),
    rbox(0.006, 0.02, 0.016, bladeMat, 0, 0, 0.004, 0.002),                       // talon (tang)
  );
  // Deux manches qui pivotent sur des goupilles (côté dos et côté tranchant)
  const handle = (side) => {
    const h = new THREE.Group();
    h.position.set(0, side * 0.0105, 0.006);
    const bar = new THREE.Group();
    bar.add(rbox(0.016, 0.0065, 0.13, handleMat, 0, 0, 0.065, 0.0025));
    for (let i = 0; i < 5; i++) bar.add(rbox(0.0168, 0.0035, 0.012, dark, 0, side * 0.0005, 0.02 + i * 0.022, 0.001)); // ajours
    bar.add(cyl(0.0035, 0.018, pinMat, 0, 0, 0.0).rotateY(Math.PI / 2));        // goupille
    bar.add(rbox(0.017, 0.006, 0.01, pinMat, 0, 0, 0.128, 0.002));              // embout
    h.add(bar);
    knife.add(h);
    return h;
  };
  const handleA = handle(1), handleB = handle(-1);
  // Loquet au bout du manche "sûr"
  const latch = rbox(0.006, 0.004, 0.025, pinMat, 0, 0.004, 0.135, 0.001);
  handleA.add(latch);
  Object.assign(g.userData, { spin, handleA, handleB, blade: knife });

  // Main : l'annulaire sert d'axe
  const handG = new THREE.Group();
  const hand = makeHand(M.glove, { curl: [-1.35, -1.15, -0.8], thumbCurl: -0.25, thumbSpread: -0.25 });
  hand.scale.x = -1;
  orientHand(hand, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  hand.position.set(0.028, 0.02, 0.085);
  handG.add(hand);
  handG.add(capsule([0.02, 0, 0.12], [0.04, -0.04, 0.2], 0.034, M.glove));
  handG.add(capsule([0.04, -0.04, 0.2], [0.1, -0.16, 0.5], 0.05, M.sleeve));
  g.add(handG);
  g.userData.hand = handG;
  return g;
}

function buildKnife(skin, skinId, skins) {
  const g = new THREE.Group();
  const M = armMaterials(skins);
  const { body, accent } = skinMaterials(skin);
  // Lame en acier pour le skin standard, sinon couleur du skin
  const bladeMat = !skinId || skinId === 'default' ? mat(0xd8dee9, { metalness: 0.9, roughness: 0.2 }) : body;

  // La lame + le manche forment un groupe qui peut tourner/s'envoler (animations)
  const blade = new THREE.Group();
  blade.add(
    extrude([[0.0, 0.014], [0.0, -0.012], [-0.16, -0.012], [-0.235, 0.004], [-0.2, 0.012], [-0.13, 0.018], [-0.02, 0.018]], 0.006, bladeMat, 0.0015), // lame (pointe)
    rbox(0.026, 0.05, 0.014, mat(0x444a55, { metalness: 0.6 }), 0, 0, -0.006, 0.004),                     // garde
    extrude([[0.005, -0.016], [0.03, -0.02], [0.05, -0.016], [0.072, -0.021], [0.11, -0.018], [0.128, -0.012], [0.128, 0.013], [0.005, 0.016]], 0.026, accent, 0.006), // manche avec crans pour les doigts
    cyl(0.008, 0.01, mat(0x444a55, { metalness: 0.6 }), 0, 0, 0.132),                                     // pommeau
  );
  g.add(blade);
  g.userData.blade = blade;

  // Main qui serre le manche
  const handG = new THREE.Group();
  const hand = makeHand(M.glove, { curl: [-1.45, -1.2, -0.8], thumbCurl: -0.15, thumbSpread: -0.2 });
  hand.scale.x = -1;
  orientHand(hand, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  hand.position.set(0.03, 0.022, 0.065);
  handG.add(hand);
  handG.add(capsule([0.02, 0, 0.1], [0.04, -0.04, 0.19], 0.034, M.glove));
  handG.add(capsule([0.04, -0.04, 0.19], [0.1, -0.16, 0.5], 0.05, M.sleeve));
  g.add(handG);
  g.userData.hand = handG;
  return g;
}
