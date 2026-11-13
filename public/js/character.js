// =====================================================================
//  character.js — Le personnage 3D riggé (character.glb, fait dans Blender)
//  · Bas du corps : clips Blender joués par un AnimationMixer avec fondus
//    (repos, marche, course, accroupi, marche accroupie, glissade, en l'air,
//    atterrissage, mort).
//  · Haut du corps : l'arme est placée devant la poitrine (visée, tir, recul,
//    rechargement, changement d'arme, couteau, course, inspection) et les deux
//    bras la rejoignent par IK → les mains restent collées à l'arme.
//  · Doigts : mêmes poses que la vue FPS, gants = ceux choisis par le joueur.
//  Squelette PARTAGÉ : tout futur skin doit garder les mêmes noms d'os.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { worldWeapon, gloveSlots, HAND_POSES as HP, mixPose, POSE_LEN, SPLAY } from './weapons.js';

const gltf = await new GLTFLoader().loadAsync('/models/character.glb');
const SRC = gltf.scene;
// Les clips n'animent ni les doigts ni (sauf la mort) les bras : ils sont pilotés par le code
const ARM_RE = /^(upperarm|forearm|hand)_/;
const FINGER_RE = /^(index|middle|ring|pinky|thumb)\d_/;
const CLIPS = {};
for (const c of gltf.animations) {
  const keepArms = c.name === 'death';
  CLIPS[c.name] = new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((t) => {
    const bone = t.name.split('.')[0];
    return !FINGER_RE.test(bone) && (keepArms || !ARM_RE.test(bone));
  }));
}
const LOOPS = ['idle', 'walk', 'run', 'crouch_idle', 'crouch_walk', 'slide', 'air'];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
// Repère des mains au repos (T-pose), même convention que la main FPS (main droite = miroir)
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const HAND_B = {
  L: new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)),
  R: new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)),
};
const HAND_REST = {
  L: HAND_B.L.clone().setPosition(-0.755, 1.41, 0),
  R: HAND_B.R.clone().setPosition(0.755, 1.41, 0).multiply(MIRROR),
};
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const RESET_BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', ...['L', 'R'].flatMap((s) => ['thigh', 'shin', 'foot', 'toe'].map((b) => `${b}_${s}`))];
const SHELL_SLOTS = new Set(['Shirt', 'Pants', 'Shoes', 'Skin', 'Cap', 'Hair', 'Glove', 'GloveMid', 'GloveTip', 'Sole', 'Belt']);

// Où l'arme est tenue (repère du personnage au repos, pieds à l'origine, regard vers -z)
// grip = position de la paume droite · rot = inclinaison de l'arme
const HOLD = {
  rifle: { hip: [0.15, 1.22, -0.26], ads: [0.075, 1.48, -0.2], sprint: [0.12, 1.12, -0.18] },
  pistol: { hip: [0.06, 1.3, -0.4], ads: [0.04, 1.47, -0.42], sprint: [0.16, 1.05, -0.2] },
  knife: { hip: [0.2, 1.05, -0.28], ads: [0.2, 1.05, -0.28], sprint: [0.22, 1.0, -0.15] },
};
const SHOULDER = V(0.12, 1.42, 0);       // pivot de la visée verticale
const LEFT_REST = new THREE.Matrix4().makeBasis(V(0, 0, -1), V(-1, 0, 0), V(0, -1, 0)).setPosition(-0.22, 0.92, -0.03); // main gauche le long du corps

// Matériaux partagés (outline / x-ray) avec les sommets poussés le long de la normale (marche aussi avec le skinning)
const outlineMats = new Map();
function outlineMaterial(color, thickness) {
  const key = `${color}:${thickness}`;
  if (!outlineMats.has(key)) {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${thickness.toFixed(4)};`);
    };
    m.customProgramCacheKey = () => `outline${thickness}`;
    outlineMats.set(key, m);
  }
  return outlineMats.get(key);
}

/** Contour d'un objet non skinné (arme) : coque poussée le long des normales (pas d'étirement des pièces fines) */
export function outlineObject(obj, color, thickness = 0.008) {
  const mat = outlineMaterial(color, thickness);
  const list = [];
  obj.traverse((o) => { if (o.isMesh && !o.userData.shell && !o.isSkinnedMesh) list.push(o); });
  for (const o of list) {
    if (o.material?.transparent || o.material?.visible === false) continue;
    const s = new THREE.Mesh(o.geometry, mat);
    s.userData.shell = true;
    o.add(s);
  }
}

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s = new THREE.Vector3();

export class Character {
  /**
   * opts : team color, skins (gloves, armes), outline (épaisseur ou 0), xray (silhouette à travers les murs)
   */
  constructor({ color = 0x888888, skins = {}, outline = 0.012, xray = false } = {}) {
    this.root = cloneSkinned(SRC);
    this.root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    this.skins = skins;
    this.bone = {};
    this.root.traverse((o) => { if (o.isBone) this.bone[o.name] = o; });
    this.meshes = [];
    this.root.traverse((o) => { if (o.isSkinnedMesh) this.meshes.push(o); });
    // Matériaux : couleur d'équipe + gants du joueur
    const team = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 });
    const gloves = gloveSlots(skins.gloves);
    for (const m of this.meshes) {
      const name = m.material.name;
      m.userData.slot = name;
      if (name === 'Team') m.material = team;
      else if (gloves[name]) m.material = gloves[name];
    }
    // Repères de repos des os (depuis les matrices de liaison du squelette)
    const sk = this.meshes[0].skeleton;
    this.restWorld = {};
    sk.bones.forEach((b, i) => { this.restWorld[b.name] = sk.boneInverses[i].clone().invert(); });
    this.q0 = {};
    for (const [n, b] of Object.entries(this.bone)) this.q0[n] = b.quaternion.clone();
    // Main : repère "main FPS" exprimé dans le repère de l'os de la main
    this.handInBone = {};
    for (const s of ['L', 'R']) this.handInBone[s] = this.restWorld[`hand_${s}`].clone().invert().multiply(HAND_REST[s]);
    this.handFromBone = { L: this.handInBone.L.clone().invert(), R: this.handInBone.R.clone().invert() };
    this.armLen = {};
    for (const s of ['L', 'R']) this.armLen[s] = [this.bone[`forearm_${s}`].position.length(), this.bone[`hand_${s}`].position.length()];
    // Axes des doigts (plier = x de la main, écarter = y) dans le repère de chaque os
    this.fingerAxes = {};
    for (const s of ['L', 'R']) {
      const bq = new THREE.Quaternion().setFromRotationMatrix(HAND_B[s]);
      const X = V(1, 0, 0).applyQuaternion(bq), Y = V(0, 1, 0).applyQuaternion(bq);
      const list = [];
      for (const f of FINGERS) for (let k = 1; k <= 3; k++) list.push(`${f}${k}_${s}`);
      list.push(`thumb1_${s}`, `thumb2_${s}`, `thumb3_${s}`);
      this.fingerAxes[s] = list.map((n) => {
        const rq = new THREE.Quaternion().setFromRotationMatrix(this.restWorld[n]).invert();
        return { b: this.bone[n], q0: this.q0[n], ax: X.clone().applyQuaternion(rq), ay: Y.clone().applyQuaternion(rq).multiplyScalar(s === 'R' ? -1 : 1) };
      });
    }
    this.pose = { L: new Float32Array(HP.SUPPORT), R: new Float32Array(HP.RIFLE) };

    // Mixer : toutes les boucles jouent, on fait varier leurs poids (fondus)
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const n of [...LOOPS, 'land', 'death']) {
      const a = this.mixer.clipAction(CLIPS[n]);
      if (n === 'land' || n === 'death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0);
      this.actions[n] = a;
    }
    this.weights = Object.fromEntries(Object.keys(this.actions).map((n) => [n, n === 'idle' ? 1 : 0]));
    this.landT = 1;

    // Contour d'équipe et silhouette à travers les murs (copies skinnées qui suivent le squelette)
    if (outline) this.addShell(outlineMaterial(color, outline), 0);
    if (xray) {
      this.xrayMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false });
      this.xrayMeshes = this.addShell(this.xrayMat, 998);
      for (const x of this.xrayMeshes) x.visible = false;
    }
    this.gun = null;
    this.gunId = null;
    this.state = { kick: 0, draw: 1, reloadT: -1, slash: 0, ads: 0, spr: 0, insp: 0, inspT: 0 };
  }

  addShell(material, order) {
    const out = [];
    for (const m of this.meshes) {
      // Seulement les grosses pièces visibles (pas les détails ni les parties cachées du gant)
      if (!SHELL_SLOTS.has(m.userData.slot) || m.material.visible === false) continue;
      const s = new THREE.SkinnedMesh(m.geometry, material);
      s.bind(m.skeleton, m.bindMatrix);
      s.frustumCulled = false; s.renderOrder = order; s.userData.shell = true;
      m.parent.add(s);
      out.push(s);
    }
    return out;
  }

  setXray(v) { if (this.xrayMeshes) for (const x of this.xrayMeshes) x.visible = v; }

  /** Arme tenue (id + skin + viseur) */
  setWeapon(id, optic = 'iron', outlineFn = null) {
    const key = `${id}:${optic}`;
    if (key === this.gunId) return;
    this.gunId = key;
    this.weaponName = id;
    if (this.gun) this.gun.removeFromParent();
    this.gun = worldWeapon(id, this.skins[id], optic);
    this.gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.gun.matrixAutoUpdate = false;
    outlineFn?.(this.gun);
    this.root.add(this.gun);
    this.kind = id === 'knife' ? 'knife' : id === 'glock' ? 'pistol' : 'rifle';
    this.state.draw = 0; // animation de sortie
    this.pose.R.set(id === 'knife' ? HP.KNIFE : HP.RIFLE);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    const m = this.gun?.userData.muzzle;
    if (m) return m.getWorldPosition(out);
    return this.bone.hand_R.getWorldPosition(out);
  }

  fire() { if (this.kind === 'knife') this.state.slash = 1; else this.state.kick = 1; }

  // ---------- os : petites aides ----------
  rotateWorld(bone, axis, angle) {
    bone.parent.getWorldQuaternion(_q2);
    _q.setFromAxisAngle(axis, angle);
    bone.quaternion.premultiply(_q3.copy(_q2).invert().multiply(_q).multiply(_q2));
  }
  /** Oriente un os (dont la direction locale vers l'enfant est childLocal) pour viser une direction monde */
  aimBone(bone, childLocal, dirWorld) {
    bone.getWorldQuaternion(_q);
    _v.copy(childLocal).normalize().applyQuaternion(_q);
    _q2.setFromUnitVectors(_v, _v2.copy(dirWorld).normalize());
    _q.premultiply(_q2);
    bone.parent.getWorldQuaternion(_q3);
    bone.quaternion.copy(_q3.invert().multiply(_q));
    bone.updateMatrixWorld(true);
  }
  /** IK à deux os : la main (repère "main FPS", monde) va à handWorld ; pole = direction du coude */
  solveArm(s, handWorld, pole) {
    const up = this.bone[`upperarm_${s}`], fo = this.bone[`forearm_${s}`], ha = this.bone[`hand_${s}`];
    up.quaternion.copy(this.q0[up.name]); fo.quaternion.copy(this.q0[fo.name]);
    up.updateMatrixWorld(true);
    // Cible du poignet = origine de l'os de la main
    _m.multiplyMatrices(handWorld, this.handFromBone[s]);
    const W = _v3.setFromMatrixPosition(_m);
    const S = up.getWorldPosition(new THREE.Vector3());
    const [a, b] = this.armLen[s];
    const toT = W.clone().sub(S);
    const d = Math.min(Math.max(toT.length(), 1e-4), (a + b) * 0.999);
    const dir = toT.normalize();
    const cosA = clamp01x((a * a + d * d - b * b) / (2 * a * d));
    const along = a * cosA, h = Math.sqrt(Math.max(0, a * a - along * along));
    const pn = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().addScaledVector(dir, along).addScaledVector(pn, h);
    this.aimBone(up, fo.position, E.clone().sub(S));
    const Wreach = S.clone().addScaledVector(dir, d);
    this.aimBone(fo, ha.position, Wreach.sub(E));
    // Orientation de la main
    _m.decompose(_v, _q, _s);
    fo.getWorldQuaternion(_q2);
    ha.quaternion.copy(_q2.invert().multiply(_q));
    ha.updateMatrixWorld(true);
  }
  applyFingers(s, p) {
    const A = this.fingerAxes[s];
    for (let i = 0; i < 12; i++) {
      const { b, q0, ax, ay } = A[i];
      b.quaternion.copy(q0);
      if (i % 3 === 0 && p[15]) b.quaternion.multiply(_q.setFromAxisAngle(ay, p[15] * SPLAY[i / 3]));
      b.quaternion.multiply(_q.setFromAxisAngle(ax, p[i]));
    }
    A[12].b.quaternion.copy(A[12].q0).multiply(_q.setFromAxisAngle(A[12].ay, p[12]));
    A[13].b.quaternion.copy(A[13].q0).multiply(_q.setFromAxisAngle(A[13].ax, p[13]));
    A[14].b.quaternion.copy(A[14].q0).multiply(_q.setFromAxisAngle(A[14].ax, p[14]));
  }

  /**
   * Une image d'animation.
   * st = { speed, crouch, air, sliding, dead, pitch, ads, spr, insp, reloading, justLanded }
   */
  update(dt, st) {
    const S = this.state;
    // ---------- 1) Bas du corps : choix du clip + fondus ----------
    let target = 'idle';
    if (st.dead) target = 'death';
    else if (st.sliding) target = 'slide';
    else if (st.air > 0.5) target = 'air';
    else if (st.crouch) target = st.speed > 0.6 ? 'crouch_walk' : 'crouch_idle';
    else if (st.speed > 4.2) target = 'run';
    else if (st.speed > 0.5) target = 'walk';
    if (target === 'death' && this.weights.death === 0) { this.actions.death.reset().play(); }
    if (st.justLanded && !st.dead) { this.actions.land.reset().play(); this.landT = 0; }
    this.landT = Math.min(1, this.landT + dt / 0.35);
    const landW = st.dead ? 0 : Math.sin(Math.min(1, this.landT) * Math.PI) * 0.85;
    const k = Math.min(1, dt * (target === 'death' ? 14 : 9));
    for (const n of Object.keys(this.actions)) {
      let want = n === target ? 1 : 0;
      if (n === 'land') want = landW;
      this.weights[n] += (want - this.weights[n]) * (n === 'land' ? 1 : k);
      this.actions[n].setEffectiveWeight(this.weights[n]);
    }
    // Vitesse des cycles calée sur la vitesse réelle (les pieds ne glissent pas)
    this.actions.walk.timeScale = Math.max(0.6, Math.min(1.7, st.speed / 2.65));
    this.actions.run.timeScale = Math.max(0.8, Math.min(2.0, st.speed / 4.4));
    this.actions.crouch_walk.timeScale = Math.max(0.6, Math.min(1.6, st.speed / 2.2));
    // Les os que le code tourne repartent du repos (l'export supprime les pistes constantes,
    // le mixer ne les remettrait donc pas à zéro → la rotation s'accumulerait)
    for (const n of RESET_BONES) { const b = this.bone[n]; b.quaternion.copy(this.q0[n]); }
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    // ---------- 2) Mort : les bras suivent le clip, l'arme reste dans la main droite ----------
    if (st.dead) {
      if (this.gun && this.gun.parent !== this.bone.hand_R) {
        // l'arme passe dans la main (elle tombe avec le corps)
        const g = this.gun.userData.grips;
        _m.multiplyMatrices(this.handInBone.R, g.R.clone().invert());
        this.bone.hand_R.add(this.gun);
        this.gun.matrix.copy(_m);
        this.gun.matrixWorldNeedsUpdate = true;
      }
      this.applyFingers('L', HP.OPEN); this.applyFingers('R', HP.OPEN);
      return;
    }
    if (this.gun && this.gun.parent !== this.root) this.root.add(this.gun);

    // ---------- 3) Haut du corps : regard vertical (colonne, poitrine, tête) ----------
    const pitch = st.pitch || 0;
    this.root.getWorldQuaternion(_q);
    const right = V(1, 0, 0).applyQuaternion(_q), upW = V(0, 1, 0).applyQuaternion(_q), back = V(0, 0, 1).applyQuaternion(_q);
    this.rotateWorld(this.bone.spine, right, pitch * 0.2);
    this.rotateWorld(this.bone.chest, right, pitch * 0.25);
    this.rotateWorld(this.bone.head, right, pitch * 0.35);
    this.root.updateMatrixWorld(true);

    // ---------- 4) Arme : tenue, visée, recul, rechargement, sortie, couteau ----------
    S.kick = Math.max(0, S.kick - dt * 9);
    S.slash = Math.max(0, S.slash - dt * 3.2);
    S.draw = Math.min(1, S.draw + dt / 0.4);
    S.ads += ((st.ads ? 1 : 0) - S.ads) * Math.min(1, dt * 10);
    S.spr += ((st.spr && !st.ads ? 1 : 0) - S.spr) * Math.min(1, dt * 8);
    S.insp += ((st.insp ? 1 : 0) - S.insp) * Math.min(1, dt * 6);
    if (st.insp) S.inspT += dt; else S.inspT = 0;
    if (st.reloading) S.reloadT = S.reloadT < 0 ? 0 : S.reloadT + dt; else S.reloadT = -1;
    const H = HOLD[this.kind] || HOLD.rifle;
    const grip = V(...H.hip).lerp(V(...H.ads), ease(S.ads)).lerp(V(...H.sprint), ease(S.spr));
    let rx = 0, ry = 0, rz = 0, px = 0, py = 0, pz = 0;
    // sortie de l'arme : elle remonte
    const dl = 1 - ease(S.draw); py -= dl * 0.25; rx -= dl * 0.9;
    // course : arme en travers
    ry += S.spr * 0.8; rx -= S.spr * 0.35; rz += S.spr * 0.3;
    // inspection : on la tourne pour la regarder
    ry -= S.insp * (0.6 + Math.sin(S.inspT * 1.4) * 0.35); rz += S.insp * 0.45; py += S.insp * 0.05;
    // recul
    pz += S.kick * 0.06; rx += S.kick * 0.12;
    // couteau : coup en diagonale
    if (this.kind === 'knife') { const sw = Math.sin(S.slash * Math.PI); px -= sw * 0.2; pz -= sw * 0.25; ry += sw * 0.9; rx -= sw * 0.5; }
    // rechargement : l'arme penche vers le haut-gauche, la main gauche va chercher un chargeur
    let lw = this.kind === 'knife' ? 0 : 1, leftOff = null, lpose = this.kind === 'pistol' ? HP.PISTOL_SUP : HP.SUPPORT;
    if (S.reloadT >= 0 && this.kind !== 'knife') {
      const t = S.reloadT, inn = ease(clamp01(t / 0.25));
      rz += 0.45 * inn; rx += 0.15 * inn; py += 0.03 * inn;
      const cyc = this.weaponName === 'kar98k' || this.weaponName === 'shotgun' ? 0.7 : 1.6;
      const u = ((t - 0.2) % cyc) / cyc;
      if (t > 0.2) {
        // aller-retour de la main gauche : arme → ceinture → arme
        const out = Math.sin(clamp01(u) * Math.PI);
        leftOff = V(-0.08 * out, -0.28 * out, 0.12 * out);
        lpose = out > 0.3 ? HP.MAG : lpose;
      }
      if (this.weaponName === 'kar98k' || this.weaponName === 'shotgun') rz -= 0.2 * inn;
    }
    // Matrice de l'arme : visée verticale autour de l'épaule, posée sur la poitrine
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    const g = this.gun.userData.grips;
    const gripPos = _v.setFromMatrixPosition(g.R);
    const pitchRest = pitch * 0.55;
    const gun = new THREE.Matrix4()
      .makeTranslation(SHOULDER.x, SHOULDER.y, SHOULDER.z)
      .multiply(_m.makeRotationX(pitchRest))
      .multiply(_m.makeTranslation(grip.x - SHOULDER.x + px, grip.y - SHOULDER.y + py, grip.z - SHOULDER.z + pz))
      .multiply(R)
      .multiply(_m.makeTranslation(-gripPos.x, -gripPos.y, -gripPos.z));
    // La poitrine bouge (accroupi, course, respiration) : l'arme suit sa position, pas sa rotation
    const chest = this.bone.chest;
    const chestNow = _v2.setFromMatrixPosition(chest.matrixWorld);
    const chestRest = _v3.setFromMatrixPosition(this.restWorld.chest).applyMatrix4(this.root.matrixWorld);
    const gunWorld = this.root.matrixWorld.clone().multiply(gun);
    gunWorld.premultiply(_m.makeTranslation(chestNow.x - chestRest.x, chestNow.y - chestRest.y, chestNow.z - chestRest.z));
    this.gun.matrix.copy(this.root.matrixWorld.clone().invert().multiply(gunWorld));
    this.gun.matrixWorldNeedsUpdate = true;
    this.gun.updateMatrixWorld(true);
    // Pièces de l'arme animées (culasse, pompe)
    const P = this.gun.userData.parts;
    if (P.slide) P.slide.position.z = (P.slide.userData.z0 ??= P.slide.position.z) + S.kick * 0.03;
    if (P.forend && this.weaponName === 'shotgun') P.forend.position.z = (P.forend.userData.z0 ??= P.forend.position.z) + Math.sin(clamp01(1 - S.kick) * Math.PI) * (S.kick > 0.01 ? 0.08 : 0);

    // ---------- 5) Bras par IK ----------
    const poleR = right.clone().multiplyScalar(0.6).addScaledVector(upW, -1).addScaledVector(back, 0.3);
    const poleL = right.clone().multiplyScalar(-0.6).addScaledVector(upW, -1).addScaledVector(back, 0.1);
    this.solveArm('R', _m2.multiplyMatrices(gunWorld, g.R), poleR);
    let leftTarget;
    if (lw > 0 && g.L) {
      leftTarget = gunWorld.clone().multiply(g.L);
      if (leftOff) leftTarget.premultiply(_m.makeTranslation(...leftOff.applyQuaternion(_q.setFromRotationMatrix(this.root.matrixWorld)).toArray()));
    } else {
      leftTarget = this.root.matrixWorld.clone().multiply(LEFT_REST);
      lpose = HP.OPEN;
    }
    this.solveArm('L', leftTarget, poleL);

    // ---------- 6) Doigts ----------
    const fk = Math.min(1, dt * 18);
    mixPose(this.pose.L, lpose, fk, this.pose.L);
    mixPose(this.pose.R, this.kind === 'knife' ? HP.KNIFE : HP.RIFLE, fk, this.pose.R);
    this.applyFingers('L', this.pose.L);
    this.applyFingers('R', this.pose.R);
  }

  revive() {
    this.actions.death.stop(); this.weights.death = 0; this.actions.death.setEffectiveWeight(0);
    this.actions.death.play();
    this.actions.death.paused = false;
    if (this.gun && this.gun.parent !== this.root) this.root.add(this.gun);
  }
}

function clamp01x(v) { return Math.max(-1, Math.min(1, v)); }
