// =====================================================================
//  avatars.js — Personnages 3D des autres joueurs (et des bots)
//  Soldat aux formes arrondies, mains avec doigts, contour d'équipe.
//  Animations : marche (genoux qui plient), course (penché en avant),
//  saut (jambes repliées), accroupi, rechargement, chute à la mort.
//  Mouvement fluide : on rejoue les positions reçues du serveur avec
//  un léger retard (interpolation) au lieu de "sauter" d'une à l'autre.
// =====================================================================
import * as THREE from 'three';
import { TEAMS, HITBOX } from '/shared/constants.js';
import { mat, box, rbox, capsule, cyl, makeHand, orientHand, addOutline, skinMaterials } from './models.js';
import { CHARACTER_SKINS, WEAPON_SKINS } from '/shared/skins.js';
import { fabricTex } from './textures.js';

const OUTLINE = 0.012; // épaisseur du contour (discret)
const HIP = 0.92;      // hauteur des hanches (pivot des jambes)
const KNEE = 0.44;     // longueur de la cuisse
const SHOULDER = 1.4;  // hauteur des épaules (pivot des bras + arme)
const NECK = 1.5;      // pivot de la tête
const INTERP_DELAY = 100; // ms de retard volontaire pour l'interpolation réseau

const ease = (t) => t * t * (3 - 2 * t);
const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class Avatar {
  /**
   * opts.skins  = skins du joueur ({ character, ak, kar98k, knife })
   * opts.weapon = arme tenue, opts.optic = viseur monté dessus
   * opts.outline = false pour ne pas dessiner de contour (aperçu du menu)
   * opts.ally = true → visible à travers les murs (silhouette + pseudo)
   */
  constructor(scene, name, team, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    const color = TEAMS[team]?.color ?? 0x888888;
    this.color = color;
    this.outline = opts.outline !== false;
    this.ally = !!opts.ally;
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
    const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 });

    // ---- Jambes : hanche → genou → pied (le genou plie en marchant) ----
    this.legs = [-0.12, 0.12].map((x) => {
      const hip = new THREE.Group();
      hip.position.set(x, HIP, 0);
      hip.add(
        capsule([0, 0, 0], [0, -KNEE, 0.01], 0.1, suit),                   // cuisse
        rbox(0.07, 0.13, 0.12, vest, x > 0 ? 0.1 : -0.1, -0.22, 0, 0.025), // poche de cuisse
      );
      const knee = new THREE.Group();
      knee.position.set(0, -KNEE, 0.01);
      knee.add(
        capsule([0, 0, 0], [0, -0.38, -0.01], 0.08, suit),               // tibia
        rbox(0.17, 0.13, 0.08, vest, 0, -0.01, -0.09, 0.03),             // genouillère
        rbox(0.19, 0.13, 0.3, boots, 0, -0.415, -0.05, 0.05),            // botte
        rbox(0.2, 0.035, 0.31, strap, 0, -0.465, -0.05, 0.012),          // semelle
      );
      hip.add(knee);
      hip.userData.knee = knee;
      this.group.add(hip);
      return hip;
    });

    // ---- Haut du corps (descend quand on s'accroupit) ----
    this.body = new THREE.Group();
    this.torso = new THREE.Group(); // penche en avant quand il court
    this.torso.add(
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
    this.body.add(this.torso);

    // Tête (pivot au cou pour regarder en haut / en bas)
    this.headG = new THREE.Group();
    this.headG.position.y = NECK;
    this.headG.add(
      capsule([0, -0.04, 0], [0, 0.07, 0], 0.06, skin),
      rbox(0.24, 0.27, 0.25, skin, 0, 0.17, 0, 0.09),
      rbox(0.13, 0.05, 0.035, mat(0x2a2622), 0, 0.075, -0.115, 0.015),
      rbox(0.31, 0.17, 0.31, helmet, 0, 0.3, 0.01, 0.1),
      rbox(0.33, 0.06, 0.15, helmet, 0, 0.24, 0.11, 0.025),
      rbox(0.24, 0.07, 0.04, glass, 0, 0.18, -0.125, 0.025),
      rbox(0.27, 0.025, 0.27, strap, 0, 0.18, 0.005, 0.012),
      rbox(0.04, 0.05, 0.03, strap, 0.13, 0.26, -0.02, 0.01),
    );
    this.torso.add(this.headG);

    // Bras + arme (pivot aux épaules pour suivre la visée)
    this.aim = new THREE.Group();
    this.aim.position.y = SHOULDER;
    const s = (x, y, z) => [x, y - SHOULDER, z];
    this.aim.add(
      capsule(s(0.3, 1.41, 0), s(0.3, 1.15, -0.15), 0.065, suit),
      capsule(s(0.3, 1.15, -0.15), s(0.16, 1.11, -0.33), 0.055, suit),
    );
    const rh = makeHand(glove, { curl: [-1.3, -1.2, -0.8] });
    rh.scale.set(-1.3, 1.3, 1.3);
    orientHand(rh, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
    rh.position.set(0.17, 1.12 - SHOULDER, -0.34);
    this.aim.add(rh);
    // Bras gauche : groupe séparé (il va chercher un chargeur pendant le rechargement)
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.3, 1.41 - SHOULDER, 0);
    const ls = (x, y, z) => [x + 0.3, y - 1.41, z];
    this.leftArm.add(
      capsule(ls(-0.3, 1.41, 0), ls(-0.21, 1.13, -0.3), 0.065, suit),
      capsule(ls(-0.21, 1.13, -0.3), ls(0.08, 1.15, -0.6), 0.055, suit),
      rbox(0.07, 0.04, 0.18, glow, 0, -0.08, -0.03, 0.02), // brassard
    );
    const lh = makeHand(glove, { curl: [-1.2, -1.0, -0.6] });
    lh.scale.setScalar(1.3);
    orientHand(lh, [0, 0, -1], [0, -1, 0], [-1, 0, 0]);
    lh.position.set(...ls(0.1, 1.13, -0.62));
    this.leftArm.add(lh);
    this.aim.add(this.leftArm);
    // L'arme tenue (reconstruite quand le joueur change d'arme)
    this.gunG = new THREE.Group();
    this.gunG.position.set(0.13, 1.18 - SHOULDER, 0);
    this.aim.add(this.gunG);
    this.torso.add(this.aim);

    this.group.add(this.body);
    this.group.traverse(o => { if (o.isMesh) o.castShadow = true; });

    if (this.outline) addOutline(this.group, color, OUTLINE);
    this.weaponId = null;
    this.setWeapon(opts.weapon || 'ak', opts.optic);

    // Pseudo flottant (les alliés le voient aussi à travers les murs)
    if (name) {
      this.label = makeLabel(name, TEAMS[team]?.css ?? '#fff', this.ally);
      this.label.position.y = 2.2;
      this.group.add(this.label);
    }

    // Silhouette des alliés à travers les murs
    if (this.ally) this.buildXray(color);

    scene.add(this.group);

    // État d'animation
    this.target = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.snaps = [];          // positions reçues du serveur (interpolation)
    this.walk = 0;
    this.crouch = false;
    this.air = 0;             // > 0 = en l'air (jambes repliées)
    this.vy = 0;
    this.reloadT = -1;        // >= 0 pendant un rechargement
    this.dead = false; this.deathT = 0;
    this.stepDist = 0;
    this.speed = 0;
    this.onStep = null;       // appelé à chaque pas (pour les bruits de pas)
  }

  /** Copie de la silhouette, dessinée par-dessus les murs (seulement si l'allié est caché) */
  buildXray(color) {
    const xmat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false });
    this.xray = new THREE.Group();
    const parts = [];
    this.group.updateMatrixWorld(true);
    this.group.traverse(o => { if (o.isMesh && !o.userData.isOutline) parts.push(o); });
    for (const o of parts) {
      const c = new THREE.Mesh(o.geometry, xmat);
      c.matrixAutoUpdate = false;
      c.renderOrder = 998;
      c.userData.src = o;
      this.xray.add(c);
    }
    this.xray.visible = false;
    this.scene.add(this.xray);
  }
  setXray(v) {
    if (!this.xray) return;
    this.xray.visible = v && this.group.visible && !this.dead;
    if (this.xray.visible) {
      for (const c of this.xray.children) c.matrix.copy(c.userData.src.matrixWorld);
    }
  }

  // ---- Positions ----
  /** Mode simple (bots du solo, menus) : on suit la cible en douceur */
  setTarget(s, snap = false) {
    Object.assign(this.target, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
    this.crouch = !!s.crouch;
    if (snap) { this.group.position.set(s.x, s.y, s.z); this.group.rotation.y = s.yaw; this.snaps.length = 0; }
  }
  /** Mode réseau : on mémorise chaque position avec l'heure du serveur */
  pushSnapshot(t, s, snap = false) {
    if (snap) this.snaps.length = 0;
    this.snaps.push({ t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, crouch: !!s.crouch });
    while (this.snaps.length > 30) this.snaps.shift();
    if (snap) { this.group.position.set(s.x, s.y, s.z); this.group.rotation.y = s.yaw; }
  }

  /** Position interpolée à l'instant serverNow - 100 ms */
  sampleSnapshots(serverNow) {
    const sn = this.snaps;
    if (!sn.length) return null;
    const rt = serverNow - INTERP_DELAY;
    if (rt <= sn[0].t) return sn[0];
    for (let i = sn.length - 1; i > 0; i--) {
      const a = sn[i - 1], b = sn[i];
      if (rt >= a.t) {
        if (rt > b.t) {
          // Pas encore de nouvelle position : on prolonge un tout petit peu le mouvement
          const k = Math.min((rt - b.t) / (b.t - a.t || 50), 1.5) * 0.6;
          return { x: b.x + (b.x - a.x) * k, y: b.y, z: b.z + (b.z - a.z) * k, yaw: b.yaw, pitch: b.pitch, crouch: b.crouch };
        }
        const k = (rt - a.t) / (b.t - a.t || 1);
        return {
          x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
          yaw: angleLerp(a.yaw, b.yaw, k), pitch: a.pitch + (b.pitch - a.pitch) * k, crouch: k < 0.5 ? a.crouch : b.crouch,
        };
      }
    }
    return sn[0];
  }

  setVisible(v) { this.group.visible = v; if (!v && this.xray) this.xray.visible = false; }

  /** Change l'arme visible dans les mains ('ak', 'kar98k' ou 'knife') + son viseur */
  setWeapon(id, optic = 'iron') {
    const key = `${id}:${optic}`;
    if (key === this.weaponId) return;
    this.weaponId = key;
    this.weaponName = id;
    for (const c of [...this.gunG.children]) this.gunG.remove(c);
    const skin = WEAPON_SKINS[this.skins[id]] || WEAPON_SKINS.default;
    const g = buildThirdPersonWeapon(id, skin, optic);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    if (this.outline) addOutline(g, this.color, OUTLINE);
    this.gunG.add(g);
    this.muzzle = g.userData.muzzle;
  }

  /** Position du bout du canon dans le monde (pour les traçantes) */
  muzzleWorld() {
    const v = new THREE.Vector3();
    (this.muzzle || this.gunG).getWorldPosition(v);
    return { x: v.x, y: v.y, z: v.z };
  }

  setReloading(r) {
    if (r && this.reloadT < 0) this.reloadT = 0;
    if (!r) this.reloadT = -1;
  }

  /** Le personnage tombe (mort) */
  die() { if (!this.dead) { this.dead = true; this.deathT = 0; if (this.label) this.label.visible = false; this.setXray(false); } }
  revive() { this.dead = false; this.group.rotation.x = 0; this.group.rotation.z = 0; if (this.label) this.label.visible = true; }

  /** serverNow = horloge serveur estimée (mode réseau), sinon mode simple */
  update(dt, serverNow = null) {
    const g = this.group;
    const prev = g.position.clone();

    // ---- Position (interpolation réseau ou suivi doux) ----
    const s = serverNow !== null ? this.sampleSnapshots(serverNow) : null;
    if (s && !this.dead) {
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.yaw;
      this.target.pitch = s.pitch;
      this.crouch = s.crouch;
    } else if (!this.dead) {
      const t = this.target, k = this.exact ? 1 : Math.min(1, dt * 12); // exact = corps du joueur local
      g.position.x += (t.x - g.position.x) * k;
      g.position.y += (t.y - g.position.y) * k;
      g.position.z += (t.z - g.position.z) * k;
      g.rotation.y = angleLerp(g.rotation.y, t.yaw, k);
    }

    // ---- Mort : chute en arrière ----
    if (this.dead) {
      this.deathT += dt;
      const f = ease(Math.min(1, this.deathT / 0.55));
      g.rotation.x = f * (Math.PI / 2 - 0.08);
      g.rotation.z = f * 0.15;
      this.aim.rotation.x = -f * 0.6;
      for (const l of this.legs) { l.rotation.x *= 0.9; l.userData.knee.rotation.x *= 0.9; }
      return;
    }

    // ---- Vitesse (lissée) et état en l'air ----
    const inst = Math.hypot(g.position.x - prev.x, g.position.z - prev.z) / Math.max(dt, 1e-4);
    this.speed += (Math.min(inst, 14) - this.speed) * Math.min(1, dt * 10);
    const vy = (g.position.y - prev.y) / Math.max(dt, 1e-4);
    this.vy += (vy - this.vy) * Math.min(1, dt * 12);
    this.air = Math.abs(this.vy) > 1.2 ? Math.min(1, this.air + dt * 6) : Math.max(0, this.air - dt * 5);

    // L'arme et la tête suivent la visée verticale
    const pitch = this.target.pitch || 0;
    this.aim.rotation.x += (pitch * 0.85 - this.aim.rotation.x) * Math.min(1, dt * 15);
    this.headG.rotation.x = pitch * 0.5;

    // ---- Accroupi : le haut du corps descend, les cuisses avancent, les genoux plient ----
    const k = Math.min(1, dt * 12);
    const drop = this.crouch ? HITBOX.stand.head[1] - HITBOX.crouch.head[1] : 0;
    this.body.position.y += (-drop - this.body.position.y) * k;
    const crouchF = -this.body.position.y / (HITBOX.stand.head[1] - HITBOX.crouch.head[1] || 1);

    // ---- Marche / course (F1, F2) ----
    const run = Math.min(1, Math.max(0, (this.speed - 4) / 3));
    const moving = Math.min(1, this.speed / 3);
    if (this.speed > 0.3) this.walk += dt * (5.5 + this.speed * 0.9);
    const stride = moving * (0.45 + run * 0.35) * (1 - this.air);
    this.legs.forEach((leg, i) => {
      const ph = this.walk + (i ? Math.PI : 0);
      let thigh = Math.sin(ph) * stride;
      let knee = -Math.max(0, Math.sin(ph - 1.3)) * stride * 1.6;      // le genou plie quand la jambe revient
      // Accroupi : cuisses vers l'avant, genoux très pliés
      thigh += crouchF * 1.1; knee -= crouchF * 2.2;
      leg.position.y = HIP + this.body.position.y; // la hanche descend avec le corps
      // En l'air (F3) : jambes repliées
      thigh += this.air * (i ? 0.3 : 0.7); knee -= this.air * (i ? 0.9 : 1.2);
      leg.rotation.x += (thigh - leg.rotation.x) * Math.min(1, dt * 18);
      leg.userData.knee.rotation.x += (knee - leg.userData.knee.rotation.x) * Math.min(1, dt * 18);
    });
    // Le corps monte/descend à chaque pas, penche en avant en courant
    const bounce = Math.abs(Math.sin(this.walk)) * 0.035 * moving * (1 - this.air);
    this.torso.position.y = bounce - crouchF * 0.05;
    this.torso.rotation.x += ((-0.06 - run * 0.16) * moving - this.torso.rotation.x) * Math.min(1, dt * 8);
    this.torso.rotation.y = Math.sin(this.walk) * 0.06 * moving;
    this.body.scale.y = 1 + Math.sin(performance.now() / 700) * 0.006; // respiration

    // ---- Rechargement (F4) : l'arme penche, la main gauche va au chargeur ----
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const r = Math.min(1, this.reloadT / 0.25);
      this.gunG.rotation.z = 0.5 * r; this.gunG.rotation.x = 0.25 * r;
      this.leftArm.rotation.x = -0.6 * r + Math.sin(this.reloadT * 5) * 0.35 * r;
      this.leftArm.rotation.z = 0.3 * r;
    } else {
      this.gunG.rotation.z *= 0.8; this.gunG.rotation.x *= 0.8;
      this.leftArm.rotation.x *= 0.8; this.leftArm.rotation.z *= 0.8;
    }

    // ---- Bruits de pas (pas accroupi) ----
    if (!this.crouch && this.air < 0.2 && this.speed > 2.5) {
      this.stepDist += this.speed * dt;
      if (this.stepDist > (run > 0.5 ? 2.6 : 2.2)) { this.stepDist = 0; this.onStep?.(g.position, run > 0.5); }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.xray) this.scene.remove(this.xray);
    // Les géométries sont partagées entre personnages : on ne libère que la texture du pseudo
    this.label?.material.map?.dispose();
  }
}

function makeLabel(text, color, throughWalls) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: !throughWalls, transparent: true }));
  s.scale.set(1.2, 0.3, 1);
  if (throughWalls) s.renderOrder = 999;
  return s;
}

// ---------------------------------------------------------------------
//  Armes vues par les autres joueurs (version simplifiée mais arrondie)
//  Repère : z négatif = vers l'avant · userData.muzzle = bout du canon
// ---------------------------------------------------------------------
function buildThirdPersonWeapon(id, skin, optic) {
  const g = new THREE.Group();
  const { body, accent, dark } = skinMaterials(skin);
  const opticMat = mat(0x16181c, { metalness: 0.5 });
  const muzzle = new THREE.Object3D();
  if (id === 'knife') {
    g.add(rbox(0.03, 0.04, 0.12, accent, 0.02, -0.08, -0.36, 0.01), rbox(0.01, 0.05, 0.22, mat(0xd8dee9, { metalness: 0.8 }), 0.02, -0.07, -0.52, 0.004));
    muzzle.position.set(0.02, -0.07, -0.6);
  } else if (id === 'kar98k') {
    g.add(
      rbox(0.06, 0.08, 0.95, accent, 0, -0.02, -0.4, 0.02),
      cyl(0.02, 0.4, body, 0, 0.02, -1.0),
      rbox(0.06, 0.12, 0.25, accent, 0, -0.06, 0.02, 0.02),
    );
    muzzle.position.set(0, 0.02, -1.2);
  } else if (id === 'glock') {
    const grip = rbox(0.035, 0.11, 0.05, body, 0, -0.1, -0.3, 0.01); grip.rotation.x = -0.25;
    g.add(
      rbox(0.04, 0.045, 0.2, mat(0x23262b, { metalness: 0.6, roughness: 0.4 }), 0, -0.02, -0.38, 0.008),
      rbox(0.036, 0.03, 0.17, body, 0, -0.055, -0.37, 0.008),
      grip,
    );
    muzzle.position.set(0, -0.02, -0.5);
  } else {
    const mag = rbox(0.05, 0.16, 0.07, dark, 0, -0.1, -0.5, 0.012); mag.rotation.x = 0.35;
    g.add(
      rbox(0.07, 0.11, 0.5, body, 0, 0.02, -0.45, 0.015),
      cyl(0.02, 0.32, body, 0, 0.04, -0.86),
      rbox(0.06, 0.09, 0.26, accent, 0, -0.02, -0.08, 0.02),
      mag,
    );
    muzzle.position.set(0, 0.04, -1.02);
  }
  if (optic === 'reddot') g.add(rbox(0.05, 0.06, 0.07, opticMat, 0, 0.1, -0.4, 0.01));
  if (optic === 'mid') g.add(cyl(0.025, 0.18, opticMat, 0, 0.11, -0.42));
  if (optic === 'scope') g.add(cyl(0.03, 0.3, opticMat, 0, 0.1, -0.42));
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}
