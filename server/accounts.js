// =====================================================================
//  accounts.js — Comptes joueurs : e-mail + mot de passe, pseudo lié au
//  compte (changeable une fois par mois). Mots de passe jamais stockés
//  en clair (scrypt + sel, module natif Node, pas de dépendance).
//
//  Stockage : une vraie base MongoDB si la variable d'environnement
//  MONGODB_URI est définie (comptes permanents, même après un
//  redéploiement) ; sinon un simple fichier JSON local, pratique pour
//  tester sur son PC sans rien installer, mais effacé à chaque
//  redéploiement sur un hébergeur au disque "éphémère" (Render…).
// =====================================================================
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PSEUDO_COOLDOWN_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PSEUDO_RE = /^[A-Za-z0-9_\-ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç ]{3,16}$/;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const check = crypto.scryptSync(password, salt, 64);
    const ref = Buffer.from(hash, 'hex');
    return check.length === ref.length && crypto.timingSafeEqual(check, ref);
  } catch { return false; }
}
function maskEmail(email) {
  const at = email.indexOf('@');
  if (at < 0) return email;
  const name = email.slice(0, at), domain = email.slice(at);
  const shown = name.slice(0, Math.min(2, name.length));
  return `${shown}${'*'.repeat(Math.max(1, name.length - shown.length))}${domain}`;
}
function publicUser(u) {
  return { id: u.id, email: maskEmail(u.email), pseudo: u.pseudo, pseudoChangedAt: u.pseudoChangedAt, pseudoCooldownDays: PSEUDO_COOLDOWN_DAYS };
}

// ---------------------------------------------------------------------
//  Stockage : deux implémentations derrière la même petite interface
//  { findByEmail, findByPseudoLower, findById, insert, updatePseudo }
// ---------------------------------------------------------------------
async function makeStore() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    // Une base injoignable (adresse mal recopiée, mot de passe faux, accès réseau non autorisé
    // sur Atlas…) ne doit JAMAIS planter tout le jeu : on bascule sur le fichier local et on
    // affiche une erreur claire, pour que seuls les comptes soient temporairement non permanents.
    try {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      await client.db('admin').command({ ping: 1 }); // vérifie vraiment la connexion tout de suite
      const dbName = process.env.MONGODB_DB || 'arenastrike';
      const col = client.db(dbName).collection('users');
      await col.createIndex({ email: 1 }, { unique: true });
      await col.createIndex({ pseudoLower: 1 }, { unique: true });
      console.log(`✅ Comptes joueurs stockés dans MongoDB (base « ${dbName} ») — permanents.`);
      return {
        kind: 'mongo',
        async findByEmail(email) { return col.findOne({ email }); },
        async findByPseudoLower(pseudoLower, exceptId = null) {
          const q = exceptId ? { pseudoLower, id: { $ne: exceptId } } : { pseudoLower };
          return col.findOne(q);
        },
        async findById(id) { return col.findOne({ id }); },
        async insert(user) { await col.insertOne(user); },
        async updatePseudo(id, pseudo, pseudoLower, pseudoChangedAt) {
          await col.updateOne({ id }, { $set: { pseudo, pseudoLower, pseudoChangedAt } });
        },
      };
    } catch (e) {
      console.error('❌ MONGODB_URI définie mais injoignable (vérifie l’adresse, le mot de passe et');
      console.error('   Network Access → Allow from anywhere sur Atlas). Détail :', e?.message || e);
      console.error('   → Les comptes repassent temporairement sur le fichier local (non permanents).');
    }
  }

  // ---- Repli local : fichier JSON (pratique pour tester, pas permanent sur un hébergeur) ----
  const DATA_DIR = path.join(__dirname, 'data');
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let users = [];
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { users = []; }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), () => {}), 50);
  };
  console.warn('⚠️  MONGODB_URI non définie : les comptes sont stockés dans server/data/users.json (local).');
  console.warn('    Sur un hébergeur comme Render, ce fichier est effacé à chaque redéploiement.');
  return {
    kind: 'file',
    async findByEmail(email) { return users.find(u => u.email === email) || null; },
    async findByPseudoLower(pseudoLower, exceptId = null) {
      return users.find(u => u.pseudoLower === pseudoLower && u.id !== exceptId) || null;
    },
    async findById(id) { return users.find(u => u.id === id) || null; },
    async insert(user) { users.push(user); save(); },
    async updatePseudo(id, pseudo, pseudoLower, pseudoChangedAt) {
      const u = users.find(x => x.id === id);
      if (u) { u.pseudo = pseudo; u.pseudoLower = pseudoLower; u.pseudoChangedAt = pseudoChangedAt; save(); }
    },
  };
}

const storeReady = makeStore(); // connexion lancée une seule fois au démarrage du serveur
const sessions = new Map(); // token (cookie) -> userId

export async function signup({ email, password, pseudo }) {
  const store = await storeReady;
  email = String(email || '').trim().toLowerCase();
  pseudo = String(pseudo || '').trim();
  if (!EMAIL_RE.test(email)) return { error: 'Adresse e-mail invalide.' };
  if (!password || String(password).length < 6) return { error: 'Le mot de passe doit faire au moins 6 caractères.' };
  if (!PSEUDO_RE.test(pseudo)) return { error: 'Pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, - ou _).' };
  const pseudoLower = pseudo.toLowerCase();
  if (await store.findByEmail(email)) return { error: 'Un compte existe déjà avec cet e-mail.' };
  if (await store.findByPseudoLower(pseudoLower)) return { error: 'Ce pseudo est déjà pris.' };
  const { salt, hash } = hashPassword(String(password));
  const user = { id: crypto.randomUUID(), email, salt, hash, pseudo, pseudoLower, pseudoChangedAt: 0, createdAt: Date.now() };
  try {
    await store.insert(user);
  } catch (e) {
    // Sécurité en plus de la vérification ci-dessus : deux inscriptions en même temps
    // avec le même e-mail/pseudo → la base elle-même refuse le doublon (index unique).
    if (e?.code === 11000) return { error: 'Cet e-mail ou ce pseudo vient d’être pris.' };
    throw e;
  }
  return { user: publicUser(user), token: createSession(user.id) };
}

export async function login({ email, password }) {
  const store = await storeReady;
  email = String(email || '').trim().toLowerCase();
  const user = await store.findByEmail(email);
  if (!user || !verifyPassword(String(password || ''), user.salt, user.hash)) {
    return { error: 'E-mail ou mot de passe incorrect.' };
  }
  return { user: publicUser(user), token: createSession(user.id) };
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, userId);
  return token;
}
export function logout(token) { sessions.delete(token); }
export async function userFromToken(token) {
  const id = token && sessions.get(token);
  if (!id) return null;
  const store = await storeReady;
  const user = await store.findById(id);
  return user ? publicUser(user) : null;
}

/** Change le pseudo du compte connecté — refusé si le mois n'est pas écoulé */
export async function changePseudo(token, newPseudo) {
  const id = sessions.get(token);
  if (!id) return { error: 'Non connecté.' };
  const store = await storeReady;
  const user = await store.findById(id);
  if (!user) return { error: 'Non connecté.' };
  newPseudo = String(newPseudo || '').trim();
  if (!PSEUDO_RE.test(newPseudo)) return { error: 'Pseudo invalide (3 à 16 caractères).' };
  if (newPseudo === user.pseudo) return { user: publicUser(user) };
  const pseudoLower = newPseudo.toLowerCase();
  if (await store.findByPseudoLower(pseudoLower, user.id)) return { error: 'Ce pseudo est déjà pris.' };
  const elapsedDays = (Date.now() - user.pseudoChangedAt) / 86400000;
  if (user.pseudoChangedAt && elapsedDays < PSEUDO_COOLDOWN_DAYS) {
    const left = Math.ceil(PSEUDO_COOLDOWN_DAYS - elapsedDays);
    return { error: `Tu pourras changer de pseudo dans ${left} jour${left > 1 ? 's' : ''}.` };
  }
  const pseudoChangedAt = Date.now();
  try {
    await store.updatePseudo(user.id, newPseudo, pseudoLower, pseudoChangedAt);
  } catch (e) {
    if (e?.code === 11000) return { error: 'Ce pseudo vient d’être pris.' };
    throw e;
  }
  return { user: publicUser({ ...user, pseudo: newPseudo, pseudoChangedAt }) };
}
