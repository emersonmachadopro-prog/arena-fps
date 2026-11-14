// =====================================================================
//  account.js — Appels au compte joueur (e-mail + mot de passe, pseudo
//  lié au compte). Le cookie de session est géré par le navigateur
//  (HttpOnly) : on ne le touche jamais nous-mêmes.
// =====================================================================
async function call(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Erreur réseau.');
  return data;
}

export const account = {
  async me() {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await r.json().catch(() => ({ user: null }));
    return data.user || null;
  },
  signup: (email, password, pseudo) => call('/api/auth/signup', { email, password, pseudo }).then(d => d.user),
  login: (email, password) => call('/api/auth/login', { email, password }).then(d => d.user),
  logout: () => call('/api/auth/logout', {}),
  changePseudo: (pseudo) => call('/api/auth/pseudo', { pseudo }).then(d => d.user),
};
