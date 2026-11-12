// =====================================================================
//  models.js — Petites fonctions pour construire des modèles low-poly
//  avec des boîtes (personnages, bras, armes). Aucun fichier 3D externe.
// =====================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { wornMetalTex, woodGrainTex } from './textures.js';

const Z = new THREE.Vector3(0, 0, 1);

/** Matériau standard mat (couleur + options) */
export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.15, ...opts });
}

/** Boîte de taille (w,h,d) centrée en (x,y,z) */
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

/**
 * Membre (bras, avant-bras…) : une boîte allongée qui relie le point a au point b.
 * a et b sont des tableaux [x, y, z].
 */
export function limb(a, b, thick, material) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, dir.length()), material);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Z, dir.normalize());
  return m;
}

/**
 * Contour coloré (technique de la "coque inversée") : on ajoute à chaque
 * pièce une copie un peu plus grosse, dont on ne dessine que l'intérieur.
 * Résultat : un liseré de couleur autour de la silhouette.
 */
export function addOutline(root, color = 0xff2a2a, thickness = 0.035) {
  const outlineMat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const meshes = [];
  root.traverse(o => { if (o.isMesh && !o.userData.noOutline) meshes.push(o); });
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    m.geometry.boundingBox.getSize(size);
    const shell = new THREE.Mesh(m.geometry, outlineMat);
    shell.scale.set(
      (size.x + thickness * 2) / size.x,
      (size.y + thickness * 2) / size.y,
      (size.z + thickness * 2) / size.z,
    );
    shell.userData.noOutline = true;
    shell.userData.isOutline = true;
    m.add(shell);
  }
  return outlineMat;
}

/** Cylindre orienté le long de l'axe Z (canons, lunettes…) */
export function cyl(radius, length, material, x = 0, y = 0, z = 0, radius2 = radius) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius2, length, 12), material);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** Matériaux d'un skin d'arme : { body, accent, dark } */
export function skinMaterials(skin) {
  const metalOpts = skin.metal ? { metalness: 0.9, roughness: 0.25 } : { metalness: 0.45, roughness: 0.45 };
  const body = mat(skin.body, { ...metalOpts, map: wornMetalTex() });       // métal légèrement usé
  const accent = skin.glow
    ? mat(skin.accent, { emissive: skin.accent, emissiveIntensity: 0.9, roughness: 0.4 })
    : mat(skin.accent, { roughness: 0.75, map: woodGrainTex() });              // veines du bois
  const dark = mat(new THREE.Color(skin.body).multiplyScalar(0.55).getHex(), { ...metalOpts, map: wornMetalTex() });
  return { body, accent, dark };
}

const Y = new THREE.Vector3(0, 1, 0);
const geoCache = new Map();
function cachedGeo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

/** Boîte aux coins arrondis (plus naturel pour les personnages) */
export function rbox(w, h, d, material, x = 0, y = 0, z = 0, radius = Math.min(w, h, d) * 0.3) {
  const geo = cachedGeo(`rb${w},${h},${d},${radius}`, () => new RoundedBoxGeometry(w, h, d, 2, radius));
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

/** Membre arrondi (capsule) qui relie a à b */
export function capsule(a, b, radius, material) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = Math.max(0.001, dir.length() - radius * 2);
  const geo = cachedGeo(`cap${radius.toFixed(4)},${len.toFixed(4)}`, () => new THREE.CapsuleGeometry(radius, len, 4, 10));
  const m = new THREE.Mesh(geo, material);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y, dir.normalize());
  return m;
}

/**
 * Main avec 4 doigts à 3 phalanges + pouce à 2 phalanges.
 * Repère de la main : paume vers -y, doigts vers -z, doigts répartis sur l'axe x
 * (index en x positif, côté pouce). C'est une main GAUCHE : pour une main droite,
 * mettre scale.x = -1.
 * curl = pliage des doigts [phalange 1, 2, 3] en radians (négatif = vers la paume).
 * indexCurl = pliage spécial de l'index (pour le poser sur la détente).
 */
export function makeHand(material, { curl = [-0.9, -1.1, -0.8], indexCurl = null, thumbCurl = -0.5, thumbSpread = -0.7 } = {}) {
  const c3 = (c) => (c.length >= 3 ? c : [c[0], c[1], c[1] * 0.8]);
  curl = c3(curl); if (indexCurl) indexCurl = c3(indexCurl);
  const hand = new THREE.Group();
  hand.add(rbox(0.078, 0.026, 0.082, material, 0, 0, 0, 0.011));                 // paume
  hand.add(rbox(0.07, 0.022, 0.02, material, 0, -0.002, -0.036, 0.009));         // jointures
  // [position x, longueurs des 3 phalanges, rayon] : index, majeur, annulaire, auriculaire
  const fingers = [
    [0.027, [0.024, 0.016, 0.014], 0.0085],
    [0.009, [0.026, 0.018, 0.015], 0.0088],
    [-0.009, [0.025, 0.017, 0.014], 0.0085],
    [-0.027, [0.02, 0.013, 0.012], 0.0076],
  ];
  fingers.forEach(([x, lens, r], i) => {
    const c = i === 0 && indexCurl ? indexCurl : curl;
    let parent = new THREE.Group();
    parent.position.set(x, 0, -0.04);
    hand.add(parent);
    lens.forEach((len, k) => {
      const seg = new THREE.Group();
      seg.rotation.x = c[k];
      seg.add(capsule([0, 0, 0], [0, 0, -len], r * (1 - k * 0.08), material));
      if (k === 0) parent.add(seg);
      else { seg.position.set(0, 0, -lens[k - 1]); parent.add(seg); }
      parent = seg;
    });
  });
  // Pouce (sur le côté, en x positif)
  const th = new THREE.Group();
  th.position.set(0.038, -0.008, 0.0);
  th.rotation.set(0, thumbSpread, 0);
  th.add(capsule([0, 0, 0], [0, 0, -0.028], 0.0105, material));
  const thTip = new THREE.Group();
  thTip.position.set(0, 0, -0.028);
  thTip.rotation.x = thumbCurl;
  thTip.add(capsule([0, 0, 0], [0, 0, -0.024], 0.0095, material));
  th.add(thTip);
  hand.add(th);
  return hand;
}

/**
 * Pièce "extrudée" : on dessine le profil de côté (points [z, y]) puis on lui
 * donne une épaisseur sur l'axe x, avec des bords arrondis. Parfait pour les
 * crosses, poignées, chargeurs courbes, lames…
 */
export function extrude(points, thickness, material, bevel = 0.004) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const depth = Math.max(0.0005, thickness - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, material);
  m.rotation.y = -Math.PI / 2; // le profil est dans le plan (z, y) de l'arme
  return m;
}

/** Oriente une main avec trois axes (où vont ses axes x, y, z locaux) */
export function orientHand(hand, xAxis, yAxis, zAxis) {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...xAxis), new THREE.Vector3(...yAxis), new THREE.Vector3(...zAxis));
  hand.quaternion.setFromRotationMatrix(m);
  return hand;
}
