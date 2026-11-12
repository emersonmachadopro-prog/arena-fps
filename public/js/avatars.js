// =====================================================================
//  avatars.js — Personnages 3D des autres joueurs (et des bots)
//  Soldat low-poly : casque, visière lumineuse, gilet, sac, bras qui
//  tiennent l'arme. Contour fin à la couleur de l'équipe (violet / orange).
//  Les skins (tenue + arme) sont appliqués.
// =====================================================================
import * as THREE from 'three';
import { TEAMS, HITBOX } from '/shared/constants.js';
import { mat, box, limb, cyl, addOutline, skinMaterials } from './models.js';
import { CHARACTER_SKINS, WEAPON_SKINS } from '/shared/skins.js';
import { fabricTex } from './textures.js';

const OUTLINE = 0.012; // épaisseur du contour (discret)

const HIP = 0.92;             // hauteur des hanches (pivot des jambes)
const SHOULDER = 1.38;        // hauteur des épaules (pivot des bras + arme)
const NECK = 1.48;            // pivot de la tête

export class Avatar {
  /**
   * opts.skins  = skins du joueur ({ character, ak, kar98k, knife })
   * opts.weapon = arme tenue au départ
   */
  constructor(scene, name, team, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    const color = TEAMS[team]?.color ?? 0x888888;
    this.color = color;
    this.skins = opts.skins || {};
    const cs = CHARACTER_SKINS[this.skins.character] || CHARACTER_SKINS.default;

    // Matériaux (couleurs de la tenue choisie)
    const suit = mat(cs.suit, { map: fabricTex(), roughness: 0.95 });
    const vest = mat(cs.vest, { map: fabricTex(), roughness: 0.9 });
    const boots = mat(0x1d1a17, { roughness: 0.8 });
    const glove = mat(0x26231f, { roughness: 0.85 });
    const skin = mat(0xc49a76, { roughness: 0.75 });
    const metal = mat(0x3a3f3a, { metalness: 0.3, roughness: 0.6, map: fabricTex() }); // casque peint mat
    const glass = mat(0x111418, { metalness: 0.9, roughness: 0.1 });                   // verres des lunettes
    // Brassard / bandes à la couleur de l'équipe (légèrement lumineux pour rester lisible)
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 });

    // ---- Jambes (pivot aux hanches pour l'animation de marche) ----
    this.legs = [-0.13, 0.13].map((x) => {
      const leg = new THREE.Group();
      leg.position.set(x, HIP, 0);
      leg.add(
        box(0.2, 0.44, 0.22, suit, 0, -0.22, 0),      // cuisse
        box(0.17, 0.38, 0.19, suit, 0, -0.62, 0),     // tibia
        box(0.21, 0.13, 0.08, vest, 0, -0.45, -0.1),  // genouillère
        box(0.08, 0.14, 0.12, vest, x > 0 ? 0.12 : -0.12, -0.2, 0), // poche de cuisse
        box(0.22, 0.13, 0.32, boots, 0, -0.855, -0.04), // botte
        box(0.23, 0.035, 0.34, mat(0x0e0d0c), 0, -0.905, -0.04) // semelle
      );
      this.group.add(leg);
      return leg;
    });

    // ---- Haut du corps (descend quand on s'accroupit) ----
    this.body = new THREE.Group();
    this.body.add(
      box(0.44, 0.16, 0.26, vest, 0, 0.99, 0),          // bassin / ceinture
      box(0.5, 0.48, 0.28, suit, 0, 1.22, 0),           // torse
      box(0.56, 0.36, 0.34, vest, 0, 1.25, 0),          // gilet pare-balles
      box(0.46, 0.06, 0.28, mat(0x1b1a18), 0, 1.05, 0), // ceinture
      box(0.09, 0.12, 0.06, vest, -0.12, 1.2, -0.19),   // poches à chargeurs
      box(0.09, 0.12, 0.06, vest, 0, 1.2, -0.19),
      box(0.09, 0.12, 0.06, vest, 0.12, 1.2, -0.19),
      box(0.14, 0.05, 0.02, glow, 0.12, 1.36, -0.175),  // écusson de l'équipe sur le torse
      box(0.32, 0.36, 0.14, vest, 0, 1.25, 0.23),       // sac à dos
      box(0.26, 0.08, 0.1, suit, 0, 1.4, 0.25),         // rabat du sac
      box(0.16, 0.1, 0.22, vest, 0.34, 1.42, 0),        // épaulière droite
      box(0.16, 0.1, 0.22, vest, -0.34, 1.42, 0),       // épaulière gauche
      box(0.165, 0.07, 0.225, glow, -0.34, 1.33, 0),    // brassard d'équipe (bras gauche)
      box(0.165, 0.07, 0.225, glow, 0.34, 1.33, 0),     // brassard d'équipe (bras droit)
    );

    // Tête (pivot au cou pour regarder en haut / en bas)
    this.headG = new THREE.Group();
    this.headG.position.y = NECK;
    this.headG.add(
      box(0.12, 0.08, 0.12, skin, 0, 0.02, 0),          // cou
      box(0.26, 0.28, 0.26, skin, 0, 0.16, 0),          // visage
      box(0.2, 0.09, 0.03, mat(0x2a2622), 0, 0.06, -0.13), // cache-cou
      box(0.33, 0.15, 0.33, metal, 0, 0.31, 0.01),      // casque
      box(0.35, 0.05, 0.14, metal, 0, 0.23, 0.13),      // rebord arrière du casque
      box(0.27, 0.025, 0.04, metal, 0, 0.235, -0.15),   // visière du casque
      box(0.24, 0.065, 0.035, glass, 0, 0.17, -0.14),   // lunettes de protection
      box(0.28, 0.025, 0.28, mat(0x1b1a18), 0, 0.17, 0.005), // sangle des lunettes
    );
    this.body.add(this.headG);

    // Bras + arme (pivot aux épaules pour suivre la visée)
    this.aim = new THREE.Group();
    this.aim.position.y = SHOULDER;
    const s = (x, y, z) => [x, y - SHOULDER, z]; // coordonnées relatives à l'épaule
    this.aim.add(
      // Bras droit : épaule → coude → main sur la poignée
      limb(s(0.3, 1.4, 0), s(0.3, 1.13, -0.16), 0.13, suit),
      limb(s(0.3, 1.13, -0.16), s(0.15, 1.1, -0.34), 0.11, suit),
      box(0.09, 0.09, 0.09, glove, 0.15, 1.1 - SHOULDER, -0.36),
      // Bras gauche : épaule → coude → main sur le garde-main
      limb(s(-0.3, 1.4, 0), s(-0.2, 1.12, -0.3), 0.13, suit),
      limb(s(-0.2, 1.12, -0.3), s(0.1, 1.15, -0.62), 0.11, suit),
      box(0.09, 0.09, 0.09, glove, 0.11, 1.15 - SHOULDER, -0.63),
    );
    // L'arme tenue (reconstruite quand le joueur change d'arme)
    this.gunG = new THREE.Group();
    this.gunG.position.set(0.13, 1.18 - SHOULDER, 0);
    this.aim.add(this.gunG);
    this.body.add(this.aim);

    this.group.add(this.body);
    this.group.traverse(o => { if (o.isMesh) o.castShadow = true; });

    // Contour fin à la couleur de l'équipe
    addOutline(this.group, color, OUTLINE);
    this.weaponId = null;
    this.setWeapon(opts.weapon || 'ak');

    // Pseudo flottant
    this.label = makeLabel(name, TEAMS[team]?.css ?? '#fff');
    this.label.position.y = 2.2;
    this.group.add(this.label);

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

  /** Change l'arme visible dans les mains ('ak', 'kar98k' ou 'knife') */
  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    for (const c of [...this.gunG.children]) { this.gunG.remove(c); c.traverse(o => { if (!o.userData.isOutline) o.geometry?.dispose(); }); }
    const skin = WEAPON_SKINS[this.skins[id]] || WEAPON_SKINS.default;
    const g = buildThirdPersonWeapon(id, skin);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    addOutline(g, this.color, OUTLINE);
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

    // Animation de marche (balancement des jambes)
    const speed = prev.distanceTo(g.position) / Math.max(dt, 1e-4);
    if (speed > 0.5) this.walk += dt * speed * 1.8;
    const swing = Math.sin(this.walk) * Math.min(speed / 6, 1) * 0.6;
    this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing;
    this.body.rotation.z = Math.sin(this.walk) * 0.03 * Math.min(speed / 6, 1);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.userData.isOutline) return; // la géométrie est partagée avec la pièce d'origine
      o.geometry?.dispose();
      if (o.material?.map) o.material.map.dispose();
    });
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
function buildThirdPersonWeapon(id, skin) {
  const g = new THREE.Group();
  const { body, accent, dark } = skinMaterials(skin);
  if (id === 'knife') {
    g.add(box(0.03, 0.04, 0.12, accent, 0.02, -0.08, -0.36), box(0.01, 0.05, 0.22, mat(0xd8dee9, { metalness: 0.8 }), 0.02, -0.07, -0.52));
  } else if (id === 'kar98k') {
    g.add(
      box(0.06, 0.08, 0.95, accent, 0, -0.02, -0.4),   // bois sur toute la longueur
      cyl(0.02, 0.4, body, 0, 0.02, -1.0),             // canon
      cyl(0.03, 0.3, dark, 0, 0.1, -0.42),             // lunette
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
  return g;
}
