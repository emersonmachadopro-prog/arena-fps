// =====================================================================
//  skins.js — Liste des skins (armes + personnage).
//  Pour en ajouter un : copie une ligne et change le nom et les couleurs.
//    body   = couleur principale (métal)
//    accent = couleur secondaire (bois, poignée…)
//    glow   = true → l'accent brille (effet néon)
// =====================================================================

export const WEAPON_SKINS = {
  default: { name: 'Standard', body: 0x2b2f38, accent: 0x8b5a2b },
  carbon:  { name: 'Carbone', body: 0x16181d, accent: 0x3a3f4a },
  arctic:  { name: 'Arctique', body: 0xdfe7f0, accent: 0x7fa6cf },
  gold:    { name: 'Or', body: 0xd4a72c, accent: 0x1b1b1f, metal: true },
  violet:  { name: 'Néon violet', body: 0x241a35, accent: 0xa855f7, glow: true },
  dragon:  { name: 'Dragon', body: 0x4a0d10, accent: 0xff4d2e, glow: true },
};

export const CHARACTER_SKINS = {
  default: { name: 'Standard', suit: 0x2c3244, vest: 0x1e2230 },
  arctic:  { name: 'Arctique', suit: 0xd5dee8, vest: 0x8796ab },
  desert:  { name: 'Désert', suit: 0xb59766, vest: 0x6b5637 },
  jungle:  { name: 'Jungle', suit: 0x41593a, vest: 0x26341f },
  shadow:  { name: 'Ombre', suit: 0x131418, vest: 0x060608 },
  royal:   { name: 'Royal', suit: 0x3b2c70, vest: 0x1e1642 },
};

export const DEFAULT_SKINS = { character: 'default', ak: 'default', kar98k: 'default', knife: 'default' };

/** Nettoie des skins reçus (le serveur n'accepte que des skins existants) */
export function sanitizeSkins(s) {
  const out = { ...DEFAULT_SKINS };
  if (!s || typeof s !== 'object') return out;
  if (CHARACTER_SKINS[s.character]) out.character = s.character;
  for (const w of ['ak', 'kar98k', 'knife']) if (WEAPON_SKINS[s[w]]) out[w] = s[w];
  return out;
}
