// =====================================================================
//  crosshair.js — Viseur personnalisable (dessiné sur un canvas).
//  Utilisé en jeu et dans l'aperçu des paramètres.
// =====================================================================
import { DEFAULT_CROSSHAIR } from './settings.js';

export const CROSSHAIR_STYLES = { cross: 'Croix', t: 'Croix en T', circle: 'Cercle', dot: 'Point', crossdot: 'Croix + point' };

/** Dessine le viseur au centre du canvas. extraGap = écart dû à la dispersion (px) */
export function drawCrosshair(canvas, cfg = {}, extraGap = 0) {
  const c = { ...DEFAULT_CROSSHAIR, ...cfg };
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, cx = Math.round(W / 2), cy = Math.round(H / 2);
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = c.opacity;
  const th = Math.max(1, c.thickness), len = c.size, gap = c.gap + (c.dynamic ? extraGap : 0);
  const rects = [];
  const line = (x, y, w, h) => rects.push([x, y, w, h]);
  const half = th / 2;
  if (c.style === 'cross' || c.style === 't' || c.style === 'crossdot') {
    if (c.style !== 't') line(cx - half, cy - gap - len, th, len);   // haut
    line(cx - half, cy + gap, th, len);                              // bas
    line(cx - gap - len, cy - half, len, th);                        // gauche
    line(cx + gap, cy - half, len, th);                              // droite
  }
  if (c.dot || c.style === 'dot' || c.style === 'crossdot') {
    const d = Math.max(2, th + (c.style === 'dot' ? 1 : 0));
    line(cx - d / 2, cy - d / 2, d, d);
  }
  // Contour noir pour rester lisible sur tous les fonds
  if (c.outline) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    for (const [x, y, w, h] of rects) ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  }
  if (c.style === 'circle') {
    const r = Math.max(3, gap + len * 0.5);
    if (c.outline) { ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = th + 2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = c.color; ctx.lineWidth = th; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = c.color;
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}
