// =====================================================================
//  weapons.js — Armes du joueur local, vues à la première personne :
//  modèles 3D avec mains et doigts, viseurs (mire, point rouge, lunettes),
//  tir, visée, recul, rechargement animé, inspection (touche Y),
//  sortie du couteau, skins.
// =====================================================================
import * as THREE from 'three';
import { WEAPONS, PLAYER, OPTICS, validOptic } from '/shared/constants.js';
import { WEAPON_SKINS, CHARACTER_SKINS } from '/shared/skins.js';
import { dirFromAngles } from '/shared/physics.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { mat, box, cyl, capsule, makeHand, orientHand, skinMaterials } from './models.js';
import { fabricTex } from './textures.js';

// Position de l'arme à l'écran sans viser (hip) + distance en visée (adsZ)
const POSES = {
  ak:     { hip: [0.17, -0.17, -0.62], adsZ: { iron: -0.52, reddot: -0.44, mid: -0.38 } },
  kar98k: { hip: [0.19, -0.2, -0.7],   adsZ: { iron: -0.68, reddot: -0.56, mid: -0.5, scope: -0.3 } },
};
const INSPECT_TIME = { ak: 3.2, kar98k: 3.4, knife: 2.6 };

const ease = (t) => t * t * (3 - 2 * t);

/**
 * Animation par "images clés" : keys = [[t, {valeurs}], ...] avec t de 0 à 1.
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
//  Images clés des animations (valeurs = décalages par rapport au repos)
//  px/py/pz = position, rx/ry/rz = rotation de l'arme
//  mag* = chargeur, h* = main gauche, bolt = ouverture de la culasse (0..1)
// ---------------------------------------------------------------------
const ANIMS = {
  akReload: [
    [0, {}],
    [0.12, { rz: 0.45, rx: 0.1, py: -0.03, px: -0.02, hy: -0.06, hz: 0.24 }],                 // on penche l'arme, la main va au chargeur
    [0.18, { rz: 0.45, rx: 0.1, py: -0.03, px: -0.02, hy: -0.08, hz: 0.24 }],
    [0.32, { rz: 0.45, rx: 0.1, py: -0.03, px: -0.02, magY: -0.4, magR: 0.5, hy: -0.48, hz: 0.24 }], // on retire le chargeur
    [0.45, { rz: 0.45, rx: 0.1, py: -0.03, px: -0.02, magY: -0.4, magR: 0.5, hy: -0.48, hz: 0.24 }],
    [0.6, { rz: 0.45, rx: 0.1, py: -0.03, px: -0.02, magY: -0.05, magR: 0.1, hy: -0.13, hz: 0.24 }], // nouveau chargeur
    [0.66, { rz: 0.42, rx: 0.08, py: -0.025, px: -0.02, hy: -0.08, hz: 0.24 }],                  // clac !
    [0.74, { rz: 0.3, rx: 0.05, py: -0.02, hx: 0.08, hy: 0.06, hz: 0.33 }],                      // main sur le levier d'armement
    [0.8, { rz: 0.28, rx: 0.06, py: -0.02, pz: 0.025, hx: 0.08, hy: 0.06, hz: 0.45 }],          // on tire le levier
    [0.86, { rz: 0.25, rx: 0.04, py: -0.015, hx: 0.08, hy: 0.06, hz: 0.33 }],
    [1, {}],
  ],
  karReload: [
    [0, {}],
    [0.1, { rz: -0.32, rx: 0.12, py: -0.02, bolt: 1 }],                                          // on ouvre la culasse
    [0.18, { rz: -0.32, rx: 0.12, py: -0.02, bolt: 1, hx: 0.02, hy: 0.12, hz: 0.33 }],          // la main va au-dessus
    // on pousse 5 cartouches une par une
    ...[0, 1, 2, 3, 4].flatMap(i => [
      [0.24 + i * 0.11, { rz: -0.32, rx: 0.12, py: -0.02, bolt: 1, hx: 0.02, hy: 0.06, hz: 0.33 }],
      [0.29 + i * 0.11, { rz: -0.32, rx: 0.12, py: -0.025, bolt: 1, hx: 0.02, hy: 0.12, hz: 0.33 }],
    ]),
    [0.84, { rz: -0.3, rx: 0.1, py: -0.02, bolt: 1 }],
    [0.92, { rz: -0.2, rx: 0.05, py: -0.01, bolt: 0 }],                                          // on referme
    [1, {}],
  ],
  akInspect: [
    [0, {}],
    [0.18, { px: -0.13, py: 0.05, pz: 0.12, ry: -0.95, rz: 0.35 }],        // on regarde le côté de l'arme
    [0.42, { px: -0.13, py: 0.05, pz: 0.12, ry: -1.05, rz: 0.3 }],
    [0.56, { px: -0.09, py: 0.07, pz: 0.1, ry: -0.25, rz: -0.55, rx: 0.35, hy: -0.06, hz: 0.24 }], // on tourne pour voir le chargeur
    [0.64, { px: -0.09, py: 0.07, pz: 0.1, ry: -0.25, rz: -0.55, rx: 0.35, magY: -0.06, hy: -0.12, hz: 0.24 }],
    [0.76, { px: -0.09, py: 0.07, pz: 0.1, ry: -0.25, rz: -0.55, rx: 0.35, magY: -0.06, hy: -0.12, hz: 0.24 }],
    [0.82, { px: -0.06, py: 0.04, pz: 0.06, ry: -0.15, rz: -0.35, rx: 0.2, hy: -0.06, hz: 0.24 }],
    [1, {}],
  ],
  karInspect: [
    [0, {}],
    [0.2, { px: -0.14, py: 0.05, pz: 0.15, ry: -1.0, rz: 0.3 }],
    [0.4, { px: -0.14, py: 0.05, pz: 0.15, ry: -1.1, rz: 0.25 }],
    [0.52, { px: -0.06, py: 0.06, pz: 0.12, ry: 0.35, rz: -0.4, rx: 0.2 }],
    [0.6, { px: -0.06, py: 0.06, pz: 0.12, ry: 0.35, rz: -0.4, rx: 0.2, bolt: 1 }],        // on ouvre la culasse pour regarder
    [0.78, { px: -0.06, py: 0.06, pz: 0.12, ry: 0.35, rz: -0.4, rx: 0.2, bolt: 1 }],
    [0.86, { px: -0.03, py: 0.03, pz: 0.06, ry: 0.15, rz: -0.2, rx: 0.1, bolt: 0 }],
    [1, {}],
  ],
  knifeInspect: [
    [0, {}],
    [0.2, { px: -0.12, py: 0.06, pz: 0.08, ry: -1.1, rz: 0.7 }],
    [0.42, { px: -0.12, py: 0.06, pz: 0.08, ry: -1.1, rz: 0.7 }],
    [0.62, { px: -0.12, py: 0.06, pz: 0.08, ry: -1.1, rz: 0.7 + Math.PI }], // on fait tourner la lame
    [0.82, { px: -0.12, py: 0.06, pz: 0.08, ry: -1.1, rz: 0.7 + Math.PI }],
    [1, { rz: Math.PI * 2 }],
  ],
};

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
    this.optic = 'iron';
    this.reset(settings.loadouts?.[settings.activeLoadout]);
  }

  /** (Re)construit les modèles avec les skins + le viseur choisis */
  rebuild() {
    for (const m of Object.values(this.models)) this.root.remove(m);
    const skins = settings.skins;
    const sk = (w) => WEAPON_SKINS[skins?.[w]] || WEAPON_SKINS.default;
    this.models = {
      ak: buildAK(sk('ak'), this.primary === 'ak' ? this.optic : 'iron'),
      kar98k: buildKar(sk('kar98k'), this.primary === 'kar98k' ? this.optic : 'iron'),
      knife: buildKnife(sk('knife'), skins?.knife),
    };
    for (const m of Object.values(this.models)) this.root.add(m);
    this.showModel();
  }
  applySkins() { this.rebuild(); }

  /** Remise à zéro au début de chaque manche / réapparition. loadout = { primary, optic } */
  reset(loadout) {
    if (loadout) {
      this.primary = WEAPONS[loadout.primary] ? loadout.primary : 'ak';
      this.optic = validOptic(this.primary, loadout.optic);
    }
    this.current = this.primary;
    const w = WEAPONS[this.primary];
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
    this.knifeSpin = 0;     // le couteau tourne quand on le sort
    this.sprintAnim = 0;    // arme baissée quand on court
    this.boltAnim = 0;      // réarmement du Kar98k après un tir
    this.inspectT = -1;     // inspection en cours (-1 = non)
    this.ads = 0;           // 0 = hanche, 1 = en visée
    this.overlay = null;    // lunette affichée en plein écran ('mid' / 'scope')
    this.lastSpread = 0;
    this.rebuild();
  }

  get isGun() { return this.current !== 'knife'; }
  get weapon() { return WEAPONS[this.current]; }
  get reloading() { return this.reloadLeft > 0; }
  get scoped() { return !!this.overlay; }
  get currentOptic() { return this.isGun ? (this.current === this.primary ? this.optic : 'iron') : null; }

  showModel() {
    if (!this.current || !this.models[this.current]) return;
    for (const [k, m] of Object.entries(this.models)) m.visible = k === this.current && !this.overlay;
    for (const m of Object.values(this.models)) if (m.userData.flash) m.userData.flash.visible = false;
  }

  setVisible(v) { this.root.visible = v; }

  switchTo(w, session) {
    if (w === this.current) return;
    this.current = w;
    this.reloadLeft = 0;       // changer d'arme annule le rechargement
    this.inspectT = -1;
    this.cooldown = w === 'knife' ? 0.45 : 0.3;
    this.switchAnim = 1;
    if (w === 'knife') this.knifeSpin = 1; // petite rotation du couteau quand on le sort
    this.ads = 0;
    this.overlay = null;
    this.showModel();
    sfx.switchWeapon();
    session.switchWeapon(w);
  }

  startReload(session) {
    const w = WEAPONS[this.current];
    if (!this.isGun || this.reloading || this.mag >= w.magSize || this.reserve <= 0) return;
    this.reloadLeft = w.reloadTime;
    this.inspectT = -1;
    sfx.reload();
    session.reload();
  }

  /**
   * Dispersion actuelle (en radians).
   * Sans viser : imprécis (+ mouvement, saut, rafale).
   * En visant : précis, même en bougeant ou en sautant.
   */
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

  /** Appelé à chaque image. canFire = false pendant la préparation de manche ou mort. */
  update(dt, input, player, session, canFire) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    this.boltAnim = Math.max(0, this.boltAnim - dt);
    this.knifeSpin = Math.max(0, this.knifeSpin - dt * 2.2);

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

    // --- Inspection (touche Y) ---
    if (input.was('inspect') && this.inspectT < 0 && !this.reloading && this.switchAnim <= 0) this.inspectT = 0;
    if (this.inspectT >= 0) {
      this.inspectT += dt / INSPECT_TIME[this.current];
      // Annulée si on tire, vise, court ou recharge
      if (this.inspectT >= 1 || input.mouseDown || input.mouseRight || player.sprinting || this.reloading) this.inspectT = -1;
    }

    // --- Visée (clic droit) ---
    const wantAds = input.mouseRight && this.isGun && !this.reloading && !player.sprinting && player.alive;
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
    this.inspectT = -1;

    // Direction = regard + dispersion aléatoire (répartie dans un disque)
    const s = this.spread(player);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
    const dir = dirFromAngles(player.yaw + Math.cos(a) * r, player.pitch + Math.sin(a) * r);
    const eye = player.eye();
    const res = session.fire(eye, dir, this.current);

    // Effets : traçante depuis le canon, impact sur le mur
    const end = { x: eye.x + dir.x * res.dist, y: eye.y + dir.y * res.dist, z: eye.z + dir.z * res.dist };
    const from = this.overlay ? { x: eye.x + dir.x * 0.5, y: eye.y - 0.15, z: eye.z + dir.z * 0.5 } : this.muzzleWorld();
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
    if (flash && !this.overlay) {
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
    this.inspectT = -1;
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

  /** Animations de l'arme en main */
  animate(dt, player) {
    this.kick = Math.max(0, this.kick - dt * (this.current === 'kar98k' ? 6 : 12));
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.switchAnim = Math.max(0, this.switchAnim - dt * 4);
    const sp = player.sprinting && !this.reloading ? 1 : 0;
    this.sprintAnim += (sp - this.sprintAnim) * Math.min(1, dt * 10);
    const sa = this.sprintAnim;

    const t = performance.now() / 1000;
    const a = ease(this.ads);
    const sway = 1 - a * 0.9; // presque pas de balancement en visée
    const moving = player.grounded && !player.sliding ? Math.min(player.speed / PLAYER.SPEED, 1.6) : 0.3;
    const bobX = Math.sin(player.bob) * 0.012 * moving * sway;
    const bobY = (Math.abs(Math.cos(player.bob)) * 0.012 * moving + Math.sin(t * 1.5) * 0.002) * sway;

    const m = this.models[this.current];
    const ud = m.userData;
    const inspect = this.inspectT >= 0 ? this.inspectT : null;

    if (this.isGun) {
      const w = this.weapon;
      const pose = POSES[this.current];
      // Animation en cours : rechargement > inspection
      let k = {};
      if (this.reloading) k = track(1 - this.reloadLeft / w.reloadTime, this.current === 'ak' ? ANIMS.akReload : ANIMS.karReload);
      else if (inspect !== null) k = track(inspect, this.current === 'ak' ? ANIMS.akInspect : ANIMS.karInspect);
      // Réarmement du Kar98k après un tir (hors visée)
      const bolt = this.current === 'kar98k' && this.boltAnim > 0 ? Math.sin((1 - this.boltAnim / w.fireInterval) * Math.PI) : 0;

      const adsY = -ud.sightY, adsZ = pose.adsZ[this.currentOptic] ?? pose.adsZ.iron;
      const px = pose.hip[0] * (1 - a);
      const py = pose.hip[1] + (adsY - pose.hip[1]) * a;
      const pz = pose.hip[2] + (adsZ - pose.hip[2]) * a;
      const draw = ease(this.switchAnim);
      m.position.set(
        px + bobX - sa * 0.04 + (k.px || 0) + bolt * 0.02 * (1 - a),
        py - bobY - draw * 0.25 - sa * 0.08 + (k.py || 0) - bolt * 0.03 * (1 - a),
        pz + this.kick * (this.current === 'kar98k' ? 0.12 : 0.05) * (1 - a * 0.5) + sa * 0.05 + (k.pz || 0),
      );
      m.rotation.set(
        this.kick * (this.current === 'kar98k' ? 0.15 : 0.06) * (1 - a * 0.6) - sa * 0.25 + (k.rx || 0) - draw * 0.4,
        (0.04 + sa * 0.5) * (1 - a) + (k.ry || 0),
        sa * 0.25 + (k.rz || 0) + bolt * 0.3 * (1 - a) + draw * 0.3,
      );
      // Chargeur (AK)
      if (ud.mag) {
        ud.mag.position.set(ud.magHome.x, ud.magHome.y + (k.magY || 0), ud.magHome.z);
        ud.mag.rotation.x = ud.magHomeRx + (k.magR || 0);
      }
      // Main gauche
      if (ud.leftHand) ud.leftHand.position.set(ud.leftHome.x + (k.hx || 0), ud.leftHome.y + (k.hy || 0), ud.leftHome.z + (k.hz || 0));
      // Culasse (Kar98k) : levier relevé puis tiré en arrière
      if (ud.bolt) {
        const open = Math.max(k.bolt || 0, bolt * (1 - a));
        ud.bolt.rotation.z = open * 1.3;
        ud.bolt.position.z = ud.boltZ + open * 0.08;
      }
    } else {
      // Couteau : coup, rotation à la sortie, inspection
      const sw = Math.sin(this.swing * Math.PI);
      const k = inspect !== null ? track(inspect, ANIMS.knifeInspect) : {};
      const spin = ease(this.knifeSpin);
      m.position.set(0.22 + bobX - sw * 0.2 + (k.px || 0), -0.16 - bobY - this.switchAnim * 0.2 - sa * 0.06 + (k.py || 0) + spin * 0.04, -0.46 - sw * 0.15 + (k.pz || 0));
      m.rotation.set(0.5 - sw * 0.9 + (k.rx || 0) + spin * Math.PI * 2, -0.35 + sw * 1.0 + (k.ry || 0), -0.25 + (k.rz || 0));
    }
  }
}

// ---------------------------------------------------------------------
//  Modèles low-poly (aucun fichier 3D). Chaque arme inclut les mains
//  (avec doigts) et les avant-bras du joueur.
// ---------------------------------------------------------------------
const GLOVE = 0x5d4f40; // gants tactiques couleur sable
const SKIN = 0xc99a72;

function armMaterials() {
  // La manche prend la couleur de la tenue choisie dans le casier
  const suit = CHARACTER_SKINS[settings.skins?.character]?.suit ?? 0x3a4560;
  return {
    sleeve: mat(suit, { map: fabricTex(), roughness: 0.95 }),
    glove: mat(GLOVE, { roughness: 0.75 }),
    skin: mat(SKIN, { roughness: 0.7 }),
    cuff: mat(0x1d1b19, { roughness: 0.8 }),
  };
}

/** Main droite sur une poignée verticale (paume sur la droite, doigts autour) */
function rightGripHand(g, M, pos, forearmEnd, { trigger = true } = {}) {
  const hand = makeHand(M.glove, { curl: [-1.35, -1.25], indexCurl: trigger ? [-0.35, -0.9] : null, thumbCurl: -0.6 });
  hand.scale.x = -1; // main droite = main gauche en miroir
  orientHand(hand, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  hand.position.set(...pos);
  g.add(hand);
  const wrist = [pos[0] + 0.02, pos[1] - 0.03, pos[2] + 0.08];
  g.add(capsule([pos[0], pos[1] - 0.01, pos[2] + 0.02], wrist, 0.034, M.glove)); // poignet (gant)
  g.add(capsule(wrist, forearmEnd, 0.05, M.sleeve));                               // avant-bras (manche)
}

/** Main gauche sous le garde-main (groupe animable : main + avant-bras) */
function leftSupportHand(g, M, pos, forearmEnd) {
  const group = new THREE.Group();
  group.position.set(...pos);
  const hand = makeHand(M.glove, { curl: [-1.25, -1.0], thumbCurl: -0.3 });
  orientHand(hand, [0, 0, -1], [0, -1, 0], [-1, 0, 0]); // paume vers le haut, doigts vers la droite
  hand.position.set(-0.012, 0, 0);
  group.add(hand);
  const rel = (p) => [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const wrist = [-0.07, -0.05, 0.05];
  group.add(capsule([-0.025, -0.012, 0.005], wrist, 0.034, M.glove)); // poignet (gant)
  group.add(capsule(wrist, rel(forearmEnd), 0.052, M.sleeve));        // avant-bras (manche)
  g.add(group);
  g.userData.leftHand = group;
  g.userData.leftHome = group.position.clone();
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

/**
 * Ajoute un viseur sur le rail (mountY = hauteur du rail, z = position).
 * Retourne la hauteur du centre de visée.
 */
function addOptic(g, optic, mountY, z) {
  const body = mat(0x1b1d22, { metalness: 0.55, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.18, metalness: 0.9, roughness: 0.05, depthWrite: false });
  if (optic === 'reddot') {
    const c = mountY + 0.042;
    g.add(
      box(0.034, 0.012, 0.07, body, 0, mountY + 0.006, z),          // base
      box(0.007, 0.05, 0.016, body, -0.022, c, z - 0.02),          // montant gauche
      box(0.007, 0.05, 0.016, body, 0.022, c, z - 0.02),           // montant droit
      box(0.05, 0.008, 0.016, body, 0, c + 0.028, z - 0.02),       // toit
      box(0.012, 0.016, 0.02, body, 0.012, mountY + 0.018, z + 0.02), // bouton de réglage
    );
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.046), glass);
    lens.position.set(0, c, z - 0.02);
    g.add(lens);
    return c;
  }
  if (optic === 'mid') {
    const c = mountY + 0.038;
    g.add(
      box(0.03, 0.02, 0.1, body, 0, mountY + 0.01, z),
      cyl(0.019, 0.14, body, 0, c, z),
      cyl(0.026, 0.05, body, 0, c, z - 0.09, 0.019),
      cyl(0.022, 0.03, body, 0, c, z + 0.08, 0.019),
      box(0.012, 0.016, 0.018, body, 0, c + 0.024, z),
    );
    return c;
  }
  if (optic === 'scope') {
    const c = mountY + 0.05;
    g.add(
      box(0.02, 0.035, 0.025, body, 0, mountY + 0.018, z - 0.06),
      box(0.02, 0.035, 0.025, body, 0, mountY + 0.018, z + 0.07),
      cyl(0.022, 0.24, body, 0, c, z),
      cyl(0.032, 0.07, body, 0, c, z - 0.15, 0.022),
      cyl(0.027, 0.05, body, 0, c, z + 0.14, 0.022),
      box(0.014, 0.02, 0.02, body, 0, c + 0.028, z),
    );
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.6 }));
    lens.position.set(0, c, z - 0.186); lens.rotation.y = Math.PI;
    g.add(lens);
    return c;
  }
  return null;
}

function buildAK(skin, optic) {
  const g = new THREE.Group();
  const { body: metal, accent: wood, dark } = skinMaterials(skin);
  const M = armMaterials();

  g.add(
    box(0.06, 0.08, 0.42, metal, 0, 0, 0),             // boîte de culasse
    box(0.055, 0.02, 0.3, dark, 0, 0.05, 0.02),        // couvercle (+ rail)
    box(0.05, 0.06, 0.22, wood, 0, -0.005, -0.3),      // garde-main
    box(0.045, 0.03, 0.2, wood, 0, 0.04, -0.3),        // garde-main supérieur
    box(0.025, 0.025, 0.34, metal, 0, 0.02, -0.52),    // canon
    box(0.035, 0.035, 0.05, dark, 0, 0.02, -0.7),      // cache-flamme
    box(0.015, 0.04, 0.02, dark, 0, 0.055, -0.62),     // guidon
    box(0.012, 0.035, 0.025, dark, -0.017, 0.065, 0.12), // hausse : deux montants avec une encoche
    box(0.012, 0.035, 0.025, dark, 0.017, 0.065, 0.12),
    box(0.02, 0.012, 0.03, dark, 0.035, 0.03, -0.02),  // levier d'armement (côté droit)
    box(0.03, 0.04, 0.07, dark, 0, -0.065, 0.06),      // pontet
  );
  const stock = box(0.05, 0.075, 0.26, wood, 0, -0.03, 0.31); stock.rotation.x = 0.12;
  const grip = box(0.04, 0.1, 0.05, wood, 0, -0.085, 0.13); grip.rotation.x = -0.3;
  g.add(stock, grip);

  // Chargeur incurvé (séparé pour l'animation de rechargement)
  const mag = new THREE.Group();
  const m1 = box(0.04, 0.1, 0.07, dark, 0, -0.04, 0); m1.rotation.x = 0.15;
  const m2 = box(0.038, 0.09, 0.065, dark, 0, -0.12, -0.025); m2.rotation.x = 0.45;
  mag.add(m1, m2);
  mag.position.set(0, -0.04, -0.07);
  g.add(mag);
  g.userData.mag = mag; g.userData.magHome = mag.position.clone(); g.userData.magHomeRx = 0;

  // Viseur
  g.userData.sightY = addOptic(g, optic, 0.06, 0.02) ?? 0.084;

  rightGripHand(g, M, [0.034, -0.098, 0.13], [0.17, -0.36, 0.58]);
  leftSupportHand(g, M, [0, -0.06, -0.3], [-0.26, -0.44, 0.08]);
  muzzleFlash(g, -0.75);
  return g;
}

function buildKar(skin, optic) {
  const g = new THREE.Group();
  const { body: metal, accent: wood, dark } = skinMaterials(skin);
  const M = armMaterials();

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

  // Levier de culasse (bouge pendant le réarmement / rechargement)
  const bolt = new THREE.Group();
  bolt.add(box(0.06, 0.012, 0.012, metal, 0.03, 0, 0), box(0.022, 0.022, 0.022, metal, 0.065, -0.01, 0));
  bolt.position.set(0.02, 0.01, 0.07);
  g.add(bolt);
  g.userData.bolt = bolt;
  g.userData.boltZ = 0.07;

  // Organes de visée d'origine (mire) : hausse sur le boîtier + guidon au bout du canon
  if (optic === 'iron') {
    g.add(
      box(0.01, 0.025, 0.02, dark, -0.012, 0.04, -0.12), box(0.01, 0.025, 0.02, dark, 0.012, 0.04, -0.12),
      box(0.03, 0.01, 0.03, dark, 0, 0.031, -0.12),
      box(0.008, 0.03, 0.012, dark, 0, 0.038, -0.96), box(0.03, 0.012, 0.02, dark, 0, 0.026, -0.96),
    );
  }
  g.userData.sightY = addOptic(g, optic, 0.0275, -0.02) ?? 0.049;

  rightGripHand(g, M, [0.032, -0.058, 0.155], [0.17, -0.36, 0.6]);
  leftSupportHand(g, M, [0, -0.075, -0.33], [-0.26, -0.45, 0.04]);
  muzzleFlash(g, -1.02, 0.28);
  return g;
}

function buildKnife(skin, skinId) {
  const g = new THREE.Group();
  const M = armMaterials();
  const { body, accent } = skinMaterials(skin);
  // Lame en acier pour le skin standard, sinon couleur du skin
  const blade = !skinId || skinId === 'default' ? mat(0xd8dee9, { metalness: 0.9, roughness: 0.2 }) : body;
  g.add(
    box(0.03, 0.035, 0.12, accent, 0, 0, 0.05),            // manche
    box(0.05, 0.05, 0.015, mat(0x444a55), 0, 0, -0.015),   // garde
    box(0.008, 0.04, 0.2, blade, 0, 0.005, -0.12),         // lame
    box(0.006, 0.02, 0.06, blade, 0, 0.012, -0.25),        // pointe
  );
  // Main qui serre le manche
  const hand = makeHand(M.glove, { curl: [-1.4, -1.3], thumbCurl: -0.2 });
  hand.scale.x = -1;
  orientHand(hand, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  hand.position.set(0.03, 0.035, 0.06);
  g.add(hand);
  g.add(capsule([0.02, 0, 0.1], [0.04, -0.04, 0.19], 0.034, M.glove));
  g.add(capsule([0.04, -0.04, 0.19], [0.1, -0.16, 0.5], 0.05, M.sleeve));
  return g;
}
