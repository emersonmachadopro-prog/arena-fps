// =====================================================================
//  effects.js — Effets visuels éphémères : traçantes, impacts, étincelles
// =====================================================================
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = []; // { obj, life, maxLife, update? }
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.9 });
    this.sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
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
