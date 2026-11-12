// =====================================================================
//  textures.js — Textures "réalistes" dessinées par le code (canvas) :
//  béton, carrelage, bois de caisse, tôle, tissu. Aucun fichier image.
//  Chaque texture est créée une seule fois puis réutilisée.
// =====================================================================
import * as THREE from 'three';

const cache = {};

// Petit générateur pseudo-aléatoire (pour que les textures soient identiques à chaque chargement)
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function make(name, size, draw, repeat = true) {
  if (cache[name]) return cache[name];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size, rng(name.length * 7919 + size));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache[name] = t;
  return t;
}

/** Ajoute du "grain" (petits points clairs/sombres) */
function grain(g, size, r, amount, alpha) {
  for (let i = 0; i < amount; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    const s = r() * 2.2 + 0.4;
    g.fillRect(r() * size, r() * size, s, s);
  }
}

/** Taches douces (salissures) */
function stains(g, size, r, count, color, maxR) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = r() * maxR + maxR * 0.2;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/** Béton des murs (1 répétition = 2 m) */
export function concreteTex() {
  return make('concrete', 512, (g, S, r) => {
    g.fillStyle = '#8e9095'; g.fillRect(0, 0, S, S);
    stains(g, S, r, 14, 'rgba(60,62,68,.09)', 120);
    stains(g, S, r, 10, 'rgba(190,190,185,.07)', 100);
    // coulures verticales (eau de pluie)
    for (let i = 0; i < 18; i++) { const x = r() * S; const grd = g.createLinearGradient(0, 0, 0, S * 0.6); grd.addColorStop(0, 'rgba(50,50,55,.12)'); grd.addColorStop(1, 'rgba(50,50,55,0)'); g.fillStyle = grd; g.fillRect(x, 0, 3 + r() * 8, S * (0.2 + r() * 0.4)); }
    grain(g, S, r, 9000, 0.12);
    // trous de banche (typiques du béton coffré)
    g.fillStyle = 'rgba(40,40,45,.45)';
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) { g.beginPath(); g.arc(x * S, y * S, 5, 0, 7); g.fill(); }
    // joints de panneaux
    g.strokeStyle = 'rgba(40,42,48,.35)'; g.lineWidth = 3; g.strokeRect(0, 0, S, S);
  });
}

/** Dalles de béton du sol (1 répétition = 2 m) */
export function floorTex() {
  return make('floor', 512, (g, S, r) => {
    g.fillStyle = '#6d6f73'; g.fillRect(0, 0, S, S);
    // 2x2 dalles légèrement différentes
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},0)`;
      const v = (r() - 0.5) * 18 | 0;
      g.fillStyle = `rgb(${109 + v},${111 + v},${115 + v})`;
      g.fillRect(i * S / 2 + 2, j * S / 2 + 2, S / 2 - 4, S / 2 - 4);
    }
    stains(g, S, r, 14, 'rgba(40,40,40,.1)', 90);
    grain(g, S, r, 12000, 0.13);
    // traces de pneus / rayures
    g.strokeStyle = 'rgba(30,30,30,.12)'; g.lineWidth = 2;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(r() * S, r() * S); g.lineTo(r() * S, r() * S); g.stroke(); }
    // joints entre les dalles
    g.fillStyle = 'rgba(35,36,40,.8)';
    g.fillRect(0, 0, S, 3); g.fillRect(0, S / 2 - 1, S, 3); g.fillRect(0, 0, 3, S); g.fillRect(S / 2 - 1, 0, 3, S);
  });
}

/** Caisse en bois (toute la face) */
export function crateTex() {
  return make('crate', 512, (g, S, r) => {
    // planches horizontales
    const planks = 5;
    for (let i = 0; i < planks; i++) {
      const v = (r() - 0.5) * 30 | 0;
      g.fillStyle = `rgb(${150 + v},${108 + v},${66 + v})`;
      g.fillRect(0, i * S / planks, S, S / planks);
      // veines du bois
      g.strokeStyle = 'rgba(80,50,25,.35)'; g.lineWidth = 1;
      for (let k = 0; k < 14; k++) {
        const y = i * S / planks + r() * S / planks;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 2);
        g.stroke();
      }
      g.fillStyle = 'rgba(40,25,10,.6)'; g.fillRect(0, i * S / planks, S, 3);
    }
    grain(g, S, r, 5000, 0.1);
    // cadre + croisillon plus foncés
    const frame = (x, y, w, h) => { g.fillStyle = '#6e4a28'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(30,18,8,.7)'; g.lineWidth = 3; g.strokeRect(x, y, w, h); };
    frame(0, 0, S, 44); frame(0, S - 44, S, 44); frame(0, 0, 44, S); frame(S - 44, 0, 44, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(Math.PI / 4); frame(-S * 0.68, -22, S * 1.36, 44); g.restore();
    // clous
    g.fillStyle = '#2b2b2b';
    for (const [x, y] of [[22, 22], [S - 22, 22], [22, S - 22], [S - 22, S - 22]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  }, false);
}

/** Tôle larmée (plateforme, marches) — 1 répétition = 1 m */
export function metalPlateTex() {
  return make('metal', 256, (g, S, r) => {
    g.fillStyle = '#7d8590'; g.fillRect(0, 0, S, S);
    stains(g, S, r, 20, 'rgba(50,40,30,.18)', 50);
    grain(g, S, r, 4000, 0.12);
    // motifs en relief
    for (let y = 0; y < S; y += 32) for (let x = 0; x < S; x += 32) {
      const ox = (y / 32) % 2 ? 16 : 0;
      g.save(); g.translate(x + ox + 8, y + 8); g.rotate(((x + y) / 32) % 2 ? 0.7 : -0.7);
      g.fillStyle = 'rgba(210,215,222,.35)'; g.fillRect(-8, -2, 16, 4);
      g.fillStyle = 'rgba(30,32,36,.35)'; g.fillRect(-8, 2, 16, 1.5);
      g.restore();
    }
  });
}

/** Bandes de danger jaune/noir */
export function hazardTex() {
  return make('hazard', 128, (g, S) => {
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#e8b52a';
    for (let i = -S; i < S * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - S, S); g.lineTo(i - S, S); g.fill(); }
  });
}

/** Tissu (tenues des personnages) : texture claire qui se multiplie avec la couleur */
export function fabricTex() {
  return make('fabric', 128, (g, S, r) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(0,0,0,.08)';
    for (let i = 0; i < S; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
    grain(g, S, r, 1500, 0.15);
    stains(g, S, r, 6, 'rgba(0,0,0,.12)', 30);
  });
}

/** Métal usé (armes) */
export function wornMetalTex() {
  return make('worn', 128, (g, S, r) => {
    g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, S, S);
    grain(g, S, r, 2500, 0.2);
    g.strokeStyle = 'rgba(255,255,255,.25)';
    for (let i = 0; i < 25; i++) { g.beginPath(); const x = r() * S, y = r() * S; g.moveTo(x, y); g.lineTo(x + r() * 20, y + r() * 4); g.stroke(); }
  });
}

/** Veines de bois (crosses) */
export function woodGrainTex() {
  return make('woodgrain', 128, (g, S, r) => {
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(70,40,15,.25)';
    for (let k = 0; k < 30; k++) {
      const x = r() * S; g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= S; y += 16) g.lineTo(x + Math.sin(y * 0.05 + k) * 3, y);
      g.stroke();
    }
    grain(g, S, r, 800, 0.12);
  });
}

/**
 * Adapte les coordonnées de texture d'une boîte à sa taille réelle,
 * pour que la texture garde la même échelle sur un petit ou un grand mur.
 * tile = taille (en mètres) d'une répétition de la texture.
 */
export function worldUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  // Ordre des faces de BoxGeometry : +x, -x, +y, -y, +z, -z (4 sommets chacune)
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * sizes[f][0] / tile, uv.getY(k) * sizes[f][1] / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}
