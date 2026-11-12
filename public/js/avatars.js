// =====================================================================
//  avatars.js — Personnages 3D des autres joueurs (et des bots)
//  Soldat aux formes arrondies : casque, lunettes, gilet, sac, membres
//  en capsules, mains avec doigts. Contour fin à la couleur de l'équipe.
// =====================================================================
import * as THREE from 'three';
import { TEAMS, HITBOX } from '/shared/constants.js';
import { mat, box, rbox, capsule, cyl, makeHand, orientHand, addOutline, skinMaterials } from './models.js';
import { CHARACTER_SKINS, WEAPON_SKINS } from '/shared/skins.js';
import { fabricTex } from './textures.js';

const OUTLINE = 0.012; // épaisseur du contour (discret)
const HIP = 0.92;      // hauteur des hanches (pivot des jambes)
const SHOULDER = 1.4;  // hauteur des épaules (pivot des bras + arme)
const NECK = 1.5;      // pivot de la tête

export class Avatar {
  /**
   * opts.skins  = skins du joueur ({ character, ak, kar98k, knife })
   * opts.weapon = arme tenue, opts.optic = viseur monté dessus
   * opts.outline = false pour ne pas dessiner de contour (aperçu du menu)
   */
  constructor(scene, name, team, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    const color = TEAMS[team]?.color ?? 0x888888;
    this.color = color;
    this.outline = opts.outline !== false;
    this.skins = opts.skins || {};
    const cs = CHARACTER_SKINS[this.skins.character] || CHARACTER_SKINS.default;

    // Matériaux (couleurs de la tenue choisie)
    const suit = mat(cs.suit, { map: fabricTex(), roughness: 0.95 });
    const vest = mat(cs.vest, { map: fabricTex(), roughness: 0.9 });
    const boots = mat(0x1d1a17, { roughness: 0.8 });
    const glove = mat(0x5d4f40, { roughness: 0.85 });
    const skin = mat(0xc49a76, { roughness: 0.7 });
    const helmet = mat(0x3a3f3a, { metalness: 0.25, roughness: 0.65, map: fabricTex() });
    const strap = mat(0x1b1a18, { roughness: 0.85 });
    const glass = mat(0x0f1216, { metalness: 0.9, roughness: 0.08 });
    // Brassard / écusson à la couleur de l'équipe (un peu lumineux pour rester lisible)
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 });
    this.mats = { glove, suit };

    // ---- Jambes (pivot aux hanches pour l'animation de marche) ----
    this.legs = [-0.12, 0.12].map((x) => {
      const leg = new THREE.Group();
      leg.position.set(x, HIP, 0);
      leg.add(
        capsule([0, 0, 0], [0, -0.44, 0.01], 0.1, suit),             // cuisse
        capsule([0, -0.44, 0.01], [0, -0.82, 0], 0.08, suit),        // tibia
        rbox(0.17, 0.13, 0.08, vest, 0, -0.44, -0.09, 0.03),         // genouillère
        rbox(0.07, 0.13, 0.12, vest, x > 0 ? 0.1 : -0.1, -0.22, 0, 0.025), // poche de cuisse
        rbox(0.19, 0.13, 0.3, boots, 0, -0.855, -0.04, 0.05),        // botte
        rbox(0.2, 0.035, 0.31, strap, 0, -0.905, -0.04, 0.012),      // semelle
      );
      this.group.add(leg);
      return leg;
    });

    // ---- Haut du corps (descend quand on s'accroupit) ----
    this.body = new THREE.Group();
    this.body.add(
      rbox(0.42, 0.18, 0.26, suit, 0, 1.0, 0, 0.07),                 // bassin
      rbox(0.44, 0.07, 0.28, strap, 0, 1.06, 0, 0.025),              // ceinture
      rbox(0.48, 0.46, 0.28, suit, 0, 1.24, 0, 0.11),                // torse
      rbox(0.52, 0.36, 0.33, vest, 0, 1.24, 0, 0.08),                // gilet pare-balles
      rbox(0.08, 0.11, 0.06, vest, -0.12, 1.19, -0.18, 0.02),        // poches à chargeurs
      rbox(0.08, 0.11, 0.06, vest, 0, 1.19, -0.18, 0.02),
      rbox(0.08, 0.11, 0.06, vest, 0.12, 1.19, -0.18, 0.02),
      rbox(0.12, 0.045, 0.02, glow, 0.12, 1.36, -0.168, 0.008),     // écusson d'équipe
      rbox(0.32, 0.36, 0.15, vest, 0, 1.26, 0.23, 0.06),             // sac à dos
      rbox(0.26, 0.09, 0.1, suit, 0, 1.42, 0.25, 0.04),              // rabat du sac
      rbox(0.17, 0.12, 0.2, vest, 0.31, 1.42, 0, 0.05),              // épaulières
      rbox(0.17, 0.12, 0.2, vest, -0.31, 1.42, 0, 0.05),
    );

    // Tête (pivot au cou pour regarder en haut / en bas)
    this.headG = new THREE.Group();
    this.headG.position.y = NECK;
    this.headG.add(
      capsule([0, -0.04, 0], [0, 0.07, 0], 0.06, skin),             // cou
      rbox(0.24, 0.27, 0.25, skin, 0, 0.17, 0, 0.09),               // visage
      rbox(0.13, 0.05, 0.035, mat(0x2a2622), 0, 0.075, -0.115, 0.015), // cache-cou
      rbox(0.31, 0.17, 0.31, helmet, 0, 0.3, 0.01, 0.1),            // casque
      rbox(0.33, 0.06, 0.15, helmet, 0, 0.24, 0.11, 0.025),         // bord arrière du casque
      rbox(0.24, 0.07, 0.04, glass, 0, 0.18, -0.125, 0.025),        // lunettes de protection
      rbox(0.27, 0.025, 0.27, strap, 0, 0.18, 0.005, 0.012),        // sangle
      rbox(0.04, 0.05, 0.03, strap, 0.13, 0.26, -0.02, 0.01),       // fixation de lampe
    );
    this.body.add(this.headG);

    // Bras + arme (pivot aux épaules pour suivre la visée)
    this.aim = new THREE.Group();
    this.aim.position.y = SHOULDER;
    const s = (x, y, z) => [x, y - SHOULDER, z]; // coordonnées relatives à l'épaule
    this.aim.add(
      // Bras droit : épaule → coude → main sur la poignée
      capsule(s(0.3, 1.41, 0), s(0.3, 1.15, -0.15), 0.065, suit),
      capsule(s(0.3, 1.15, -0.15), s(0.16, 1.11, -0.33), 0.055, suit),
      // Bras gauche : épaule → coude → main sur le garde-main
      capsule(s(-0.3, 1.41, 0), s(-0.21, 1.13, -0.3), 0.065, suit),
      capsule(s(-0.21, 1.13, -0.3), s(0.08, 1.15, -0.6), 0.055, suit),
      rbox(0.07, 0.04, 0.18, glow, -0.3, 1.33 - SHOULDER, -0.03, 0.02), // brassard (bras gauche)
    );
    // Mains avec doigts
    const rh = makeHand(glove, { curl: [-1.3, -1.2] });
    rh.scale.setScalar(1.3); rh.scale.x = -1.3;
    orientHand(rh, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
    rh.position.set(0.17, 1.12 - SHOULDER, -0.34);
    const lh = makeHand(glove, { curl: [-1.2, -1.0] });
    lh.scale.setScalar(1.3);
    orientHand(lh, [0, 0, -1], [0, -1, 0], [-1, 0, 0]);
    lh.position.set(0.1, 1.13 - SHOULDER, -0.62);
    this.aim.add(rh, lh);
    // L'arme tenue (reconstruite quand le joueur change d'arme)
    this.gunG = new THREE.Group();
    this.gunG.position.set(0.13, 1.18 - SHOULDER, 0);
    this.aim.add(this.gunG);
    this.body.add(this.aim);

    this.group.add(this.body);
    this.group.traverse(o => { if (o.isMesh) o.castShadow = true; });

    // Contour fin à la couleur de l'équipe
    if (this.outline) addOutline(this.group, color, OUTLINE);
    this.weaponId = null;
    this.setWeapon(opts.weapon || 'ak', opts.optic);

    // Pseudo flottant
    if (name) {
      this.label = makeLabel(name, TEAMS[team]?.css ?? '#fff');
      this.label.position.y = 2.2;
      this.group.add(this.label);
    }

    scene.add(this.group);

    // Pour l'interpolation (mouvement fluide entre deux messages réseau)
    this.target = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.walk = 0;
    this.crouch = false;
  }

  setTarget(s, snap = false) {
    Object.assign(this.target, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
    this.crouch = !!s.crouch;
    if (snap) { this.group.position.set(s.x, s.y, s.z); this.group.rotation.y = s.yaw; }
  }

  setVisible(v) { this.group.visible = v; }

  /** Change l'arme visible dans les mains ('ak', 'kar98k' ou 'knife') + son viseur */
  setWeapon(id, optic = 'iron') {
    const key = `${id}:${optic}`;
    if (key === this.weaponId) return;
    this.weaponId = key;
    for (const c of [...this.gunG.children]) this.gunG.remove(c);
    const skin = WEAPON_SKINS[this.skins[id]] || WEAPON_SKINS.default;
    const g = buildThirdPersonWeapon(id, skin, optic);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    if (this.outline) addOutline(g, this.color, OUTLINE);
    this.gunG.add(g);
  }

  update(dt) {
    const g = this.group, t = this.target;
    const k = Math.min(1, dt * 15);
    const prev = g.position.clone();
    g.position.x += (t.x - g.position.x) * k;
    g.position.y += (t.y - g.position.y) * k;
    g.position.z += (t.z - g.position.z) * k;
    // Rotation par le chemin le plus court
    let dy = t.yaw - g.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * k;
    // L'arme et la tête suivent la visée verticale
    this.aim.rotation.x = t.pitch * 0.85;
    this.headG.rotation.x = t.pitch * 0.5;

    // Accroupi : le haut du corps descend, les jambes se plient
    const drop = this.crouch ? HITBOX.stand.head[1] - HITBOX.crouch.head[1] : 0;
    this.body.position.y += (-drop - this.body.position.y) * k;
    const legScale = (HIP - drop) / HIP;
    for (const l of this.legs) {
      l.scale.y += (legScale - l.scale.y) * k;
      l.position.y = HIP * l.scale.y;
    }

    // Animation de marche (balancement des jambes) + respiration
    const speed = prev.distanceTo(g.position) / Math.max(dt, 1e-4);
    if (speed > 0.5) this.walk += dt * speed * 1.8;
    const swing = Math.sin(this.walk) * Math.min(speed / 6, 1) * 0.6;
    this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing;
    this.body.rotation.z = Math.sin(this.walk) * 0.03 * Math.min(speed / 6, 1);
    this.body.scale.y = 1 + Math.sin(performance.now() / 700) * 0.006;
  }

  dispose() {
    this.scene.remove(this.group);
    // Les géométries sont partagées entre personnages : on ne libère que la texture du pseudo
    this.label?.material.map?.dispose();
  }
}

function makeLabel(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.2, 0.3, 1);
  return s;
}

// ---------------------------------------------------------------------
//  Armes vues par les autres joueurs (version simplifiée)
//  Repère : z négatif = vers l'avant
// ---------------------------------------------------------------------
function buildThirdPersonWeapon(id, skin, optic) {
  const g = new THREE.Group();
  const { body, accent, dark } = skinMaterials(skin);
  const opticMat = mat(0x16181c, { metalness: 0.5 });
  if (id === 'knife') {
    g.add(box(0.03, 0.04, 0.12, accent, 0.02, -0.08, -0.36), box(0.01, 0.05, 0.22, mat(0xd8dee9, { metalness: 0.8 }), 0.02, -0.07, -0.52));
    return g;
  }
  if (id === 'kar98k') {
    g.add(
      box(0.06, 0.08, 0.95, accent, 0, -0.02, -0.4),   // bois sur toute la longueur
      cyl(0.02, 0.4, body, 0, 0.02, -1.0),             // canon
      box(0.06, 0.12, 0.25, accent, 0, -0.06, 0.02),   // crosse
    );
  } else {
    const mag = box(0.05, 0.16, 0.07, dark, 0, -0.1, -0.5); mag.rotation.x = 0.35;
    g.add(
      box(0.07, 0.11, 0.5, body, 0, 0.02, -0.45),      // corps
      box(0.04, 0.04, 0.32, body, 0, 0.04, -0.86),     // canon
      box(0.06, 0.09, 0.26, accent, 0, -0.02, -0.08),  // crosse
      mag,
    );
  }
  // Viseur monté
  if (optic === 'reddot') g.add(box(0.05, 0.06, 0.07, opticMat, 0, 0.1, -0.4));
  if (optic === 'mid') g.add(cyl(0.025, 0.18, opticMat, 0, 0.11, -0.42));
  if (optic === 'scope') g.add(cyl(0.03, 0.3, opticMat, 0, 0.1, -0.42));
  return g;
}
