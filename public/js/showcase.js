// =====================================================================
//  showcase.js — Personnages affichés en 3D dans les menus :
//  - menu principal : ton personnage avec son loadout équipé
//  - salon (lobby) : tous les joueurs du salon, alignés par équipe
// =====================================================================
import * as THREE from 'three';
import { Avatar } from './avatars.js';

const STAGE = { x: 0, y: 1.6, z: 0 }; // en haut de la plateforme centrale

export class Showcase {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.avatars = [];   // { av, x, phase }
    this.mode = null;    // 'me' | 'lobby' | null
    this.key = '';       // pour ne reconstruire que si quelque chose a changé
    this.time = 0;
    this.frame = 0.35; // décalage du cadrage (personnage plus à droite ou à gauche de l'écran)
    // Lumière "studio" qui éclaire les personnages de face dans les menus
    this.light = new THREE.DirectionalLight(0xfff2e0, 3.4);
    this.light.position.set(STAGE.x - 2, STAGE.y + 4, STAGE.z - 6);
    this.light.target.position.set(STAGE.x, STAGE.y + 1, STAGE.z);
    this.light.visible = false;
    scene.add(this.light, this.light.target);
  }

  clear() {
    for (const a of this.avatars) a.av.dispose();
    this.avatars = [];
    this.key = '';
  }

  hide() { this.clear(); this.mode = null; this.light.visible = false; }

  /** Affiche son propre personnage (skins + loadout) */
  showMe(skins, loadout) {
    const key = `me|${JSON.stringify(skins)}|${loadout.primary}|${loadout.optic}`;
    this.mode = 'me';
    if (key === this.key) return;
    this.clear();
    this.key = key;
    const av = new Avatar(this.scene, null, 'A', { skins, weapon: loadout.primary, optic: loadout.optic, outline: false });
    this.avatars.push({ av, x: 0, phase: 0 });
  }

  /** Affiche les joueurs du salon */
  showLobby(players) {
    const list = players.filter(p => p.team).sort((a, b) => a.team.localeCompare(b.team));
    const key = 'lobby|' + list.map(p => `${p.id}${p.team}${JSON.stringify(p.skins)}${p.primary}${p.optic}`).join('|');
    this.mode = 'lobby';
    if (key === this.key) return;
    this.clear();
    this.key = key;
    const n = list.length;
    list.forEach((p, i) => {
      // Équipe Violet à gauche de l'écran, Orange à droite (x positif = gauche vu de la caméra)
      const x = ((n - 1) / 2 - i) * 1.15 + (p.team === 'A' ? 0.25 : -0.25);
      const av = new Avatar(this.scene, p.name, p.team, { skins: p.skins, weapon: p.primary, optic: p.optic });
      this.avatars.push({ av, x, phase: i * 1.7 });
    });
  }

  update(dt) {
    if (!this.mode) return false;
    this.light.visible = true;
    this.time += dt;
    for (const a of this.avatars) {
      // Petit balancement pour que les personnages aient l'air vivants
      const yaw = Math.sin(this.time * 0.6 + a.phase) * 0.25 + (this.mode === 'me' ? 0.35 : 0);
      a.av.setTarget({ x: STAGE.x + a.x, y: STAGE.y, z: STAGE.z, yaw, pitch: Math.sin(this.time * 0.4 + a.phase) * 0.05 }, !a.placed);
      a.placed = true;
      a.av.update(dt);
    }
    // Caméra
    const cam = this.camera;
    if (cam.fov !== 45) { cam.fov = 45; cam.updateProjectionMatrix(); }
    if (this.mode === 'me') {
      cam.position.set(STAGE.x - 0.2, STAGE.y + 1.25, STAGE.z - 4.4);
      cam.lookAt(STAGE.x + this.frame, STAGE.y + 0.95, STAGE.z); // vu de la caméra, x positif = gauche de l'écran
    } else {
      cam.position.set(STAGE.x, STAGE.y + 1.4, STAGE.z - 6);
      cam.lookAt(STAGE.x + 2.1, STAGE.y + 1.0, STAGE.z); // les joueurs apparaissent à droite du panneau
    }
    return true;
  }
}
