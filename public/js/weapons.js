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
import { WEAPON_SKINS, CHARACTER_SKINS, GLOVE_SKINS } from '/shared/skins.js';
import { dirFromAngles } from '/shared/physics.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mat, rbox, cyl, capsule, orientHand, skinMaterials, handMaterials } from './models.js';
import { fabricTex } from './textures.js';

// ---------------------------------------------------------------------
//  Modèles .glb (faits dans Blender) : chargés une fois avant le jeu
// ---------------------------------------------------------------------
const GLB_FILES = { hands: 'hands', ak: 'ak47', kar98k: 'kar98k', mp5: 'mp5', shotgun: 'm870', glock: 'glock18', knife: 'knife', butterfly: 'butterfly' };
const GLB = Object.fromEntries(await Promise.all(Object.entries(GLB_FILES).map(async ([id, file]) => {
  const gltf = await new GLTFLoader().loadAsync(`/models/${file}.glb`);
  return [id, gltf.scene];
})));

/**
 * Main riggée (hands.glb : 16 os — paume, 3 phalanges par doigt, pouce en 3 parties).
 * Même repère et mêmes réglages que l'ancienne makeHand :
 * paume vers -y, doigts vers -z, index en +x (main GAUCHE ; main droite : scale.x = -1).
 * curl = pliage des phalanges [1, 2, 3] (négatif = vers la paume), indexCurl = index sur la détente.
 * Le style du gant (mitaines / complets / nues) choisit les matériaux de chaque zone du mesh.
 */
const HAND_X = new THREE.Vector3(1, 0, 0), HAND_Y = new THREE.Vector3(0, 1, 0);
const handSkinMats = new Map();
function handSlotMaterials(glove) {
  if (!handSkinMats.has(glove.uuid)) {
    const H = handMaterials(glove);
    const style = glove.userData?.gloveStyle || 'fingerless';
    const bare = style === 'bare', full = style === 'full';
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    handSkinMats.set(glove.uuid, {
      Glove: bare ? H.skin : glove,
      GloveMid: full ? glove : H.skin,        // phalanges du milieu : nues en mitaines
      GloveTip: full ? glove : H.skin,        // bouts des doigts
      GlovePlate: bare ? hidden : H.plate,    // protections des jointures / renfort
      GloveStrap: bare ? hidden : H.strap,    // sangle du poignet
      GloveSeam: bare ? hidden : H.seam,
      Nail: full ? hidden : H.nail,
      Tendon: bare ? H.skin : hidden,         // tendons : mains nues seulement
    });
  }
  return handSkinMats.get(glove.uuid);
}
function makeHand(glove, { curl = [-0.9, -1.1, -0.8], indexCurl = null, thumbCurl = -0.5, thumbSpread = -0.7 } = {}) {
  const c3 = (c) => (c.length >= 3 ? c : [c[0], c[1], c[1] * 0.8]);
  curl = c3(curl); if (indexCurl) indexCurl = c3(indexCurl);
  const hand = new THREE.Group();
  const rig = cloneSkinned(GLB.hands);
  hand.add(rig);
  const slots = handSlotMaterials(glove);
  rig.traverse((o) => {
    if (o.isMesh) { o.material = slots[o.material.name] || o.material; o.frustumCulled = false; }
  });
  // Pour chaque os : axes de la MAIN (x = plier, y = écarter) exprimés dans le repère de l'os au repos
  const rest = new Map();
  rig.traverse((o) => { if (o.isBone) rest.set(o, o.quaternion.clone()); });
  const restToHand = (b) => { const q = new THREE.Quaternion(); for (let o = b; o && o.isBone; o = o.parent) q.premultiply(rest.get(o)); return q; };
  const bone = (name) => {
    const b = rig.getObjectByName(name);
    const inv = restToHand(b).invert();
    return { b, q0: rest.get(b), ax: HAND_X.clone().applyQuaternion(inv), ay: HAND_Y.clone().applyQuaternion(inv) };
  };
  const B = [];
  for (const f of FINGERS) for (let k = 1; k <= 3; k++) B.push(bone(`${f}${k}`));
  B.push(bone('thumb1'), bone('thumb2'), bone('thumb3'));
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const cur = new Float32Array(POSE_LEN);
  /** Applique une pose (vecteur de 16 valeurs, cf. pose()) */
  const apply = (p) => {
    cur.set(p);
    for (let i = 0; i < 12; i++) {
      const { b, q0, ax, ay } = B[i];
      b.quaternion.copy(q0);
      if (i % 3 === 0) { // 1re phalange : écartement des doigts (index et auriculaire s'écartent le plus)
        const s = p[15] * SPLAY[i / 3];
        if (s) b.quaternion.multiply(qb.setFromAxisAngle(ay, s));
      }
      b.quaternion.multiply(qa.setFromAxisAngle(ax, p[i]));
    }
    B[12].b.quaternion.copy(B[12].q0).multiply(qa.setFromAxisAngle(B[12].ay, p[12]));
    B[13].b.quaternion.copy(B[13].q0).multiply(qa.setFromAxisAngle(B[13].ax, p[13]));
    B[14].b.quaternion.copy(B[14].q0).multiply(qa.setFromAxisAngle(B[14].ax, p[14]));
  };
  const tmp = new Float32Array(POSE_LEN);
  hand.userData.pose = cur;
  hand.userData.setPose = apply;
  /** Va vers la pose voulue en douceur (les doigts ont un peu d'inertie) */
  hand.userData.blendTo = (target, k) => {
    for (let i = 0; i < POSE_LEN; i++) tmp[i] = cur[i] + (target[i] - cur[i]) * k;
    apply(tmp);
  };
  hand.userData.rest = pose(curl, { index: indexCurl, thumbCurl, thumbSpread });
  apply(hand.userData.rest);
  return hand;
}

// ---------------------------------------------------------------------
//  Poses de main : 16 valeurs = [index ×3, majeur ×3, annulaire ×3, auriculaire ×3,
//  pouce (écart, pli 2, pli 3), écartement des doigts]. Pli négatif = vers la paume.
// ---------------------------------------------------------------------
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const POSE_LEN = 16;
const SPLAY = [-1, -0.3, 0.3, 1];
function pose(curl, { index = null, middle = null, ring = null, pinky = null, thumbCurl = -0.5, thumbSpread = -0.7, splay = 0 } = {}) {
  const c3 = (c) => (c.length >= 3 ? c : [c[0], c[1], c[1] * 0.8]);
  const p = new Float32Array(POSE_LEN);
  [index, middle, ring, pinky].forEach((c, i) => p.set(c3(c || curl), i * 3));
  p[12] = thumbSpread; p[13] = thumbCurl * 0.5; p[14] = thumbCurl * 0.7; p[15] = splay;
  return p;
}
function mixPose(a, b, k, out = new Float32Array(POSE_LEN)) {
  for (let i = 0; i < POSE_LEN; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}
const HP = {
  RIFLE: pose([-1.25, -1.05, -0.7], { index: [-0.3, -0.75, -0.5], thumbCurl: -0.55, thumbSpread: -0.4 }),
  SUPPORT: pose([-1.15, -0.95, -0.6], { thumbCurl: -0.25 }),
  PISTOL_SUP: pose([-1.35, -1.15, -0.8], { thumbCurl: -0.05, thumbSpread: 0.15 }),
  KNIFE: pose([-1.45, -1.2, -0.8], { thumbCurl: -0.15, thumbSpread: -0.2 }),
  OPEN: pose([-0.3, -0.35, -0.2], { thumbCurl: -0.15, thumbSpread: -0.75, splay: 0.08 }),
  FLAT: pose([-0.08, -0.06, -0.04], { thumbCurl: 0.05, thumbSpread: -0.35, splay: 0.03 }),          // paume à plat (claque)
  PINCH: pose([-1.55, -1.35, -0.9], { index: [-0.95, -0.85, -0.45], thumbCurl: -0.85, thumbSpread: -0.1 }), // pince pouce + index
  MAG: pose([-0.95, -0.95, -0.6], { thumbCurl: -0.45, thumbSpread: -0.95 }),                          // tient un chargeur
  CART: pose([-1.3, -1.2, -0.8], { index: [-0.75, -0.95, -0.55], thumbCurl: -0.95, thumbSpread: -0.2 }), // balle entre pouce et index
  PUSH: pose([-1.35, -1.2, -0.85], { index: [-1.0, -1.0, -0.6], thumbCurl: 0.15, thumbSpread: -0.05 }),   // le pouce pousse
  SLIDE: pose([-1.05, -1.15, -0.75], { thumbCurl: -0.7, thumbSpread: -0.55 }),                          // prise par-dessus
  FIST: pose([-1.6, -1.5, -1.0], { thumbCurl: -0.9, thumbSpread: -0.1 }),
};

// Position de l'arme à l'écran sans viser (hip) + distance en visée (adsZ)
const POSES = {
  ak:     { hip: [0.17, -0.17, -0.62], adsZ: { iron: -0.52, reddot: -0.44, mid: -0.38 } },
  kar98k: { hip: [0.19, -0.2, -0.7],   adsZ: { iron: -0.68, reddot: -0.56, mid: -0.5, scope: -0.3 } },
  mp5:    { hip: [0.16, -0.16, -0.5],   adsZ: { iron: -0.47, reddot: -0.38, mid: -0.33 } },
  shotgun: { hip: [0.17, -0.16, -0.6], adsZ: { iron: -0.62, reddot: -0.5 } },
  glock:  { hip: [0.115, -0.135, -0.4], adsZ: { iron: -0.36 } },
};
const PI = Math.PI;
const INSPECT_TIME = { butterfly: 6.0, ak: 3.0, mp5: 2.8, shotgun: 3.2, kar98k: 3.6, glock: 2.6, knife: 2.8 };

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Ressort critique (amorti pile ce qu'il faut) : ramène `pos` vers `target` sans
 * jamais osciller, quelle que soit la durée de l'image (dt). Formule fermée stable
 * (Game Programming Gems 4 / "SmoothDamp") — contrairement à une intégration
 * d'Euler classique (vitesse += -raideur*x*dt), qui devient sous-amortie et se met
 * à vibrer dès que le taux d'images varie un peu (c'était la cause du tremblement
 * des mains/de l'arme quand on bouge la souris).
 * smoothTime = temps (s) pour combler l'essentiel de l'écart.
 */
function springTo(pos, vel, target, smoothTime, dt) {
  const omega = 2 / Math.max(smoothTime, 0.0001);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = pos - target;
  const temp = (vel + omega * change) * dt;
  return [target + (change + temp) * exp, (vel - omega * temp) * exp];
}

/**
 * Animation par "images clés" : keys = [[t, {valeurs}], ...] (t de 0 à 1).
 * Retourne les valeurs interpolées en douceur au temps t.
 */
function track(t, keys) {
  const [a, b, k] = segment(t, keys);
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[key], vb = b[key];
    if (typeof va === 'string' || typeof vb === 'string') continue; // noms de poses de main : voir handPose()
    out[key] = (va || 0) + ((vb || 0) - (va || 0)) * k;
  }
  return out;
}
/** Segment d'images clés en cours : [clé avant, clé après, avancement adouci 0..1]. lin: 1 = vitesse constante */
function segment(t, keys) {
  if (!(t > keys[0][0])) return [keys[0][1], keys[0][1], 0];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i], [t1, b] = keys[i + 1];
    if (t <= t1) {
      const u = clamp01((t - t0) / (t1 - t0 || 1));
      return [a, b, b.lin ? u : ease(u)];
    }
  }
  const last = keys[keys.length - 1][1];
  return [last, last, 0];
}
/** Pose de main d'une animation : les images clés donnent un nom de pose (rf = main droite, lf = gauche) */
function handPose(t, keys, field, fallback, out) {
  const [a, b, k] = segment(t, keys);
  return mixPose(HP[a[field]] || fallback, HP[b[field]] || fallback, k, out);
}

// ---------------------------------------------------------------------
//  Images clés (décalages par rapport au repos)
//  px/py/pz, rx/ry/rz = arme · magY/magR = chargeur · hx/hy/hz = main gauche
//  ch = levier d'armement tiré (0..1) · bolt = culasse ouverte (0..1)
// ---------------------------------------------------------------------
const TILT = { rz: 0.42, rx: 0.1, py: -0.03, px: -0.02 };
const ITILT = { rz: 0.45, rx: -0.06, ry: 0.12, py: 0.06, px: -0.08, pz: 0.02 }; // AK penchée pour bien voir le chargeur
const ANIMS = {
  // A1 : il reste des balles → chargeur sorti, nouveau chargeur, claque
  classicTactical: {
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
  // ---- AK : rechargement "irakien" (inspiré de ta vidéo) ----
  // La main gauche reste sur le garde-main. La main droite lâche la poignée, prend un chargeur neuf,
  // s'en sert pour taper la palette : l'ancien chargeur bascule et tombe, le neuf s'accroche par l'avant
  // et se verrouille en basculant vers l'arrière. nm = chargeur neuf dans la main, oh = ancien caché.
  akTactical: {
    keys: [
      [0, {}],
      [0.1, { ...ITILT, rhx: 0.03, rhy: -0.12, rhz: 0.0, nm: 1, rf: 'MAG' }],             // la main va chercher le chargeur neuf
      [0.22, { ...ITILT, rhx: 0.01, rhy: -0.2, rhz: -0.14, nm: 1, rf: 'MAG' }],           // il remonte sous l'arme
      [0.28, { ...ITILT, rhx: 0.0, rhy: -0.135, rhz: -0.165, nm: 1, rf: 'MAG' }],         // élan…
      [0.3, { ...ITILT, py: 0.008, rz: 0.47, rhx: 0.0, rhy: -0.11, rhz: -0.17, nm: 1, rf: 'MAG' }],   // TAC : il frappe la palette (l'arme encaisse)
      [0.34, { ...ITILT, rz: 0.36, rhx: 0.0, rhy: -0.12, rhz: -0.19, nm: 1, magR: 0.45, magY: -0.02, rf: 'MAG' }], // l'ancien bascule
      [0.44, { ...ITILT, rhx: 0.0, rhy: -0.12, rhz: -0.21, nm: 1, magR: 1.5, magY: -0.55, oh: 0, rf: 'MAG' }],      // et tombe
      [0.47, { ...ITILT, rhx: 0.0, rhy: -0.11, rhz: -0.2, nm: 1, magY: -0.8, oh: 1, rf: 'MAG' }],
      [0.5, { ...ITILT, rhx: 0.0, rhy: -0.1, rhz: -0.2, nm: 0, magY: -0.035, magR: 0.28, oh: 0, rf: 'FLAT' }],     // le neuf s'accroche par l'avant
      [0.56, { ...ITILT, rhx: 0.0, rhy: -0.105, rhz: -0.16, magY: -0.02, magR: 0.18, rf: 'FLAT' }],               // la paume remonte sous le chargeur
      [0.6, { ...ITILT, rz: 0.33, rx: 0.12, py: 0.01, rhx: 0.0, rhy: -0.08, rhz: -0.17, magY: 0, magR: 0, rf: 'FLAT' }], // CLAC, verrouillé (choc)
      [0.66, { ...ITILT, rz: 0.4, rx: 0.08, rhx: 0.01, rhy: -0.09, rhz: -0.12, rf: 'OPEN' }],
      [0.8, { rz: 0.06 }],
      [1, {}],
    ],
    events: [[0.04, 'cloth'], [0.31, 'magOut'], [0.6, 'magIn']],
  },
  akEmpty: {
    keys: [
      [0, {}],
      [0.08, { ...ITILT, rhx: 0.03, rhy: -0.12, rhz: 0.0, nm: 1, rf: 'MAG' }],
      [0.17, { ...ITILT, rhx: 0.01, rhy: -0.2, rhz: -0.14, nm: 1, rf: 'MAG' }],
      [0.21, { ...ITILT, rhx: 0.0, rhy: -0.135, rhz: -0.165, nm: 1, rf: 'MAG' }],
      [0.23, { ...ITILT, py: 0.008, rz: 0.47, rhx: 0.0, rhy: -0.11, rhz: -0.17, nm: 1, rf: 'MAG' }],
      [0.26, { ...ITILT, rz: 0.36, rhx: 0.0, rhy: -0.12, rhz: -0.19, nm: 1, magR: 0.45, magY: -0.02, rf: 'MAG' }],
      [0.34, { ...ITILT, rhx: 0.0, rhy: -0.12, rhz: -0.21, nm: 1, magR: 1.5, magY: -0.55, oh: 0, rf: 'MAG' }],
      [0.36, { ...ITILT, rhx: 0.0, rhy: -0.11, rhz: -0.2, nm: 1, magY: -0.8, oh: 1, rf: 'MAG' }],
      [0.39, { ...ITILT, rhx: 0.0, rhy: -0.1, rhz: -0.2, nm: 0, magY: -0.035, magR: 0.28, oh: 0, rf: 'FLAT' }],
      [0.44, { ...ITILT, rhx: 0.0, rhy: -0.105, rhz: -0.16, magY: -0.02, magR: 0.18, rf: 'FLAT' }],
      [0.47, { ...ITILT, rz: 0.33, rx: 0.12, py: 0.01, rhx: 0.0, rhy: -0.08, rhz: -0.17, magY: 0, magR: 0, rf: 'FLAT' }],
      // la main droite passe par-dessus l'arme et arme le levier (comme dans la vidéo)
      [0.6, { rz: -0.22, ry: 0.08, rx: 0.04, rhx: 0.03, rhy: 0.125, rhz: -0.17, rf: 'SLIDE' }],
      [0.7, { rz: -0.26, ry: 0.1, rx: 0.06, rhx: 0.03, rhy: 0.125, rhz: -0.07, ch: 1, pz: 0.015, rf: 'SLIDE' }],
      [0.73, { rz: -0.2, ry: 0.08, rx: 0.1, py: 0.006, rhx: 0.035, rhy: 0.135, rhz: -0.05, ch: 0, rf: 'OPEN' }], // lâché : la culasse claque
      [0.86, { rz: 0.05 }],
      [1, {}],
    ],
    events: [[0.03, 'cloth'], [0.24, 'magOut'], [0.47, 'magIn'], [0.68, 'chargeBack'], [0.72, 'chargeRelease']],
  },
  akEmptyOld: {
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
      [0.28, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.7, rz: -0.22, rx: 0.08, hx: 0.085, hy: 0.055, hz: 0.33, lf: 'PINCH' }],
      [0.4, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.72, rz: -0.22, rx: 0.08, hx: 0.085, hy: 0.055, hz: 0.38, ch: 0.45, lf: 'PINCH' }], // on entrouvre
      [0.62, { px: -0.07, py: 0.055, pz: 0.13, ry: 0.8, rz: -0.18, rx: 0.12, hx: 0.085, hy: 0.055, hz: 0.38, ch: 0.45, lf: 'PINCH' }], // on regarde
      [0.7, { px: -0.07, py: 0.05, pz: 0.12, ry: 0.7, rz: -0.22, rx: 0.08, hx: 0.085, hy: 0.055, hz: 0.33, lf: 'OPEN' }],
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
      [0.37, { px: -0.05, py: 0.06, pz: 0.12, ry: 0.4, rz: -0.35, rx: 0.15, rhw: 1 }],              // la main droite va sur le verrou
      [0.46, { px: -0.05, py: 0.06, pz: 0.12, ry: 0.4, rz: -0.35, rx: 0.15, bolt: 1, rhw: 1 }],
      [0.6, { px: -0.05, py: 0.065, pz: 0.13, ry: 0.45, rz: -0.38, rx: 0.18, bolt: 1, rhw: 1 }],
      [0.66, { px: -0.05, py: 0.058, pz: 0.12, ry: 0.4, rz: -0.35, rx: 0.15, rhw: 1 }],
      [0.74, { px: -0.03, py: 0.04, pz: 0.08, ry: 0.15, rz: -0.12, hx: 0.01, hy: 0.15, hz: 0.25, lf: 'OPEN' }], // main sur la lunette
      [0.88, { px: -0.03, py: 0.04, pz: 0.08, ry: 0.15, rz: -0.12, hx: 0.01, hy: 0.15, hz: 0.42, lf: 'OPEN' }], // caresse
      [1, {}],
    ],
    events: [[0.05, 'cloth'], [0.42, 'boltUp'], [0.45, 'boltBack'], [0.62, 'boltForward'], [0.65, 'boltDown'], [0.76, 'cloth']],
  },
  // Couteau de combat : animations simples (on regarde la lame d'un côté puis de l'autre)
  knifeInspect: {
    keys: [
      [0, {}],
      [0.2, { px: -0.1, py: 0.06, pz: 0.1, ry: -0.9, rz: 0.5, rx: -0.2 }],
      [0.4, { px: -0.1, py: 0.06, pz: 0.1, ry: -0.95, rz: 0.5, rx: -0.2 }],
      [0.46, { px: -0.09, py: 0.065, pz: 0.1, ry: -0.3, rz: 0.0, fo: 0.6 }],                       // les doigts se desserrent…
      [0.58, { px: -0.08, py: 0.06, pz: 0.1, ry: 0.4, rz: -0.6, rx: 0.2, fo: 0.6, kspin: 2 * PI }],  // …la lame tourne dans la main
      [0.64, { px: -0.08, py: 0.055, pz: 0.1, ry: 0.4, rz: -0.6, rx: 0.2, kspin: 2 * PI }],          // et on resserre (petit choc)
      [0.85, { px: -0.08, py: 0.06, pz: 0.1, ry: 0.42, rz: -0.6, rx: 0.2, kspin: 2 * PI }],
      [1, { kspin: 2 * PI }],
    ],
    events: [[0.05, 'cloth'], [0.5, 'knifeFlip'], [0.62, 'cloth']],
  },
  knifeDraw: {
    keys: [[0, { py: -0.2, rx: -0.6 }], [0.6, { py: 0.01 }], [1, {}]],
    events: [[0.05, 'cloth']],
  },
  // ---- Couteau papillon ----
  // Canaux : bH / bR / bC = orientation du couteau (H = tenu dans le poing lame en l'air,
  // R = à plat entre les doigts pour les rollovers, C = "Chaplin" pendu au bout de l'annulaire).
  // kx/ky/kz = déplacement des goupilles depuis le poing · rl = 1 : le couteau roule autour des doigts,
  // rg = position dans les espaces entre les doigts (0 = pouce/index … 4 = sous l'auriculaire).
  // sz = rotation autour de l'axe des doigts · fx = salto (aérien) · fs = bascule autour des goupilles.
  // ha / hb = angle des deux manches (0 = ouvert, π = refermés sur la lame).
  // fo = ouverture des doigts (0 = poing, 1 = ouverts) · ce = Chaplin (annulaire tendu, les autres repliés).
  // Ouverture classique : on tient le manche "sûr", la lame et le manche "mordant" font le tour,
  // puis le manche mordant revient claquer dans la paume.
  bflyDraw: {
    keys: [
      [0, { py: -0.2, rx: -0.5, fs: PI, ha: PI, hb: PI }],
      [0.22, { py: 0.01, fs: PI, ha: PI, hb: PI }],
      [0.3, { rz: -0.16, rx: 0.05, fs: PI, ha: PI, hb: PI }],                 // on arme le poignet
      [0.5, { rz: 0.28, fs: PI * 2, ha: 0, hb: PI, fo: 0.15 }],               // coup de poignet : la lame sort
      [0.56, { rz: 0.24, fs: PI * 2, ha: 0, hb: PI, fo: 0.3 }],
      [0.64, { rz: -0.2, fs: PI * 2, ha: 0, hb: PI * 0.7, fo: 0.3 }],         // contre-coup…
      [0.76, { rz: 0.05, py: -0.008, fs: PI * 2, ha: 0, hb: 0 }],            // …le manche mordant claque dans la paume
      [0.84, { rz: -0.02, py: 0.003, fs: PI * 2 }],
      [1, { fs: PI * 2 }],
    ],
    events: [[0.05, 'cloth'], [0.46, 'knifeFlip'], [0.74, 'knifeFlip'], [0.77, 'magIn']],
  },
  // Inspection : rollovers d'un doigt à l'autre (aller-retour), fan, aérien,
  // puis "Chaplin" pendu à l'annulaire qui se balance et fait un tour complet, et on referme / rouvre.
  bflyInspect: {
    keys: (() => {
      const S = { px: -0.11, py: 0.06, pz: 0.05, rx: 0.85, ry: -0.25, rz: 2.0, fo: 1 };   // main levée, doigts vers la gauche
      const C = { px: -0.13, py: 0.06, pz: -0.02, rx: 0.45, ry: -1.0, rz: 2.0 };         // annulaire pointé vers l'avant-gauche
      const R = (rg, o = {}) => ({ ...S, bR: 1, rl: 1, rg, ...o });
      // Chaplin : sz décalé d'un demi-tour pour avoir la lame en haut, manches en T
      const CH = (o = {}) => ({ ...C, bC: 1, kx: 0.022, ky: -0.049, kz: -0.056, ce: 1, fx: 4 * PI, ha: PI / 2, hb: PI / 2, ...o, sz: PI + (o.sz ?? -6 * PI) });
      return [
        [0, {}],
        [0.05, { ...S, fo: 0.25 }],
        [0.1, R(0)],                                    // le couteau glisse entre le pouce et l'index
        [0.14, R(1)], [0.18, R(2)], [0.22, R(3)], [0.26, R(4)],     // rollovers : index → auriculaire
        [0.3, R(3)], [0.34, R(2)], [0.38, R(1)], [0.42, R(0)],      // et retour
        [0.46, R(0, { sz: -2 * PI, ha: 0.4, hb: 0.4, lin: 1 })],     // fan : il tourne autour des goupilles
        [0.5, R(0, { sz: -4 * PI, ha: 0.4, hb: 0.4, lin: 1 })],
        [0.54, R(0, { sz: -6 * PI })],
        [0.56, { ...S, bR: 1, kx: 0.022, ky: -0.004, kz: -0.018, sz: -6 * PI }],                       // il quitte les doigts…
        [0.62, { ...S, bR: 0.5, bH: 0.5, kx: -0.02, ky: -0.16, kz: -0.03, sz: -6 * PI, fx: 2 * PI, ha: 1.3, hb: 0.9, fo: 1.1 }], // aérien (vers le haut de l'écran)
        [0.68, { ...S, py: S.py - 0.028, bH: 1, sz: -6 * PI, fx: 4 * PI, fo: 0 }],                    // rattrapé (la main encaisse)
        [0.71, { ...S, bH: 1, sz: -6 * PI, fx: 4 * PI, fo: 0 }],
        [0.75, CH()],                                                                                   // Chaplin sur l'annulaire
        [0.79, CH({ sz: -6 * PI + 0.55, ha: PI / 2 + 0.35, hb: PI / 2 - 0.3 })],                       // balancier…
        [0.83, CH({ sz: -6 * PI - 0.5, ha: PI / 2 - 0.3, hb: PI / 2 + 0.35 })],
        [0.86, CH({ sz: -6 * PI + 0.25 })],
        [0.9, CH({ sz: -8 * PI, lin: 1 })],                                                            // un tour complet autour du doigt
        [0.92, CH({ sz: -8 * PI })],
        [0.955, { bH: 1, sz: -8 * PI, fx: 4 * PI, ha: PI, hb: PI }],                                   // on referme…
        [0.985, { bH: 1, sz: -8 * PI, fx: 4 * PI, py: -0.006 }],                                       // …et on rouvre d'un coup sec
        [1, { sz: -8 * PI, fx: 4 * PI }],
      ];
    })(),
    events: [[0.03, 'cloth'], [0.13, 'knifeFlip'], [0.17, 'knifeFlip'], [0.21, 'knifeFlip'], [0.25, 'knifeFlip'],
      [0.29, 'knifeFlip'], [0.33, 'knifeFlip'], [0.37, 'knifeFlip'], [0.41, 'knifeFlip'], [0.45, 'knifeFlip'], [0.49, 'knifeFlip'], [0.53, 'knifeFlip'],
      [0.6, 'knifeFlip'], [0.68, 'magIn'], [0.78, 'knifeFlip'], [0.82, 'knifeFlip'], [0.89, 'knifeFlip'], [0.95, 'knifeFlip'], [0.98, 'magIn']],
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
      [0.25, { rz: 0.15, ry: 0.15, hx: 0.085, hy: 0.055, hz: 0.33, lf: 'PINCH' }],
      [0.45, { rz: 0.14, ry: 0.15, pz: 0.02, hx: 0.085, hy: 0.055, hz: 0.43, ch: 1, lf: 'PINCH' }],
      [0.55, { rz: 0.12, ry: 0.15, rx: 0.06, py: 0.005, hx: 0.085, hy: 0.06, hz: 0.36, lf: 'OPEN' }],
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
      [0.36, { ...GTILT, magY: -0.3, magR: 0.25, hy: -0.32, hx: -0.02, hz: 0.02, lf: 'MAG' }], // la main gauche va chercher un chargeur
      [0.48, { ...GTILT, magY: -0.16, magR: 0.12, hy: -0.2, hx: 0.03, hz: -0.01, lf: 'MAG' }], // elle l'amène sous la poignée
      [0.6, { ...GTILT, magY: -0.06, magR: 0.02, hy: -0.1, hx: 0.035, hz: -0.01, lf: 'MAG' }], // on l'engage…
      [0.68, { ...GTILT, magY: 0, hy: -0.055, hx: 0.035, hz: -0.01, rx: 0.4, lf: 'FLAT' }],     // …et on le claque dedans
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
      [0.3, { ...GTILT, magY: -0.3, magR: 0.25, hy: -0.32, hx: -0.02, hz: 0.02, sl: 1, lf: 'MAG' }],
      [0.4, { ...GTILT, magY: -0.16, magR: 0.12, hy: -0.2, hx: 0.03, hz: -0.01, sl: 1, lf: 'MAG' }],
      [0.5, { ...GTILT, magY: -0.06, magR: 0.02, hy: -0.1, hx: 0.035, hz: -0.01, sl: 1, lf: 'MAG' }],
      [0.56, { ...GTILT, magY: 0, hy: -0.055, hx: 0.035, hz: -0.01, rx: 0.4, sl: 1, lf: 'FLAT' }],
      // la main gauche passe par-dessus et attrape l'arrière de la culasse…
      [0.68, { rz: 0.15, ry: -0.3, rx: 0.08, px: -0.07, py: 0.02, hx: 0.03, hy: 0.1, hz: 0.0, sl: 1, lf: 'SLIDE' }],
      // …la tire en arrière…
      [0.76, { rz: 0.15, ry: -0.32, rx: 0.08, px: -0.07, py: 0.02, hx: 0.03, hy: 0.1, hz: 0.06, sl: 1.15, lf: 'SLIDE' }],
      // …et la lâche : elle repart en avant et chambre une balle
      [0.8, { rz: 0.1, ry: -0.25, rx: 0.12, hx: 0.03, hy: 0.12, hz: 0.09, sl: 0, lf: 'OPEN' }],
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
      [0.06, { rhw: 0.35, rz: 0.015, py: -0.004 }],                       // anticipation : l'arme se pose
      [0.14, { rhw: 1, rz: -0.05 }],                                       // les doigts attrapent la boule
      [0.22, { rhw: 1, bolt: 0.5, rz: -0.11, rx: 0.01 }],                  // lève le levier
      [0.36, { rhw: 1, bolt: 1, rz: -0.2, rx: -0.06, pz: 0.035 }],         // tire en arrière : la douille sort
      [0.43, { rhw: 1, bolt: 1, rz: -0.21, rx: -0.05, pz: 0.03 }],         // (on voit la balle suivante)
      [0.55, { rhw: 1, bolt: 0.5, rz: -0.1, pz: -0.004 }],                 // pousse : la balle part dans la chambre
      [0.6, { rhw: 1, bolt: 0.5, rz: -0.09, pz: -0.009, py: 0.003 }],      // butée (petit choc vers l'avant)
      [0.67, { rhw: 1, bolt: 0, rz: -0.04, rx: 0.02, py: -0.004 }],        // rabaisse d'un coup sec
      [0.84, { rz: 0.008 }],                                               // la main revient sur la poignée
      [1, {}],
    ],
    events: [[0.2, 'boltUp'], [0.53, 'boltForward'], [0.65, 'boltDown']],
  },
});

// ---- MP5 : rechargement à vide avec la "claque" du levier (à gauche, au-dessus du garde-main) ----
const MTILT = { rz: 0.3, rx: 0.08, py: -0.015 };
Object.assign(ANIMS, {
  mp5Empty: {
    keys: [
      [0, {}],
      [0.08, { rz: -0.12, ry: 0.1, hx: -0.035, hy: 0.075, hz: 0.06, lf: 'PINCH' }],                 // main gauche sur le levier
      [0.16, { rz: -0.14, ry: 0.12, hx: -0.035, hy: 0.075, hz: 0.16, ch: 1, lf: 'PINCH' }],          // levier tiré et bloqué en haut
      [0.24, { ...MTILT, hy: -0.06, hz: 0.12, ch: 1, magY: -0.02 }],
      [0.36, { ...MTILT, hy: -0.48, hz: 0.12, ch: 1, magY: -0.4, magR: 0.4, lf: 'MAG' }],
      [0.48, { ...MTILT, hy: -0.48, hz: 0.12, ch: 1, magY: -0.4, magR: 0.4, lf: 'MAG' }],
      [0.62, { ...MTILT, hy: -0.08, hz: 0.12, ch: 1, magY: -0.03, lf: 'MAG' }],
      [0.68, { rz: 0.24, rx: 0.05, py: -0.01, hy: -0.05, hz: 0.12, ch: 1, lf: 'FLAT' }],
      [0.76, { rz: -0.1, ry: 0.12, hx: -0.035, hy: 0.09, hz: 0.18, ch: 1, lf: 'FLAT' }],           // la main remonte...
      [0.8, { rz: -0.18, ry: 0.14, rx: 0.05, hx: -0.035, hy: 0.075, hz: 0.12, ch: 0, lf: 'FLAT' }],  // ...et claque le levier !
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
      [0.55, { px: -0.05, py: 0.06, pz: 0.12, ry: -0.6, rz: 0.3, hx: -0.035, hy: 0.075, hz: 0.06, lf: 'PINCH' }],
      [0.66, { px: -0.05, py: 0.06, pz: 0.12, ry: -0.62, rz: 0.3, hx: -0.035, hy: 0.075, hz: 0.11, ch: 0.5, lf: 'PINCH' }],   // on vérifie la chambre
      [0.78, { px: -0.05, py: 0.06, pz: 0.12, ry: -0.6, rz: 0.3, hx: -0.035, hy: 0.075, hz: 0.06, ch: 0, lf: 'OPEN' }],
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
// (le TILT irakien est défini plus haut)
// Réarmement après un tir : quelle animation, à quel moment la douille sort
const CYCLES = {
  kar98k: { anim: 'karCycle', eject: 0.35 },
  shotgun: { anim: 'pumpCycle', eject: 0.3 },
};
/** Animation de rechargement selon l'arme */
function reloadAnim(weapon, empty) {
  return { kar98k: 'kar', shotgun: 'shotgun', glock: empty ? 'glockEmpty' : 'glockTactical', mp5: empty ? 'mp5Empty' : 'classicTactical' }[weapon] || (empty ? 'akEmpty' : 'akTactical');
}
const INSPECTS = { ak: 'akInspect', mp5: 'mp5Inspect', shotgun: 'shotgunInspect', kar98k: 'karInspect', glock: 'glockInspect' };
// Motif de recul horizontal de l'AK et du MP5 (toujours le même : on peut apprendre à le contrôler)
const RECOIL_PATTERN = [0, 0, 0.1, 0.2, 0.15, -0.1, -0.35, -0.5, -0.4, -0.1, 0.25, 0.5, 0.6, 0.45, 0.1, -0.25, -0.45, -0.3, 0, 0.3];

const DRAW_TIME = { knifeDraw: 0.75, bflyDraw: 1.05, akRack: 1.0, karRack: 1.0, glockDraw: 0.45 };
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
    if (location.search.includes('animdebug')) { // accès aux animations pour les tests (?animdebug)
      window.__ws = this;
      window.__wsDbg = { ANIMS, HP, BFLY_POS, BFLY_ROT, BFLY_HOLD };
    }
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
  get busy() { return (!!this.draw && this.draw.name !== 'knifeDraw' && this.draw.name !== 'bflyDraw') || !!this.cycle; }
  /** Animation de sortie selon l'arme */
  drawName(w) { return w === 'knife' ? (this.knifeType === 'butterfly' ? 'bflyDraw' : 'knifeDraw') : w === 'glock' ? 'glockDraw' : 'switch'; }

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
    this.draw = { name: this.drawName(w), t: 0, fired: 0 };
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
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const k = 1 - this.ads * 0.8;
    // Impulsion de vitesse (position exprimée en unités/s pour le ressort critique ci-dessous)
    this.sway.vx += Math.max(-40, Math.min(40, dx)) * 0.0072 * k;
    this.sway.vy += Math.max(-40, Math.min(40, dy)) * 0.0072 * k;
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
      this.inspect.t += dt / (INSPECT_TIME[this.mk] || INSPECT_TIME[this.current]);
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
      if (![end.x, end.y, end.z, from.x, from.y, from.z].every(Number.isFinite)) return; // jamais d'effet à une position NaN
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
      // shotsInRow redescend en continu (décimal) : on arrondit, sinon l'index donne undefined → NaN
      const pat = RECOIL_PATTERN[Math.min(Math.floor(this.shotsInRow), RECOIL_PATTERN.length - 1)] || 0;
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
    // Doigts gauches : la balle pincée entre pouce et index, puis le pouce la pousse dans la fenêtre
    k._lp = mixPose(mixPose(HP.SUPPORT, HP.CART, handIn, this._kl1 || (this._kl1 = new Float32Array(POSE_LEN))), HP.PUSH, dip * handIn, this._kl2 || (this._kl2 = new Float32Array(POSE_LEN)));
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
    // Doigts : la main lâche la pompe, pince une cartouche, le pouce l'enfonce
    k._lp = mixPose(mixPose(HP.SUPPORT, HP.CART, handIn, this._sl1 || (this._sl1 = new Float32Array(POSE_LEN))), HP.PUSH, dip * handIn, this._sl2 || (this._sl2 = new Float32Array(POSE_LEN)));
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

    // Inertie : ressort critique qui ramène l'arme au centre sans jamais vibrer
    // (l'ancienne intégration d'Euler était sous-amortie → tremblement à la souris)
    const sw = this.sway;
    if (![sw.x, sw.y, sw.vx, sw.vy].every(Number.isFinite)) { sw.x = sw.y = sw.vx = sw.vy = 0; }
    const dtc = Math.min(dt, 0.1); // sécurité : jamais de grand saut même après une pause d'onglet
    [sw.x, sw.vx] = springTo(sw.x, sw.vx, 0, 0.15, dtc);
    [sw.y, sw.vy] = springTo(sw.y, sw.vy, 0, 0.15, dtc);
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
      let at = 0, akeys = null; // animation à images clés en cours (pour les poses des doigts)
      if (this.draw && ANIMS[this.draw.name]) { at = clamp01(this.draw.t); akeys = ANIMS[this.draw.name].keys; }
      else if (this.draw) drawLower = 1 - ease(clamp01(this.draw.t)); // simple changement d'arme
      else if (this.reload) {
        if (this.reload.anim === 'kar') k = this.karReloadPose(this.reload);
        else if (this.reload.anim === 'shotgun') k = this.shotgunReloadPose(this.reload);
        else { at = this.reload.t / this.reload.total; akeys = ANIMS[this.reload.anim].keys; }
      }
      else if (this.cycle) { at = clamp01(this.cycle.t); akeys = ANIMS[CYCLES[this.cycle.w || 'kar98k'].anim].keys; }
      else if (this.inspect) { at = this.inspect.t; akeys = ANIMS[INSPECTS[this.current]].keys; }
      if (akeys) k = track(at, akeys);
      // Poses des doigts visées (la main y va avec un peu d'inertie)
      const rTarget = this._rp || (this._rp = new Float32Array(POSE_LEN)), lTarget = this._lp || (this._lp = new Float32Array(POSE_LEN));
      if (ud.rHand) { if (k._rp) rTarget.set(k._rp); else if (akeys) handPose(at, akeys, 'rf', ud.rHand.userData.rest, rTarget); else rTarget.set(ud.rHand.userData.rest); }
      if (ud.lHand) { if (k._lp) lTarget.set(k._lp); else if (akeys) handPose(at, akeys, 'lf', ud.lHand.userData.rest, lTarget); else lTarget.set(ud.lHand.userData.rest); }
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
        ud.mag.visible = !((k.oh || 0) > 0.5);
        if (ud.handMag) ud.handMag.visible = (k.nm || 0) > 0.5;
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
          // Trajet en arc (la main passe à côté de la crosse au lieu de la traverser)
          const arc = Math.sin(hw * Math.PI);
          ud.rightHand.position.x += arc * 0.03; ud.rightHand.position.y += arc * 0.02;
          ud.rightHand.rotation.set(-0.5 * hw, 0.25 * hw, 0.5 * hw + ang * 0.35 * hw);
          // Doigts : on lâche la poignée et on pince la boule entre le pouce et l'index
          if (ud.rHand && !k._rp) mixPose(rTarget, HP.PINCH, clamp01(hw * 1.4), rTarget);
        }
      }
      // Doigts (après les mains : la pose suit la position)
      const fk = Math.min(1, dt * 22);
      if (ud.rHand) ud.rHand.userData.blendTo(rTarget, dt > 0 ? fk : 1);
      if (ud.lHand) ud.lHand.userData.blendTo(lTarget, dt > 0 ? fk : 1);
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
      const dn = this.draw?.name;
      if (dn === 'knifeDraw' || dn === 'bflyDraw') k = track(clamp01(this.draw.t), ANIMS[bf ? 'bflyDraw' : 'knifeDraw'].keys);
      else if (this.inspect) k = track(this.inspect.t, ANIMS[bf ? 'bflyInspect' : 'knifeInspect'].keys);
      const [bx, by, bz] = bf ? BFLY_POS : [0.22, -0.16, -0.46];
      const [brx, bry, brz] = bf ? BFLY_ROT : [0.5, -0.35, -0.25];
      m.position.set(bx + bobX - sw.x - swg * 0.2 + (k.px || 0), by - bobY + sw.y - land - sa * 0.05 + (k.py || 0), bz - swg * 0.15 + (k.pz || 0));
      m.rotation.set(brx - swg * 0.9 + (k.rx || 0) + sw.y * 2, bry + swg * 1.0 + (k.ry || 0) + sw.x * 2, brz + (k.rz || 0) - sl * 0.3);
      const fk = dt > 0 ? Math.min(1, dt * 22) : 1;
      if (bf) bflyPose(ud, k, fk);
      else {
        // Couteau de combat : la lame tourne dans la main, les doigts se desserrent pendant le tour
        ud.blade.position.set(0, (k.ktoss || 0), 0);
        ud.blade.rotation.set(-(k.kflip || 0), 0, k.kspin || 0);
        if (ud.kHand) ud.kHand.userData.blendTo(mixPose(HP.KNIFE, HP.OPEN, clamp01(k.fo || 0), this._kp || (this._kp = new Float32Array(POSE_LEN))), fk);
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
    if (info.weapon !== this.current) { this.current = info.weapon; this.showModel(); this.draw = { name: this.drawName(info.weapon), t: 0, fired: 0 }; }
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
    if (info.insp && !this.inspect && !this.reload && INSPECT_TIME[this.mk]) this.inspect = { t: 0, fired: 999 };
    if (this.inspect) { this.inspect.t += dt / INSPECT_TIME[this.mk]; if (this.inspect.t >= 1 || !info.insp) this.inspect = null; }
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
const gloveMats = new Map();
/** Matériau des gants selon le skin choisi (le style est lu par makeHand) */
function gloveMaterial(id) {
  const g = GLOVE_SKINS[id] || GLOVE_SKINS.default;
  if (!gloveMats.has(g)) {
    const m = g.style === 'bare' ? mat(g.color, { roughness: 0.62 }) : mat(g.color, { roughness: g.style === 'full' ? 0.55 : 0.78, map: g.style === 'full' ? null : fabricTex() });
    m.userData = { gloveStyle: g.style, plate: g.plate, glow: g.glow };
    gloveMats.set(g, m);
  }
  return gloveMats.get(g);
}

function armMaterials(skins = settings.skins) {
  // La manche prend la couleur de la tenue choisie dans le casier
  const suit = CHARACTER_SKINS[skins?.character]?.suit ?? 0x3a4560;
  const cuff = new THREE.Color(suit).multiplyScalar(0.72).getHex();
  return {
    sleeve: mat(suit, { map: fabricTex(), roughness: 0.95 }),
    cuff: mat(cuff, { roughness: 0.9 }),           // ourlet de la manche courte (au coude)
    skin: mat(SKIN, { roughness: 0.68 }),          // avant-bras nu, comme le personnage (manches courtes)
    glove: gloveMaterial(skins?.gloves),
    knuckle: mat(0x3e352b, { roughness: 0.6 }),
  };
}

/** Petite sphère (jointures, raccords lisses entre segments d'un membre) */
function ball(r, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), material);
  m.position.set(x, y, z);
  return m;
}

/**
 * Avant-bras, construit le long de l'axe Y LOCAL (de +len0/2 = coude à -len0/2 = poignet),
 * pour pouvoir être réétiré (scale.y) à chaque image quand le poignet bouge (rechargements,
 * verrou du Kar98k…) sans perdre ses proportions. Manche courte (ourlet au coude) puis peau
 * nue qui s'affine vers le poignet — même style que le personnage.
 */
function limbMesh(len0, M) {
  const g = new THREE.Group();
  const h = len0 / 2;
  // Fractions de la demi-longueur (1 = coude, -1 = poignet) et rayon de chaque tronçon :
  // ourlet de manche très court, puis la peau s'affine en douceur sur plusieurs tronçons
  // (comme les doigts) pour éviter l'effet "boudin" d'un raccord brutal.
  const stops = [1, 0.74, 0.4, 0.04, -1];
  const radii = [0.053, 0.047, 0.041, 0.034];
  const mats = [M.cuff, M.skin, M.skin, M.skin];
  for (let i = 0; i < 4; i++) {
    g.add(capsule([0, stops[i] * h, 0], [0, stops[i + 1] * h, 0], radii[i], mats[i]));
    if (i > 0) g.add(ball((radii[i - 1] + radii[i]) / 2, mats[i], 0, stops[i] * h, 0));
  }
  return g;
}
/** Avant-bras statique entre deux points du monde (armes tenues à deux mains fixes : couteaux) */
function limbBetween(a, b, M) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = limbMesh(A.distanceTo(B), M);
  g.position.copy(A).add(B).multiplyScalar(0.5);
  g.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  return g;
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
  // Avant-bras : relié au coude (fixe) et au poignet (qui bouge avec la main) → il pivote et s'étire naturellement
  const elbow = new THREE.Vector3(...forearmEnd), w0 = new THREE.Vector3(...wrist).add(group.position);
  const len0 = w0.distanceTo(elbow);
  const fa = limbMesh(len0, M);
  fa.position.copy(w0).add(elbow).multiplyScalar(0.5);
  fa.quaternion.setFromUnitVectors(UP, elbow.clone().sub(w0).normalize());
  g.add(fa);
  g.add(group);
  g.userData.rightHand = group;
  g.userData.rightHome = group.position.clone();
  g.userData.rHand = hand; // squelette (poses des doigts)
  g.userData.rightArm = { mesh: fa, elbow, wristLocal: new THREE.Vector3(...wrist), len0 };
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
  group.add(limbBetween(wrist, rel(forearmEnd), M));
  g.add(group);
  g.userData.leftHand = group;
  g.userData.leftHome = group.position.clone();
  g.userData.lHand = hand;
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
  group.add(limbBetween(wrist.toArray(), rel, M));
  g.add(group);
  g.userData.leftHand = group;
  g.userData.leftHome = group.position.clone();
  g.userData.lHand = hand;
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

// ---------------------------------------------------------------------
//  Modèles 3D (.glb faits dans Blender, public/models/).
//  Chaque arme garde ses pièces animables sous forme de nœuds nommés
//  "<arme>_<pièce>" (mag, charge, bolt, slide, forend…) placés exactement
//  là où le code les attend : les animations n'ont pas changé.
// ---------------------------------------------------------------------

/** Clone une arme du .glb et applique les matériaux du skin (Body / Accent / Dark) */
function glbWeapon(id, skin, overrides = () => ({})) {
  const node = id === 'kar98k' ? 'kar' : id;   // nom de la racine dans le .glb
  const src = GLB[id].getObjectByName(node);
  const g = src.clone(true);
  g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1);
  const { body, accent, dark } = skinMaterials(skin);
  const map = { Body: body, Accent: accent, Dark: dark };
  for (const [k, v] of Object.entries(overrides({ body, accent, dark }))) if (v) map[k] = v;
  g.traverse((o) => { if (o.isMesh && map[o.material.name]) o.material = map[o.material.name]; });
  const part = (n) => g.getObjectByName(`${node}_${n}`);
  return { g, part };
}

function buildAK(skin, optic, skins) {
  const { g, part } = glbWeapon('ak', skin);
  const M = armMaterials(skins);
  // Levier d'armement (côté droit, animable)
  const charge = part('charge');
  Object.assign(g.userData, { charge, chargeZ: charge.position.z });
  // Chargeur banane (séparé pour le rechargement irakien)
  const mag = part('mag');
  Object.assign(g.userData, { mag, magHome: mag.position.clone() });
  // Rail + viseur
  part('rail').visible = optic !== 'iron';
  g.userData.sightY = addOptic(g, optic, 0.06, 0.02) ?? 0.084;
  g.userData.ejectPort = part('ejectPort');

  rightGripHand(g, M, [0.032, -0.09, 0.128], [0.17, -0.36, 0.58], 0.35);
  // Chargeur neuf tenu par la main droite pendant le rechargement irakien
  const handMag = mag.clone();
  const handAt = g.userData.rightHome.clone().add(new THREE.Vector3(0, -0.1, -0.2)); // pose "insertion"
  handMag.position.copy(g.userData.magHome).sub(handAt).add(new THREE.Vector3(0, -0.03, 0));
  handMag.rotation.x = 0.22;
  handMag.visible = false;
  g.userData.rightHand.add(handMag);
  g.userData.handMag = handMag;
  leftSupportHand(g, M, [0, -0.062, -0.31], [-0.26, -0.44, 0.08]);
  muzzleFlash(g, -0.85);
  return g;
}

function buildKar(skin, optic, skins) {
  const { g, part } = glbWeapon('kar98k', skin);
  const M = armMaterials(skins);
  // Levier de culasse avec boule + corps de culasse brillant
  const bolt = part('bolt'), boltBody = part('boltBody');
  // Balles du magasin (visibles quand la fenêtre est ouverte) + balle chambrée
  const magRounds = [part('magRound0'), part('magRound1')];
  const chamberRound = part('chamberRound');
  for (const r of [...magRounds, chamberRound]) r.visible = false;
  Object.assign(g.userData, { bolt, boltZ: bolt.position.z, magRounds, chamberRound, boltBody, boltBodyZ: boltBody.position.z });
  // Mire d'origine seulement sans viseur
  part('irons').visible = optic === 'iron';
  g.userData.sightY = addOptic(g, optic, 0.054, -0.02) ?? 0.049; // le montage passe au-dessus de la culasse
  g.userData.ejectPort = part('ejectPort');

  rightGripHand(g, M, [0.032, -0.058, 0.155], [0.17, -0.36, 0.6], 0.15);
  leftSupportHand(g, M, [0, -0.075, -0.33], [-0.26, -0.45, 0.04]);
  // Balle tenue par la main gauche pendant le rechargement (une par une)
  const cart = part('cartridge');
  g.userData.leftHand.add(cart);
  cart.position.set(0.012, 0.028, 0.0);
  cart.visible = false;
  g.userData.cartridge = cart;
  g.userData.knobGrip = new THREE.Vector3(0.012, -0.022, 0.012);
  muzzleFlash(g, -1.02, 0.28);
  return g;
}

// MP5 : levier d'armement à gauche (la fameuse "claque"), crosse rétractable.
function buildMP5(skin, optic, skins) {
  const std = skin === WEAPON_SKINS.default;
  const { g, part } = glbWeapon('mp5', skin, (m) => ({ Poly: std ? null : m.accent })); // polymère noir d'origine
  const M = armMaterials(skins);
  const charge = part('charge');
  Object.assign(g.userData, { charge, chargeZ: charge.position.z, chargeTravel: 0.07 });
  const mag = part('mag');
  Object.assign(g.userData, { mag, magHome: mag.position.clone() });
  part('irons').visible = optic === 'iron';   // hausse à tambour
  part('rail').visible = optic !== 'iron';    // griffes pour viseur
  g.userData.sightY = addOptic(g, optic, 0.072, 0.0) ?? 0.088;
  g.userData.ejectPort = part('ejectPort');
  rightGripHand(g, M, [0.032, -0.07, 0.088], [0.17, -0.36, 0.52], 0.35);
  leftSupportHand(g, M, [0, -0.052, -0.28], [-0.26, -0.42, 0.02]);
  muzzleFlash(g, -0.48, 0.17);
  return g;
}

// M870 : la pompe (avec la main gauche) glisse ; cartouches rouges chargées par-dessous.
function buildShotgun(skin, optic, skins) {
  const { g, part } = glbWeapon('shotgun', skin);
  const M = armMaterials(skins);
  const forend = part('forend');
  Object.assign(g.userData, { forend, forendZ: forend.position.z });
  g.userData.ejectPort = part('ejectPort');
  part('rail').visible = optic !== 'iron';
  g.userData.sightY = addOptic(g, optic, 0.048, 0.0) ?? 0.043;
  rightGripHand(g, M, [0.03, -0.055, 0.165], [0.17, -0.36, 0.6], 0.75);
  leftSupportHand(g, M, [0, -0.058, -0.25], [-0.26, -0.44, 0.04]);
  // La main gauche suit la pompe : on la rattache au groupe de la pompe
  const lh = g.userData.leftHand;
  g.remove(lh); forend.add(lh);
  lh.position.set(0, -0.048, 0);
  g.userData.leftHome = lh.position.clone();
  // Cartouche tenue par la main gauche pendant le rechargement
  const hull = part('hull');
  lh.add(hull);
  hull.position.set(0.0, 0.03, 0.0);
  hull.visible = false;
  g.userData.cartridge = hull;
  muzzleFlash(g, -0.65, 0.3);
  return g;
}

function buildGlock(skin, skins) {
  const { g, part } = glbWeapon('glock', skin);   // Body = carcasse en polymère (couleur du skin)
  const M = armMaterials(skins);
  // Culasse (recule à chaque tir) + fenêtre d'éjection qui la suit
  const slide = part('slide');
  Object.assign(g.userData, { slide, slideZ: slide.position.z, ejectPort: part('ejectPort') });
  // Chargeur (l'inclinaison de la poignée est dans le modèle)
  const mag = part('mag');
  Object.assign(g.userData, { mag, magHome: mag.position.clone() });
  g.userData.sightY = 0.034;
  // Prise à deux mains : la main droite sur la poignée, la gauche par-dessus
  rightGripHand(g, M, [0.03, -0.06, 0.078], [0.13, -0.3, 0.42], 0.2);
  pistolSupportHand(g, M, [-0.036, -0.074, 0.06], [-0.17, -0.32, 0.36]);
  muzzleFlash(g, -0.13, 0.14);
  return g;
}

/**
 * Couteau papillon (balisong) : une lame et deux manches ajourés qui pivotent sur deux goupilles.
 * Main tenue de profil (paume vers la gauche, index en haut, doigts vers l'avant) : le couteau
 * peut ainsi rouler d'un doigt à l'autre dans les espaces entre les doigts.
 * Le groupe "pivot" a son origine entre les deux goupilles ; c'est lui qu'on oriente / déplace.
 */
function buildButterfly(skin, skinId, skins) {
  const std = !skinId || skinId === 'default';
  const { g, part } = glbWeapon('butterfly', skin, (m) => (std ? {} : { Blade: m.body, Handle: m.accent }));
  const M = armMaterials(skins);
  const knife = part('knife');
  // "frame" = repère de la main (doigts vers -z, index en +y, paume vers -x), tourné pour que le dos
  // de la main soit face à nous, doigts vers le haut : le plat de la lame est bien visible.
  const frame = new THREE.Group();
  frame.quaternion.copy(BQ_FRAME);
  g.add(frame);
  const pivot = new THREE.Group();
  frame.add(pivot);
  pivot.add(knife);
  knife.position.set(0, 0, -0.006); // goupilles au centre du pivot
  knife.rotation.set(0, 0, 0);
  Object.assign(g.userData, { pivot, frame, handleA: part('handleA'), handleB: part('handleB'), blade: knife });

  const handG = new THREE.Group();
  const hand = makeHand(M.glove, { curl: [-1.6, -1.5, -1.0], thumbCurl: -0.9, thumbSpread: -0.1 });
  hand.scale.x = -1;                                      // main droite
  orientHand(hand, [0, -1, 0], [1, 0, 0], [0, 0, 1]);     // index en haut, paume à gauche, doigts vers -z
  frame.add(hand);
  handG.add(capsule([0, -0.02, 0.0], [0.01, -0.07, 0.03], 0.034, M.glove));      // poignet (sous la main)
  handG.add(limbBetween([0.01, -0.07, 0.03], [0.07, -0.4, 0.26], M));            // avant-bras vers le bas et vers nous
  g.add(handG);
  g.userData.hand = handG;
  g.userData.kHand = hand;
  return g;
}
// Repère "main" → modèle : paume (-x) vers l'avant, doigts (-z) vers le haut, index (+y) vers la gauche
const BQ_FRAME = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)));

// ---- Papillon : orientations de base du couteau (repère de la main) ----
// colonnes = où vont les axes du couteau : x = épaisseur, y = axe des goupilles, z = longueur (lame vers -z)
const basisQ = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)));
const BQ_H = basisQ([1, 0, 0], [0, 0, 1], [0, -1, 0]);   // dans le poing, lame vers le haut
const BQ_R = basisQ([0, 1, 0], [0, 0, 1], [1, 0, 0]);    // à plat entre deux doigts (épaisseur dans l'espace entre les doigts)
const BQ_C = basisQ([0, 0, 1], [-1, 0, 0], [0, -1, 0]);  // Chaplin : lame en haut, goupilles enfilées sur l'annulaire
const BFLY_HOLD = new THREE.Vector3(-0.022, 0.04, -0.054); // goupilles juste au-dessus du poing
const BFLY_POS = [0.2, -0.14, -0.42], BFLY_ROT = [-0.25, 0.1, -0.5]; // lame vers le haut et la gauche
const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _v = new THREE.Vector3();
const BF_FIST = pose([-1.6, -1.5, -1.0], { thumbCurl: -0.9, thumbSpread: -0.1 });
const BF_OPEN = pose([-0.32, -0.22, -0.12], { thumbCurl: -0.15, thumbSpread: -0.95, splay: 0.12 });
const BF_CHAP = pose([-1.55, -1.45, -0.95], { ring: [-0.05, -0.05, 0.02], thumbCurl: -0.7, thumbSpread: -0.3, splay: 0.05 });
const _bp = new Float32Array(POSE_LEN);

/** Place le couteau papillon et plie les doigts selon les canaux d'animation (cf. bflyDraw / bflyInspect) */
function bflyPose(ud, k, fk) {
  // Orientation de base : mélange pondéré des 3 orientations
  let wH = k.bH || 0, wR = k.bR || 0, wC = k.bC || 0;
  const s = wH + wR + wC;
  if (s < 1e-4) wH = 1; else { wH /= s; wR /= s; wC /= s; }
  _q.set(0, 0, 0, 0);
  for (const [q, w] of [[BQ_H, wH], [BQ_R, wR], [BQ_C, wC]]) {
    if (!w) continue;
    const sg = _q.x * q.x + _q.y * q.y + _q.z * q.z + _q.w * q.w < 0 ? -w : w; // même hémisphère
    _q.x += q.x * sg; _q.y += q.y * sg; _q.z += q.z * sg; _q.w += q.w * sg;
  }
  _q.normalize();
  // Roulé autour des doigts : les goupilles font le tour de chaque doigt, le couteau tourne avec
  const rl = clamp01(k.rl || 0), rg = k.rg || 0;
  const spin = (k.sz || 0) - rl * PI * rg;
  _q2.setFromAxisAngle(AZ, spin).multiply(_q3.setFromAxisAngle(AX, k.fx || 0)).multiply(_q);
  _q2.multiply(_q3.setFromAxisAngle(AX, k.fs || 0)); // bascule autour de l'axe des goupilles (repère du couteau)
  ud.pivot.quaternion.copy(_q2);
  _v.set(BFLY_HOLD.x + (k.kx || 0), BFLY_HOLD.y + (k.ky || 0), BFLY_HOLD.z + (k.kz || 0));
  if (rl > 0) _v.lerp({ x: 0.014 * Math.abs(Math.sin(PI * rg)), y: 0.036 - 0.018 * rg, z: -0.072 }, rl);
  ud.pivot.position.copy(_v);
  ud.handleA.rotation.x = k.ha || 0;
  ud.handleB.rotation.x = -(k.hb || 0);
  // Doigts : poing ↔ ouverts ; le doigt que le couteau enjambe se soulève ; Chaplin = annulaire tendu
  mixPose(BF_FIST, BF_OPEN, Math.max(0, Math.min(1.15, k.fo || 0)), _bp);
  if (rl > 0) for (let i = 0; i < 4; i++) {
    const lift = clamp01(1 - Math.abs(rg - (i + 0.5)) * 1.6) * rl;
    _bp[i * 3] += lift * 0.5; _bp[i * 3 + 1] += lift * 0.25;
  }
  if (k.ce) mixPose(_bp, BF_CHAP, clamp01(k.ce), _bp);
  ud.kHand.userData.blendTo(_bp, fk);
}

function buildKnife(skin, skinId, skins) {
  const std = !skinId || skinId === 'default';
  // Lame en acier pour le skin standard, sinon couleur du skin
  const { g, part } = glbWeapon('knife', skin, (m) => (std ? {} : { Blade: m.body }));
  const M = armMaterials(skins);
  g.userData.blade = part('blade');

  // Main qui serre le manche
  const handG = new THREE.Group();
  const hand = makeHand(M.glove, { curl: [-1.45, -1.2, -0.8], thumbCurl: -0.15, thumbSpread: -0.2 });
  hand.scale.x = -1;
  orientHand(hand, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  hand.position.set(0.03, 0.022, 0.065);
  handG.add(hand);
  handG.add(capsule([0.02, 0, 0.1], [0.04, -0.04, 0.19], 0.034, M.glove));
  handG.add(limbBetween([0.04, -0.04, 0.19], [0.1, -0.16, 0.5], M));
  g.add(handG);
  g.userData.hand = handG;
  g.userData.kHand = hand;
  return g;
}

// ---------------------------------------------------------------------
//  Pour le personnage vu en 3e personne (avatars.js) : même arme .glb,
//  et où se placent les mains sur l'arme (mêmes prises qu'en vue FPS).
// ---------------------------------------------------------------------
// r = paume droite sur la poignée (+ inclinaison), l = paume gauche (garde-main / pompe / prise pistolet)
const GRIPS = {
  ak: { r: [0.032, -0.09, 0.128], tilt: 0.35, l: [-0.012, -0.062, -0.31] },
  kar98k: { r: [0.032, -0.058, 0.155], tilt: 0.15, l: [-0.012, -0.075, -0.33] },
  mp5: { r: [0.032, -0.07, 0.088], tilt: 0.35, l: [-0.012, -0.052, -0.28] },
  shotgun: { r: [0.03, -0.055, 0.165], tilt: 0.75, l: [-0.012, -0.048, -0.25] },
  glock: { r: [0.03, -0.06, 0.078], tilt: 0.2, l: [-0.036, -0.074, 0.06], pistol: true },
  knife: { r: [0.03, 0.022, 0.065], knife: true },
};
const _m4 = () => new THREE.Matrix4();
/** Repère de la main (convention FPS, miroir compris pour la droite) dans le repère de l'arme */
function gripFrames(id) {
  const G = GRIPS[id] || GRIPS.ak;
  const S = _m4().makeScale(-1, 1, 1);
  const q = new THREE.Quaternion();
  let R;
  if (G.knife) {
    orientHand({ quaternion: q }, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    R = _m4().compose(new THREE.Vector3(...G.r), q, new THREE.Vector3(1, 1, 1)).multiply(S);
  } else {
    orientHand({ quaternion: q }, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
    R = _m4().makeTranslation(...G.r).multiply(_m4().makeRotationX(-G.tilt)).multiply(_m4().makeRotationFromQuaternion(q)).multiply(S);
  }
  let L = null;
  if (G.pistol) {
    const d = new THREE.Vector3(0, -0.62, -0.78).normalize();
    const z = d.clone().negate(), y = new THREE.Vector3(-1, 0, 0), x = new THREE.Vector3().crossVectors(y, z);
    L = _m4().makeBasis(x, y, z).setPosition(...G.l);
  } else if (G.l) {
    orientHand({ quaternion: q }, [0, 0, -1], [0, -1, 0], [-1, 0, 0]);
    L = _m4().makeRotationFromQuaternion(q).setPosition(...G.l);
  }
  return { R, L, pistol: !!G.pistol, knife: !!G.knife };
}
/** Arme pour le personnage 3e personne : clone du .glb avec le skin, sans les mains */
export function worldWeapon(id, skinId, optic = 'iron') {
  const skin = WEAPON_SKINS[skinId] || WEAPON_SKINS.default;
  const key = id === 'knife' ? 'knife' : id;
  const std = !skinId || skinId === 'default';
  const { g, part } = glbWeapon(key, skin, (m) => (key === 'knife' ? (std ? {} : { Blade: m.body }) : key === 'mp5' ? { Poly: std ? null : m.accent } : {}));
  part('rail') && (part('rail').visible = optic !== 'iron');
  part('irons') && (part('irons').visible = optic === 'iron');
  for (const n of ['magRound0', 'magRound1', 'chamberRound', 'cartridge', 'hull']) { const p = part(n); if (p) p.visible = false; }
  if (optic && optic !== 'iron' && key !== 'knife' && key !== 'glock') {
    const mount = { ak: [0.06, 0.02], kar98k: [0.054, -0.02], mp5: [0.072, 0], shotgun: [0.048, 0] }[key];
    if (mount) addOptic(g, optic, mount[0], mount[1]);
  }
  g.userData.muzzle = part('muzzle') || null;
  g.userData.parts = { mag: part('mag'), charge: part('charge'), forend: part('forend'), slide: part('slide'), bolt: part('bolt') };
  g.userData.grips = gripFrames(key);
  return g;
}
/** Matériaux des gants (mitaines / complets / mains nues) selon le gant choisi par le joueur */
export function gloveSlots(gloveId) { return handSlotMaterials(gloveMaterial(gloveId)); }
export { pose as handPoseVec, HP as HAND_POSES, mixPose, POSE_LEN, SPLAY };
