// =====================================================================
//  avatars.js — Personnages 3D des autres joueurs (et des bots)
//  Le modèle et ses animations viennent de character.js (character.glb) :
//  clips Blender pour le corps (repos, marche, course, accroupi, glissade,
//  saut, atterrissage, mort) + bras placés par IK sur l'arme.
//  Mouvement fluide : on rejoue les positions reçues du serveur avec
//  un léger retard (interpolation) au lieu de "sauter" d'une à l'autre.
// =====================================================================
import * as THREE from 'three';
import { TEAMS } from '/shared/constants.js';
import { playerHitboxes } from '/shared/physics.js';

// ?debug dans l'adresse : hitbox (communes à tous les skins) dessinées en fil de fer
const DEBUG_HITBOX = /[?&]debug\b/.test(location.search);
const HB_COLORS = { head: 0xff3b3b, torso: 0xffd23b, legs: 0x3bff6e };
const unitBox = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
import { Character, outlineObject } from './character.js';

const OUTLINE = 0.012; // épaisseur du contour (discret)
// Retard volontaire pour l'interpolation réseau (ms). Ajusté en direct par net.js selon la qualité de la connexion.
export const INTERP = { delay: 70 };

const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class Avatar {
  /**
   * opts.skins  = skins du joueur ({ character, gloves, ak, kar98k, knife… })
   * opts.weapon = arme tenue, opts.optic = viseur monté dessus
   * opts.outline = false pour ne pas dessiner de contour (aperçu du menu, corps local)
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

    this.char = new Character({ color, skins: this.skins, outline: this.outline ? OUTLINE : 0, xray: this.ally });
    this.group.add(this.char.root);
    this.weaponId = null;
    this.setWeapon(opts.weapon || 'ak', opts.optic);

    // Pseudo flottant (les alliés le voient aussi à travers les murs)
    if (name) {
      this.label = makeLabel(name, TEAMS[team]?.css ?? '#fff', this.ally);
      this.label.position.y = 2.15;
      this.group.add(this.label);
    }
    scene.add(this.group);
    if (DEBUG_HITBOX && name) {
      this.hbDebug = {};
      for (const [z, c] of Object.entries(HB_COLORS)) {
        const l = new THREE.LineSegments(unitBox, new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true }));
        l.renderOrder = 1000;
        scene.add(l);
        this.hbDebug[z] = l;
      }
    }

    // État d'animation
    this.target = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.snaps = [];          // positions reçues du serveur (interpolation)
    this.crouch = false;
    this.sliding = false;
    this.air = 0;             // 0..1 : en l'air
    this.vy = 0;
    this.reloading = false;
    this.dead = false;
    this.stepDist = 0;
    this.speed = 0;
    this.onStep = null;       // appelé à chaque pas (pour les bruits de pas)
  }

  setXray(v) { this.char.setXray(v && this.group.visible && !this.dead); }

  // ---- Positions ----
  /** Mode simple (bots du solo, menus, corps local) : on suit la cible en douceur */
  setTarget(s, snap = false) {
    Object.assign(this.target, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
    this.crouch = !!s.crouch;
    if ('sliding' in s) this.sliding = !!s.sliding;
    if (snap) { this.group.position.set(s.x, s.y, s.z); this.group.rotation.y = s.yaw; this.snaps.length = 0; }
  }
  /** Mode réseau : on mémorise chaque position avec l'heure du serveur */
  pushSnapshot(t, s, snap = false) {
    if (snap) this.snaps.length = 0;
    this.snaps.push({ t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, crouch: !!s.crouch });
    while (this.snaps.length > 30) this.snaps.shift();
    if (snap) { this.group.position.set(s.x, s.y, s.z); this.group.rotation.y = s.yaw; }
  }

  /** Position interpolée à l'instant serverNow - delay */
  sampleSnapshots(serverNow) {
    const sn = this.snaps;
    if (!sn.length) return null;
    const rt = serverNow - INTERP.delay;
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

  setVisible(v) { this.group.visible = v; if (!v) this.char.setXray(false); }

  /** Change l'arme visible dans les mains + son viseur */
  setWeapon(id, optic = 'iron') {
    const key = `${id}:${optic}`;
    if (key === this.weaponId) return;
    this.weaponId = key;
    this.weaponName = id;
    this.char.setWeapon(id, optic, this.outline ? (g) => outlineObject(g, this.color, OUTLINE * 0.7) : null);
  }

  /** Position du bout du canon dans le monde (pour les traçantes) */
  muzzleWorld() {
    const v = this.char.muzzleWorld();
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Il tire : recul de l'arme (ou coup de couteau) */
  fire() { this.char.fire(); }
  setReloading(r) { this.reloading = !!r; }

  /** Le personnage tombe (mort) */
  die() { if (!this.dead) { this.dead = true; if (this.label) this.label.visible = false; this.char.setXray(false); } }
  revive() { this.dead = false; this.char.revive(); if (this.label) this.label.visible = true; }

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

    // ---- Vitesse (lissée) et état en l'air ----
    const inst = Math.hypot(g.position.x - prev.x, g.position.z - prev.z) / Math.max(dt, 1e-4);
    if (Number.isFinite(inst)) this.speed += (Math.min(inst, 14) - this.speed) * Math.min(1, dt * 10);
    const vy = (g.position.y - prev.y) / Math.max(dt, 1e-4);
    if (Number.isFinite(vy)) this.vy += (vy - this.vy) * Math.min(1, dt * 12);
    const wasAir = this.air;
    this.air = Math.abs(this.vy) > 1.2 ? Math.min(1, this.air + dt * 6) : Math.max(0, this.air - dt * 5);
    const justLanded = wasAir > 0.5 && this.air <= 0.5 && this.vy > -1;

    const info = this.info || {};
    const sliding = this.sliding || !!info.sl;
    this.char.update(dt, {
      speed: this.speed, crouch: this.crouch && !sliding, air: this.air, sliding: sliding && this.air < 0.5,
      dead: this.dead, pitch: this.target.pitch || 0, justLanded,
      ads: !!info.ads, spr: !!info.spr || (this.speed > 7.2 && !this.crouch), insp: !!info.insp, reloading: this.reloading,
    });

    // ---- Hitbox en fil de fer (?debug) ----
    if (this.hbDebug) {
      const p = g.position;
      const hb = playerHitboxes({ x: p.x, y: p.y, z: p.z, crouch: this.crouch });
      for (const [z, l] of Object.entries(this.hbDebug)) {
        const b = hb[z];
        l.visible = this.group.visible && !this.dead;
        l.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
        l.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      }
    }

    // ---- Bruits de pas (pas accroupi) ----
    if (!this.dead && !this.crouch && this.air < 0.2 && this.speed > 2.5) {
      const run = this.speed > 7;
      this.stepDist += this.speed * dt;
      if (this.stepDist > (run ? 2.6 : 2.2)) { this.stepDist = 0; this.onStep?.(g.position, run); }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.hbDebug) for (const l of Object.values(this.hbDebug)) this.scene.remove(l);
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
