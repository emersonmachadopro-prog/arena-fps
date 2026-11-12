// =====================================================================
//  input.js — Clavier + souris + capture du pointeur (pointer lock)
//  + plein écran avec verrouillage clavier (empêche Ctrl+W de fermer
//  l'onglet sur Chrome / Edge).
// =====================================================================
import { settings } from './settings.js';

// Touches qu'on "verrouille" en plein écran : les raccourcis Ctrl+lettre
// du navigateur (Ctrl+W fermer, Ctrl+T nouvel onglet, Ctrl+R recharger…)
// arrivent alors au jeu au lieu du navigateur. Échap reste libre.
const LOCKED_KEYS = ['KeyW', 'KeyZ', 'KeyQ', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyN', 'KeyR', 'KeyF', 'KeyE', 'KeyC', 'KeyP', 'KeyH', 'KeyJ', 'KeyL', 'KeyO', 'KeyU', 'KeyG', 'Space'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();      // touches enfoncées (event.code)
    this.pressed = new Set();   // touches appuyées CETTE image (pour les actions ponctuelles)
    this.pressedChars = new Set();
    this.mouseDown = false;     // clic gauche (tir)
    this.mouseRight = false;    // clic droit (viser)
    this.mouseClicked = false;
    this.dx = 0; this.dy = 0;   // mouvement de souris accumulé
    this.wheel = 0;
    this.enabled = false;       // désactivé dans les menus
    this.onUnlock = null;       // appelé quand le joueur appuie sur Échap

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      // Bloque les raccourcis du navigateur pendant la partie
      if (e.code === 'Tab' || e.code === 'Space' || e.ctrlKey || e.altKey) e.preventDefault();
      if (!this.down.has(e.code)) { this.pressed.add(e.code); this.pressedChars.add(e.key?.toLowerCase()); }
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouseDown = false; this.mouseRight = false; });

    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouseDown = true; this.mouseClicked = true; }
      if (e.button === 2) this.mouseRight = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseRight = false;
    });
    addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); }); // pas de menu au clic droit
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) {
        this.down.clear(); this.mouseDown = false; this.mouseRight = false;
        if (this.enabled) this.onUnlock?.();
      }
    });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  /** Capture la souris (+ plein écran si activé). Doit être appelé après un clic. */
  lock() {
    if (settings.fullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
        .then(() => navigator.keyboard?.lock?.(LOCKED_KEYS))
        .catch(() => {});
    }
    // Le navigateur peut refuser si on re-capture trop vite après Échap
    try { const p = this.canvas.requestPointerLock(); p?.catch?.(() => {}); } catch { /* ignore */ }
  }
  unlock() { if (this.locked) document.exitPointerLock(); }

  exitFullscreen() {
    navigator.keyboard?.unlock?.();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  /** L'action (ex: 'forward') est-elle maintenue ? */
  is(action) { return this.down.has(settings.keys[action]); }
  /** L'action vient-elle d'être appuyée ? */
  was(action) {
    if (this.pressed.has(settings.keys[action])) return true;
    // Secours pour les navigateurs qui ne connaissent pas la disposition du clavier
    return action === 'loadout' && settings.keys.loadout === 'KeyM' && this.pressedChars.has('m');
  }

  /** Récupère et remet à zéro le mouvement de souris */
  consumeMouse() { const d = [this.dx, this.dy]; this.dx = 0; this.dy = 0; return d; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  /** À appeler à la fin de chaque image */
  endFrame() { this.pressed.clear(); this.pressedChars.clear(); this.mouseClicked = false; }
}
