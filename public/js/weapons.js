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
import { WEAPONS, PLAYER, OPTICS, validOptic, reloadPlan, roundsInserted } from '/shared/constants.js';
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
};
const INSPECT_TIME = { ak: 3.0, kar98k: 3.6, knife: 2.8 };

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

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
  // C4 : couteau papillon (rotations rapides de la lame dans la main)
  knifeInspect: {
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
  // D1 : sortie du couteau → lancé en l'air en tournant, puis rattrapé
  knifeDraw: {
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
const DRAW_TIME = { knifeDraw: 0.75, akRack: 1.0, karRack: 1.0 };

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
    this.spectating = false;
    this.reset(settings.loadouts?.[settings.activeLoadout]);
  }

  /** (Re)construit les modèles avec les skins + le viseur choisis */
  rebuild(skins = settings.skins) {
    for (const m of Object.values(this.models)) this.root.remove(m);
    const sk = (w) => WEAPON_SKINS[skins?.[w]] || WEAPON_SKINS.default;
    this.models = {
      ak: buildAK(sk('ak'), this.primary === 'ak' ? this.optic : 'iron', skins),
      kar98k: buildKar(sk('kar98k'), this.primary === 'kar98k' ? this.optic : 'iron', skins),
      knife: buildKnife(sk('knife'), skins?.knife, skins),
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
    }
    this.current = this.primary;
    const w = WEAPONS[this.primary];
    this.mag = w.magSize;
    this.reserve = w.reserve;
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
  get weapon() { return WEAPONS[this.current]; }
  get reloading() { return !!this.reload; }
  get scoped() { return !!this.overlay; }
  get currentOptic() { return this.isGun ? (this.current === this.primary ? this.optic : 'iron') : null; }
  get busy() { return !!this.draw && this.draw.name !== 'knifeDraw' ? true : false; }

  showModel() {
    if (!this.current || !this.models[this.current]) return;
    for (const [k, m] of Object.entries(this.models)) m.visible = k === this.current && !this.overlay;
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
    this.draw = { name: w === 'knife' ? 'knifeDraw' : 'switch', t: 0, fired: 0 };
    this.showModel();
    if (w !== 'knife') sfx.switchWeapon();
    session.switchWeapon(w);
  }

  startReload(session) {
    const w = WEAPONS[this.current];
    if (!this.isGun || this.reload || this.mag >= w.magSize || this.reserve <= 0) return;
    const plan = reloadPlan(this.current, this.mag, this.reserve);
    const anim = this.current === 'kar98k' ? 'kar' : plan.empty ? 'akEmpty' : 'akTactical';
    this.reload = { t: 0, total: plan.time, plan, anim, fired: 0, roundsDone: 0 };
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
    if (input.was('weapon2')) this.switchTo('knife', session);
    const wheel = input.consumeWheel();
    if (wheel !== 0) this.switchTo(this.current === 'knife' ? this.primary : 'knife', session);

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
      else this.fireEvents(r, ANIMS[r.anim].events, r.t / r.total);
      // Kar98k : un clic interrompt le rechargement (on garde les balles déjà mises)
      if (r.anim === 'kar' && input.mouseClicked && (this.mag + roundsInserted('kar98k', r.t, r.plan.rounds)) > 0) {
        this.cancelReload(session);
      } else if (r.t >= r.total) {
        this.mag += r.plan.rounds; this.reserve -= r.plan.rounds;
        this.reload = null;
      }
    }

    // --- Inspection (touche Y) ---
    if (input.was('inspect') && !this.inspect && !this.reload && !this.draw) { this.inspect = { t: 0, fired: 0 }; }
    if (this.inspect) {
      this.inspect.t += dt / INSPECT_TIME[this.current];
      const anim = ANIMS[this.current === 'ak' ? 'akInspect' : this.current === 'kar98k' ? 'karInspect' : 'knifeInspect'];
      this.fireEvents(this.inspect, anim.events, this.inspect.t);
      // Annulée si on tire, vise, court ou recharge
      if (this.inspect.t >= 1 || input.mouseDown || input.mouseRight || player.sprinting || this.reload) this.inspect = null;
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
    const ev = [[0.05, 'boltUp'], [0.22, 'boltBack']];
    for (let i = 0; i < r.plan.rounds; i++) ev.push([w.reloadOpen + i * w.reloadPerRound + w.reloadPerRound * 0.55, 'roundIn']);
    const close = w.reloadOpen + r.plan.rounds * w.reloadPerRound;
    ev.push([close + 0.05, 'boltForward'], [close + 0.25, 'boltDown']);
    this.fireEvents(r, ev, r.t);
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
    const end = { x: eye.x + dir.x * res.dist, y: eye.y + dir.y * res.dist, z: eye.z + dir.z * res.dist };
    const from = this.overlay ? { x: eye.x + dir.x * 0.5, y: eye.y - 0.15, z: eye.z + dir.z * 0.5 } : this.muzzleWorld();
    this.effects.tracer(from, end);
    if (res.hitWall) this.effects.impact(end);
    if (res.hitPlayer && res.confirmed) this.effects.blood(end);

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
    if (this.current === 'kar98k') { sfx.sniper(); this.boltAnim = w.fireInterval; setTimeout(() => sfx.bolt(), 420); }
    else sfx.shot();
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
    const k = { ...TILT, rz: -0.34, rx: 0.14 };
    // ouverture puis fermeture de la culasse
    k.bolt = t < close ? clamp01(t / 0.35) : 1 - clamp01((t - close) / 0.3);
    // la main gauche va au-dessus de l'arme et pousse chaque balle
    const handIn = clamp01((t - 0.2) / 0.2) * (1 - clamp01((t - close) / 0.25));
    let dip = 0;
    if (t > w.reloadOpen && t < close) {
      const phase = ((t - w.reloadOpen) % w.reloadPerRound) / w.reloadPerRound;
      dip = Math.sin(phase * Math.PI);
    }
    k.hx = 0.02 * handIn; k.hy = (0.13 - dip * 0.06) * handIn; k.hz = 0.33 * handIn;
    // retour en douceur à la fin
    const out = clamp01((t - (r.total - 0.25)) / 0.25);
    for (const key of ['rz', 'rx', 'py', 'px']) k[key] *= 1 - out;
    const inn = clamp01(t / 0.15);
    for (const key of ['rz', 'rx', 'py', 'px']) k[key] *= inn;
    return k;
  }

  /** Animations de l'arme en main */
  animate(dt, player) {
    this.kick = Math.max(0, this.kick - dt * (this.current === 'kar98k' ? 6 : 12));
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.landing = Math.max(0, this.landing - dt * 3);
    const sp = player.sprinting && !this.reload ? 1 : 0;
    this.sprintAnim += (sp - this.sprintAnim) * Math.min(1, dt * 9);
    this.slideAnim += ((player.sliding ? 1 : 0) - this.slideAnim) * Math.min(1, dt * 10);
    const sa = this.sprintAnim, sl = this.slideAnim;

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

    const m = this.models[this.current];
    const ud = m.userData;

    if (this.isGun) {
      const w = this.weapon;
      const pose = POSES[this.current];
      // Animation en cours : sortie > rechargement > inspection
      let k = {};
      let drawLower = 0;
      if (this.draw && ANIMS[this.draw.name]) k = track(clamp01(this.draw.t), ANIMS[this.draw.name].keys);
      else if (this.draw) drawLower = 1 - ease(clamp01(this.draw.t)); // simple changement d'arme
      else if (this.reload) k = this.reload.anim === 'kar' ? this.karReloadPose(this.reload) : track(this.reload.t / this.reload.total, ANIMS[this.reload.anim].keys);
      else if (this.inspect) k = track(this.inspect.t, this.current === 'ak' ? ANIMS.akInspect.keys : ANIMS.karInspect.keys);
      // Réarmement du Kar98k après un tir (hors visée)
      const bolt = this.current === 'kar98k' && this.boltAnim > 0 ? Math.sin((1 - this.boltAnim / w.fireInterval) * Math.PI) : 0;

      const adsY = -ud.sightY, adsZ = pose.adsZ[this.currentOptic] ?? pose.adsZ.iron;
      const px = pose.hip[0] * (1 - a);
      const py = pose.hip[1] + (adsY - pose.hip[1]) * a;
      const pz = pose.hip[2] + (adsZ - pose.hip[2]) * a;
      m.position.set(
        px + bobX - sw.x - sa * 0.07 + (k.px || 0) + bolt * 0.02 * (1 - a),
        py - bobY + sw.y - land - drawLower * 0.25 - sa * 0.06 - sl * 0.03 + (k.py || 0) - bolt * 0.03 * (1 - a),
        pz + this.kick * (this.current === 'kar98k' ? 0.12 : 0.05) * (1 - a * 0.5) + sa * 0.06 + (k.pz || 0),
      );
      // Course (E4) : arme tenue en diagonale · Glissade (E5) : arme penchée
      m.rotation.set(
        this.kick * (this.current === 'kar98k' ? 0.15 : 0.06) * (1 - a * 0.6) - sa * 0.22 + (k.rx || 0) - drawLower * 0.4 + sw.y * 2 + land * 1.5,
        (0.04 + sa * 0.95) * (1 - a) + (k.ry || 0) + sw.x * 2,
        sa * 0.55 - sl * 0.4 + (k.rz || 0) + bolt * 0.3 * (1 - a) + drawLower * 0.3,
      );
      // Chargeur (AK)
      if (ud.mag) {
        ud.mag.position.set(ud.magHome.x, ud.magHome.y + (k.magY || 0), ud.magHome.z);
        ud.mag.rotation.x = k.magR || 0;
      }
      // Levier d'armement (AK)
      if (ud.charge) ud.charge.position.z = ud.chargeZ + (k.ch || 0) * 0.1;
      // Main gauche
      if (ud.leftHand) ud.leftHand.position.set(ud.leftHome.x + (k.hx || 0), ud.leftHome.y + (k.hy || 0), ud.leftHome.z + (k.hz || 0));
      // Culasse (Kar98k) : levier relevé puis tiré en arrière
      if (ud.bolt) {
        const open = Math.max(k.bolt || 0, bolt * (1 - a));
        const up = Math.min(1, open * 2), back = Math.max(0, open * 2 - 1);
        ud.bolt.rotation.z = up * 1.35;
        ud.bolt.position.z = ud.boltZ + back * 0.09;
      }
    } else {
      // Couteau : coup, lancé à la sortie (D1), papillon à l'inspection (C4)
      const swg = Math.sin(this.swing * Math.PI);
      let k = {};
      if (this.draw?.name === 'knifeDraw') k = track(clamp01(this.draw.t), ANIMS.knifeDraw.keys);
      else if (this.inspect) k = track(this.inspect.t, ANIMS.knifeInspect.keys);
      m.position.set(0.22 + bobX - sw.x - swg * 0.2 + (k.px || 0), -0.16 - bobY + sw.y - land - sa * 0.05 + (k.py || 0), -0.46 - swg * 0.15 + (k.pz || 0));
      m.rotation.set(0.5 - swg * 0.9 + (k.rx || 0) + sw.y * 2, -0.35 + swg * 1.0 + (k.ry || 0) + sw.x * 2, -0.25 + (k.rz || 0) - sl * 0.3);
      // La lame seule tourne dans la main / s'envole
      ud.blade.position.set(0, (k.ktoss || 0), 0);
      ud.blade.rotation.set(-(k.kflip || 0), 0, k.kspin || 0);
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
      this.primary = info.primary; this.optic = validOptic(info.primary, info.optic);
      this.rebuild(info.skins || {});
    }
    if (info.weapon !== this.current) { this.current = info.weapon; this.showModel(); this.draw = { name: info.weapon === 'knife' ? 'knifeDraw' : 'switch', t: 0, fired: 0 }; }
    // Rechargement vu de l'extérieur : on lance l'animation quand il commence
    if (info.reloading && !this.reload && this.isGun) {
      const plan = reloadPlan(this.current, Math.max(0, info.mag), info.reserve + 1);
      this.reload = { t: 0, total: plan.time, plan, anim: this.current === 'kar98k' ? 'kar' : plan.empty ? 'akEmpty' : 'akTactical', fired: 999 };
    }
    if (this.reload) { this.reload.t += dt; if (this.reload.t >= this.reload.total || !info.reloading) this.reload = null; }
    if (this.draw) { this.draw.t += dt / (DRAW_TIME[this.draw.name] || 0.35); if (this.draw.t >= 1) this.draw = null; }
    this.overlay = null;
    this.ads = 0;
    this.animate(dt, { speed: moving, grounded: true, sliding: false, sprinting: false, bob: (this._specBob = (this._specBob || 0) + dt * moving * 1.6) });
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
  const holder = new THREE.Group();
  holder.position.set(...pos);
  holder.rotation.x = -tilt; // suit l'inclinaison de la poignée
  holder.add(hand);
  g.add(holder);
  const wrist = [pos[0] + 0.02, pos[1] - 0.035, pos[2] + 0.08];
  g.add(capsule([pos[0], pos[1] - 0.012, pos[2] + 0.025], wrist, 0.033, M.glove)); // poignet (gant)
  g.add(capsule(wrist, forearmEnd, 0.05, M.sleeve));                                // avant-bras (manche)
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
  // Hausse (2 montants avec encoche, pour la mire) + bloc de hausse
  g.add(
    rbox(0.012, 0.035, 0.025, dark, -0.017, 0.065, 0.12, 0.003),
    rbox(0.012, 0.035, 0.025, dark, 0.017, 0.065, 0.12, 0.003),
    rbox(0.05, 0.02, 0.05, dark, 0, 0.045, -0.17, 0.005),
  );
  // Garde-mains en bois (extrudés, bords arrondis)
  g.add(extrude([[-0.2, -0.04], [-0.42, -0.034], [-0.43, -0.02], [-0.43, 0.012], [-0.2, 0.012]], 0.052, wood, 0.006));
  g.add(extrude([[-0.21, 0.018], [-0.4, 0.018], [-0.41, 0.03], [-0.4, 0.05], [-0.22, 0.05], [-0.21, 0.035]], 0.042, wood, 0.006));
  // Tube de gaz, canon, guidon, frein de bouche
  g.add(
    cyl(0.011, 0.24, metal, 0, 0.034, -0.48),
    cyl(0.0125, 0.4, metal, 0, 0.012, -0.58),
    rbox(0.03, 0.035, 0.03, dark, 0, 0.022, -0.62, 0.005),        // bloc de guidon
    rbox(0.012, 0.04, 0.012, dark, 0, 0.056, -0.62, 0.003),       // guidon
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

  // Organes de visée d'origine (mire)
  if (optic === 'iron') {
    g.add(
      rbox(0.01, 0.025, 0.02, dark, -0.012, 0.04, -0.12, 0.003), rbox(0.01, 0.025, 0.02, dark, 0.012, 0.04, -0.12, 0.003),
      rbox(0.034, 0.012, 0.035, dark, 0, 0.031, -0.12, 0.004),
      rbox(0.008, 0.03, 0.012, dark, 0, 0.038, -0.96, 0.002), rbox(0.03, 0.012, 0.02, dark, 0, 0.026, -0.96, 0.004),
    );
  }
  g.userData.sightY = addOptic(g, optic, 0.0275, -0.02) ?? 0.049;

  rightGripHand(g, M, [0.032, -0.058, 0.155], [0.17, -0.36, 0.6], 0.15);
  leftSupportHand(g, M, [0, -0.075, -0.33], [-0.26, -0.45, 0.04]);
  muzzleFlash(g, -1.02, 0.28);
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
