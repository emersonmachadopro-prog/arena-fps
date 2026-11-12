// =====================================================================
//  ui.js — Menus HTML : navigation entre écrans, paramètres, lobby,
//  casier (skins), choix d'arme, écran de fin.
// =====================================================================
import { ACTIONS, settings, saveSettings, resetSettings, keyLabel, activeLoadout } from './settings.js';
import { TEAMS, WEAPONS, PRIMARIES, OPTICS, WEAPON_OPTICS, BOT_LEVELS, validOptic } from '/shared/constants.js';
import { WEAPON_SKINS, CHARACTER_SKINS } from '/shared/skins.js';
import { escapeHtml } from './hud.js';
import { sfx } from './audio.js';

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
//  Petits dessins SVG (aperçus des armes et des tenues)
// ---------------------------------------------------------------------
export function weaponSVG(id, skinId = 'default', optic = null) {
  const s = WEAPON_SKINS[skinId] || WEAPON_SKINS.default;
  const body = hex(s.body), acc = hex(s.accent), dark = shade(s.body, 0.6);
  const glow = s.glow ? `filter="url(#g)"` : '';
  const defs = `<defs><filter id="g"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  if (id === 'knife') {
    const blade = skinId === 'default' ? '#d8dee9' : body;
    return `<svg viewBox="0 0 200 60">${defs}<path d="M70 30 L150 24 L170 30 L150 34 Z" fill="${blade}"/><rect x="62" y="22" width="8" height="16" rx="2" fill="#444a55"/><rect x="28" y="25" width="36" height="10" rx="4" fill="${acc}" ${glow}/></svg>`;
  }
  if (id === 'kar98k') {
    return `<svg viewBox="0 0 200 60">${defs}
      <path d="M6 30 L40 26 L48 33 L150 32 L150 38 L50 40 L36 44 L6 44 Z" fill="${acc}" ${glow}/>
      <rect x="40" y="27" width="40" height="6" fill="${body}"/><rect x="148" y="30" width="48" height="3" fill="${body}"/>
      ${opticSVG(optic, 60, 27)}<rect x="74" y="31" width="10" height="3" fill="${dark}"/></svg>`;
  }
  return `<svg viewBox="0 0 200 60">${defs}
    <path d="M8 30 L46 26 L50 38 L20 46 L8 44 Z" fill="${acc}" ${glow}/>
    <rect x="46" y="24" width="56" height="12" rx="2" fill="${body}"/>
    <rect x="100" y="25" width="34" height="9" rx="2" fill="${acc}" ${glow}/>
    <rect x="132" y="27" width="50" height="4" fill="${body}"/><rect x="180" y="25" width="8" height="7" fill="${dark}"/>
    <path d="M78 36 L92 36 L98 56 L86 58 Z" fill="${dark}"/><path d="M58 36 L66 36 L62 50 L54 50 Z" fill="${acc}"/>${opticSVG(optic, 62, 24)}</svg>`;
}

/** Petit dessin du viseur posé sur l'arme (x = position, y = hauteur du rail) */
export function opticSVG(optic, x, y) {
  const c = '#15171c';
  if (optic === 'reddot') return `<rect x="${x}" y="${y - 4}" width="16" height="4" fill="${c}"/><path d="M${x + 2} ${y - 4} v-9 h12 v9" fill="none" stroke="${c}" stroke-width="3"/><circle cx="${x + 8}" cy="${y - 9}" r="1.6" fill="#ff3b3b"/>`;
  if (optic === 'mid') return `<rect x="${x - 2}" y="${y - 5}" width="20" height="5" fill="${c}"/><rect x="${x - 6}" y="${y - 13}" width="30" height="8" rx="3" fill="${c}"/><rect x="${x - 10}" y="${y - 15}" width="6" height="12" rx="2" fill="${c}"/>`;
  if (optic === 'scope') return `<rect x="${x - 8}" y="${y - 14}" width="44" height="7" rx="3" fill="${c}"/><rect x="${x + 32}" y="${y - 16}" width="10" height="11" rx="3" fill="${c}"/><rect x="${x}" y="${y - 7}" width="4" height="7" fill="${c}"/><rect x="${x + 22}" y="${y - 7}" width="4" height="7" fill="${c}"/>`;
  return '';
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
//  Skins (onglet Personnage + écran Skins du lobby)
// ---------------------------------------------------------------------
/** Construit une grille de skins avec ses onglets. onChange() à chaque changement. */
export function initSkinGrid(tabsEl, gridEl, onChange) {
  let cat = 'character';
  tabsEl.querySelectorAll('button').forEach(b => { b.onclick = () => { cat = b.dataset.tab; render(); }; });
  function render() {
    tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === cat));
    gridEl.innerHTML = '';
    const list = cat === 'character' ? CHARACTER_SKINS : WEAPON_SKINS;
    for (const [id, skin] of Object.entries(list)) {
      const tile = document.createElement('div');
      tile.className = 'skin-tile' + (settings.skins[cat] === id ? ' selected' : '');
      tile.innerHTML = (cat === 'character' ? characterSVG(id) : weaponSVG(cat, id)) + `<div class="sname">${skin.name}</div>`;
      tile.onclick = () => { settings.skins[cat] = id; saveSettings(); sfx.click(); render(); onChange(cat); };
      gridEl.appendChild(tile);
    }
  }
  return render;
}

// ---------------------------------------------------------------------
//  Inventaire : 5 loadouts (arme + viseur), un seul équipé
// ---------------------------------------------------------------------
let editing = null; // index du loadout affiché dans l'éditeur

/** onChange() est appelé quand un loadout est modifié ou équipé */
export function initInventory(onChange) {
  function render() {
    if (editing === null) editing = settings.activeLoadout;
    // Liste des 5 emplacements
    const list = $('loadout-list');
    list.innerHTML = '';
    settings.loadouts.forEach((l, i) => {
      const b = document.createElement('button');
      b.className = 'lslot' + (i === editing ? ' selected' : '');
      b.innerHTML = `<span class="num">${i + 1}</span><span>${escapeHtml(l.name)}<span class="lsub">${WEAPONS[l.primary].name} · ${OPTICS[l.optic].name}</span></span>
        ${i === settings.activeLoadout ? '<span class="on">ÉQUIPÉ</span>' : ''}`;
      b.onclick = () => { editing = i; sfx.click(); render(); };
      list.appendChild(b);
    });

    // Éditeur du loadout sélectionné
    const l = settings.loadouts[editing];
    const ed = $('loadout-editor');
    ed.innerHTML = `<div class="card-title">Loadout ${editing + 1}</div>
      <input class="editor-name" id="lo-name" maxlength="24" value="${escapeHtml(l.name)}" />
      <h3>Arme principale</h3><div class="weapon-cards" id="lo-weapons"></div>
      <h3>Viseur (${WEAPONS[l.primary].name})</h3><div class="optic-grid" id="lo-optics"></div>
      <h3>Équipement</h3><p class="hint">🔪 Couteau inclus · 💣 Grenades : bientôt !</p>
      <div class="row"><button class="big ${editing === settings.activeLoadout ? '' : 'primary'}" id="lo-equip" ${editing === settings.activeLoadout ? 'disabled' : ''}>
        ${editing === settings.activeLoadout ? '✔ Équipé' : 'Équiper ce loadout'}</button></div>`;
    $('lo-name').oninput = (e) => { l.name = e.target.value.slice(0, 24) || `Loadout ${editing + 1}`; saveSettings(); renderListOnly(); };
    renderWeaponCards($('lo-weapons'), l.primary, (id) => {
      l.primary = id; l.optic = validOptic(id, l.optic); saveSettings(); render(); onChange();
    }, l.optic);
    const og = $('lo-optics');
    for (const o of WEAPON_OPTICS[l.primary]) {
      const b = document.createElement('button');
      b.className = 'ocard' + (o === l.optic ? ' selected' : '');
      b.innerHTML = `<svg viewBox="40 0 60 30">${opticSVG(o, 62, 26) || '<text x="70" y="22" fill="#8d94a8" font-size="10" text-anchor="middle">mire</text>'}</svg><b>${OPTICS[o].name}</b><small>${OPTICS[o].desc} · x${OPTICS[o].zoom}</small>`;
      b.onclick = () => { l.optic = o; saveSettings(); sfx.click(); render(); onChange(); };
      og.appendChild(b);
    }
    $('lo-equip').onclick = () => { settings.activeLoadout = editing; saveSettings(); sfx.click(); render(); onChange(); };
  }
  function renderListOnly() {
    const items = $('loadout-list').children;
    settings.loadouts.forEach((l, i) => { items[i].querySelector('span:nth-child(2)').firstChild.textContent = l.name; });
  }
  return render;
}

// ---------------------------------------------------------------------
//  Cartes d'armes
// ---------------------------------------------------------------------
const WEAPON_INFO = {
  ak: { desc: 'Fusil d\'assaut automatique. Polyvalent, efficace à moyenne distance.', stats: { Dégâts: 35, Cadence: 90, Précision: 60, Portée: 65, Mobilité: 75 } },
  kar98k: { desc: 'Fusil à verrou. Un tir à la tête = un kill. Mire de base, lunette en option.', stats: { Dégâts: 95, Cadence: 15, Précision: 98, Portée: 100, Mobilité: 50 } },
};

export function renderWeaponCards(container, selected, onPick, optic = null) {
  container.innerHTML = '';
  for (const id of PRIMARIES) {
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
    b.innerHTML = `<b>${i + 1}. ${escapeHtml(l.name)}</b>${weaponSVG(l.primary, settings.skins[l.primary], l.optic)}<small>${WEAPONS[l.primary].name} · ${OPTICS[l.optic].name}</small>`;
    b.onclick = () => { sfx.click(); onPick(i); };
    container.appendChild(b);
  });
}

// ---------------------------------------------------------------------
//  Onglet Jouer : loadout équipé
// ---------------------------------------------------------------------
export function renderMainSide() {
  const l = activeLoadout();
  $('equipped-card').innerHTML = `<div class="card-title">🎒 Loadout équipé</div>
    <div class="equipped"><div class="lname">${escapeHtml(l.name)}</div>
    ${weaponSVG(l.primary, settings.skins[l.primary], l.optic)}
    <div><span class="tag">${WEAPONS[l.primary].name}</span><span class="tag">${OPTICS[l.optic].name}</span><span class="tag">Couteau</span></div>
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

export function initSettingsMenu() {
  const sliders = [
    ['set-sens', 'out-sens', 'sensitivity', v => v.toFixed(2)],
    ['set-fov', 'out-fov', 'fov', v => `${v}°`],
    ['set-vol', 'out-vol', 'volume', v => `${Math.round(v * 100)}%`],
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
  $('btn-reset-settings').addEventListener('click', () => { resetSettings(); refreshSettingsMenu(); toast('Paramètres réinitialisés'); });

  // Capture de la nouvelle touche
  addEventListener('keydown', (e) => {
    if (!listeningFor) return;
    e.preventDefault(); e.stopPropagation();
    if (e.code !== 'Escape') {
      // Si la touche est déjà utilisée, on échange les deux actions
      const other = Object.keys(settings.keys).find(k => settings.keys[k] === e.code);
      if (other && other !== listeningFor) settings.keys[other] = settings.keys[listeningFor];
      settings.keys[listeningFor] = e.code;
      saveSettings();
      sfx.click();
    }
    listeningFor = null;
    refreshSettingsMenu();
  }, true);

  function refreshSettingsMenu() {
    for (const [inp, out, key, fmt] of sliders) { $(inp).value = settings[key]; $(out).textContent = fmt(settings[key]); }
    $('set-invert').checked = settings.invertY;
    $('set-fullscreen').checked = settings.fullscreen;
    const box = $('keybinds');
    box.innerHTML = '';
    for (const [id, label] of ACTIONS) {
      const row = document.createElement('div'); row.className = 'bind';
      const span = document.createElement('span'); span.textContent = label;
      const btn = document.createElement('button');
      btn.textContent = listeningFor === id ? 'Appuie sur une touche…' : keyLabel(settings.keys[id]);
      if (listeningFor === id) btn.classList.add('listening');
      btn.addEventListener('click', () => { listeningFor = id; refreshSettingsMenu(); });
      row.append(span, btn);
      box.appendChild(row);
    }
  }
  return refreshSettingsMenu;
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
  let warn = $('net-warning');
  if (!warn) {
    warn = document.createElement('div'); warn.id = 'net-warning'; warn.className = 'net-warning';
    $('menu-lobby').querySelector('.lobby-head').after(warn);
  }
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
        li.className = 'pcard';
        const host = p.id === lobby.hostId ? ' 👑' : '';
        const you = p.id === myId ? ' (toi)' : '';
        li.innerHTML = `<span class="pav" style="background:${TEAMS[team].css}">${p.isBot ? '🤖' : escapeHtml(p.name[0]?.toUpperCase() || '?')}</span>
          <span class="pname">${escapeHtml(p.name)}${you}${host}</span>
          <span class="pstate ${p.ready ? 'ok' : ''}">${p.isBot ? 'BOT' : p.ready ? '✔ PRÊT' : 'en attente'}</span>`;
        if (p.isBot && isHost) {
          const rm = document.createElement('button'); rm.className = 'rm ghost'; rm.textContent = '✕'; rm.title = 'Retirer le bot';
          rm.onclick = () => actions.removeBot(p.id);
          li.appendChild(rm);
        }
      } else if (isHost) {
        // Place libre : l'hôte peut la compléter avec un bot
        li.className = 'pcard empty';
        li.innerHTML = `<div class="addbot"><span>Place libre — ajouter un bot :</span></div>`;
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

  $('btn-ready').disabled = !me?.team;
  $('btn-ready').textContent = me?.ready ? 'Annuler « Prêt »' : '✔ Prêt';
  $('btn-ready').classList.toggle('primary', !me?.ready);

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
