// =====================================================================
//  body.js — Le corps du joueur local, vu à la première personne :
//  on voit ses jambes en baissant la tête et son ombre au sol.
//  Le haut du corps est invisible (sinon il cacherait la vue) mais
//  projette quand même son ombre.
// =====================================================================
import * as THREE from 'three';
import { Avatar } from './avatars.js';

export class LocalBody {
  constructor(scene) {
    this.scene = scene;
    this.av = null;
    this.key = '';
  }

  /** (Re)crée le corps avec la tenue et l'arme actuelles */
  build(skins, weapon, team = 'A') {
    const key = `${JSON.stringify(skins)}|${team}`;
    if (key !== this.key || !this.av) {
      this.av?.dispose();
      this.key = key;
      this.av = new Avatar(this.scene, null, team, { skins, weapon, outline: false });
      this.av.exact = true;
      this.legMeshes = new Set();
      for (const leg of this.av.legs) leg.userData.knee.traverse(o => { if (o.isMesh) this.legMeshes.add(o); }); // tibias + bottes (le haut des cuisses serait coupé par la caméra)
      // Seuls le bas des jambes et les bottes sont visibles ; le reste ne fait que de l'ombre
      const keep = new Set();
      this.av.group.traverse(o => {
        if (!o.isMesh || this.legMeshes.has(o) || keep.has(o)) return;
        o.material = o.material.clone();
        o.material.colorWrite = false;
        o.material.depthWrite = false;
        o.castShadow = true;
      });
      this.av.group.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
      this.weapon = null;
    }
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      this.av.setWeapon(weapon);
      this.av.gunG.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.colorWrite = false; o.material.depthWrite = false; } });
    }
  }

  /** visible = false en menu, mort ou spectateur */
  update(dt, player, weapon, skins, visible, team) {
    if (!visible) { if (this.av) this.av.group.visible = false; return; }
    this.build(skins, weapon, team);
    const av = this.av;
    av.group.visible = true;
    // Le corps est un peu derrière la caméra pour ne pas la traverser
    const back = player.crouch ? 0.2 : 0.12;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    av.setTarget({ x: player.pos.x - fx * back, y: player.pos.y, z: player.pos.z - fz * back, yaw: player.yaw, pitch: player.pitch, crouch: player.crouch && !player.sliding });
    av.update(dt);
    // Glissade : jambes tendues vers l'avant
    if (player.sliding) for (const [i, leg] of av.legs.entries()) { leg.rotation.x = -1.2 + i * 0.25; leg.userData.knee.rotation.x = 0.2; }
  }

  dispose() { this.av?.dispose(); this.av = null; this.key = ''; }
}
