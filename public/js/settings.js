// =====================================================================
//  settings.js — Paramètres du joueur, sauvegardés dans le navigateur
//  (localStorage). Les touches utilisent "event.code", c'est-à-dire la
//  position physique de la touche : ZQSD sur AZERTY = WASD sur QWERTY.
//  Les boutons de la souris sont aussi utilisables : Mouse0 (gauche),
//  Mouse1 (molette), Mouse2 (droit), Mouse3/Mouse4 (boutons latéraux),
//  WheelUp / WheelDown (molette).
// =====================================================================

// [identifiant, libellé affiché, touche par défaut]
export const ACTIONS = [
  ['fire', 'Tirer', 'Mouse0'],
  ['ads', 'Viser', 'Mouse2'],
  ['forward', 'Avancer', 'KeyW'],
  ['back', 'Reculer', 'KeyS'],
  ['left', 'Aller à gauche', 'KeyA'],
  ['right', 'Aller à droite', 'KeyD'],
  ['sprint', 'Courir (maintenir)', 'ShiftLeft'],
  ['jump', 'Sauter', 'Space'],
  ['crouch', "S'accroupir / glisser en courant", 'KeyC'],
  ['reload', 'Recharger', 'KeyR'],
  ['inspect', "Inspecter l'arme", 'KeyY'],
  ['weapon1', 'Arme principale', 'Digit1'],
  ['weapon2', 'Arme secondaire (Glock)', 'Digit2'],
  ['weapon3', 'Couteau', 'Digit3'],
  ['nextWeapon', 'Arme suivante', 'WheelDown'],
  ['prevWeapon', 'Arme précédente', 'WheelUp'],
  ['loadout', 'Choisir son loadout (prochaine apparition)', 'KeyM'],
  ['scoreboard', 'Tableau des scores', 'Tab'],
];

import { DEFAULT_SKINS } from '/shared/skins.js';
import { PRIMARIES, SECONDARIES, validOptic } from '/shared/constants.js';

const STORAGE_KEY = 'arenastrike.settings.v3';

// Réticule par défaut (personnalisable dans Paramètres)
export const DEFAULT_CROSSHAIR = { style: 'cross', color: '#ffffff', size: 9, gap: 5, thickness: 2, outline: true, dot: false, dynamic: true, opacity: 1 };

export const LOADOUT_COUNT = 5;
function defaultLoadouts() {
  return [
    { name: 'Assaut', primary: 'ak', optic: 'iron', secondary: 'glock' },
    { name: 'Sniper', primary: 'kar98k', optic: 'scope', secondary: 'glock' },
    { name: 'Assaut point rouge', primary: 'ak', optic: 'reddot', secondary: 'glock' },
    { name: 'Tireur à la mire', primary: 'kar98k', optic: 'iron', secondary: 'glock' },
    { name: 'Polyvalent', primary: 'ak', optic: 'mid', secondary: 'glock' },
  ];
}

function defaults() {
  return {
    name: '',
    sensitivity: 1.0,
    fov: 80,
    volume: 0.7,           // volume général
    sfxVolume: 0.8,        // bruitages
    musicVolume: 0.35,     // musique des menus
    graphics: 'high',      // qualité : 'low' | 'medium' | 'high'
    killSound: 'classic',  // pack de sons de kill (d'autres viendront avec les skins)
    crosshair: { ...DEFAULT_CROSSHAIR },
    invertY: false,
    fullscreen: true,      // plein écran en jeu (bloque Ctrl+W sur Chrome/Edge)
    skins: { ...DEFAULT_SKINS },
    // 5 loadouts personnalisables (Inventaire) + celui qui est équipé
    loadouts: defaultLoadouts(),
    activeLoadout: 0,
    keys: Object.fromEntries(ACTIONS.map(([id, , key]) => [id, key])),
  };
}

export const settings = load();

function load() {
  const s = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('arenastrike.settings.v2') || '{}');
    Object.assign(s, saved, { keys: { ...s.keys, ...(saved.keys || {}) }, skins: { ...s.skins, ...(saved.skins || {}) }, crosshair: { ...s.crosshair, ...(saved.crosshair || {}) } });
  } catch { /* stockage indisponible : on garde les valeurs par défaut */ }
  // Vérifie les loadouts (au cas où le fichier sauvegardé est ancien ou abîmé)
  const def = defaultLoadouts();
  s.loadouts = Array.from({ length: LOADOUT_COUNT }, (_, i) => {
    const l = { ...def[i], ...(s.loadouts?.[i] || {}) };
    if (!PRIMARIES.includes(l.primary)) l.primary = def[i].primary;
    l.optic = validOptic(l.primary, l.optic);
    if (!SECONDARIES.includes(l.secondary)) l.secondary = 'glock';
    if (l.knife !== 'butterfly') l.knife = 'combat'; // couteau de combat ou papillon (cosmétique)
    l.name = String(l.name || def[i].name).slice(0, 24);
    return l;
  });
  if (!(s.activeLoadout >= 0 && s.activeLoadout < LOADOUT_COUNT)) s.activeLoadout = 0;
  delete s.primary;
  return s;
}

/** Le loadout actuellement équipé : { name, primary, optic } */
export function activeLoadout() { return settings.loadouts[settings.activeLoadout]; }

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
  Mouse0: 'Clic gauche', Mouse1: 'Clic molette', Mouse2: 'Clic droit', Mouse3: 'Souris 4', Mouse4: 'Souris 5',
  WheelUp: 'Molette ↑', WheelDown: 'Molette ↓',
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
