// =====================================================================
//  audio.js — Sons générés par le code (Web Audio API), aucun fichier
//  audio à télécharger. Le volume suit les paramètres.
// =====================================================================
import { settings, onSettingsChange } from './settings.js';

let ctx = null, master = null, noiseBuf = null;

/** Le navigateur n'autorise le son qu'après un clic : on initialise à ce moment. */
export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = settings.volume;
  master.connect(ctx.destination);
  // Bruit blanc réutilisable (base des sons de tir)
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}
onSettingsChange(s => { if (master) master.gain.value = s.volume; });

function noise(dur, freq, q, vol, type = 'lowpass', t0 = 0) {
  const t = ctx.currentTime + t0;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + dur);
}

function tone(freq, dur, vol, type = 'sine', t0 = 0, endFreq = null) {
  const t = ctx.currentTime + t0;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  /** volume 0..1 (pour les tirs lointains) */
  shot(vol = 1) {
    if (!ctx || vol < 0.02) return;
    noise(0.18, 2500, 0.7, 0.5 * vol);
    noise(0.09, 900, 1, 0.6 * vol, 'bandpass');
    tone(140, 0.12, 0.5 * vol, 'triangle', 0, 50);
  },
  sniper(vol = 1) {
    if (!ctx || vol < 0.02) return;
    noise(0.45, 1800, 0.6, 0.7 * vol);
    noise(0.15, 600, 1, 0.7 * vol, 'bandpass');
    tone(90, 0.3, 0.6 * vol, 'triangle', 0, 35);
  },
  bolt() { if (!ctx) return; noise(0.05, 2000, 8, 0.3, 'bandpass'); noise(0.05, 1400, 8, 0.3, 'bandpass', 0.18); },
  knife(vol = 1) { if (!ctx) return; noise(0.15, 3000, 4, 0.25 * vol, 'bandpass'); },
  reload() {
    if (!ctx) return;
    noise(0.05, 1800, 6, 0.3, 'bandpass', 0.2);
    noise(0.05, 1200, 6, 0.3, 'bandpass', 1.1);
    noise(0.06, 2200, 8, 0.35, 'bandpass', 1.9);
  },
  empty() { if (ctx) noise(0.03, 3000, 10, 0.2, 'bandpass'); },
  hit(head) {
    if (!ctx) return;
    if (head) { tone(1400, 0.15, 0.25, 'sine'); tone(2100, 0.2, 0.15, 'sine', 0.03); }
    else tone(900, 0.06, 0.2, 'square');
  },
  kill() { if (ctx) { tone(700, 0.1, 0.2, 'sine'); tone(1050, 0.18, 0.2, 'sine', 0.08); } },
  hurt() { if (ctx) tone(220, 0.15, 0.3, 'sawtooth', 0, 120); },
  switchWeapon() { if (ctx) noise(0.04, 2500, 5, 0.2, 'bandpass'); },
  roundStart() { if (ctx) { tone(523, 0.12, 0.2); tone(784, 0.25, 0.2, 'sine', 0.12); } },
  roundEnd(win) {
    if (!ctx) return;
    if (win) { tone(523, 0.15, 0.2); tone(659, 0.15, 0.2, 'sine', 0.12); tone(784, 0.35, 0.2, 'sine', 0.24); }
    else { tone(392, 0.2, 0.2); tone(311, 0.4, 0.2, 'sine', 0.18); }
  },
  slide() { if (ctx) noise(0.5, 900, 0.8, 0.25, 'lowpass'); },
  click() { if (ctx) tone(1200, 0.03, 0.08, 'square'); },
};
