// =====================================================================
//  body.js — Le corps du joueur local, vu à la première personne :
//  on voit ses jambes en baissant la tête et son ombre au sol.
//  Le haut du corps est invisible (sinon il cacherait la vue) mais
//  projette quand même son ombre.
// =====================================================================
import * as THREE from 'three';
import { Avatar } from './avatars.js';
import { PLAYER } from '/shared/constants.js';

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
      for (const leg of this.av.legs) leg.traverse(o => { if (o.isMesh) this.legMeshes.add(o); }); // jambes entières : cuisses, genoux, bottes
      // Le bas du corps est visible (bassin, jambes, bottes) ; le reste ne fait que de l'ombre
      // Visible : torse (gilet, poches), bassin, jambes. Invisible (ombre seulement) : tête, bras, arme.
      const keep = new Set();
      for (const c of this.av.torso.children) if (c !== this.av.headG && c !== this.av.aim) c.traverse(o => { if (o.isMesh) keep.add(o); });
      this.av.group.traverse(o => {
        if (!o.isMesh || this.legMeshes.has(o) || keep.has(o)) return;
        o.material = o.material.clone();
        o.material.colorWrite = false;
        o.material.depthWrite = false;
        o.castShadow = true;
      });
      this.av.group.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
      // Les jambes sont "coupées" proprement au milieu des cuisses (plan de découpe qui suit le joueur) :
      // on voit cuisses, genoux et bottes, sans le dessus arrondi des cuisses ni le bassin.
      this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
      this.torsoMeshes = [...keep];
      for (const m of [...this.legMeshes, ...keep]) { m.material = m.material.clone(); m.material.clippingPlanes = [this.clip]; m.material.side = THREE.DoubleSide; m.castShadow = true; } // DoubleSide : la coupe paraît pleine
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
    // Plus on regarde vers le bas, plus le corps recule : on voit ses jambes en entier
    // sans que la caméra se retrouve à l'intérieur du bassin.
    const down = Math.max(0, -player.pitch);
    // Un peu derrière (le torse ne passe pas devant la caméra), et encore plus en regardant ses pieds :
    // on voit alors le bas du gilet, la ceinture et les jambes jusqu'aux bottes.
    const back = (player.crouch ? 0.2 : 0.16) + down * 0.1;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    av.setTarget({ x: player.pos.x - fx * back, y: player.pos.y, z: player.pos.z - fz * back, yaw: player.yaw, pitch: player.pitch, crouch: player.crouch && !player.sliding });
    av.update(dt);
    // Coupe à mi-cuisse (au-dessus, c'est le ventre qu'on verrait)
    this.clip.constant = player.pos.y + (player.crouch ? PLAYER.CROUCH_EYE : PLAYER.EYE) - 0.2; // rien au niveau des yeux
    // En regardant ses pieds immobile, les pieds sont un peu devant (posture naturelle)
    const still = Math.max(0, 1 - av.speed / 2);
    for (const leg of av.legs) leg.rotation.x -= 0.12 * still * Math.min(1, down * 1.5);
    // Le torse reste droit et n'est montré que quand on regarde vraiment ses pieds
    // (sinon, en courant, on le voyait dépasser en bas de l'écran)
    av.torso.rotation.x = 0;
    const showTorso = down > 0.85 && !player.sprinting && !player.sliding;
    if (showTorso !== this.torsoShown) {
      this.torsoShown = showTorso;
      for (const m of this.torsoMeshes) { m.material.colorWrite = showTorso; m.material.depthWrite = showTorso; }
    }
    // Glissade : jambes tendues vers l'avant
    if (player.sliding) for (const [i, leg] of av.legs.entries()) { leg.rotation.x = -1.2 + i * 0.25; leg.userData.knee.rotation.x = 0.2; }
  }

  dispose() { this.av?.dispose(); this.av = null; this.key = ''; }
}
