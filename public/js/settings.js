// =====================================================================
//  settings.js — Paramètres du joueur, sauvegardés dans le navigateur
//  (localStorage). Les touches utilisent "event.code", c'est-à-dire la
//  position physique de la touche : ZQSD sur AZERTY = WASD sur QWERTY.
// =====================================================================

// [identifiant, libellé affiché, touche par défaut]
export const ACTIONS = [
  ['forward', 'Avancer', 'KeyW'],
  ['back', 'Reculer', 'KeyS'],
  ['left', 'Aller à gauche', 'KeyA'],
  ['right', 'Aller à droite', 'KeyD'],
  ['sprint', 'Courir (maintenir)', 'ShiftLeft'],
  ['jump', 'Sauter', 'Space'],
  ['crouch', "S'accroupir / glisser en courant", 'KeyC'],
  ['reload', 'Recharger', 'KeyR'],
  ['weapon1', 'Arme principale', 'Digit1'],
  ['weapon2', 'Couteau', 'Digit2'],
  ['loadout', "Choisir son arme (prochaine apparition)", 'KeyM'],
  ['scoreboard', 'Tableau des scores', 'Tab'],
];

import { DEFAULT_SKINS } from '/shared/skins.js';

const STORAGE_KEY = 'arenastrike.settings.v2';

function defaults() {
  return {
    name: '',
    sensitivity: 1.0,
    fov: 80,
    volume: 0.6,
    invertY: false,
    fullscreen: true,      // plein écran en jeu (bloque Ctrl+W sur Chrome/Edge)
    primary: 'ak',         // arme principale choisie
    skins: { ...DEFAULT_SKINS },
    keys: Object.fromEntries(ACTIONS.map(([id, , key]) => [id, key])),
  };
}

export const settings = load();

function load() {
  const s = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    Object.assign(s, saved, { keys: { ...s.keys, ...(saved.keys || {}) }, skins: { ...s.skins, ...(saved.skins || {}) } });
  } catch { /* stockage indisponible : on garde les valeurs par défaut */ }
  return s;
}

const listeners = [];
/** Appelé à chaque modification (ex : pour changer le FOV en direct). */
export function onSettingsChange(fn) { listeners.push(fn); }

export function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  listeners.forEach(fn => fn(settings));
}

export function resetSettings() {
  const name = settings.name;
  Object.assign(settings, defaults(), { name });
  saveSettings();
}

// ---- Affichage lisible du nom d'une touche (en tenant compte d'AZERTY si possible) ----
let layoutMap = null;
navigator.keyboard?.getLayoutMap?.().then(m => {
  layoutMap = m;
  // Sur AZERTY, la touche "M" n'est pas au même endroit qu'en QWERTY :
  // on place la touche "Choisir son arme" sur la vraie touche M du clavier.
  if (settings.keys.loadout === 'KeyM' && m.get('KeyM') !== 'm') {
    for (const [code, ch] of m) if (ch === 'm') { settings.keys.loadout = code; break; }
  }
}).catch(() => {});

const NAMES = {
  Space: 'Espace', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche',
  ControlRight: 'Ctrl droite', AltLeft: 'Alt', Tab: 'Tab', Enter: 'Entrée', Backspace: 'Retour',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Verr. Maj',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  const fromLayout = layoutMap?.get(code);
  if (fromLayout) return fromLayout.toUpperCase();
  return code.replace(/^Key|^Digit/, '');
}
