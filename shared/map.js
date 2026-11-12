// =====================================================================
//  map.js — La map "Arène" décrite comme une liste de boîtes.
//  Le client s'en sert pour l'afficher, le serveur pour les collisions
//  et pour vérifier qu'un mur bloque bien une balle.
// =====================================================================

// Crée une boîte à partir de son centre (cx, cz), sa taille et sa hauteur.
// kind sert uniquement au rendu : 'wall', 'crate', 'platform', 'step', 'pillar'
function box(cx, cz, w, d, h, kind = 'crate', y0 = 0) {
  return {
    min: [cx - w / 2, y0, cz - d / 2],
    max: [cx + w / 2, y0 + h, cz + d / 2],
    kind,
  };
}

// La map est symétrique par rotation de 180° : chaque équipe a exactement
// les mêmes couvertures de son côté. On décrit une moitié + le centre.
const half = [
  // Mur de protection devant le spawn
  box(-14, 0, 0.8, 6, 2.2, 'wall'),
  // Couloir : long mur qui sépare l'allée du milieu de l'allée du bas
  box(-6.5, 7, 7, 0.6, 3, 'wall'),
  box(-6.5, -7, 3, 0.6, 3, 'wall'),
  // Escaliers qui montent sur la plateforme centrale
  box(-5.0, 0, 0.8, 2.4, 0.4, 'step'),
  box(-4.2, 0, 0.8, 2.4, 0.8, 'step'),
  box(-3.4, 0, 0.8, 2.4, 1.2, 'step'),
  // Caisses
  box(-8, 2.5, 1.2, 1.2, 1.2),
  box(-8, -3.5, 1.4, 1.4, 1.4),
  box(-11, -10.5, 1.4, 1.4, 1.4),
  box(-11, -10.5, 0.9, 0.9, 0.9, 'crate', 1.4),  // caisse posée sur une autre
  box(-6, 11, 1.4, 1.4, 1.4),
  box(-15.5, 9, 1.2, 1.2, 1.2),
  box(-15.5, -9, 2.4, 1.2, 1.2),
  box(-2, 11.5, 1.2, 2.4, 1.2),
  box(-2, -11, 1.2, 1.2, 1.2),
  // Piliers
  box(-10, 4.5, 1, 1, 3.2, 'pillar'),
  box(-10, -5.5, 1, 1, 3.2, 'pillar'),
];

// Rotation de 180° autour du centre (x → -x, z → -z)
function rotate180(b) {
  return {
    min: [-b.max[0], b.min[1], -b.max[2]],
    max: [-b.min[0], b.max[1], -b.min[2]],
    kind: b.kind,
  };
}

export const MAP_SIZE = { x: 20, z: 15 }; // l'arène va de -20 à 20 en x, -15 à 15 en z
const WALL_H = 5;

export const MAP_BOXES = [
  ...half,
  ...half.map(rotate180),
  // Plateforme centrale surélevée
  box(0, 0, 6, 6, 1.6, 'platform'),
  // Murs extérieurs
  box(0, -MAP_SIZE.z - 0.5, MAP_SIZE.x * 2 + 2, 1, WALL_H, 'outer'),
  box(0, MAP_SIZE.z + 0.5, MAP_SIZE.x * 2 + 2, 1, WALL_H, 'outer'),
  box(-MAP_SIZE.x - 0.5, 0, 1, MAP_SIZE.z * 2, WALL_H, 'outer'),
  box(MAP_SIZE.x + 0.5, 0, 1, MAP_SIZE.z * 2, WALL_H, 'outer'),
];

// Points d'apparition : équipe A à gauche (x négatif), équipe B à droite.
// yaw = direction du regard (en radians). On regarde vers le centre.
export const SPAWNS = {
  A: [
    { x: -17.5, z: -1.5, yaw: -Math.PI / 2 },
    { x: -17.5, z: 1.5, yaw: -Math.PI / 2 },
  ],
  B: [
    { x: 17.5, z: 1.5, yaw: Math.PI / 2 },
    { x: 17.5, z: -1.5, yaw: Math.PI / 2 },
  ],
};

// Points de passage utilisés par les bots du mode solo
export const BOT_WAYPOINTS = [
  [-12, 0], [-8, 0], [-5.5, 3], [0, 0], [5.5, -3], [8, 0], [12, 0],
  [-12, 11], [-4, 11], [4, 11], [12, 11],
  [-12, -11], [-4, -11], [4, -11], [12, -11],
  [-17, 6], [17, -6], [-17, -6], [17, 6],
  [-16, 4.5], [-16, -4.5], [16, 4.5], [16, -4.5], [-8, 6], [8, -6], [-8, -8.5], [8, 8.5],
];
