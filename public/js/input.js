// =====================================================================
//  input.js — Clavier + souris + capture du pointeur (pointer lock)
//  + plein écran avec verrouillage clavier (empêche Ctrl+W de fermer
//  l'onglet sur Chrome / Edge / Opera).
//  Tous les boutons de la souris sont utilisables comme des touches :
//  Mouse0 (gauche), Mouse1 (molette), Mouse2 (droit), Mouse3 / Mouse4
//  (boutons latéraux), WheelUp / WheelDown (molette).
// =====================================================================
import { settings } from './settings.js';

// Touches qu'on "verrouille" en plein écran : les raccourcis Ctrl+lettre
// du navigateur (Ctrl+W fermer, Ctrl+T nouvel onglet, Ctrl+R recharger…)
// arrivent alors au jeu au lieu du navigateur. Échap reste libre.
const LOCKED_KEYS = ['KeyW', 'KeyZ', 'KeyQ', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyN', 'KeyR', 'KeyF', 'KeyE', 'KeyC', 'KeyP', 'KeyH', 'KeyJ', 'KeyL', 'KeyO', 'KeyU', 'KeyG', 'Space'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();      // touches / boutons enfoncés
    this.pressed = new Set();   // appuyés CETTE image (pour les actions ponctuelles)
    this.pressedChars = new Set();
    this.dx = 0; this.dy = 0;   // mouvement de souris accumulé
    this.wheel = 0;
    this.enabled = false;       // désactivé dans les menus
    this.onUnlock = null;       // appelé quand le joueur appuie sur Échap

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      // Bloque les raccourcis du navigateur pendant la partie
      if (e.code === 'Tab' || e.code === 'Space' || e.ctrlKey || e.altKey) e.preventDefault();
      this.press(e.code);
      this.pressedChars.add(e.key?.toLowerCase());
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());

    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button >= 1) e.preventDefault(); // pas de défilement auto au clic molette
      this.press(`Mouse${e.button}`);
    });
    addEventListener('mouseup', (e) => {
      this.down.delete(`Mouse${e.button}`);
      if (this.enabled && (e.button === 3 || e.button === 4)) e.preventDefault(); // pas de "page précédente"
    });
    addEventListener('auxclick', (e) => { if (this.enabled) e.preventDefault(); });
    addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); }); // pas de menu au clic droit
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    addEventListener('wheel', (e) => {
      if (!this.locked) return;
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      this.pressed.add(code);
      // Si la molette n'est attribuée à aucune action, elle sert à changer d'arme
      if (!Object.values(settings.keys).includes(code)) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) {
        this.down.clear();
        if (this.enabled) this.onUnlock?.();
      }
    });
  }

  press(code) {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  // Raccourcis utilisés par les armes
  get mouseDown() { return this.is('fire'); }
  get mouseRight() { return this.is('ads'); }
  get mouseClicked() { return this.was('fire'); }

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
  endFrame() { this.pressed.clear(); this.pressedChars.clear(); }
}
