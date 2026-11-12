// =====================================================================
//  ui.js — Menus HTML : navigation entre écrans, paramètres, lobby,
//  casier (skins), choix d'arme, écran de fin.
// =====================================================================
import { ACTIONS, settings, saveSettings, resetSettings, keyLabel } from './settings.js';
import { TEAMS, WEAPONS, PRIMARIES } from '/shared/constants.js';
import { WEAPON_SKINS, CHARACTER_SKINS } from '/shared/skins.js';
import { escapeHtml } from './hud.js';
import { sfx } from './audio.js';

export const $ = (id) => document.getElementById(id);
const SCREENS = ['menu-main', 'menu-lobby', 'menu-pause', 'menu-settings', 'menu-end', 'menu-click', 'menu-locker', 'menu-loadout'];

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
export function weaponSVG(id, skinId = 'default') {
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
      <rect x="52" y="14" width="44" height="7" rx="3" fill="#15171c"/><rect x="92" y="12" width="10" height="11" rx="3" fill="#15171c"/>
      <rect x="62" y="21" width="4" height="7" fill="${dark}"/><rect x="84" y="21" width="4" height="7" fill="${dark}"/>
      <rect x="74" y="31" width="10" height="3" fill="${dark}"/></svg>`;
  }
  return `<svg viewBox="0 0 200 60">${defs}
    <path d="M8 30 L46 26 L50 38 L20 46 L8 44 Z" fill="${acc}" ${glow}/>
    <rect x="46" y="24" width="56" height="12" rx="2" fill="${body}"/>
    <rect x="100" y="25" width="34" height="9" rx="2" fill="${acc}" ${glow}/>
    <rect x="132" y="27" width="50" height="4" fill="${body}"/><rect x="180" y="25" width="8" height="7" fill="${dark}"/>
    <path d="M78 36 L92 36 L98 56 L86 58 Z" fill="${dark}"/><path d="M58 36 L66 36 L62 50 L54 50 Z" fill="${acc}"/></svg>`;
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
//  Cartes d'armes (casier + menu M)
// ---------------------------------------------------------------------
const WEAPON_INFO = {
  ak: { desc: 'Fusil d\'assaut automatique. Polyvalent, efficace à moyenne distance.', stats: { Dégâts: 35, Cadence: 90, Précision: 60, Portée: 65, Mobilité: 75 } },
  kar98k: { desc: 'Fusil de précision à verrou, lunette x4. Un tir à la tête = un kill.', stats: { Dégâts: 95, Cadence: 15, Précision: 98, Portée: 100, Mobilité: 50 } },
};

/** Remplit un conteneur avec les cartes des armes principales. onPick(id) au clic. */
export function renderWeaponCards(container, selected, onPick) {
  container.innerHTML = '';
  for (const id of PRIMARIES) {
    const info = WEAPON_INFO[id];
    const card = document.createElement('button');
    card.className = 'wcard' + (id === selected ? ' selected' : '');
    card.innerHTML = `<div class="wname">${WEAPONS[id].name}${id === selected ? '<small>Équipée</small>' : ''}</div>
      ${weaponSVG(id, settings.skins[id])}
      <div class="wdesc">${info.desc}</div>
      ${Object.entries(info.stats).map(([k, v]) => `<div class="stat"><span>${k}</span><div class="bar"><i style="width:${v}%"></i></div></div>`).join('')}`;
    card.onclick = () => { sfx.click(); onPick(id); };
    container.appendChild(card);
  }
}

// ---------------------------------------------------------------------
//  Casier (skins)
// ---------------------------------------------------------------------
let lockerTab = 'character';

/** onChange() est appelé quand un skin ou l'arme principale change */
export function initLocker(onChange) {
  document.querySelectorAll('.locker-tabs button').forEach(b => {
    b.onclick = () => { lockerTab = b.dataset.tab; renderLocker(); };
  });

  function renderLocker() {
    document.querySelectorAll('.locker-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === lockerTab));
    const grid = $('locker-grid');
    grid.innerHTML = '';
    const list = lockerTab === 'character' ? CHARACTER_SKINS : WEAPON_SKINS;
    for (const [id, skin] of Object.entries(list)) {
      const tile = document.createElement('div');
      tile.className = 'skin-tile' + (settings.skins[lockerTab] === id ? ' selected' : '');
      tile.innerHTML = (lockerTab === 'character' ? characterSVG(id) : weaponSVG(lockerTab, id)) + `<div class="sname">${skin.name}</div>`;
      tile.onclick = () => {
        settings.skins[lockerTab] = id; saveSettings(); sfx.click();
        renderLocker(); onChange();
      };
      grid.appendChild(tile);
    }
    renderWeaponCards($('locker-primary'), settings.primary, (id) => {
      settings.primary = id; saveSettings(); renderLocker(); onChange(id);
    });
  }
  return renderLocker;
}

// ---------------------------------------------------------------------
//  Menu principal : commandes + arme équipée
// ---------------------------------------------------------------------
export function renderMainSide() {
  const rows = [
    [`${keyLabel(settings.keys.forward)} ${keyLabel(settings.keys.left)} ${keyLabel(settings.keys.back)} ${keyLabel(settings.keys.right)}`, 'Se déplacer'],
    ['Clic G', 'Tirer'], ['Clic D', 'Viser / lunette'],
    [keyLabel(settings.keys.sprint), 'Courir'], [keyLabel(settings.keys.crouch), "S'accroupir · glisser en courant"],
    [keyLabel(settings.keys.jump), 'Sauter'], [keyLabel(settings.keys.reload), 'Recharger'],
    [`${keyLabel(settings.keys.weapon1)} ${keyLabel(settings.keys.weapon2)}`, 'Changer d\'arme'],
    [keyLabel(settings.keys.loadout), 'Choisir son arme'], [keyLabel(settings.keys.scoreboard), 'Scores'],
  ];
  $('controls-list').innerHTML = rows.map(([k, t]) => `<kbd>${escapeHtml(k)}</kbd><span>${t}</span>`).join('');
  $('equipped-card').innerHTML = `<div class="card-title">🔫 Arme équipée</div>
    <div class="equipped">${weaponSVG(settings.primary, settings.skins[settings.primary])}<div><b>${WEAPONS[settings.primary].name}</b><div class="hint">Change avec ${escapeHtml(keyLabel(settings.keys.loadout))} en jeu ou dans le Casier</div></div></div>`;
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
export function renderLobby(lobby, myId, netInfo) {
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
      ? `📶 Le lien d'invitation marche pour tes potes <b>sur le même Wi-Fi</b> que toi (${escapeHtml(netInfo.lan)}).<br>Pour des potes <b>chez eux</b>, mets le jeu en ligne (README, partie 3).`
      : `⚠️ Tu joues en local : tes potes ne peuvent pas rejoindre. Mets le jeu en ligne (README, partie 3).`;
  }

  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === lobby.mode);
    b.disabled = !isHost;
  });
  $('mode-hint').textContent = isHost ? 'Tu es l\'hôte 👑' : 'Mode choisi par l\'hôte';

  for (const team of ['A', 'B']) {
    const list = lobby.players.filter(p => p.team === team);
    const slots = [];
    for (let i = 0; i < size; i++) {
      const p = list[i];
      if (p) {
        const host = p.id === lobby.hostId ? ' 👑' : '';
        const you = p.id === myId ? ' (toi)' : '';
        slots.push(`<li class="pcard"><span class="pav" style="background:${TEAMS[team].css}">${escapeHtml(p.name[0]?.toUpperCase() || '?')}</span>
          <span class="pname">${escapeHtml(p.name)}${you}${host}</span>
          <span class="pstate ${p.ready ? 'ok' : ''}">${p.ready ? '✔ PRÊT' : 'en attente'}</span></li>`);
      } else slots.push('<li class="pcard empty">Place libre</li>');
    }
    $(`team-${team}`).innerHTML = slots.join('');
    const btn = document.querySelector(`.join-team[data-team="${team}"]`);
    btn.disabled = me?.team === team || list.length >= size;
    btn.textContent = me?.team === team ? 'Ton équipe' : list.length >= size ? 'Complète' : 'Rejoindre';
  }

  const specs = lobby.players.filter(p => !p.team);
  $('spectators').textContent = specs.length ? `Sans équipe : ${specs.map(p => p.name).join(', ')}` : '';

  $('btn-ready').disabled = !me?.team;
  $('btn-ready').textContent = me?.ready ? 'Annuler « Prêt »' : '✔ Prêt';
  $('btn-ready').classList.toggle('primary', !me?.ready);

  const full = ['A', 'B'].every(t => lobby.players.filter(p => p.team === t).length === size);
  const inTeams = lobby.players.filter(p => p.team).length;
  $('lobby-status').textContent = !full
    ? `En attente de joueurs (${inTeams}/${size * 2}) — envoie le lien à tes potes !`
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
