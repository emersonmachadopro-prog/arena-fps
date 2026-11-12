// =====================================================================
//  world.js — Rendu 3D : scène, lumières, ciel, construction de la map.
//  Style : cubique mais réaliste (béton, bois, tôle, lumière du soir).
// =====================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MAP_BOXES, MAP_SIZE, SPAWNS } from '/shared/map.js';
import { TEAMS } from '/shared/constants.js';
import { settings, onSettingsChange } from './settings.js';
import { concreteTex, floorTex, crateTex, metalPlateTex, hazardTex, worldUV } from './textures.js';

export function createWorld(container) {
  // ---- Moteur de rendu ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // rendu "cinéma", couleurs plus naturelles
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false; // on dessine 2 scènes : le monde puis l'arme
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0x9aa6b5, 45, 140);

  // Reflets doux sur les matériaux (environnement "studio" généré par Three.js)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 300);
  camera.rotation.order = 'YXZ'; // d'abord gauche/droite, puis haut/bas
  scene.add(camera);

  // Scène séparée pour l'arme en main (évite qu'elle traverse les murs)
  const vmScene = new THREE.Scene();
  vmScene.environment = envMap;
  vmScene.environmentIntensity = 0.5;
  const vmCamera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 10);
  vmScene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4036, 1.4));
  const vmLight = new THREE.DirectionalLight(0xffe2c0, 2.2);
  vmLight.position.set(1.5, 2, 0.5);
  vmScene.add(vmLight);

  // ---- Lumières : soleil de fin d'après-midi + ciel ----
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x5a4a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffe0b8, 3.0);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  buildMap(scene);

  // ---- Redimensionnement et FOV ----
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = vmCamera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    vmCamera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  onSettingsChange(s => { camera.fov = s.fov; camera.updateProjectionMatrix(); });

  function render() {
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }

  return { renderer, scene, camera, vmScene, vmCamera, render };
}

// ---------------------------------------------------------------------
//  Ciel : dégradé de fin de journée
// ---------------------------------------------------------------------
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3d5a85');
  grad.addColorStop(0.55, '#8fa8c6');
  grad.addColorStop(0.8, '#e2c2a0');
  grad.addColorStop(1, '#f0d2a8');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------
//  Construction de la map à partir de shared/map.js (la disposition ne change pas)
// ---------------------------------------------------------------------
function buildMap(scene) {
  // Matériaux réutilisés
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.92, metalness: 0 });
  const concreteDark = new THREE.MeshStandardMaterial({ map: concreteTex(), color: 0xb5b8bf, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ map: crateTex(), roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ map: metalPlateTex(), roughness: 0.5, metalness: 0.7 });
  const MATS = { outer: concreteDark, wall: concrete, pillar: concrete, platform: metal, step: metal, crate: wood };

  // Sol en dalles de béton
  const ft = floorTex();
  ft.repeat.set(MAP_SIZE.x, MAP_SIZE.z); // 1 dalle double = 2 m
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE.x * 2, MAP_SIZE.z * 2),
    new THREE.MeshStandardMaterial({ map: ft, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Zones de spawn : marquages peints au sol aux couleurs des équipes
  for (const team of ['A', 'B']) {
    const s = SPAWNS[team][0];
    const paint = new THREE.MeshStandardMaterial({ color: TEAMS[team].color, transparent: true, opacity: 0.35, roughness: 0.9 });
    const x = Math.sign(s.x) * 17.5;
    for (const [w, d, ox, oz] of [[4, 0.15, 0, 3.5], [4, 0.15, 0, -3.5], [0.15, 7, 2, 0], [0.15, 7, -2, 0]]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x + ox, 0.012, oz);
      scene.add(line);
    }
  }

  // Les boîtes (murs, caisses, plateformes…)
  for (const b of MAP_BOXES) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const geo = new THREE.BoxGeometry(w, h, d);
    if (b.kind !== 'crate') worldUV(geo, w, h, d, b.kind === 'platform' || b.kind === 'step' ? 1 : 2);
    const mesh = new THREE.Mesh(geo, MATS[b.kind] || concrete);
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    mesh.castShadow = b.kind !== 'outer';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Bandes de danger sur le bord de la plateforme centrale
  const hz = hazardTex();
  hz.repeat.set(12, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.7 });
  for (const [x, z, w, d] of [[0, 3.01, 6, 0.01], [0, -3.01, 6, 0.01], [3.01, 0, 0.01, 6], [-3.01, 0, 0.01, 6]]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w || 0.01, 0.15, d || 0.01), hazardMat);
    strip.position.set(x, 1.52, z);
    scene.add(strip);
  }

  // Lampes murales (petits détails qui donnent de l'ambiance)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 2 });
  const lampBox = new THREE.BoxGeometry(0.5, 0.18, 0.12);
  for (const x of [-14, -7, 0, 7, 14]) {
    for (const z of [-MAP_SIZE.z + 0.06, MAP_SIZE.z - 0.06]) {
      const lamp = new THREE.Mesh(lampBox, lampMat);
      lamp.position.set(x, 3.6, z);
      scene.add(lamp);
    }
  }
}
