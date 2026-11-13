// =====================================================================
//  effects.js — Effets visuels éphémères : traçantes, impacts, étincelles
// =====================================================================
import * as THREE from 'three';
import { sfx } from './audio.js';

// Tailles des douilles [rayon, longueur]
const SHELLS = { ak: [0.0058, 0.039], mp5: [0.0052, 0.019], kar98k: [0.0062, 0.057], glock: [0.0052, 0.019], shotgun: [0.0105, 0.058] };

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = []; // { obj, life, maxLife, update? }
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.9 });
    this.sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    this.brass = new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.85, roughness: 0.3 });
    this.hull = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.55 }); // douille de cartouche rouge
    this.shellGeos = {};
    this.shells = [];
  }

  /**
   * Douille éjectée : pos = point de sortie, vel = vitesse initiale,
   * floorY = hauteur du sol sous le tireur (pour le rebond).
   */
  shell(type, pos, vel, floorY = 0) {
    const [r, len] = SHELLS[type] || SHELLS.ak;
    if (!this.shellGeos[type]) this.shellGeos[type] = new THREE.CylinderGeometry(r, r * 1.04, len, 8);
    const m = new THREE.Mesh(this.shellGeos[type], type === 'shotgun' ? this.hull : this.brass);
    m.position.set(pos.x, pos.y, pos.z);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = true;
    this.scene.add(m);
    this.shells.push({ m, v: new THREE.Vector3(vel.x, vel.y, vel.z), spin: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30), floorY, life: 6, bounced: 0 });
    while (this.shells.length > 60) { const o = this.shells.shift(); this.scene.remove(o.m); }
  }

  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      if (s.bounced < 4) {
        s.v.y -= 9.8 * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; s.m.rotation.z += s.spin.z * dt;
        // Rebond sur le sol
        if (s.m.position.y < s.floorY + 0.006) {
          s.m.position.y = s.floorY + 0.006;
          if (s.bounced === 0) sfx.shell({ x: s.m.position.x, y: s.m.position.y, z: s.m.position.z });
          s.v.y = -s.v.y * 0.35; s.v.x *= 0.5; s.v.z *= 0.5; s.spin.multiplyScalar(0.5);
          s.bounced++;
          if (s.bounced >= 4) { s.m.rotation.x = Math.PI / 2; } // la douille reste couchée
        }
      }
      if (s.life <= 0) { this.scene.remove(s.m); this.shells.splice(i, 1); }
    }
  }

  add(obj, life, update) {
    this.scene.add(obj);
    this.items.push({ obj, life, maxLife: life, update });
  }

  /** Ligne lumineuse rapide entre deux points */
  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.add(line, 0.06, (it, k) => { line.material.opacity = 0.9 * k; });
  }

  /** Petites particules qui jaillissent d'un point */
  burst(p, color = 0xffd27a, count = 6, speed = 3) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.set(p.x, p.y, p.z);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this.add(m, 0.35, (it, k, dt) => {
        v.y -= 9 * dt;
        m.position.addScaledVector(v, dt);
        mat.opacity = k;
      });
    }
  }

  impact(p) { this.burst(p, 0xffd27a, 5, 2.5); }
  blood(p) { this.burst(p, 0xff3355, 8, 2); }

  update(dt) {
    this.updateShells(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.update) it.update(it, Math.max(0, it.life / it.maxLife), dt);
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        if (it.obj.geometry !== this.sparkGeo) it.obj.geometry?.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
