// =====================================================================
//  accounts.js — Comptes joueurs : e-mail + mot de passe, pseudo lié au
//  compte (changeable une fois par mois). Stockage simple dans un fichier
//  JSON (pas de base de données externe) ; mots de passe jamais stockés
//  en clair (scrypt + sel, module natif Node, pas de dépendance).
// =====================================================================
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PSEUDO_COOLDOWN_DAYS = 30;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}
let users = loadUsers();
let saveTimer = null;
function saveUsers() {
  // On regroupe les écritures rapprochées (ex: plusieurs requêtes à la suite)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), () => {}), 50);
}

const sessions = new Map(); // token (cookie) -> userId

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PSEUDO_RE = /^[A-Za-z0-9_\-ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç ]{3,16}$/;

function findByEmail(email) { return users.find(u => u.email === email); }
function pseudoTaken(pseudo, exceptId = null) {
  return users.some(u => u.id !== exceptId && u.pseudo.toLowerCase() === pseudo.toLowerCase());
}

export function signup({ email, password, pseudo }) {
  email = String(email || '').trim().toLowerCase();
  pseudo = String(pseudo || '').trim();
  if (!EMAIL_RE.test(email)) return { error: 'Adresse e-mail invalide.' };
  if (!password || String(password).length < 6) return { error: 'Le mot de passe doit faire au moins 6 caractères.' };
  if (!PSEUDO_RE.test(pseudo)) return { error: 'Pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, - ou _).' };
  if (findByEmail(email)) return { error: 'Un compte existe déjà avec cet e-mail.' };
  if (pseudoTaken(pseudo)) return { error: 'Ce pseudo est déjà pris.' };
  const { salt, hash } = hashPassword(String(password));
  const user = { id: crypto.randomUUID(), email, salt, hash, pseudo, pseudoChangedAt: 0, createdAt: Date.now() };
  users.push(user);
  saveUsers();
  return { user: publicUser(user), token: createSession(user.id) };
}

export function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const user = findByEmail(email);
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
export function userFromToken(token) {
  const id = token && sessions.get(token);
  const user = id && users.find(u => u.id === id);
  return user ? publicUser(user) : null;
}

/** Change le pseudo du compte connecté — refusé si le mois n'est pas écoulé */
export function changePseudo(token, newPseudo) {
  const id = sessions.get(token);
  const user = id && users.find(u => u.id === id);
  if (!user) return { error: 'Non connecté.' };
  newPseudo = String(newPseudo || '').trim();
  if (!PSEUDO_RE.test(newPseudo)) return { error: 'Pseudo invalide (3 à 16 caractères).' };
  if (newPseudo === user.pseudo) return { user: publicUser(user) };
  if (pseudoTaken(newPseudo, user.id)) return { error: 'Ce pseudo est déjà pris.' };
  const elapsedDays = (Date.now() - user.pseudoChangedAt) / 86400000;
  if (user.pseudoChangedAt && elapsedDays < PSEUDO_COOLDOWN_DAYS) {
    const left = Math.ceil(PSEUDO_COOLDOWN_DAYS - elapsedDays);
    return { error: `Tu pourras changer de pseudo dans ${left} jour${left > 1 ? 's' : ''}.` };
  }
  user.pseudo = newPseudo;
  user.pseudoChangedAt = Date.now();
  saveUsers();
  return { user: publicUser(user) };
}
