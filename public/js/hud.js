// =====================================================================
//  hud.js — Interface en jeu : viseur, PV, munitions, score, timer,
//  killfeed, messages au centre, indicateur de dégâts.
// =====================================================================
import { TEAMS, WEAPONS, PLAYER } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.crosshair = $('crosshair');
    this.msgTimer = null;
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  /** Mise à jour à chaque image */
  update({ hp, weapon, primary, ads = 0, optic = null, overlay = null, mag, reserve, reloading, spread, score, timeLeft, timerLabel, roundLabel }) {
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
    slots[0].classList.toggle('on', weapon !== 'knife');
    slots[1].classList.toggle('on', weapon === 'knife');

    // Viseur dynamique : il s'écarte avec la dispersion, et disparaît en visée
    const gap = 5 + (weapon !== 'knife' ? spread * 700 : 0);
    this.crosshair.style.setProperty('--gap', `${Math.min(gap, 80)}px`);
    this.crosshair.classList.toggle('knife', weapon === 'knife');
    this.crosshair.style.opacity = weapon !== 'knife' ? Math.max(0, 1 - ads * 2) : 1;
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
    const w = document.createElement('span'); w.className = 'w';
    w.textContent = ({ knife: '🔪', kar98k: '━╤⌐', ak: '▬╦' }[weapon] || '▬╦') + (headshot ? ' ◎' : '');
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
      .map(p => `<tr class="${p.alive ? '' : 'dead'}"><td style="color:${TEAMS[p.team]?.css}">${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('');
    sb.innerHTML = `<table><tr><th>Joueur</th><th>Kills</th><th>Morts</th></tr>${rows}</table>`;
  }

  clearFeed() { $('killfeed').innerHTML = ''; this.message(''); }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
