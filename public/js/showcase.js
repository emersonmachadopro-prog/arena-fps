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
    this.light.intensity = 0;
    scene.add(this.light, this.light.target);
    // Lobby : éclairage de scène (contre-jour violet à gauche, orange à droite) + socles lumineux
    this.lobbyFx = new THREE.Group();
    this.rims = [];
    const rim = (color, x) => {
      const l = new THREE.SpotLight(color, 60, 14, 0.7, 0.6, 1.4);
      l.position.set(STAGE.x + x, STAGE.y + 4.5, STAGE.z + 3.5);
      l.target.position.set(STAGE.x + x * 0.5, STAGE.y + 0.8, STAGE.z);
      this.rims.push(l);
      l.intensity = 0;
      scene.add(l, l.target); // toujours dans la scène (intensité 0 hors lobby) : évite de recompiler les shaders
    };
    rim(0xa855f7, 2.6); rim(0xff8a1f, -2.6);
    this.pads = [];
    for (const team of ['A', 'B']) for (let i = 0; i < 2; i++) {
      const color = team === 'A' ? 0xa855f7 : 0xff8a1f;
      const pad = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
      ring.rotation.x = disc.rotation.x = -Math.PI / 2;
      pad.add(ring, disc);
      pad.visible = false;
      this.pads.push({ pad, team, i });
      this.lobbyFx.add(pad);
    }
    this.lobbyFx.visible = false;
    scene.add(this.lobbyFx);
  }

  clear() {
    for (const a of this.avatars) a.av.dispose();
    this.avatars = [];
    this.key = '';
  }

  hide() { this.clear(); this.mode = null; this.light.intensity = 0; this.lobbyFx.visible = false; for (const r of this.rims) r.intensity = 0; }

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
    for (const pd of this.pads) pd.pad.visible = false;
    for (const team of ['A', 'B']) {
      const members = list.filter(p => p.team === team);
      members.forEach((p, i) => {
        // Équipe Violet à gauche de l'écran, Orange à droite (x positif = gauche vu de la caméra)
        const side = team === 'A' ? 1 : -1;
        const x = side * (0.62 + i * 0.95);
        const av = new Avatar(this.scene, null, p.team, { skins: p.skins, weapon: p.primary, optic: p.optic }); // les noms sont dans les panneaux
        this.avatars.push({ av, x, phase: i * 1.7 + (team === 'B' ? 0.9 : 0), side });
        const pd = this.pads.find(q => q.team === team && q.i === i);
        if (pd) { pd.pad.visible = true; pd.pad.position.set(STAGE.x + x, STAGE.y + 0.02, STAGE.z); }
      });
    }
  }

  update(dt) {
    if (!this.mode) return false;
    this.light.intensity = 3.4;
    this.lobbyFx.visible = this.mode === 'lobby';
    for (const r of this.rims) r.intensity = this.mode === 'lobby' ? 60 : 0;
    this.time += dt;
    for (const pd of this.pads) pd.pad.children[0].material.opacity = 0.6 + Math.sin(this.time * 2.4 + pd.i) * 0.25;
    for (const a of this.avatars) {
      // Petit balancement pour que les personnages aient l'air vivants ; en lobby les équipes se font face légèrement
      const yaw = Math.sin(this.time * 0.6 + a.phase) * 0.2 + (this.mode === 'me' ? 0.35 : (a.side || 0) * -0.35);
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
      // Lent travelling de caméra pour un lobby vivant
      const sway = Math.sin(this.time * 0.15) * 0.35;
      cam.position.set(STAGE.x + sway, STAGE.y + 1.35, STAGE.z - 5.6);
      cam.lookAt(STAGE.x + sway * 0.3, STAGE.y + 0.95, STAGE.z);
    }
    return true;
  }
}
