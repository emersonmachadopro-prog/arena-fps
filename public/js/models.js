// =====================================================================
//  models.js — Petites fonctions pour construire des modèles low-poly
//  avec des boîtes (personnages, bras, armes). Aucun fichier 3D externe.
// =====================================================================
import * as THREE from 'three';
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
