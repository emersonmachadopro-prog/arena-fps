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
 * Main détaillée (style cubique arrondi) : gant tactique sans doigts,
 * protections sur les jointures, sangle au poignet, bouts de doigts nus
 * avec ongles. 4 doigts à 3 phalanges + pouce à 2 phalanges.
 *
 * Repère de la main : paume vers -y, doigts vers -z, doigts répartis sur l'axe x
 * (index en x positif, côté pouce). C'est une main GAUCHE : pour une main droite,
 * mettre scale.x = -1.
 * curl = pliage des doigts [phalange 1, 2, 3] en radians (négatif = vers la paume).
 * indexCurl = pliage spécial de l'index (pour le poser sur la détente).
 */
const handMats = new Map();
export function handMaterials(glove) {
  const key = glove.uuid;
  if (!handMats.has(key)) {
    const ud = glove.userData || {};
    const skin = new THREE.MeshStandardMaterial({ color: 0xc99a72, roughness: 0.62 });
    handMats.set(key, {
      skin,
      nail: new THREE.MeshStandardMaterial({ color: 0xe8c4b0, roughness: 0.35 }),
      plate: new THREE.MeshStandardMaterial({ color: ud.plate ?? new THREE.Color(glove.color).multiplyScalar(0.55), roughness: 0.5, metalness: 0.12,
        ...(ud.glow ? { emissive: ud.plate, emissiveIntensity: 0.6 } : {}) }),
      strap: new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 0.9 }),
      seam: new THREE.MeshStandardMaterial({ color: new THREE.Color(glove.color).multiplyScalar(0.6), roughness: 0.9 }),
    });
  }
  return handMats.get(key);
}
const jointGeo = new THREE.SphereGeometry(1, 10, 8);

/**
 * Main détaillée, style cubique arrondi mais propre :
 * - 4 doigts à 3 phalanges légèrement effilées, avec des articulations rondes
 *   (aucun trou quand les doigts se plient), ongles, protections de jointures ;
 * - pouce à 3 segments (base dans la paume) ;
 * - paume avec coussinet sous le pouce, dos de main légèrement bombé.
 * Le style du gant vient du matériau (userData.gloveStyle) :
 *   'fingerless' = mitaines (bouts de doigts nus), 'full' = gants complets, 'bare' = mains nues.
 *
 * Repère : paume vers -y, doigts vers -z, index en x positif (main GAUCHE ;
 * pour une main droite : scale.x = -1).
 */
export function makeHand(material, { curl = [-0.9, -1.1, -0.8], indexCurl = null, thumbCurl = -0.5, thumbSpread = -0.7 } = {}) {
  const c3 = (c) => (c.length >= 3 ? c : [c[0], c[1], c[1] * 0.8]);
  curl = c3(curl); if (indexCurl) indexCurl = c3(indexCurl);
  const M = handMaterials(material);
  const style = material.userData?.gloveStyle || 'fingerless';
  const bare = style === 'bare';
  const G = bare ? M.skin : material;                         // matière principale
  const tipMat = style === 'full' ? material : M.skin;        // bout des doigts
  const joint = (r, mat, x, y, z) => { const m = new THREE.Mesh(jointGeo, mat); m.scale.setScalar(r); m.position.set(x, y, z); return m; };
  const hand = new THREE.Group();
  hand.add(
    rbox(0.078, 0.027, 0.08, G, 0, 0, 0, 0.012),                       // paume
    rbox(0.07, 0.008, 0.07, G, 0, 0.012, 0.002, 0.004),                // dos de la main (bombé)
    rbox(0.03, 0.022, 0.05, G, 0.026, -0.008, 0.012, 0.01),            // coussinet sous le pouce
    rbox(0.072, 0.024, 0.022, G, 0, -0.001, -0.035, 0.011),            // ligne des jointures
  );
  if (!bare) {
    hand.add(
      rbox(0.058, 0.007, 0.046, M.plate, 0, 0.018, 0.004, 0.004),      // renfort du dos
      rbox(0.084, 0.03, 0.022, M.strap, 0, 0.002, 0.044, 0.007),       // sangle du poignet
      rbox(0.03, 0.006, 0.014, M.plate, 0.022, 0.018, 0.044, 0.002),   // velcro
      rbox(0.002, 0.004, 0.07, M.seam, 0.014, 0.0165, 0.0, 0.001),     // coutures
      rbox(0.002, 0.004, 0.07, M.seam, -0.014, 0.0165, 0.0, 0.001),
    );
  } else {
    // mains nues : tendons discrets sur le dos de la main
    for (const x of [-0.018, 0, 0.018]) hand.add(rbox(0.006, 0.004, 0.06, M.skin, x, 0.016, 0.0, 0.002));
  }
  // [x, longueurs des phalanges, épaisseur] : index, majeur, annulaire, auriculaire
  const fingers = [
    [0.027, [0.025, 0.017, 0.015], 0.0175],
    [0.009, [0.027, 0.019, 0.016], 0.018],
    [-0.009, [0.026, 0.018, 0.015], 0.0172],
    [-0.027, [0.021, 0.014, 0.013], 0.0152],
  ];
  fingers.forEach(([x, lens, w], i) => {
    const c = i === 0 && indexCurl ? indexCurl : curl;
    let parent = new THREE.Group();
    parent.position.set(x, -0.001, -0.042);
    hand.add(parent);
    parent.add(joint(w * 0.56, G, 0, 0, 0)); // jointure (base du doigt)
    lens.forEach((len, k) => {
      const seg = new THREE.Group();
      seg.rotation.x = c[k];
      const ww = w * (1 - k * 0.09);
      const last = k === 2;
      const mat = last ? tipMat : (style === 'fingerless' && k === 1 ? M.skin : G);
      seg.add(rbox(ww, ww * 0.9, len + 0.002, mat, 0, 0, -len / 2, ww * (last ? 0.46 : 0.36)));
      if (k > 0) seg.add(joint(ww * 0.5, mat, 0, 0, 0));                                                 // articulation ronde
      if (k === 0 && !bare) seg.add(rbox(ww * 0.86, 0.005, len * 0.55, M.plate, 0, ww * 0.47, -len * 0.45, 0.002)); // protection
      if (last && style !== 'full') seg.add(rbox(ww * 0.62, 0.003, len * 0.48, M.nail, 0, ww * 0.44, -len * 0.62, 0.0012)); // ongle
      if (k === 0) parent.add(seg);
      else { seg.position.set(0, 0, -lens[k - 1]); parent.add(seg); }
      parent = seg;
    });
  });
  // Pouce : base dans la paume + 2 phalanges
  const th = new THREE.Group();
  th.position.set(0.032, -0.008, 0.006);
  th.rotation.set(0, thumbSpread, 0);
  th.add(rbox(0.022, 0.02, 0.03, G, 0.004, 0, -0.012, 0.008));
  const th2 = new THREE.Group();
  th2.position.set(0.004, 0, -0.027);
  th2.rotation.x = thumbCurl * 0.5;
  th2.add(joint(0.0105, G, 0, 0, 0), rbox(0.02, 0.018, 0.022, style === 'fingerless' ? M.skin : G, 0, 0, -0.01, 0.007));
  const thTip = new THREE.Group();
  thTip.position.set(0, 0, -0.021);
  thTip.rotation.x = thumbCurl * 0.7;
  thTip.add(joint(0.0095, tipMat, 0, 0, 0), rbox(0.018, 0.0165, 0.021, tipMat, 0, 0, -0.009, 0.0075));
  if (style !== 'full') thTip.add(rbox(0.011, 0.003, 0.011, M.nail, 0, 0.008, -0.012, 0.0012));
  th2.add(thTip);
  th.add(th2);
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
