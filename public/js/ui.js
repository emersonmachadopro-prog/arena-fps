// =====================================================================
//  ui.js — Menus HTML : navigation entre écrans, paramètres, lobby,
//  casier (skins), choix d'arme, écran de fin.
// =====================================================================
import { ACTIONS, settings, saveSettings, resetSettings, keyLabel, activeLoadout } from './settings.js';
import { TEAMS, WEAPONS, PRIMARIES, SECONDARIES, OPTICS, WEAPON_OPTICS, BOT_LEVELS, validOptic } from '/shared/constants.js';
import { GLOVE_SKINS, WEAPON_SKINS, CHARACTER_SKINS } from '/shared/skins.js';
import { escapeHtml } from './hud.js';
import { sfx, initAudio, KILL_SOUND_PACKS } from './audio.js';
import { drawCrosshair, CROSSHAIR_STYLES } from './crosshair.js';

export const $ = (id) => document.getElementById(id);
const SCREENS = ['menu-main', 'menu-lobby', 'menu-lobby-skins', 'menu-pause', 'menu-settings', 'menu-end', 'menu-click', 'menu-loadout'];

/** Affiche un écran (ou aucun avec null) */
export function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  document.body.classList.toggle('in-menu', !!id && id !== 'menu-click');
}
export function currentScreen() { return SCREENS.find(s => !$(s).classList.contains('hidden')) || null; }

export function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const shade = (n, k) => {
  const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
};

// ---------------------------------------------------------------------
//  Dessins SVG des armes (vue de profil, avec reflets) et des tenues
// ---------------------------------------------------------------------
let svgId = 0;
export function weaponSVG(id, skinId = 'default', optic = null) {
  const s = WEAPON_SKINS[skinId] || WEAPON_SKINS.default;
  const u = `w${svgId++}`; // identifiants uniques (plusieurs SVG dans la page)
  const body = hex(s.body), acc = hex(s.accent), dark = shade(s.body, 0.55), light = shade(s.body, 1.5), accL = shade(s.accent, 1.35), accD = shade(s.accent, 0.7);
  const glow = s.glow ? `filter="url(#${u}g)"` : '';
  const defs = `<defs>
    <filter id="${u}g"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="${u}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".45" stop-color="${body}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
    <linearGradient id="${u}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accL}"/><stop offset=".6" stop-color="${acc}"/><stop offset="1" stop-color="${accD}"/></linearGradient>
    <linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8edf5"/><stop offset=".5" stop-color="#aab4c4"/><stop offset="1" stop-color="#6c7688"/></linearGradient>
  </defs>`;
  const M = `url(#${u}m)`, A = `url(#${u}a)`;
  if (id === 'knife') {
    const blade = skinId === 'default' ? `url(#${u}b)` : M;
    return `<svg viewBox="0 0 200 70">${defs}
      <path d="M78 33 L150 28 Q168 30 182 36 Q166 40 150 41 L78 40 Z" fill="${blade}" ${glow}/>
      <path d="M86 35 L150 33" stroke="rgba(255,255,255,.55)" stroke-width="1"/>
      <rect x="70" y="25" width="9" height="21" rx="2" fill="#3b4049"/>
      <path d="M22 31 Q20 36 22 41 L70 42 L70 30 Z" fill="${A}" ${glow}/>
      ${[30, 40, 50, 60].map(x => `<rect x="${x}" y="30" width="3" height="12" fill="rgba(0,0,0,.25)"/>`).join('')}
      <circle cx="20" cy="36" r="4" fill="#3b4049"/></svg>`;
  }
  if (id === 'butterfly') {
    const H = skinId === 'default' || !skinId ? '#2b2f37' : A;
    return `<svg viewBox="0 0 200 70">${defs}
      <path d="M100 33 L160 31 Q176 33 186 36 Q170 39 160 40 L100 39 Z" fill="url(#${u}b)" ${glow}/>
      <path d="M108 35 L156 34" stroke="rgba(255,255,255,.55)" stroke-width="1"/>
      <rect x="14" y="26" width="86" height="7" rx="2.5" fill="${H}"/><rect x="14" y="39" width="86" height="7" rx="2.5" fill="${H}"/>
      ${[24, 38, 52, 66, 80].map(x => `<rect x="${x}" y="28" width="8" height="3" rx="1" fill="rgba(0,0,0,.55)"/><rect x="${x}" y="41" width="8" height="3" rx="1" fill="rgba(0,0,0,.55)"/>`).join('')}
      <circle cx="98" cy="29.5" r="2.4" fill="#c9a04a"/><circle cx="98" cy="42.5" r="2.4" fill="#c9a04a"/>
      <rect x="8" y="27" width="6" height="5" rx="1" fill="#c9a04a"/></svg>`;
  }
  if (id === 'mp5') {
    return `<svg viewBox="0 0 200 70">${defs}
      <rect x="8" y="22" width="4" height="30" rx="1.5" fill="#1d2026"/>
      <rect x="10" y="26" width="38" height="3" fill="${M}"/><rect x="10" y="38" width="38" height="3" fill="${M}"/>
      <rect x="46" y="22" width="80" height="16" rx="3" fill="${M}" ${glow}/>
      <rect x="48" y="19" width="76" height="4" rx="1.5" fill="${dark}"/>
      ${[56, 76, 96, 112].map(x => `<rect x="${x}" y="30" width="3" height="3" rx="1" fill="rgba(0,0,0,.4)"/>`).join('')}
      <rect x="124" y="24" width="40" height="14" rx="3" fill="${A}" ${glow}/>
      ${[0, 1, 2].map(i => `<rect x="126" y="${27 + i * 3.5}" width="36" height="1.4" fill="rgba(0,0,0,.35)"/>`).join('')}
      <rect x="120" y="16" width="52" height="5" rx="2" fill="${M}"/>
      <rect x="164" y="27" width="22" height="6" rx="1.5" fill="${dark}"/><rect x="184" y="25" width="8" height="10" rx="2" fill="${dark}"/>
      <circle cx="160" cy="12" r="4.5" fill="none" stroke="${dark}" stroke-width="2"/><rect x="157" y="14" width="6" height="5" fill="${dark}"/>
      <path d="M100 38 L114 38 Q112 52 110 62 L100 62 Q104 50 100 38 Z" fill="#1d2026"/>
      <path d="M68 38 L84 38 L88 58 Q82 62 76 60 Z" fill="${A}"/>
      <path d="M84 38 Q88 46 96 46 L96 38" fill="none" stroke="${dark}" stroke-width="2"/>
      <rect x="150" y="18" width="10" height="4" fill="#1d2026"/>${opticSVG(optic, 70, 19)}</svg>`;
  }
  if (id === 'shotgun') {
    return `<svg viewBox="0 0 200 70">${defs}
      <path d="M4 30 Q20 28 46 27 L52 33 L50 40 Q30 46 8 50 Q2 46 4 30 Z" fill="${A}" ${glow}/>
      <path d="M12 33 Q30 31 44 30" stroke="rgba(255,255,255,.2)" stroke-width="1.5" fill="none"/>
      <rect x="50" y="24" width="40" height="16" rx="3" fill="${M}"/>
      <rect x="62" y="28" width="16" height="5" rx="1" fill="rgba(0,0,0,.5)"/>
      <rect x="88" y="26" width="108" height="5" rx="2" fill="${M}"/>
      <rect x="90" y="32" width="88" height="5" rx="2" fill="${dark}"/>
      <rect x="112" y="30" width="40" height="11" rx="4" fill="${A}" ${glow}/>
      ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${116 + i * 6}" y="31" width="2" height="9" fill="rgba(0,0,0,.3)"/>`).join('')}
      <circle cx="193" cy="25" r="1.6" fill="#ece6d6"/>
      <path d="M58 40 Q62 50 72 48 L72 40" fill="none" stroke="${dark}" stroke-width="2"/>
      <rect x="64" y="40" width="2.5" height="6" fill="${dark}"/>${opticSVG(optic, 64, 24)}</svg>`;
  }
  if (id === 'glock') {
    const F = skinId === 'default' || !skinId ? '#25282f' : A; // carcasse en polymère noir par défaut
    return `<svg viewBox="0 0 200 70">${defs}
      <rect x="54" y="16" width="96" height="16" rx="2.5" fill="${M}" ${glow}/>
      ${[60, 64, 68, 72, 76].map(x => `<rect x="${x}" y="18" width="2" height="12" fill="rgba(0,0,0,.35)"/>`).join('')}
      <rect x="92" y="19" width="22" height="5" rx="1" fill="rgba(0,0,0,.55)"/>
      <rect x="142" y="12" width="4" height="4" fill="${dark}"/><rect x="58" y="12" width="7" height="4" fill="${dark}"/>
      <path d="M58 32 L150 32 L148 40 L104 40 L100 46 Q92 50 86 46 L82 40 L80 40 L84 62 Q84 66 80 66 L62 66 Q58 66 58 62 L54 40 Z" fill="${F}" ${glow}/>
      <path d="M86 40 Q92 47 100 40" fill="none" stroke="${dark}" stroke-width="2"/>
      <rect x="92" y="38" width="3" height="7" rx="1" fill="#15171c"/>
      ${[0, 1, 2, 3, 4].map(i => `<rect x="${62 + i * 3.6}" y="${44 + i * 0.6}" width="1.6" height="16" fill="rgba(0,0,0,.18)"/>`).join('')}</svg>`;
  }
  if (id === 'kar98k') {
    return `<svg viewBox="0 0 200 70">${defs}
      <path d="M4 34 Q20 31 46 29 L58 33 L156 33 L156 40 L60 41 L46 45 Q30 50 6 50 Q2 44 4 34 Z" fill="${A}" ${glow}/>
      <path d="M10 37 Q30 34 44 33" stroke="rgba(255,255,255,.2)" stroke-width="1.5" fill="none"/>
      <rect x="46" y="28" width="46" height="7" rx="3" fill="${M}"/>
      <rect x="90" y="30" width="106" height="3.5" rx="1.5" fill="${M}"/>
      <rect x="120" y="29" width="5" height="12" rx="1" fill="${dark}"/><rect x="146" y="29" width="5" height="12" rx="1" fill="${dark}"/>
      <path d="M62 32 L70 32 L72 38" stroke="${light}" stroke-width="2.4" fill="none"/><circle cx="73" cy="39" r="2.8" fill="${light}"/>
      <path d="M58 41 Q62 49 70 47 L70 41" fill="none" stroke="${dark}" stroke-width="2"/>
      <rect x="193" y="25" width="2" height="5" fill="${dark}"/>
      ${opticSVG(optic, 58, 28)}</svg>`;
  }
  return `<svg viewBox="0 0 200 70">${defs}
    <path d="M6 30 Q20 28 46 26 L50 39 Q30 46 10 48 Q4 46 4 40 Z" fill="${A}" ${glow}/>
    <rect x="46" y="23" width="56" height="14" rx="2" fill="${M}"/>
    <path d="M48 23 Q74 18 98 23" fill="${dark}"/>
    ${[56, 64, 72].map(x => `<rect x="${x}" y="21" width="1.5" height="3" fill="rgba(0,0,0,.4)"/>`).join('')}
    <rect x="100" y="25" width="34" height="10" rx="2" fill="${A}" ${glow}/>
    <rect x="100" y="21" width="34" height="4" rx="1.5" fill="${A}"/>
    <rect x="132" y="27" width="50" height="4" fill="${M}"/><rect x="134" y="22" width="30" height="3" rx="1" fill="${M}"/>
    <rect x="178" y="24" width="12" height="9" rx="1.5" fill="${dark}"/><rect x="170" y="17" width="3" height="7" fill="${dark}"/>
    <path d="M76 37 L94 37 Q98 50 100 60 Q92 64 86 62 Q82 50 76 37 Z" fill="${dark}"/>
    ${[0, 1, 2].map(i => `<path d="M${79 + i * 3} ${42 + i * 7} L${94 + i * 2} ${41 + i * 7}" stroke="rgba(255,255,255,.12)" stroke-width="1.5"/>`).join('')}
    <path d="M58 37 L68 37 L64 54 L54 54 Z" fill="${A}"/>
    <path d="M68 37 Q70 44 76 44" fill="none" stroke="${dark}" stroke-width="1.8"/>
    <rect x="80" y="30" width="10" height="3" rx="1" fill="${light}"/>${opticSVG(optic, 62, 23)}</svg>`;
}

/** Petit dessin du viseur posé sur l'arme (x = position, y = hauteur du rail) */
export function opticSVG(optic, x, y) {
  const c = '#15171c';
  if (optic === 'reddot') return `<rect x="${x}" y="${y - 4}" width="16" height="4" fill="${c}"/><path d="M${x + 2} ${y - 4} v-9 h12 v9" fill="none" stroke="${c}" stroke-width="3"/><circle cx="${x + 8}" cy="${y - 9}" r="1.6" fill="#ff3b3b"/>`;
  if (optic === 'mid') return `<rect x="${x - 2}" y="${y - 5}" width="20" height="5" fill="${c}"/><rect x="${x - 6}" y="${y - 13}" width="30" height="8" rx="3" fill="${c}"/><rect x="${x - 10}" y="${y - 15}" width="6" height="12" rx="2" fill="${c}"/>`;
  if (optic === 'scope') return `<rect x="${x - 8}" y="${y - 14}" width="44" height="7" rx="3" fill="${c}"/><rect x="${x + 32}" y="${y - 16}" width="10" height="11" rx="3" fill="${c}"/><rect x="${x}" y="${y - 7}" width="4" height="7" fill="${c}"/><rect x="${x + 22}" y="${y - 7}" width="4" height="7" fill="${c}"/>`;
  return '';
}

function gloveSVG(g) {
  const c = hex(g.color), p = hex(g.plate), skin = '#c99a72';
  const tip = g.style === 'full' ? c : skin;
  const base = g.style === 'bare' ? skin : c;
  return `<svg viewBox="0 0 60 80">
    ${[0, 1, 2, 3].map(i => `<rect x="${14 + i * 8.5}" y="${12 + (i === 0 || i === 3 ? 6 : 0)}" width="7.5" height="16" rx="3" fill="${base}"/><rect x="${14 + i * 8.5}" y="${8 + (i === 0 || i === 3 ? 6 : 0)}" width="7.5" height="9" rx="3.5" fill="${tip}"/>`).join('')}
    <rect x="12" y="26" width="36" height="30" rx="7" fill="${base}"/>
    <rect x="4" y="34" width="12" height="20" rx="5" fill="${base}" transform="rotate(-25 10 44)"/>
    ${g.style !== 'bare' ? `<rect x="17" y="31" width="26" height="14" rx="4" fill="${p}"/><rect x="11" y="56" width="38" height="9" rx="3" fill="#1c1b19"/>` : ''}
    <rect x="13" y="65" width="34" height="12" rx="3" fill="#2c3244"/></svg>`;
}

export function characterSVG(skinId = 'default') {
  const s = CHARACTER_SKINS[skinId] || CHARACTER_SKINS.default;
  const suit = hex(s.suit), vest = hex(s.vest);
  return `<svg viewBox="0 0 60 80">
    <rect x="21" y="4" width="18" height="8" rx="2" fill="#1a1c22"/><rect x="22" y="10" width="16" height="12" rx="2" fill="#c99a72"/>
    <rect x="25" y="14" width="10" height="3" fill="#2b2f38"/>
    <rect x="16" y="23" width="28" height="24" rx="3" fill="${suit}"/><rect x="17" y="26" width="26" height="16" rx="2" fill="${vest}"/>
    <rect x="8" y="24" width="8" height="22" rx="3" fill="${suit}"/><rect x="44" y="24" width="8" height="22" rx="3" fill="${suit}"/>
    <rect x="19" y="47" width="10" height="27" rx="2" fill="${suit}"/><rect x="31" y="47" width="10" height="27" rx="2" fill="${suit}"/>
    <rect x="18" y="72" width="12" height="6" rx="2" fill="#15171d"/><rect x="30" y="72" width="12" height="6" rx="2" fill="#15171d"/></svg>`;
}

// ---------------------------------------------------------------------
//  Onglets du menu principal
// ---------------------------------------------------------------------
export function initTabs(onChange) {
  document.querySelectorAll('.topnav .tab[data-tab]').forEach(b => {
    b.onclick = () => { sfx.click(); showTab(b.dataset.tab); onChange?.(b.dataset.tab); };
  });
}
export function showTab(tab) {
  document.querySelectorAll('.topnav .tab[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  for (const t of ['play', 'skins', 'inventory']) $(`tab-${t}`).classList.toggle('hidden', t !== tab);
}

// ---------------------------------------------------------------------
//  Personnage : uniquement la tenue (les skins d'armes sont dans l'Inventaire)
// ---------------------------------------------------------------------
export function initCharacterGrid(gridEl, onChange) {
  function render() {
    gridEl.innerHTML = '';
    for (const [id, skin] of Object.entries(CHARACTER_SKINS)) {
      const tile = document.createElement('div');
      tile.className = 'skin-tile' + (settings.skins.character === id ? ' selected' : '');
      tile.innerHTML = characterSVG(id) + `<div class="sname">${skin.name}</div>`;
      tile.onclick = () => { settings.skins.character = id; saveSettings(); sfx.click(); render(); onChange('character'); };
      gridEl.appendChild(tile);
    }
    // Gants (visibles en vue à la 1re personne)
    const title = document.createElement('div');
    title.className = 'grid-title'; title.textContent = '🧤 Gants';
    gridEl.appendChild(title);
    for (const [id, g] of Object.entries(GLOVE_SKINS)) {
      const tile = document.createElement('div');
      tile.className = 'skin-tile' + ((settings.skins.gloves || 'default') === id ? ' selected' : '');
      tile.innerHTML = gloveSVG(g) + `<div class="sname">${g.name}</div>`;
      tile.onclick = () => { settings.skins.gloves = id; saveSettings(); sfx.click(); render(); onChange('gloves'); };
      gridEl.appendChild(tile);
    }
  }
  return render;
}

/** Grille des skins d'une arme (dans l'Inventaire) */
function weaponSkinGrid(gridEl, weaponId, onChange) {
  gridEl.innerHTML = '';
  for (const [id, skin] of Object.entries(WEAPON_SKINS)) {
    const tile = document.createElement('div');
    tile.className = 'skin-tile' + (settings.skins[weaponId] === id ? ' selected' : '');
    tile.innerHTML = weaponSVG(weaponId, id) + `<div class="sname">${skin.name}</div>`;
    tile.onclick = () => { settings.skins[weaponId] = id; saveSettings(); sfx.click(); onChange(); };
    gridEl.appendChild(tile);
  }
}

// ---------------------------------------------------------------------
//  Inventaire : 5 loadouts. Chaque loadout = 3 emplacements
//  (arme principale + viseur, arme secondaire, couteau) avec leurs skins.
// ---------------------------------------------------------------------
let editing = null;            // index du loadout affiché
let category = 'primary';      // emplacement ouvert

const WEAPON_INFO = {
  ak: { desc: 'Fusil d\'assaut automatique. Polyvalent, efficace à moyenne distance.', stats: { Dégâts: 35, Cadence: 90, Précision: 60, Portée: 65, Mobilité: 75 } },
  kar98k: { desc: 'Fusil à verrou. Un tir à la tête = un kill. Mire de base, lunette en option.', stats: { Dégâts: 95, Cadence: 15, Précision: 98, Portée: 100, Mobilité: 50 } },
  mp5: { desc: 'Mitraillette rapide et maniable. Précise même sans viser, idéale en courte et moyenne distance.', stats: { Dégâts: 28, Cadence: 98, Précision: 70, Portée: 45, Mobilité: 90 } },
  shotgun: { desc: 'Fusil à pompe. Dévastateur de près (un tir bien placé = un kill), inutile de loin. Pompe après chaque tir.', stats: { Dégâts: 100, Cadence: 20, Précision: 40, Portée: 15, Mobilité: 70 } },
  glock: { desc: 'Pistolet semi-automatique de 17 coups. Sortie rapide, parfait en dépannage.', stats: { Dégâts: 22, Cadence: 70, Précision: 55, Portée: 35, Mobilité: 95 } },
  knife: { desc: 'Toujours avec toi. Rapide, silencieux, mortel au corps à corps.', stats: { Dégâts: 55, Cadence: 60, Précision: 100, Portée: 5, Mobilité: 100 } },
};
const CATS = [
  { id: 'primary', label: 'Arme principale', key: '1' },
  { id: 'secondary', label: 'Arme secondaire', key: '2' },
  { id: 'knife', label: 'Couteau', key: '3' },
];

/** onChange() est appelé quand un loadout est modifié ou équipé */
export function initInventory(onChange) {
  const changed = () => { render(); onChange(); };
  function render() {
    if (editing === null) editing = settings.activeLoadout;
    const l = settings.loadouts[editing];
    // Liste des 5 loadouts
    const list = $('loadout-list');
    list.innerHTML = '';
    settings.loadouts.forEach((lo, i) => {
      const b = document.createElement('button');
      b.className = 'lslot' + (i === editing ? ' selected' : '');
      b.innerHTML = `<span class="num">${i + 1}</span><span>${escapeHtml(lo.name)}<span class="lsub">${WEAPONS[lo.primary].name} · ${WEAPONS[lo.secondary || 'glock'].name}</span></span>
        ${i === settings.activeLoadout ? '<span class="on">ÉQUIPÉ</span>' : ''}`;
      b.onclick = () => { editing = i; sfx.click(); render(); };
      list.appendChild(b);
    });
    // En-tête : nom + équiper
    const name = $('lo-name');
    if (document.activeElement !== name) name.value = l.name;
    name.oninput = (e) => { l.name = e.target.value.slice(0, 24) || `Loadout ${editing + 1}`; saveSettings(); list.children[editing].querySelector('span:nth-child(2)').firstChild.textContent = l.name; };
    const eq = $('lo-equip');
    const active = editing === settings.activeLoadout;
    eq.disabled = active; eq.textContent = active ? '✔ Équipé' : 'Équiper ce loadout'; eq.classList.toggle('primary', !active);
    eq.onclick = () => { settings.activeLoadout = editing; saveSettings(); sfx.click(); changed(); };

    // Rangée de cartes (style armurerie)
    const row = $('cat-row');
    row.innerHTML = '';
    for (const c of CATS) {
      const wid = c.id === 'primary' ? l.primary : c.id === 'secondary' ? (l.secondary || 'glock') : 'knife';
      const optic = c.id === 'primary' ? l.optic : null;
      const skin = WEAPON_SKINS[settings.skins[wid]] || WEAPON_SKINS.default;
      const st = WEAPON_INFO[wid].stats;
      const card = document.createElement('button');
      card.className = 'cat-card' + (c.id === category ? ' selected' : '');
      card.innerHTML = `<div class="cat-label"><span>${c.label}</span><kbd>${c.key}</kbd></div>
        <div class="cat-art">${weaponSVG(wid === 'knife' && l.knife === 'butterfly' ? 'butterfly' : wid, settings.skins[wid], optic)}</div>
        <div class="cat-name">${wid === 'knife' && l.knife === 'butterfly' ? 'Papillon' : WEAPONS[wid].name}</div>
        <div class="cat-sub">${optic ? OPTICS[optic].name + ' · ' : ''}Skin ${skin.name}</div>
        <div class="cat-bars">${['Dégâts', 'Cadence', 'Mobilité'].map(k => `<div><span>${k}</span><i><b style="width:${st[k]}%"></b></i></div>`).join('')}</div>
        <div class="cat-actions"><span>${c.id === 'knife' ? 'SKINS' : 'MODIFIER'}</span><span>${c.id === 'primary' ? 'ARMURERIE' : 'SKINS'}</span></div>`;
      card.onclick = () => { category = c.id; sfx.click(); render(); };
      row.appendChild(card);
    }

    // Détail de l'emplacement ouvert
    const d = $('cat-detail');
    if (category === 'primary') {
      d.innerHTML = `<h3>Arme principale</h3><div class="weapon-cards" id="lo-weapons"></div>
        <h3>Viseur (${WEAPONS[l.primary].name})</h3><div class="optic-grid" id="lo-optics"></div>
        <h3>Skin (${WEAPONS[l.primary].name})</h3><div class="skin-grid" id="lo-skins"></div>`;
      renderWeaponCards($('lo-weapons'), PRIMARIES, l.primary, (id) => { l.primary = id; l.optic = validOptic(id, l.optic); saveSettings(); changed(); }, l.optic);
      const og = $('lo-optics');
      for (const o of WEAPON_OPTICS[l.primary]) {
        const b = document.createElement('button');
        b.className = 'ocard' + (o === l.optic ? ' selected' : '');
        b.innerHTML = `<svg viewBox="40 0 60 30">${opticSVG(o, 62, 26) || '<text x="70" y="22" fill="#8d94a8" font-size="10" text-anchor="middle">mire</text>'}</svg><b>${OPTICS[o].name}</b><small>${OPTICS[o].desc} · x${OPTICS[o].zoom}</small>`;
        b.onclick = () => { l.optic = o; saveSettings(); sfx.click(); changed(); };
        og.appendChild(b);
      }
      weaponSkinGrid($('lo-skins'), l.primary, changed);
    } else if (category === 'secondary') {
      d.innerHTML = `<h3>Arme secondaire</h3><div class="weapon-cards" id="lo-weapons"></div>
        <h3>Skin (${WEAPONS[l.secondary || 'glock'].name})</h3><div class="skin-grid" id="lo-skins"></div>`;
      renderWeaponCards($('lo-weapons'), SECONDARIES, l.secondary || 'glock', (id) => { l.secondary = id; saveSettings(); changed(); });
      weaponSkinGrid($('lo-skins'), l.secondary || 'glock', changed);
    } else {
      d.innerHTML = `<h3>Couteau</h3><div class="weapon-cards" id="lo-knives"></div><h3>Skin</h3><div class="skin-grid" id="lo-skins"></div>`;
      const box = $('lo-knives');
      for (const [id, name, desc] of [['combat', 'Couteau de combat', 'Le classique : solide et sobre.'], ['butterfly', 'Couteau papillon', 'Balisong : sortie en rotation, et des figures autour de l\'annulaire à l\'inspection (Y).']]) {
        const b = document.createElement('button');
        b.className = 'wcard' + ((l.knife || 'combat') === id ? ' selected' : '');
        b.innerHTML = `<div class="wname">${name}${(l.knife || 'combat') === id ? '<small>Choisi</small>' : ''}</div>${weaponSVG(id === 'butterfly' ? 'butterfly' : 'knife', settings.skins.knife)}<div class="wdesc">${desc}</div>`;
        b.onclick = () => { l.knife = id; saveSettings(); sfx.click(); changed(); };
        box.appendChild(b);
      }
      weaponSkinGrid($('lo-skins'), 'knife', changed);
    }
  }
  return render;
}

// ---------------------------------------------------------------------
//  Cartes d'armes
// ---------------------------------------------------------------------
export function renderWeaponCards(container, ids, selected, onPick, optic = null) {
  container.innerHTML = '';
  for (const id of ids) {
    const info = WEAPON_INFO[id];
    const card = document.createElement('button');
    card.className = 'wcard' + (id === selected ? ' selected' : '');
    card.innerHTML = `<div class="wname">${WEAPONS[id].name}${id === selected ? '<small>Choisie</small>' : ''}</div>
      ${weaponSVG(id, settings.skins[id], id === selected ? optic : null)}
      <div class="wdesc">${info.desc}</div>
      ${Object.entries(info.stats).map(([k, v]) => `<div class="stat"><span>${k}</span><div class="bar"><i style="width:${v}%"></i></div></div>`).join('')}`;
    card.onclick = () => { sfx.click(); onPick(id); };
    container.appendChild(card);
  }
}

/** Les 5 loadouts sous forme de cartes cliquables (menu M en jeu) */
export function renderLoadoutCards(container, selected, onPick) {
  container.innerHTML = '';
  settings.loadouts.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'lcard' + (i === selected ? ' selected' : '');
    b.innerHTML = `<b>${i + 1}. ${escapeHtml(l.name)}</b>${weaponSVG(l.primary, settings.skins[l.primary], l.optic)}<small>${WEAPONS[l.primary].name} · ${OPTICS[l.optic].name} · ${WEAPONS[l.secondary || 'glock'].name}</small>`;
    b.onclick = () => { sfx.click(); onPick(i); };
    container.appendChild(b);
  });
}

// ---------------------------------------------------------------------
//  Onglet Jouer : loadout équipé
// ---------------------------------------------------------------------
export function renderMainSide() {
  const l = activeLoadout();
  const sec = l.secondary || 'glock';
  void 0;
  $('equipped-card').innerHTML = `<div class="card-title">🎒 Loadout équipé</div>
    <div class="equipped"><div class="lname">${escapeHtml(l.name)}</div>
    ${weaponSVG(l.primary, settings.skins[l.primary], l.optic)}
    <div class="eq-mini">${weaponSVG(sec, settings.skins[sec])}${weaponSVG(l.knife === 'butterfly' ? 'butterfly' : 'knife', settings.skins.knife)}</div>
    <div><span class="tag">${WEAPONS[l.primary].name}</span><span class="tag">${OPTICS[l.optic].name}</span><span class="tag">${WEAPONS[sec].name}</span><span class="tag">Couteau</span></div>
    <div class="hint">Change-le dans l'Inventaire, ou avec ${escapeHtml(keyLabel(settings.keys.loadout))} en jeu.</div>
    <button class="small" id="btn-goto-inventory">Ouvrir l'inventaire</button></div>`;
  $('btn-goto-inventory').onclick = () => document.querySelector('.topnav .tab[data-tab="inventory"]').click();
  const n = $('name-input').value.trim();
  $('profile-dot').textContent = n ? n[0].toUpperCase() : '?';
}

// ---------------------------------------------------------------------
//  Paramètres
// ---------------------------------------------------------------------
let listeningFor = null; // action en attente d'une nouvelle touche
const GRAPHICS_HINT = {
  low: 'Pour les PC modestes : pas d\'ombres douces ni d\'effets, résolution réduite.',
  medium: 'Bon compromis : ombres et anticrénelage, sans halo lumineux.',
  high: 'Tout au maximum : ombres douces, halo lumineux (bloom), anticrénelage, détails du décor.',
};

export function initSettingsMenu() {
  const sliders = [
    ['set-sens', 'out-sens', 'sensitivity', v => v.toFixed(2)],
    ['set-fov', 'out-fov', 'fov', v => `${v}°`],
    ['set-vol', 'out-vol', 'volume', v => `${Math.round(v * 100)}%`],
    ['set-sfx', 'out-sfx', 'sfxVolume', v => `${Math.round(v * 100)}%`],
    ['set-music', 'out-music', 'musicVolume', v => `${Math.round(v * 100)}%`],
  ];
  for (const [inp, out, key, fmt] of sliders) {
    $(inp).addEventListener('input', () => {
      settings[key] = parseFloat($(inp).value);
      $(out).textContent = fmt(settings[key]);
      saveSettings();
    });
  }
  $('set-invert').addEventListener('change', () => { settings.invertY = $('set-invert').checked; saveSettings(); });
  $('set-fullscreen').addEventListener('change', () => { settings.fullscreen = $('set-fullscreen').checked; saveSettings(); });
  $('btn-reset-settings').addEventListener('click', () => { resetSettings(); refresh(); toast('Paramètres réinitialisés'); });

  // Sous-onglets
  document.querySelectorAll('.settings-tabs button').forEach(b => {
    b.onclick = () => {
      sfx.click();
      document.querySelectorAll('.settings-tabs button').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.stab').forEach(t => t.classList.toggle('hidden', t.id !== `stab-${b.dataset.stab}`));
    };
  });

  // Sons de kill
  const ks = $('set-killsound');
  ks.innerHTML = Object.entries(KILL_SOUND_PACKS).map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
  ks.onchange = () => { settings.killSound = ks.value; saveSettings(); };
  $('btn-test-kill').onclick = () => { initAudio(); for (let i = 1; i <= 5; i++) setTimeout(() => sfx.killStreak(i, settings.killSound), (i - 1) * 550); };

  // Qualité graphique
  document.querySelectorAll('#set-graphics button').forEach(b => {
    b.onclick = () => { settings.graphics = b.dataset.q; saveSettings(); sfx.click(); refresh(); };
  });

  // Éditeur de viseur
  const ch = () => settings.crosshair;
  const chSliders = ['size', 'gap', 'thickness', 'opacity'];
  $('ch-style').innerHTML = Object.entries(CROSSHAIR_STYLES).map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
  $('ch-style').onchange = () => { ch().style = $('ch-style').value; saveSettings(); drawPreview(); };
  $('ch-color').oninput = () => { ch().color = $('ch-color').value; saveSettings(); drawPreview(); };
  $('ch-swatches').innerHTML = ['#ffffff', '#00ff66', '#00e5ff', '#ffee00', '#ff3b3b', '#ff4dff'].map(c => `<i data-c="${c}" style="background:${c}"></i>`).join('');
  $('ch-swatches').querySelectorAll('i').forEach(i => { i.onclick = (e) => { e.preventDefault(); ch().color = i.dataset.c; saveSettings(); refresh(); }; });
  for (const k of chSliders) {
    $(`ch-${k}`).oninput = () => { ch()[k] = parseFloat($(`ch-${k}`).value); saveSettings(); refresh(); };
  }
  for (const k of ['outline', 'dot', 'dynamic']) $(`ch-${k}`).onchange = () => { ch()[k] = $(`ch-${k}`).checked; saveSettings(); drawPreview(); };
  let bg = 'wall';
  document.querySelectorAll('.ch-bg-row button').forEach(b => { b.onclick = () => { bg = b.dataset.bg; refresh(); }; });
  let anim = 0;
  function drawPreview() {
    const c = $('ch-preview');
    c.className = `bg-${bg}`;
    // Aperçu animé : le viseur dynamique "respire" comme quand on bouge
    drawCrosshair(c, ch(), ch().dynamic ? (Math.sin(anim) * 0.5 + 0.5) * 10 : 0);
  }
  setInterval(() => { if (!$('menu-settings').classList.contains('hidden') && !$('stab-crosshair').classList.contains('hidden')) { anim += 0.12; drawPreview(); } }, 50);

  // Capture de la nouvelle touche : clavier, boutons de souris ou molette
  const assign = (code) => {
    if (code === 'Delete' || code === 'Backspace') { settings.keys[listeningFor] = ''; saveSettings(); sfx.click(); }
    else if (code !== 'Escape') {
      // Si la touche est déjà utilisée, on échange les deux actions
      const other = Object.keys(settings.keys).find(k => settings.keys[k] === code);
      if (other && other !== listeningFor) settings.keys[other] = settings.keys[listeningFor];
      settings.keys[listeningFor] = code;
      saveSettings();
      sfx.click();
    }
    listeningFor = null;
    refresh();
  };
  addEventListener('keydown', (e) => { if (!listeningFor) return; e.preventDefault(); e.stopPropagation(); assign(e.code); }, true);
  addEventListener('mousedown', (e) => { if (!listeningFor) return; e.preventDefault(); e.stopPropagation(); assign(`Mouse${e.button}`); }, true);
  addEventListener('wheel', (e) => { if (!listeningFor) return; e.preventDefault(); e.stopPropagation(); assign(e.deltaY < 0 ? 'WheelUp' : 'WheelDown'); }, { capture: true, passive: false });
  addEventListener('contextmenu', (e) => { if (listeningFor || !$('menu-settings').classList.contains('hidden')) e.preventDefault(); }, true);

  function refresh() {
    for (const [inp, out, key, fmt] of sliders) { $(inp).value = settings[key]; $(out).textContent = fmt(settings[key]); }
    $('set-invert').checked = settings.invertY;
    $('set-fullscreen').checked = settings.fullscreen;
    ks.value = settings.killSound;
    document.querySelectorAll('#set-graphics button').forEach(b => b.classList.toggle('active', b.dataset.q === settings.graphics));
    $('graphics-hint').textContent = GRAPHICS_HINT[settings.graphics] || '';
    // Viseur
    $('ch-style').value = ch().style; $('ch-color').value = ch().color;
    for (const k of chSliders) { $(`ch-${k}`).value = ch()[k]; $(`ch-${k}`).nextElementSibling.textContent = k === 'opacity' ? `${Math.round(ch()[k] * 100)}%` : ch()[k]; }
    for (const k of ['outline', 'dot', 'dynamic']) $(`ch-${k}`).checked = !!ch()[k];
    document.querySelectorAll('.ch-bg-row button').forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
    drawPreview();
    // Touches
    const box = $('keybinds');
    box.innerHTML = '';
    for (const [id, label] of ACTIONS) {
      const row = document.createElement('div'); row.className = 'bind';
      const span = document.createElement('span'); span.textContent = label;
      const btn = document.createElement('button');
      btn.textContent = listeningFor === id ? 'Touche ou bouton…' : keyLabel(settings.keys[id]);
      if (/^Mouse|^Wheel/.test(settings.keys[id])) btn.classList.add('mouse');
      if (listeningFor === id) btn.classList.add('listening');
      btn.addEventListener('click', (e) => { if (listeningFor) return; e.stopPropagation(); setTimeout(() => { listeningFor = id; refresh(); }, 0); });
      // ✕ : retirer la touche (l'action n'a plus de touche)
      const clr = document.createElement('button');
      clr.className = 'ghost small unbind'; clr.textContent = '✕'; clr.title = 'Retirer la touche';
      clr.disabled = !settings.keys[id];
      clr.onclick = (e) => { e.stopPropagation(); settings.keys[id] = ''; saveSettings(); sfx.click(); refresh(); };
      row.append(span, btn, clr);
      box.appendChild(row);
    }
  }
  return refresh;
}

// ---------------------------------------------------------------------
//  Lobby
// ---------------------------------------------------------------------
/** actions = { addBot(team, level), removeBot(id) } */
export function renderLobby(lobby, myId, netInfo, actions) {
  $('lobby-code').textContent = lobby.code;
  const size = lobby.mode === '2v2' ? 2 : 1;
  const isHost = lobby.hostId === myId;
  const me = lobby.players.find(p => p.id === myId);

  // Avertissement si le jeu tourne en local (localhost)
  const warn = $('net-warning');
  warn.classList.toggle('hidden', !netInfo?.local);
  if (netInfo?.local) {
    warn.innerHTML = netInfo.lan
      ? `📶 Le lien marche pour tes potes <b>sur le même Wi-Fi</b>. Pour des potes <b>chez eux</b>, utilise ton lien Render.`
      : `⚠️ Tu joues en local : tes potes ne peuvent pas rejoindre.`;
  }

  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === lobby.mode);
    b.disabled = !isHost;
  });
  $('mode-hint').textContent = isHost ? 'Tu es l\'hôte 👑' : 'Mode choisi par l\'hôte';

  for (const team of ['A', 'B']) {
    const list = lobby.players.filter(p => p.team === team);
    const ul = $(`team-${team}`);
    ul.innerHTML = '';
    for (let i = 0; i < size; i++) {
      const p = list[i];
      const li = document.createElement('li');
      if (p) {
        li.className = 'pcard' + (p.ready || p.isBot ? ' ready' : '') + (p.id === myId ? ' me' : '');
        const host = p.id === lobby.hostId ? '<span class="crown" title="Hôte">👑</span>' : '';
        const lo = WEAPONS[p.primary] ? `${WEAPONS[p.primary].name}${p.optic && p.optic !== 'iron' ? ' · ' + OPTICS[p.optic].name : ''}` : '';
        li.innerHTML = `<span class="pav">${p.isBot ? '🤖' : escapeHtml(p.name[0]?.toUpperCase() || '?')}</span>
          <span class="pinfo"><span class="pname">${escapeHtml(p.name)}${p.id === myId ? ' <em>(toi)</em>' : ''}${host}</span><span class="plo">${lo}</span></span>
          <span class="pstate ${p.ready || p.isBot ? 'ok' : ''}">${p.isBot ? 'BOT' : p.ready ? 'PRÊT' : 'EN ATTENTE'}</span>`;
        if (p.isBot && isHost) {
          const rm = document.createElement('button'); rm.className = 'rm ghost'; rm.textContent = '✕'; rm.title = 'Retirer le bot';
          rm.onclick = () => actions.removeBot(p.id);
          li.appendChild(rm);
        }
      } else if (isHost) {
        // Place libre : l'hôte peut la compléter avec un bot
        li.className = 'pcard empty';
        li.innerHTML = `<div class="addbot"><span>Place libre — ajouter un bot</span></div>`;
        const box = li.firstChild;
        for (const [lvl, cfg] of Object.entries(BOT_LEVELS)) {
          const b = document.createElement('button'); b.className = 'small'; b.textContent = cfg.name;
          b.onclick = () => actions.addBot(team, lvl);
          box.appendChild(b);
        }
      } else {
        li.className = 'pcard empty'; li.textContent = 'Place libre';
      }
      ul.appendChild(li);
    }
    const btn = document.querySelector(`.join-team[data-team="${team}"]`);
    btn.disabled = me?.team === team || list.length >= size;
    btn.textContent = me?.team === team ? 'Ton équipe' : list.length >= size ? 'Complète' : 'Rejoindre';
  }

  const specs = lobby.players.filter(p => !p.team);
  $('spectators').textContent = specs.length ? `Sans équipe : ${specs.map(p => p.name).join(', ')}` : '';

  // Choix rapide du loadout
  const sel = $('lobby-loadout-select');
  sel.innerHTML = settings.loadouts.map((l, i) => `<option value="${i}" ${i === settings.activeLoadout ? 'selected' : ''}>${i + 1}. ${escapeHtml(l.name)} — ${WEAPONS[l.primary].name}, ${OPTICS[l.optic].name}</option>`).join('');

  const rb = $('btn-ready');
  rb.disabled = !me?.team;
  rb.innerHTML = me?.ready ? '<b>PRÊT ✔</b><small>clique pour annuler</small>' : '<b>PRÊT ?</b><small>clique quand tu es prêt</small>';
  rb.classList.toggle('is-ready', !!me?.ready);

  const full = ['A', 'B'].every(t => lobby.players.filter(p => p.team === t).length === size);
  const inTeams = lobby.players.filter(p => p.team).length;
  $('lobby-status').textContent = !full
    ? `En attente de joueurs (${inTeams}/${size * 2}) — envoie le code à tes potes${isHost ? ' ou ajoute des bots' : ''} !`
    : 'Équipes complètes : la partie démarre quand tout le monde est prêt.';
}

// ---------------------------------------------------------------------
//  Écran de fin
// ---------------------------------------------------------------------
export function renderEnd(e, myTeam) {
  const win = e.winner === myTeam;
  $('end-title').textContent = myTeam ? (win ? '🏆 Victoire !' : 'Défaite…') : `Victoire ${TEAMS[e.winner].name}`;
  $('end-title').style.color = TEAMS[e.winner].css;
  $('end-score').innerHTML = `<span class="A">${e.score.A}</span> — <span class="B">${e.score.B}</span>`;
  const rows = e.players.filter(p => p.team).sort((a, b) => b.kills - a.kills)
    .map(p => `<tr><td style="color:${TEAMS[p.team].css}">${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('');
  $('end-stats').innerHTML = `<tr><th>Joueur</th><th>Kills</th><th>Morts</th></tr>${rows}`;
  $('end-hint').textContent = '« Rejouer » ramène tout le monde au lobby avec les mêmes équipes.';
}
