// =====================================================================
//  world.js — Rendu 3D : scène, lumières, ciel, construction de la map.
//  Style : cubique mais réaliste (béton, bois, tôle, lumière du soir).
// =====================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // ombres douces
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // rendu "cinéma", couleurs plus naturelles
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false; // on dessine 2 scènes : le monde puis l'arme
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb3cc);
  scene.add(skyDome());
  scene.fog = new THREE.Fog(0xb8c3cf, 50, 160);

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
  const details = buildDetails(scene); // détails du décor (sans collision), masqués en qualité basse

  // ---- Post-traitement (qualité haute) : anticrénelage MSAA + léger halo lumineux ----
  let composer = null, bloom = null;
  function makeComposer() {
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: 4, type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    const vmPass = new RenderPass(vmScene, vmCamera);
    vmPass.clear = false; vmPass.clearDepth = true; // l'arme par-dessus le monde
    composer.addPass(vmPass);
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.45, 0.88);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ---- Qualité graphique : basse / moyenne / haute ----
  let quality = null;
  function applyQuality(q) {
    if (q === quality) return;
    quality = q;
    const dpr = q === 'low' ? Math.min(devicePixelRatio, 1) * 0.8 : q === 'medium' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    const size = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.mapSize.set(size, size);
    renderer.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    details.visible = q !== 'low';
    if (q === 'high' && !composer) makeComposer();
    if (composer) { composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight); }
  }
  applyQuality(settings.graphics || 'high');

  // ---- Redimensionnement et FOV ----
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    composer?.setSize(innerWidth, innerHeight);
    camera.aspect = vmCamera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    vmCamera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  onSettingsChange(s => { camera.fov = s.fov; camera.updateProjectionMatrix(); applyQuality(s.graphics || 'high'); });

  function render() {
    if (quality === 'high' && composer) { composer.render(); return; }
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }

  return { renderer, scene, camera, vmScene, vmCamera, render, sun };
}

// ---------------------------------------------------------------------
//  Ciel : dôme avec dégradé de fin de journée, halo du soleil et nuages
// ---------------------------------------------------------------------
function skyDome() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H / 2);
  grad.addColorStop(0, '#2f4f7d'); grad.addColorStop(0.55, '#7f9dc2'); grad.addColorStop(0.88, '#e7c9a6'); grad.addColorStop(1, '#f3d9b5');
  g.fillStyle = grad; g.fillRect(0, 0, W, H / 2);
  g.fillStyle = '#c9b8a2'; g.fillRect(0, H / 2, W, H / 2); // sous l'horizon (caché par les murs)
  // Halo du soleil (même direction que la lumière : x+, z+)
  const sx = W * 0.82, sy = H * 0.28;
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, 180);
  sun.addColorStop(0, 'rgba(255,248,225,1)'); sun.addColorStop(0.06, 'rgba(255,236,190,.95)'); sun.addColorStop(0.3, 'rgba(255,200,140,.35)'); sun.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = sun; g.fillRect(0, 0, W, H / 2);
  // Nuages : amas de taches floues
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 26; k++) {
    const cx = rnd() * W, cy = H * (0.12 + rnd() * 0.3), w = 60 + rnd() * 160;
    for (let i = 0; i < 14; i++) {
      const x = cx + (rnd() - 0.5) * w, y = cy + (rnd() - 0.5) * w * 0.18, r = 14 + rnd() * 30;
      const cg = g.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, `rgba(255,250,244,${0.16 + rnd() * 0.14})`); cg.addColorStop(1, 'rgba(255,250,244,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(250, 48, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.rotation.y = Math.PI * 0.32;
  dome.renderOrder = -1;
  return dome;
}

// ---------------------------------------------------------------------
//  Détails du décor (aucune collision, la disposition ne change pas) :
//  tuyaux et câbles en haut des murs extérieurs, plinthes, aérations,
//  taches au sol, projecteurs.
// ---------------------------------------------------------------------
function buildDetails(scene) {
  const g = new THREE.Group();
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x59606b, metalness: 0.7, roughness: 0.45 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a4b2e, metalness: 0.4, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.5, roughness: 0.6 });
  const cable = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.8 });
  const X = MAP_SIZE.x, Z = MAP_SIZE.z;
  // Tuyaux le long des murs nord/sud, avec colliers
  for (const z of [-Z + 0.18, Z - 0.18]) {
    for (const [y, r, m] of [[3.75, 0.09, pipeMat], [3.45, 0.055, rust]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, X * 2, 12), m);
      p.rotation.z = Math.PI / 2; p.position.set(0, y, z); p.castShadow = true; g.add(p);
    }
    for (let x = -X + 2; x < X; x += 4) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.12), dark);
      clamp.position.set(x, 3.62, z + Math.sign(-z) * 0.0); g.add(clamp);
    }
    // Câble qui pend entre deux points
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(new THREE.Vector3(-X + t * X * 2, 3.25 - Math.sin(t * Math.PI * 5) ** 2 * 0.25, z)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.018, 6), cable));
  }
  // Aérations sur les murs est/ouest
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.6, roughness: 0.5 });
  for (const x of [-X + 0.03, X - 0.03]) for (const z of [-9, 9]) {
    const v = new THREE.Group();
    v.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 1.3), ventMat));
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 1.2), dark); s.position.y = -0.33 + i * 0.13; v.add(s); }
    v.position.set(x, 2.6, z); g.add(v);
  }
  // Projecteurs dans les coins (le halo brille avec le bloom)
  const glass = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe6b0, emissiveIntensity: 3 });
  for (const [x, z] of [[-X + 0.4, -Z + 0.4], [X - 0.4, -Z + 0.4], [-X + 0.4, Z - 0.4], [X - 0.4, Z - 0.4]]) {
    const head = new THREE.Group();
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.3), dark));
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.27), glass); lens.position.z = 0.16; head.add(lens);
    head.position.set(x, 4.2, z);
    head.lookAt(0, 0, 0);
    g.add(head);
  }
  // Taches d'huile / usure sur le sol
  const stainC = document.createElement('canvas'); stainC.width = stainC.height = 128;
  const sg = stainC.getContext('2d');
  const sgr = sg.createRadialGradient(64, 64, 4, 64, 64, 62);
  sgr.addColorStop(0, 'rgba(20,18,16,.55)'); sgr.addColorStop(0.6, 'rgba(20,18,16,.25)'); sgr.addColorStop(1, 'rgba(20,18,16,0)');
  sg.fillStyle = sgr; sg.fillRect(0, 0, 128, 128);
  const stainTex = new THREE.CanvasTexture(stainC);
  const stainMat = new THREE.MeshBasicMaterial({ map: stainTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const st = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), stainMat);
    st.rotation.x = -Math.PI / 2; st.rotation.z = rnd() * 6.28;
    const k = 0.8 + rnd() * 2.2; st.scale.set(k, k * (0.6 + rnd() * 0.6), 1);
    st.position.set((rnd() - 0.5) * X * 1.9, 0.006, (rnd() - 0.5) * Z * 1.9);
    g.add(st);
  }
  scene.add(g);
  return g;
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
