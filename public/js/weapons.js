// =====================================================================
//  weapons.js — Armes du joueur local : modèle 3D en main (avec les mains),
//  tir, visée (clic droit), lunette, rechargement, recul, dispersion,
//  changement d'arme et skins.
// =====================================================================
import * as THREE from 'three';
import { WEAPONS, PLAYER } from '/shared/constants.js';
import { WEAPON_SKINS, CHARACTER_SKINS } from '/shared/skins.js';
import { dirFromAngles } from '/shared/physics.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { mat, box, limb, cyl, skinMaterials } from './models.js';
import { fabricTex } from './textures.js';

// Position de l'arme à l'écran : "hip" = sans viser, "ads" = en visant
const POSES = {
  ak:     { hip: [0.17, -0.17, -0.62], ads: [0, -0.086, -0.52] },
  kar98k: { hip: [0.19, -0.2, -0.7], ads: [0, -0.079, -0.32] },
};

const ease = (t) => t * t * (3 - 2 * t);

export class WeaponSystem {
  constructor(vmScene, vmCamera, camera, effects) {
    this.vmCamera = vmCamera;
    this.camera = camera;
    this.effects = effects;
    this.root = new THREE.Group();         // suit la caméra de l'arme
    vmScene.add(vmCamera);
    vmCamera.add(this.root);
    this.models = {};
    this.primary = settings.primary || 'ak';
    this.applySkins(settings.skins);
    this.reset();
  }

  /** (Re)construit les modèles avec les skins choisis */
  applySkins(skins) {
    for (const m of Object.values(this.models)) this.root.remove(m);
    const sk = (w) => WEAPON_SKINS[skins?.[w]] || WEAPON_SKINS.default;
    this.models = { ak: buildAK(sk('ak')), kar98k: buildKar(sk('kar98k')), knife: buildKnife(sk('knife'), skins?.knife) };
    for (const m of Object.values(this.models)) this.root.add(m);
    this.showModel();
  }

  /** Remise à zéro au début de chaque manche / réapparition */
  reset(primary = this.primary) {
    this.primary = primary;
    this.current = primary;
    const w = WEAPONS[primary];
    this.mag = w.magSize;
    this.reserve = w.reserve;
    this.reloadLeft = 0;
    this.cooldown = 0;
    this.shotsInRow = 0;
    this.sinceShot = 1;
    this.recoil = 0;        // recul accumulé (récupéré quand on arrête de tirer)
    this.kick = 0;          // animation de recul de l'arme
    this.swing = 0;         // animation du coup de couteau
    this.switchAnim = 0;    // animation de sortie d'arme
    this.sprintAnim = 0;    // arme baissée quand on court
    this.boltAnim = 0;      // réarmement du Kar98k
    this.ads = 0;           // 0 = hanche, 1 = en visée
    this.scoped = false;    // dans la lunette du sniper
    this.lastSpread = 0;
    this.showModel();
  }

  get isGun() { return this.current !== 'knife'; }
  get weapon() { return WEAPONS[this.current]; }
  get reloading() { return this.reloadLeft > 0; }

  showModel() {
    if (!this.current) return;
    for (const [k, m] of Object.entries(this.models)) m.visible = k === this.current && !this.scoped;
    for (const m of Object.values(this.models)) if (m.userData.flash) m.userData.flash.visible = false;
  }

  setVisible(v) { this.root.visible = v; }

  switchTo(w, session) {
    if (w === this.current) return;
    this.current = w;
    this.reloadLeft = 0;       // changer d'arme annule le rechargement
    this.cooldown = 0.3;       // petit délai pour sortir l'arme
    this.switchAnim = 1;
    this.ads = 0;
    this.scoped = false;
    this.showModel();
    sfx.switchWeapon();
    session.switchWeapon(w);
  }

  startReload(session) {
    const w = WEAPONS[this.current];
    if (!this.isGun || this.reloading || this.mag >= w.magSize || this.reserve <= 0) return;
    this.reloadLeft = w.reloadTime;
    sfx.reload();
    session.reload();
  }

  /** Dispersion actuelle (en radians) */
  spread(player) {
    const w = this.weapon;
    if (!this.isGun) return 0;
    const a = ease(this.ads);
    let s = w.hipSpread + (w.adsSpread - w.hipSpread) * a;               // viser = beaucoup plus précis
    s += Math.min(this.shotsInRow, 12) * w.burstSpread * (1 - 0.5 * a);  // rafale
    s += Math.min(player.speed / PLAYER.SPEED, 1.4) * w.moveSpread;      // en mouvement
    if (!player.grounded) s += w.airSpread;                              // en l'air
    if (player.crouch && !player.sliding) s *= 0.75;
    return s;
  }

  /**
   * Appelé à chaque image.
   * canFire = false pendant la préparation de manche ou quand on est mort.
   */
  update(dt, input, player, session, canFire) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    this.boltAnim = Math.max(0, this.boltAnim - dt);

    // --- Changement d'arme : touches 1 / 2 ou molette ---
    if (input.was('weapon1')) this.switchTo(this.primary, session);
    if (input.was('weapon2')) this.switchTo('knife', session);
    const wheel = input.consumeWheel();
    if (wheel !== 0) this.switchTo(this.current === 'knife' ? this.primary : 'knife', session);

    // --- Rechargement ---
    if (input.was('reload')) this.startReload(session);
    if (this.reloading) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        const take = Math.min(WEAPONS[this.current].magSize - this.mag, this.reserve);
        this.mag += take; this.reserve -= take;
      }
    }

    // --- Visée (clic droit) ---
    const wantAds = input.mouseRight && this.isGun && !this.reloading && !player.sprinting && player.alive;
    const adsSpeed = this.isGun ? this.weapon.adsSpeed : 8;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * adsSpeed);
    if (!wantAds && this.ads < 0.01) this.ads = 0;
    const wasScoped = this.scoped;
    this.scoped = this.current === 'kar98k' && this.ads > 0.85;
    if (wasScoped !== this.scoped) this.showModel();

    // Zoom transmis au joueur (champ de vision + sensibilité)
    let zoom = 1;
    if (this.isGun) {
      const z = this.weapon.adsZoom;
      zoom = this.current === 'kar98k' ? (this.scoped ? z : 1 + 0.2 * this.ads) : 1 + (z - 1) * ease(this.ads);
    }
    player.zoom = zoom;
    player.ads = this.ads;

    // --- Tir ---
    if (canFire && this.cooldown <= 0 && this.sprintAnim < 0.5) {
      if (this.isGun && !this.reloading) {
        const trigger = this.weapon.auto ? input.mouseDown : input.mouseClicked;
        if (trigger) {
          if (this.mag > 0) this.fireGun(player, session);
          else { sfx.empty(); this.startReload(session); }
        }
      } else if (this.current === 'knife' && input.mouseDown) {
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

  fireGun(player, session) {
    const w = this.weapon;
    this.mag--;
    this.cooldown = w.fireInterval;
    this.sinceShot = 0;

    // Direction = regard + dispersion aléatoire (répartie dans un disque)
    const s = this.spread(player);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
    const dir = dirFromAngles(player.yaw + Math.cos(a) * r, player.pitch + Math.sin(a) * r);
    const eye = player.eye();
    const res = session.fire(eye, dir, this.current);

    // Effets : traçante depuis le canon, impact sur le mur
    const end = { x: eye.x + dir.x * res.dist, y: eye.y + dir.y * res.dist, z: eye.z + dir.z * res.dist };
    const from = this.scoped ? { x: eye.x + dir.x * 0.5, y: eye.y - 0.15, z: eye.z + dir.z * 0.5 } : this.muzzleWorld();
    this.effects.tracer(from, end);
    if (res.hitWall) this.effects.impact(end);
    if (res.hitPlayer) this.effects.blood(end);

    // Recul : la vue monte (moins en visant), et part un peu sur les côtés
    const adsMul = 1 - 0.35 * this.ads;
    const kick = w.recoilKick * (this.shotsInRow < 3 ? 0.6 : 1) * adsMul * (this.current === 'kar98k' ? 1.6 : 1);
    player.pitch = Math.min(1.55, player.pitch + kick);
    player.yaw += (Math.random() - 0.5) * 0.008 * Math.min(this.shotsInRow + 1, 8) / 4 * adsMul;
    this.recoil += kick * (this.current === 'kar98k' ? 0.85 : 0.6);
    this.shotsInRow++;
    this.kick = 1;

    const flash = this.models[this.current].userData.flash;
    if (flash && !this.scoped) {
      flash.visible = true; flash.rotation.z = Math.random() * Math.PI;
      setTimeout(() => { flash.visible = false; }, 40);
    }
    if (this.current === 'kar98k') { sfx.sniper(); this.boltAnim = w.fireInterval; setTimeout(() => sfx.bolt(), 450); }
    else sfx.shot();
    if (this.mag === 0) setTimeout(() => { if (this.mag === 0) this.startReload(session); }, this.current === 'kar98k' ? 900 : 0);
  }

  stab(player, session) {
    this.cooldown = WEAPONS.knife.fireInterval;
    this.swing = 1;
    const dir = dirFromAngles(player.yaw, player.pitch);
    const res = session.fire(player.eye(), dir, 'knife');
    if (res.hitPlayer) {
      const e = player.eye();
      this.effects.blood({ x: e.x + dir.x * res.dist, y: e.y + dir.y * res.dist, z: e.z + dir.z * res.dist });
    }
    sfx.knife();
  }

  /** Position approximative du bout du canon dans le monde */
  muzzleWorld() {
    this.camera.updateMatrixWorld();
    const z = this.current === 'kar98k' ? -0.95 : -0.75;
    const v = new THREE.Vector3(0.14 * (1 - this.ads), -0.12 * (1 - this.ads) - 0.03, z).applyMatrix4(this.camera.matrixWorld);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Animations de l'arme en main : balancement, visée, recul, rechargement */
  animate(dt, player) {
    this.kick = Math.max(0, this.kick - dt * (this.current === 'kar98k' ? 6 : 12));
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.switchAnim = Math.max(0, this.switchAnim - dt * 5);
    // En courant, l'arme se baisse et pivote
    const sp = player.sprinting && !this.reloading ? 1 : 0;
    this.sprintAnim += (sp - this.sprintAnim) * Math.min(1, dt * 10);
    const sa = this.sprintAnim;

    const t = performance.now() / 1000;
    const a = ease(this.ads);
    const sway = 1 - a * 0.85; // presque pas de balancement en visée
    const moving = player.grounded && !player.sliding ? Math.min(player.speed / PLAYER.SPEED, 1.6) : 0.3;
    const bobX = Math.sin(player.bob) * 0.012 * moving * sway;
    const bobY = (Math.abs(Math.cos(player.bob)) * 0.012 * moving + Math.sin(t * 1.5) * 0.002) * sway;

    const m = this.models[this.current];
    if (this.isGun) {
      const w = this.weapon;
      const pose = POSES[this.current];
      // Pendant le rechargement, l'arme descend et pivote
      const rl = this.reloading ? Math.sin(Math.min(1, (w.reloadTime - this.reloadLeft) / w.reloadTime) * Math.PI) : 0;
      // Réarmement du Kar98k (seulement hors lunette)
      const bolt = this.current === 'kar98k' && this.boltAnim > 0
        ? Math.sin((1 - this.boltAnim / w.fireInterval) * Math.PI) * (1 - a) : 0;
      const px = pose.hip[0] + (pose.ads[0] - pose.hip[0]) * a;
      const py = pose.hip[1] + (pose.ads[1] - pose.hip[1]) * a;
      const pz = pose.hip[2] + (pose.ads[2] - pose.hip[2]) * a;
      m.position.set(
        px + bobX - sa * 0.04 + bolt * 0.02,
        py - bobY - rl * 0.12 - this.switchAnim * 0.3 - sa * 0.08 - bolt * 0.03,
        pz + this.kick * (this.current === 'kar98k' ? 0.12 : 0.05) + sa * 0.05,
      );
      m.rotation.set(
        this.kick * (this.current === 'kar98k' ? 0.15 : 0.06) * (1 - a * 0.6) + rl * 0.5 - sa * 0.25,
        (0.04 + sa * 0.5) * (1 - a),
        rl * 0.4 + sa * 0.25 + bolt * 0.35,
      );
      // La culasse recule pendant le réarmement
      if (m.userData.bolt) m.userData.bolt.position.z = m.userData.boltZ + bolt * 0.08;
    } else {
      const sw = Math.sin(this.swing * Math.PI);
      m.position.set(0.24 + bobX - sw * 0.2, -0.22 - bobY - this.switchAnim * 0.3 - sa * 0.06, -0.42 - sw * 0.15);
      m.rotation.set(0.5 - sw * 0.9, -0.35 + sw * 1.0, -0.25);
    }
  }
}

// ---------------------------------------------------------------------
//  Modèles low-poly construits avec des boîtes (aucun fichier 3D)
//  Chaque arme inclut les MAINS et AVANT-BRAS du joueur.
// ---------------------------------------------------------------------
const SLEEVE = 0x3a4560;   // manche de la tenue
const GLOVE = 0x23262e;    // gants
const SKIN = 0xc99a72;     // poignet

function hands() {
  // La manche prend la couleur de la tenue choisie dans le casier
  const suit = CHARACTER_SKINS[settings.skins?.character]?.suit ?? SLEEVE;
  return { sleeve: mat(suit, { map: fabricTex(), roughness: 0.95 }), glove: mat(GLOVE, { roughness: 0.85 }), skin: mat(SKIN, { roughness: 0.75 }) };
}

function muzzleFlash(g, z, size = 0.22) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  flash.position.set(0, 0.02, z);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;
}

function buildAK(skin) {
  const g = new THREE.Group();
  const { body: metal, accent: wood, dark } = skinMaterials(skin);
  const { sleeve, glove, skin: wrist } = hands();

  g.add(
    box(0.06, 0.08, 0.42, metal, 0, 0, 0),             // boîte de culasse
    box(0.055, 0.02, 0.3, dark, 0, 0.05, 0.02),        // couvercle
    box(0.05, 0.06, 0.22, wood, 0, -0.005, -0.3),      // garde-main
    box(0.045, 0.03, 0.2, wood, 0, 0.04, -0.3),        // garde-main supérieur
    box(0.025, 0.025, 0.34, metal, 0, 0.02, -0.52),    // canon
    box(0.035, 0.035, 0.05, dark, 0, 0.02, -0.7),      // cache-flamme
    box(0.015, 0.04, 0.02, dark, 0, 0.055, -0.62),     // guidon (pour viser)
    box(0.012, 0.035, 0.025, dark, -0.017, 0.065, 0.12), // hausse : deux montants avec une encoche au milieu
    box(0.012, 0.035, 0.025, dark, 0.017, 0.065, 0.12),
  );
  const stock = box(0.05, 0.075, 0.26, wood, 0, -0.03, 0.31); stock.rotation.x = 0.12;
  const grip = box(0.04, 0.1, 0.05, wood, 0, -0.08, 0.12); grip.rotation.x = -0.3;
  const magazine = box(0.04, 0.17, 0.07, dark, 0, -0.11, -0.07); magazine.rotation.x = 0.35;
  g.add(stock, grip, magazine);

  // Main droite sur la poignée + avant-bras
  const rHand = box(0.075, 0.085, 0.09, glove, 0.005, -0.1, 0.12); rHand.rotation.x = -0.3;
  g.add(rHand, box(0.08, 0.025, 0.05, glove, 0.005, -0.05, 0.06),
    limb([0.01, -0.13, 0.16], [0.04, -0.18, 0.24], 0.07, wrist),
    limb([0.04, -0.18, 0.24], [0.16, -0.34, 0.55], 0.095, sleeve));
  // Main gauche sur le garde-main
  g.add(
    box(0.075, 0.045, 0.13, glove, -0.005, -0.06, -0.31),
    box(0.03, 0.075, 0.12, glove, -0.04, -0.02, -0.31),
    box(0.022, 0.04, 0.09, glove, 0.035, -0.03, -0.3),
    limb([-0.03, -0.08, -0.27], [-0.07, -0.12, -0.2], 0.075, wrist),
    limb([-0.07, -0.12, -0.2], [-0.24, -0.42, 0.05], 0.105, sleeve));

  muzzleFlash(g, -0.75);
  return g;
}

function buildKar(skin) {
  const g = new THREE.Group();
  const { body: metal, accent: wood, dark } = skinMaterials(skin);
  const { sleeve, glove, skin: wrist } = hands();
  const scopeMat = mat(0x111216, { metalness: 0.6, roughness: 0.35 });

  g.add(
    box(0.05, 0.055, 0.3, metal, 0, 0, 0),             // boîtier
    box(0.052, 0.06, 0.62, wood, 0, -0.035, -0.28),    // fût en bois sous le canon
    box(0.045, 0.03, 0.18, wood, 0, 0.012, -0.5),      // garde-main supérieur
    cyl(0.013, 0.42, metal, 0, 0.012, -0.78),          // canon long
    cyl(0.016, 0.04, dark, 0, 0.012, -0.98),           // bouche du canon
    box(0.03, 0.04, 0.07, dark, 0, -0.07, 0.08),       // pontet / détente
  );
  const butt = box(0.058, 0.1, 0.32, wood, 0, -0.06, 0.32); butt.rotation.x = 0.16;
  const wrist2 = box(0.048, 0.06, 0.12, wood, 0, -0.04, 0.15); wrist2.rotation.x = 0.25;
  g.add(butt, wrist2);

  // Levier de culasse (il bouge pendant le réarmement)
  const bolt = new THREE.Group();
  bolt.add(box(0.06, 0.012, 0.012, metal, 0.03, 0, 0), box(0.022, 0.022, 0.022, metal, 0.065, -0.01, 0));
  bolt.position.set(0.02, 0.01, 0.07);
  g.add(bolt);
  g.userData.bolt = bolt;
  g.userData.boltZ = 0.07;

  // Lunette de sniper
  g.add(
    cyl(0.022, 0.24, scopeMat, 0, 0.077, -0.02),                 // tube
    cyl(0.032, 0.07, scopeMat, 0, 0.077, -0.17, 0.022),          // objectif (avant, plus large)
    cyl(0.027, 0.05, scopeMat, 0, 0.077, 0.12, 0.022),           // oculaire (arrière)
    box(0.02, 0.035, 0.025, dark, 0, 0.045, -0.08),              // fixation avant
    box(0.02, 0.035, 0.025, dark, 0, 0.045, 0.05),               // fixation arrière
    box(0.014, 0.02, 0.02, scopeMat, 0, 0.105, -0.02),           // molette de réglage
  );
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.6 }));
  lens.position.set(0, 0.077, -0.206); lens.rotation.y = Math.PI;
  g.add(lens);

  // Main droite sur la poignée + avant-bras
  const rHand = box(0.075, 0.085, 0.09, glove, 0.005, -0.08, 0.15); rHand.rotation.x = -0.25;
  g.add(rHand,
    limb([0.01, -0.11, 0.19], [0.04, -0.16, 0.27], 0.07, wrist),
    limb([0.04, -0.16, 0.27], [0.16, -0.34, 0.58], 0.095, sleeve));
  // Main gauche sous le fût
  g.add(
    box(0.075, 0.045, 0.13, glove, -0.005, -0.075, -0.33),
    box(0.03, 0.075, 0.12, glove, -0.04, -0.035, -0.33),
    box(0.022, 0.04, 0.09, glove, 0.035, -0.045, -0.32),
    limb([-0.03, -0.095, -0.29], [-0.07, -0.135, -0.22], 0.075, wrist),
    limb([-0.07, -0.135, -0.22], [-0.24, -0.43, 0.04], 0.105, sleeve));

  muzzleFlash(g, -1.02, 0.28);
  return g;
}

function buildKnife(skin, skinId) {
  const g = new THREE.Group();
  const { glove, sleeve, skin: wrist } = hands();
  const { body, accent } = skinMaterials(skin);
  // Lame en acier pour le skin standard, sinon couleur du skin
  const blade = !skinId || skinId === 'default' ? mat(0xd8dee9, { metalness: 0.9, roughness: 0.2 }) : body;
  g.add(
    box(0.03, 0.035, 0.12, accent, 0, 0, 0.05),            // manche
    box(0.05, 0.05, 0.015, mat(0x444a55), 0, 0, -0.015),   // garde
    box(0.008, 0.04, 0.2, blade, 0, 0.005, -0.12),         // lame
    box(0.006, 0.02, 0.06, blade, 0, 0.012, -0.25),        // pointe
    box(0.07, 0.08, 0.1, glove, 0.005, -0.005, 0.06),      // main
    limb([0.005, -0.02, 0.1], [0.02, -0.05, 0.17], 0.065, wrist),
    limb([0.02, -0.05, 0.17], [0.08, -0.15, 0.48], 0.095, sleeve),
  );
  return g;
}
