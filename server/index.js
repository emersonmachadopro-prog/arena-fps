// =====================================================================
//  index.js — Point d'entrée du serveur
//  1) Sert les fichiers du jeu (HTML, JS, Three.js) au navigateur
//  2) Gère les connexions Socket.io et les salons de jeu
//  Lancer avec :  npm start   puis ouvrir http://localhost:3000
// =====================================================================

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { Server } from 'socket.io';
import { Room } from './Room.js';
import { signup, login, logout, userFromToken, changePseudo } from './accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000; // les hébergeurs fournissent souvent leur propre PORT

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  perMessageDeflate: false,   // pas de compression : les paquets sont petits, ça évite de la latence
  pingInterval: 10000, pingTimeout: 8000,
});

// ---- Fichiers statiques ----
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm')));
app.get('/health', (_req, res) => res.send('ok'));
app.use(express.json());

// ---- Comptes (e-mail + mot de passe, pseudo lié au compte) ----
// Pas de dépendance cookie-parser : on lit l'en-tête nous-mêmes (un seul cookie).
const COOKIE = 'as_session';
function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}
// asyncRoute : évite de répéter le try/catch (une erreur inattendue → 500, jamais un plantage du serveur)
const asyncRoute = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('Erreur compte :', e);
  res.status(500).json({ error: 'Erreur serveur, réessaie.' });
});
app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  const r = await signup(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  setSessionCookie(res, r.token);
  res.json({ user: r.user });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const r = await login(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  setSessionCookie(res, r.token);
  res.json({ user: r.user });
}));
app.post('/api/auth/logout', (req, res) => {
  const token = readSessionToken(req);
  if (token) logout(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.get('/api/auth/me', asyncRoute(async (req, res) => {
  res.json({ user: await userFromToken(readSessionToken(req)) });
}));
app.post('/api/auth/pseudo', asyncRoute(async (req, res) => {
  const token = readSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Non connecté.' });
  const r = await changePseudo(token, req.body?.pseudo);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ user: r.user });
}));

// Adresses IP de ce PC sur le réseau local (Wi-Fi / box).
// Sert à fabriquer un lien d'invitation qui marche pour les potes
// connectés au même Wi-Fi (localhost ne marche QUE sur ton propre PC).
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // On met en premier les adresses de box classiques (192.168.x.x)
  return out.sort((a, b) => (b.startsWith('192.168.') ? 1 : 0) - (a.startsWith('192.168.') ? 1 : 0));
}
app.get('/api/info', (_req, res) => {
  res.json({ lan: lanAddresses().map(ip => `http://${ip}:${PORT}`), publicUrl: process.env.PUBLIC_URL || null });
});

// ---- Salons ----
const rooms = new Map(); // code -> Room

// Code à 5 caractères, sans les lettres qui prêtent à confusion (O/0, I/1)
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  let room = null; // le salon de ce joueur

  const leave = () => {
    if (room) { socket.leave(room.code); room.removePlayer(socket.id); room = null; }
  };

  socket.on('createRoom', ({ name, skins, loadout } = {}, reply) => {
    leave();
    const code = makeCode();
    room = new Room(code, io, (c) => rooms.delete(c));
    rooms.set(code, room);
    room.addPlayer(socket, name, skins, loadout);
    reply?.({ ok: true, code });
  });

  socket.on('joinRoom', ({ code, name, skins, loadout } = {}, reply) => {
    leave();
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return reply?.({ ok: false, error: 'Salon introuvable. Vérifie le code.' });
    const err = r.addPlayer(socket, name, skins, loadout);
    if (err) return reply?.({ ok: false, error: err });
    room = r;
    reply?.({ ok: true, code: r.code });
  });

  socket.on('leaveRoom', leave);
  socket.on('disconnect', leave);

  // Lobby
  socket.on('setMode', (mode) => room?.setMode(socket.id, mode));
  socket.on('setTeam', (team) => room?.setTeam(socket.id, team));
  socket.on('setReady', (ready) => room?.setReady(socket.id, ready));
  socket.on('setSkins', (skins) => room?.setSkins(socket.id, skins));
  socket.on('setLoadout', (lo) => room?.setLoadout(socket.id, lo));
  socket.on('addBot', ({ team, level } = {}) => room?.addBot(socket.id, team, level));
  socket.on('removeBot', (botId) => room?.removeBot(socket.id, botId));
  socket.on('playAgain', () => { if (room && room.state === 'ended') room.backToLobby(); });

  // En jeu
  socket.on('move', (data) => room?.onMove(socket.id, data || {}));
  socket.on('shoot', (data) => room?.onShoot(socket.id, data || {}));
  socket.on('reload', () => room?.onReload(socket.id));
  socket.on('reloadCancel', () => room?.onReloadCancel(socket.id));
  // Mesure du ping : le client envoie l'heure, on la renvoie tout de suite
  socket.on('pingCheck', (t, reply) => reply?.(t));
  socket.on('myPing', (ms) => { const p = room?.players.get(socket.id); if (p && typeof ms === 'number') p.ping = Math.max(0, Math.min(999, Math.round(ms))); });
  socket.on('switch', (w) => room?.onSwitch(socket.id, w));
});

server.listen(PORT, () => {
  console.log(`\n✅ Serveur lancé !`);
  console.log(`   • Sur ce PC :            http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`   • Potes sur ton Wi-Fi :  http://${ip}:${PORT}`);
  console.log(`   • Potes à distance :     mets le jeu en ligne (voir README, partie 3)\n`);
});
