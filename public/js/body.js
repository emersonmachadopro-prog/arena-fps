// =====================================================================
//  body.js — Le corps du joueur local, vu à la première personne :
//  le même personnage que celui vu par les autres (character.glb + mêmes
//  animations). On voit ses jambes en baissant la tête et son ombre au sol.
//  Tête, bras, mains et arme sont invisibles (sinon ils cacheraient la vue)
//  mais projettent quand même leur ombre.
// =====================================================================
import * as THREE from 'three';
import { Avatar } from './avatars.js';
import { PLAYER } from '/shared/constants.js';

const LEGS = new Set(['Pants', 'Shoes', 'Sole', 'Belt']);   // toujours visibles (sous la coupe)
const TORSO = new Set(['Shirt']);                            // visible seulement en regardant ses pieds

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
      // Coupe horizontale qui suit le joueur : rien au niveau des yeux
      this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
      this.torsoMats = [];
      for (const m of this.av.char.meshes) {
        const slot = m.userData.slot;
        m.material = m.material.clone();
        m.receiveShadow = false;
        m.castShadow = true;
        if (LEGS.has(slot) || TORSO.has(slot)) {
          m.material.clippingPlanes = [this.clip];
          m.material.side = THREE.DoubleSide; // la coupe paraît pleine
          if (TORSO.has(slot)) this.torsoMats.push(m.material);
        } else {
          m.material.colorWrite = false;   // invisible, mais garde son ombre
          m.material.depthWrite = false;
        }
      }
      this.torsoShown = null;
      this.weapon = null;
    }
    if (weapon !== this.weapon) {
      this.weapon = weapon;
      this.av.setWeapon(weapon);
      this.av.char.gun.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.colorWrite = false; o.material.depthWrite = false; } });
    }
  }

  /** visible = false en menu, mort ou spectateur */
  update(dt, player, weapon, skins, visible, team) {
    if (!visible) { if (this.av) this.av.group.visible = false; return; }
    this.build(skins, weapon, team);
    const av = this.av;
    av.group.visible = true;
    // Le corps est un peu derrière la caméra pour ne pas la traverser ;
    // plus on regarde vers le bas, plus il recule : on voit ses jambes en entier.
    const down = Math.max(0, -player.pitch);
    const back = (player.crouch ? 0.2 : 0.16) + down * 0.1;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    av.setTarget({
      x: player.pos.x - fx * back, y: player.pos.y, z: player.pos.z - fz * back,
      yaw: player.yaw, pitch: 0, crouch: player.crouch && !player.sliding, sliding: !!player.sliding,
    });
    av.info = { spr: !!player.sprinting, ads: (player.ads || 0) > 0.5 };
    av.update(dt);
    this.clip.constant = player.pos.y + (player.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE) - 0.2;
    // Le torse n'est montré que quand on regarde vraiment ses pieds
    const showTorso = down > 0.85 && !player.sprinting && !player.sliding;
    if (showTorso !== this.torsoShown) {
      this.torsoShown = showTorso;
      for (const m of this.torsoMats) { m.colorWrite = showTorso; m.depthWrite = showTorso; }
    }
  }

  dispose() { this.av?.dispose(); this.av = null; this.key = ''; }
}
