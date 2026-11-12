// =====================================================================
//  hud.js — Interface en jeu : viseur, PV, munitions, score, timer,
//  killfeed, messages au centre, indicateur de dégâts.
// =====================================================================
import { TEAMS, WEAPONS, PLAYER } from '/shared/constants.js';
import { drawCrosshair } from './crosshair.js';
import { settings } from './settings.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.crosshair = $('crosshair');
    this.msgTimer = null;
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  /** Mise à jour à chaque image */
  update({ hp, weapon, primary, secondary = 'glock', ads = 0, optic = null, overlay = null, mag, reserve, reloading, spread, score, timeLeft, timerLabel, roundLabel }) {
    $('hp').textContent = Math.ceil(hp);
    const bar = $('hp-bar').firstElementChild;
    bar.style.width = `${(hp / PLAYER.MAX_HP) * 100}%`;
    bar.style.background = hp > 60 ? '#4ade80' : hp > 30 ? '#facc15' : '#ff4d6d';

    $('weapon-name').textContent = WEAPONS[weapon].name + (reloading ? ' — rechargement…' : '');
    if (weapon !== 'knife') {
      $('ammo-mag').textContent = mag;
      $('ammo-res').textContent = ` / ${reserve}`;
      $('ammo-mag').classList.toggle('low', mag <= Math.ceil(WEAPONS[weapon].magSize * 0.2));
    } else {
      $('ammo-mag').textContent = '∞'; $('ammo-res').textContent = '';
      $('ammo-mag').classList.remove('low');
    }
    const slots = $('weapon-slots').children;
    slots[0].textContent = `1 ${WEAPONS[primary || 'ak'].name}`;
    slots[1].textContent = `2 ${WEAPONS[secondary]?.name || 'Glock 18'}`;
    slots[0].classList.toggle('on', weapon === primary);
    slots[1].classList.toggle('on', weapon === secondary);
    slots[2].classList.toggle('on', weapon === 'knife');

    // Viseur personnalisé : s'écarte avec la dispersion (si "dynamique"), disparaît en visée
    const extra = weapon !== 'knife' ? Math.min(spread * 700, 70) : 0;
    const key = `${Math.round(extra)}|${JSON.stringify(settings.crosshair)}`;
    if (key !== this.chKey) { this.chKey = key; drawCrosshair(this.crosshair, settings.crosshair, Math.round(extra)); }
    this.crosshair.style.opacity = weapon !== 'knife' ? Math.max(0, 1 - ads * 2) : 0.6;
    // Viseurs : lunette sniper / lunette moyenne / point rouge
    $('scope').classList.toggle('hidden', overlay !== 'scope');
    $('midscope').classList.toggle('hidden', overlay !== 'mid');
    $('reddot').classList.toggle('hidden', !(optic === 'reddot' && weapon !== 'knife' && ads > 0.9));

    if (score) { $('score-A').textContent = score.A; $('score-B').textContent = score.B; }
    if (timerLabel !== undefined) $('round-timer').textContent = timerLabel;
    else if (timeLeft !== undefined) {
      const t = Math.ceil(timeLeft);
      $('round-timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }
    $('round-label').textContent = roundLabel || '';
  }

  /** Grand message au centre (ex: "Manche 3", "Victoire") */
  message(text, sub = '', duration = 2000, color = '#fff') {
    $('center-msg').textContent = text;
    $('center-msg').style.color = color;
    $('sub-msg').textContent = sub;
    clearTimeout(this.msgTimer);
    if (duration) this.msgTimer = setTimeout(() => { $('center-msg').textContent = ''; $('sub-msg').textContent = ''; }, duration);
  }

  hitmarker(head) {
    const h = $('hitmarker');
    h.classList.toggle('head', head);
    h.style.transition = 'none'; h.style.opacity = 1;
    requestAnimationFrame(() => { h.style.transition = 'opacity .25s'; h.style.opacity = 0; });
  }

  /** Flash rouge + flèche vers l'attaquant. angle = direction relative au regard */
  damage(angle) {
    const v = $('damage-vignette');
    v.style.transition = 'none'; v.style.opacity = 0.55;
    requestAnimationFrame(() => { v.style.transition = 'opacity .5s'; v.style.opacity = 0; });
    if (angle !== null && angle !== undefined) {
      const a = $('damage-arrow');
      a.style.transform = `rotate(${angle}rad)`;
      a.style.transition = 'none'; a.style.opacity = 1;
      requestAnimationFrame(() => { a.style.transition = 'opacity 1.2s'; a.style.opacity = 0; });
    }
  }

  /** Ajoute une ligne au killfeed (en haut à droite) */
  kill({ killer, killerTeam, victim, victimTeam, weapon, headshot }, mine = false) {
    const row = document.createElement('div');
    row.className = 'kf' + (mine ? ' me' : '');
    const k = document.createElement('span'); k.textContent = killer; k.style.color = TEAMS[killerTeam]?.css;
    // Icône de l'arme + petite croix rouge si le dernier tir était dans la tête
    const w = document.createElement('span'); w.className = 'w';
    w.innerHTML = (KILL_ICONS[weapon] || KILL_ICONS.ak) + (headshot ? KILL_ICONS.headshot : '');
    const v = document.createElement('span'); v.textContent = victim; v.style.color = TEAMS[victimTeam]?.css;
    row.append(k, w, v);
    this.feedRow(row);
  }

  info(text) {
    const row = document.createElement('div'); row.className = 'kf'; row.textContent = text;
    this.feedRow(row);
  }

  feedRow(row) {
    const feed = $('killfeed');
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  /** Tableau des scores (touche Tab) */
  scoreboard(visible, players) {
    const sb = $('scoreboard');
    sb.classList.toggle('hidden', !visible);
    if (!visible) return;
    const rows = [...players].sort((a, b) => String(a.team).localeCompare(String(b.team)) || b.kills - a.kills)
      .map(p => {
        const ping = p.ping === -1 || p.ping === undefined ? '<td class="ping bot">BOT</td>'
          : `<td class="ping ${p.ping < 70 ? 'good' : p.ping < 140 ? 'mid' : 'bad'}">${p.ping} ms</td>`;
        return `<tr class="${p.alive ? '' : 'dead'}"><td style="color:${TEAMS[p.team]?.css}">${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td>${ping}</tr>`;
      }).join('');
    sb.innerHTML = `<table><tr><th>Joueur</th><th>Kills</th><th>Morts</th><th class="ping">Ping</th></tr>${rows}</table>`;
  }

  clearFeed() { $('killfeed').innerHTML = ''; this.message(''); }
}

// Petits dessins pour le killfeed (blancs, comme dans CS / Valorant)
const KILL_ICONS = {
  ak: `<svg viewBox="0 0 64 18" class="kicon"><path d="M2 8 L14 6 L16 12 L6 15 L2 14 Z M14 5 H34 V10 H14 Z M33 6 H44 V9 H33 Z M44 7 H60 V8.5 H44 Z M24 10 H28 L30 17 H26 Z M18 10 H21 L20 14 H17 Z" fill="currentColor"/></svg>`,
  kar98k: `<svg viewBox="0 0 76 18" class="kicon"><path d="M2 9 L16 7 L19 10 L52 10 L52 12 L18 13 L13 15 L2 15 Z M16 7 H30 V10 H16 Z M50 10 H74 V11.2 H50 Z M20 3 H36 V6 H20 Z M24 6 H26 V7.5 H24 Z M31 6 H33 V7.5 H31 Z" fill="currentColor"/></svg>`,
  glock: `<svg viewBox="0 0 40 18" class="kicon"><path d="M3 4 H30 V8.5 H3 Z M30 5 H34 V7.5 H30 Z M5 8.5 H18 L17 10 H13 L11 16 H5.5 L7 10 Z M13 10 H17 L15.5 12.5 H13 Z" fill="currentColor"/></svg>`,
  knife: `<svg viewBox="0 0 48 18" class="kicon"><path d="M2 8 H16 V12 H2 Z M16 6 H19 V14 H16 Z M19 8 L40 8 L46 10 L40 12 L19 12 Z" fill="currentColor"/></svg>`,
  headshot: `<svg viewBox="0 0 18 18" class="kicon hs"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 1 V5 M9 13 V17 M1 9 H5 M13 9 H17" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9" r="1.6" fill="currentColor"/></svg>`,
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
