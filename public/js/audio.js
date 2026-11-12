// =====================================================================
//  audio.js — Sons générés par le code (Web Audio API), aucun fichier.
//  - Tirs en plusieurs couches (claquement, corps, grave, mécanique)
//    + écho (réverbération) pour un rendu plus "vraie arme"
//  - Sons placés en 3D (HRTF) : on entend d'où viennent les pas et les tirs
//  - Bruits de rechargement synchronisés avec les animations
// =====================================================================
import { settings, onSettingsChange } from './settings.js';

let ctx = null, master = null, sfxBus = null, reverbIn = null, noiseBuf = null;

// ---------------------------------------------------------------------
//  Sons enregistrés (dossier public/sounds/, générés avec ElevenLabs).
//  S'il en manque un, le jeu utilise automatiquement le son fabriqué par le code.
// ---------------------------------------------------------------------
const SAMPLE_NAMES = [
  'ak_shot', 'ak_shot_far', 'kar_shot', 'kar_shot_far', 'knife_swing', 'empty_click',
  'mag_out', 'mag_in', 'charge_back', 'charge_release', 'bolt_open', 'bolt_close', 'round_in',
  'weapon_switch', 'knife_flip', 'step_1', 'step_2', 'step_3', 'land', 'slide', 'hurt',
  'bullet_impact', 'round_start', 'round_win', 'round_lose',
  'glock_shot', 'glock_shot_far', 'pistol_mag_out', 'pistol_mag_in', 'pistol_slide', 'shell_casing',
  // Optionnels : ajoute 'hitmarker', 'headshot', 'kill', 'ui_click' ici si tu mets ces fichiers dans public/sounds/
];
const buffers = {};

// Mixage : volume de chaque son par rapport aux autres (1 = référence = tir d'AK).
// C'est ici qu'on équilibre si un son paraît trop fort ou trop faible.
const MIX = {
  ak_shot: 1, ak_shot_far: 0.9, kar_shot: 1, kar_shot_far: 0.9, glock_shot: 0.8, glock_shot_far: 0.75,
  knife_swing: 0.45, empty_click: 0.35, knife_flip: 0.3,
  mag_out: 0.32, mag_in: 0.38, charge_back: 0.32, charge_release: 0.38, bolt_open: 0.35, bolt_close: 0.38, round_in: 0.3,
  pistol_mag_out: 0.3, pistol_mag_in: 0.35, pistol_slide: 0.35, shell_casing: 0.18,
  weapon_switch: 0.3, step_1: 0.5, step_2: 0.45, step_3: 0.5, land: 0.35, slide: 0.3,
  hurt: 0.4, bullet_impact: 0.3, round_start: 0.22, round_win: 0.35, round_lose: 0.35,
  hitmarker: 0.35, headshot: 0.4, kill: 0.4, ui_click: 0.25,
};

function loadSamples() {
  for (const name of SAMPLE_NAMES) {
    fetch(`/sounds/${name}.mp3`)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(ab => ab && ctx.decodeAudioData(ab))
      .then(buf => { if (buf) buffers[name] = buf; })
      .catch(() => {});
  }
}

/**
 * Joue un son enregistré. Retourne false s'il n'est pas (encore) chargé.
 * pos = position 3D (null = son "dans la tête" : nos propres actions, l'interface)
 * ref = distance jusqu'à laquelle le son garde tout son volume
 */
function sample(name, pos = null, { vol = 1, reverb = 0.1, far = 60, ref = 2.5, pitch = 0.05 } = {}) {
  const buf = buffers[name];
  if (!ctx || !buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitch; // légère variation : moins répétitif
  src.connect(output(pos, vol * (MIX[name] ?? 1), reverb, far, ref));
  src.start();
  return true;
}

/** Le navigateur n'autorise le son qu'après un clic : on initialise à ce moment. */
export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Sortie : volume général → compresseur (évite la saturation des rafales)
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = settings.volume;
  master.connect(comp);
  sfxBus = ctx.createGain();             // tous les bruitages passent par ici (réglage "Effets")
  sfxBus.gain.value = settings.sfxVolume ?? 0.8;
  sfxBus.connect(master);

  // Bruit blanc réutilisable (base de la plupart des sons)
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  // Réverbération : on fabrique une "empreinte" de salle (bruit qui s'éteint)
  const conv = ctx.createConvolver();
  const len = ctx.sampleRate * 1.6;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  conv.buffer = ir;
  reverbIn = ctx.createGain(); reverbIn.gain.value = 0.35;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
  reverbIn.connect(conv).connect(lp).connect(sfxBus);

  loadSamples();
}
onSettingsChange(s => {
  if (master) master.gain.value = s.volume;
  if (sfxBus) sfxBus.gain.value = s.sfxVolume ?? 0.8;
  if (music) music.volume = musicTarget();
});

// ---------------------------------------------------------------------
//  Musique des menus (fichier public/sounds/lobby_music.mp3, en boucle)
// ---------------------------------------------------------------------
let music = null, musicFade = null, musicWanted = false;
const musicTarget = () => Math.max(0, Math.min(1, (settings.volume ?? 0.7) * (settings.musicVolume ?? 0.35)));

export function playMusic(on) {
  musicWanted = on;
  if (!music) {
    music = new Audio('/sounds/lobby_music.mp3');
    music.loop = true;
    music.volume = 0;
  }
  clearInterval(musicFade);
  if (on) music.play().catch(() => {}); // le navigateur peut refuser avant le premier clic
  // Fondu en douceur
  musicFade = setInterval(() => {
    const target = musicWanted ? musicTarget() : 0;
    const v = music.volume + Math.sign(target - music.volume) * 0.02;
    music.volume = Math.max(0, Math.min(1, Math.abs(target - v) < 0.02 ? target : v));
    if (music.volume === target) { clearInterval(musicFade); if (!musicWanted) music.pause(); }
  }, 40);
}
// Le navigateur bloque le son avant la première interaction : on relance au premier clic
addEventListener('pointerdown', () => { if (musicWanted && music?.paused) music.play().catch(() => {}); }, { capture: true });

/** Position/orientation de l'auditeur = la caméra (à appeler à chaque image) */
export function setListener(camera) {
  if (!ctx) return;
  const L = ctx.listener;
  const p = camera.position;
  const f = { x: -Math.sin(camera.rotation.y) * Math.cos(camera.rotation.x), y: Math.sin(camera.rotation.x), z: -Math.cos(camera.rotation.y) * Math.cos(camera.rotation.x) };
  if (L.positionX) {
    const t = ctx.currentTime;
    L.positionX.setTargetAtTime(p.x, t, 0.01); L.positionY.setTargetAtTime(p.y, t, 0.01); L.positionZ.setTargetAtTime(p.z, t, 0.01);
    L.forwardX.setTargetAtTime(f.x, t, 0.01); L.forwardY.setTargetAtTime(f.y, t, 0.01); L.forwardZ.setTargetAtTime(f.z, t, 0.01);
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else {
    L.setPosition(p.x, p.y, p.z);
    L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
  }
}

/**
 * Point d'entrée d'un son : s'il a une position, il passe par un "panner" 3D.
 * reverb = quantité d'écho (0..1)
 */
function output(pos, vol = 1, reverb = 0.2, far = 60, ref = 2.5) {
  const g = ctx.createGain();
  g.gain.value = vol;
  let head = g;
  if (pos) {
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = ref; pan.rolloffFactor = 1.1; pan.maxDistance = far;
    if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; }
    else pan.setPosition(pos.x, pos.y, pos.z);
    g.connect(pan).connect(sfxBus);
  } else g.connect(sfxBus);
  if (reverb > 0) {
    const r = ctx.createGain(); r.gain.value = reverb;
    g.connect(r).connect(reverbIn);
  }
  return head;
}

function noise(dest, { t = 0, dur = 0.1, type = 'lowpass', freq = 1000, q = 0.7, vol = 0.5, attack = 0.001, sweep = null }) {
  const t0 = ctx.currentTime + t;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}

function tone(dest, { t = 0, dur = 0.1, freq = 200, end = null, vol = 0.5, type = 'sine' }) {
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (end) o.frequency.exponentialRampToValueAtTime(end, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/** Petit clic métallique (pièces d'arme qui se touchent) */
function metal(dest, t, vol = 0.4, freq = 3200) {
  noise(dest, { t, dur: 0.035, type: 'bandpass', freq, q: 6, vol });
  tone(dest, { t, dur: 0.05, freq: freq * 0.8, vol: vol * 0.25, type: 'triangle' });
}

// ---------------------------------------------------------------------
//  Packs de sons de kill (créations originales)
// ---------------------------------------------------------------------
function bell(dest, t, freq, vol, dur = 0.5) {
  tone(dest, { t, dur, freq, vol, type: 'sine' });
  tone(dest, { t, dur: dur * 0.6, freq: freq * 2.01, vol: vol * 0.35, type: 'sine' });   // harmonique
  tone(dest, { t, dur: dur * 0.3, freq: freq * 3.02, vol: vol * 0.15, type: 'triangle' });
}
const KILL_PACKS = {
  // "Classique" : un son cristallin qui monte d'une marche à chaque kill
  classic(n) {
    const out = output(null, 0.5, 0.25);
    const notes = [349.2, 440, 523.3, 659.3]; // fa, la, do, mi
    if (n <= 4) {
      noise(out, { dur: 0.12, type: 'bandpass', freq: 1500 + n * 600, sweep: 6000, q: 1.5, vol: 0.12, attack: 0.01 }); // "swish"
      bell(out, 0.01, notes[n - 1], 0.5, 0.45 + n * 0.05);
      if (n >= 3) bell(out, 0.07, notes[n - 1] * 1.5, 0.22, 0.4);
    } else {
      // 5e kill : petite fanfare montante
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => bell(out, i * 0.07, f, 0.38, 0.6));
      noise(out, { t: 0.25, dur: 0.6, type: 'highpass', freq: 5000, vol: 0.08, attack: 0.05 }); // scintillement
    }
  },
  // "Néon" : synthé électronique, accord qui grimpe
  neon(n) {
    const out = output(null, 0.45, 0.2);
    const base = [196, 246.9, 293.7, 370][Math.min(n, 4) - 1];
    if (n <= 4) {
      tone(out, { dur: 0.22, freq: base, end: base * 1.02, vol: 0.35, type: 'sawtooth' });
      tone(out, { t: 0.04, dur: 0.25, freq: base * 2, vol: 0.22, type: 'square' });
      noise(out, { dur: 0.08, type: 'bandpass', freq: 3000 + n * 800, q: 3, vol: 0.12 });
    } else {
      [392, 493.9, 587.3, 784].forEach((f, i) => tone(out, { t: i * 0.06, dur: 0.3, freq: f, end: f * 1.01, vol: 0.25, type: 'sawtooth' }));
      tone(out, { t: 0.24, dur: 0.6, freq: 1568, end: 1600, vol: 0.12, type: 'triangle' });
    }
  },
  // "Impact" : coup sourd + clochette, plus discret
  impact(n) {
    const out = output(null, 0.55, 0.15);
    tone(out, { dur: 0.12, freq: 70 + n * 12, end: 40, vol: 0.6 });
    noise(out, { dur: 0.06, type: 'lowpass', freq: 900, vol: 0.35 });
    bell(out, 0.02, [523.3, 587.3, 659.3, 784, 1046.5][n - 1], 0.25, n === 5 ? 0.9 : 0.35);
    if (n === 5) bell(out, 0.12, 1568, 0.18, 0.7);
  },
};
export const KILL_SOUND_PACKS = { classic: 'Classique', neon: 'Néon', impact: 'Impact' };

// Distance d'un son jusqu'à l'auditeur (pour assourdir les tirs lointains)
function distTo(pos) {
  if (!pos || !ctx) return 0;
  const L = ctx.listener;
  const lx = L.positionX ? L.positionX.value : 0, ly = L.positionY ? L.positionY.value : 0, lz = L.positionZ ? L.positionZ.value : 0;
  return Math.hypot(pos.x - lx, pos.y - ly, pos.z - lz);
}

export const sfx = {
  /** Tir d'AK-47. pos = position 3D (null = notre propre arme) */
  shot(pos = null) {
    if (!ctx) return;
    const d = distTo(pos);
    if (sample(pos && d > 28 ? 'ak_shot_far' : 'ak_shot', pos, { vol: pos ? 1.2 : 0.9, ref: 10, far: 150, reverb: 0.12 })) return;
    const out = output(pos, pos ? 1.4 : 1, 0.45 + Math.min(d / 60, 0.4), 120);
    const bright = d > 25 ? 1200 : 6000;                                                 // les tirs lointains sont plus sourds
    noise(out, { dur: 0.04, type: 'highpass', freq: 2200, vol: 0.9 });                    // claquement
    noise(out, { dur: 0.18, type: 'lowpass', freq: bright, sweep: 400, vol: 1.0 });       // corps de la détonation
    noise(out, { dur: 0.09, type: 'bandpass', freq: 700, q: 1.2, vol: 0.8 });
    tone(out, { dur: 0.14, freq: 160, end: 42, vol: 0.9 });                               // coup dans le ventre
    if (!pos) metal(out, 0.035, 0.18, 4200);                                              // culasse qui recule
  },
  /** Tir du Kar98k : plus lourd, plus long, gros écho */
  sniper(pos = null) {
    if (!ctx) return;
    const d = distTo(pos);
    if (sample(pos && d > 30 ? 'kar_shot_far' : 'kar_shot', pos, { vol: pos ? 1.3 : 1, ref: 14, far: 200, reverb: 0.15, pitch: 0.03 })) return;
    const out = output(pos, pos ? 1.6 : 1.1, 0.7, 160);
    noise(out, { dur: 0.05, type: 'highpass', freq: 1800, vol: 1.0 });
    noise(out, { dur: 0.42, type: 'lowpass', freq: d > 30 ? 900 : 4500, sweep: 250, vol: 1.0 });
    noise(out, { dur: 0.2, type: 'bandpass', freq: 450, q: 1, vol: 0.9 });
    tone(out, { dur: 0.35, freq: 110, end: 30, vol: 1.0 });
  },
  /** Tir de Glock 18 */
  pistol(pos = null) {
    if (!ctx) return;
    const d = distTo(pos);
    if (sample(pos && d > 25 ? 'glock_shot_far' : 'glock_shot', pos, { vol: pos ? 1.2 : 0.9, ref: 8, far: 110, reverb: 0.1 })) return;
    const out = output(pos, 0.8, 0.35, 100);
    noise(out, { dur: 0.03, type: 'highpass', freq: 2600, vol: 0.8 });
    noise(out, { dur: 0.12, type: 'lowpass', freq: 5000, sweep: 500, vol: 0.8 });
    tone(out, { dur: 0.08, freq: 220, end: 70, vol: 0.6 });
  },
  pistolMagOut(pos) { if (!ctx || sample('pistol_mag_out', pos, { far: 20, ref: 2 })) return; this.magOut(pos); },
  pistolMagIn(pos) { if (!ctx || sample('pistol_mag_in', pos, { far: 20, ref: 2 })) return; this.magIn(pos); },
  pistolSlide(pos) { if (!ctx || sample('pistol_slide', pos, { far: 20, ref: 2 })) return; this.chargeRelease(pos); },
  /** Douille qui tombe et rebondit sur le sol */
  shell(pos) { if (!ctx || sample('shell_casing', pos, { far: 15, ref: 1.5, pitch: 0.18 })) return; metal(output(pos, 0.3, 0, 15), 0, 0.2, 5200); },

  /**
   * Son de kill qui monte à chaque élimination de la manche (1 → 5).
   * Plusieurs "packs" possibles : plus tard, chaque skin pourra avoir le sien.
   */
  killStreak(n, pack = settings.killSound) {
    if (!ctx) return;
    (KILL_PACKS[pack] || KILL_PACKS.classic)(Math.max(1, Math.min(5, n)));
  },

  knife(pos = null) {
    if (!ctx) return;
    if (sample('knife_swing', pos, { vol: 0.9, far: 20 })) return;
    const out = output(pos, 0.8, 0.05, 20);
    noise(out, { dur: 0.18, type: 'bandpass', freq: 700, sweep: 3200, q: 2.5, vol: 0.5, attack: 0.04 }); // "fsshh"
  },
  /** Bruit de pas. loud = en courant. pos = null pour nos propres pas */
  step(pos = null, loud = false) {
    if (!ctx) return;
    if (sample(`step_${1 + Math.floor(Math.random() * 3)}`, pos, { vol: (pos ? 1.5 : 0.45) * (loud ? 1.25 : 1), ref: 3, far: 35, reverb: 0.03, pitch: 0.08 })) return;
    const out = output(pos, (pos ? 1.6 : 0.5) * (loud ? 1.3 : 1), 0.08, 35);
    const p = 0.85 + Math.random() * 0.3;
    tone(out, { dur: 0.07, freq: 95 * p, end: 55, vol: 0.7 });                                     // talon
    noise(out, { dur: 0.06, type: 'lowpass', freq: 500 * p, vol: 0.5 });
    noise(out, { t: 0.015, dur: 0.07, type: 'bandpass', freq: 2200 * p, q: 1.5, vol: 0.22 });      // gravier
  },
  land(pos = null) {
    if (!ctx) return;
    if (sample('land', pos, { vol: pos ? 1.4 : 0.7, ref: 3, far: 35 })) return;
    const out = output(pos, pos ? 1.6 : 0.7, 0.1, 35);
    tone(out, { dur: 0.12, freq: 80, end: 40, vol: 0.9 });
    noise(out, { dur: 0.1, type: 'lowpass', freq: 700, vol: 0.6 });
    noise(out, { t: 0.02, dur: 0.08, type: 'bandpass', freq: 1800, q: 1.2, vol: 0.3 });
  },

  // ---- Mécanique des armes (rechargement, inspection, sortie) ----
  magOut(pos) { if (!ctx || sample('mag_out', pos, { far: 25, ref: 2 })) return; const o = output(pos, 0.9, 0.05, 25); metal(o, 0, 0.5, 2600); noise(o, { t: 0.02, dur: 0.12, type: 'bandpass', freq: 1200, q: 2, vol: 0.25 }); },
  magIn(pos) { if (!ctx || sample('mag_in', pos, { far: 25, ref: 2 })) return; const o = output(pos, 1, 0.08, 25); noise(o, { dur: 0.05, type: 'bandpass', freq: 900, q: 2, vol: 0.6 }); metal(o, 0.03, 0.6, 2300); tone(o, { t: 0.03, dur: 0.06, freq: 180, end: 90, vol: 0.4 }); },
  chargeBack(pos) { if (!ctx || sample('charge_back', pos, { far: 25, ref: 2 })) return; const o = output(pos, 0.9, 0.05, 25); noise(o, { dur: 0.1, type: 'bandpass', freq: 1800, sweep: 1200, q: 3, vol: 0.35 }); metal(o, 0.09, 0.4, 3000); },
  chargeRelease(pos) { if (!ctx || sample('charge_release', pos, { far: 25, ref: 2 })) return; const o = output(pos, 1, 0.1, 25); metal(o, 0, 0.7, 2500); metal(o, 0.012, 0.4, 3800); tone(o, { dur: 0.08, freq: 260, end: 120, vol: 0.35 }); },
  boltUp(pos) { if (!ctx || sample('bolt_open', pos, { far: 25, ref: 2 })) return; const o = output(pos, 0.9, 0.05, 25); metal(o, 0, 0.45, 2800); },
  boltBack(pos) { if (!ctx || buffers.bolt_open) return; /* déjà inclus dans le son "bolt_open" */ const o = output(pos, 0.9, 0.05, 25); noise(o, { dur: 0.12, type: 'bandpass', freq: 1500, sweep: 900, q: 3, vol: 0.35 }); metal(o, 0.11, 0.35, 3300); },
  boltForward(pos) { if (!ctx || sample('bolt_close', pos, { far: 25, ref: 2 })) return; const o = output(pos, 0.9, 0.05, 25); noise(o, { dur: 0.1, type: 'bandpass', freq: 1000, sweep: 1700, q: 3, vol: 0.35 }); metal(o, 0.09, 0.45, 2900); },
  boltDown(pos) { if (!ctx || buffers.bolt_close) return; /* déjà inclus dans le son "bolt_close" */ const o = output(pos, 0.9, 0.05, 25); metal(o, 0, 0.55, 2400); },
  roundIn(pos) { if (!ctx || sample('round_in', pos, { far: 20, ref: 2 })) return; const o = output(pos, 0.8, 0.04, 20); metal(o, 0, 0.35, 3600); noise(o, { t: 0.02, dur: 0.04, type: 'bandpass', freq: 1400, q: 3, vol: 0.2 }); },
  cloth(pos) { if (!ctx || sample('weapon_switch', pos, { vol: 0.45, far: 15 })) return; const o = output(pos, 0.6, 0, 15); noise(o, { dur: 0.16, type: 'bandpass', freq: 900, q: 0.8, vol: 0.18, attack: 0.04 }); },
  knifeFlip(pos) { if (!ctx || sample('knife_flip', pos, { vol: 0.8, far: 15, pitch: 0.12 })) return; const o = output(pos, 0.6, 0.03, 15); metal(o, 0, 0.18, 5200); },

  /** Impact de balle sur un mur */
  impact(pos) { if (ctx) sample('bullet_impact', pos, { vol: 0.8, ref: 3, far: 40, pitch: 0.12 }); },

  /** Bruit de rechargement générique d'un autre joueur (positionné) */
  remoteReload(pos, weapon) {
    if (!ctx) return;
    if (weapon === 'kar98k') { this.boltUp(pos); setTimeout(() => this.boltBack(pos), 200); setTimeout(() => this.roundIn(pos), 700); }
    else if (weapon === 'glock') { this.pistolMagOut(pos); setTimeout(() => this.pistolMagIn(pos), 700); }
    else { this.magOut(pos); setTimeout(() => this.magIn(pos), 900); }
  },

  // ---- Interface ----
  empty() { if (ctx && !sample('empty_click', null, { vol: 0.8 })) metal(output(null, 0.8), 0, 0.3, 4500); },
  hit(head) {
    if (!ctx || sample(head ? 'headshot' : 'hitmarker', null, { reverb: 0, pitch: 0 })) return;
    const o = output(null, 1, 0);
    if (head) { tone(o, { dur: 0.18, freq: 1500, vol: 0.28 }); tone(o, { t: 0.02, dur: 0.22, freq: 2250, vol: 0.18 }); }
    else { noise(o, { dur: 0.04, type: 'bandpass', freq: 2600, q: 4, vol: 0.4 }); tone(o, { dur: 0.05, freq: 1100, vol: 0.12, type: 'square' }); }
  },
  kill() { if (!ctx || sample('kill', null, { reverb: 0, pitch: 0 })) return; const o = output(null, 1, 0); tone(o, { dur: 0.1, freq: 760, vol: 0.2 }); tone(o, { t: 0.08, dur: 0.2, freq: 1140, vol: 0.2 }); },
  hurt() { if (!ctx || sample('hurt', null, { reverb: 0 })) return; const o = output(null, 1, 0); tone(o, { dur: 0.15, freq: 180, end: 90, vol: 0.4, type: 'triangle' }); noise(o, { dur: 0.08, type: 'lowpass', freq: 600, vol: 0.4 }); },
  switchWeapon() { if (!ctx || sample('weapon_switch', null, { vol: 0.7 })) return; this.cloth(); metal(output(null, 0.6), 0.08, 0.25, 3000); },
  roundStart() { if (!ctx || sample('round_start', null, { reverb: 0, pitch: 0 })) return; const o = output(null, 1, 0); tone(o, { dur: 0.12, freq: 523, vol: 0.2 }); tone(o, { t: 0.12, dur: 0.25, freq: 784, vol: 0.2 }); },
  roundEnd(win) {
    if (!ctx || sample(win ? 'round_win' : 'round_lose', null, { reverb: 0, pitch: 0 })) return;
    const o = output(null, 1, 0);
    if (win) { tone(o, { dur: 0.15, freq: 523, vol: 0.2 }); tone(o, { t: 0.12, dur: 0.15, freq: 659, vol: 0.2 }); tone(o, { t: 0.24, dur: 0.35, freq: 784, vol: 0.2 }); }
    else { tone(o, { dur: 0.2, freq: 392, vol: 0.2 }); tone(o, { t: 0.18, dur: 0.4, freq: 311, vol: 0.2 }); }
  },
  slide() { if (ctx && !sample('slide', null, { vol: 0.8 })) noise(output(null, 1, 0), { dur: 0.5, type: 'lowpass', freq: 900, sweep: 300, vol: 0.3, attack: 0.03 }); },
  click() { if (ctx && !sample('ui_click', null, { reverb: 0, pitch: 0 })) tone(output(null, 1, 0), { dur: 0.03, freq: 1200, vol: 0.08, type: 'square' }); },

  // Compatibilité : ancien nom (rechargement complet joué d'un coup)
  reload() {},
  bolt() { this.boltUp(); setTimeout(() => this.boltBack(), 120); setTimeout(() => this.boltForward(), 300); setTimeout(() => this.boltDown(), 420); },
};
