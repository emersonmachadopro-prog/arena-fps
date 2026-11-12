// =====================================================================
//  main.js — Point d'entrée du client : crée le monde 3D, relie les
//  menus aux modes de jeu (solo / multijoueur) et fait tourner la boucle.
// =====================================================================
import { createWorld } from './world.js';
import { Input } from './input.js';
import { LocalPlayer } from './player.js';
import { WeaponSystem } from './weapons.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { SoloSession } from './solo.js';
import { NetGame } from './net.js';
import { Showcase } from './showcase.js';
import { initAudio } from './audio.js';
import { settings, saveSettings, keyLabel, activeLoadout } from './settings.js';
import { WEAPONS } from '/shared/constants.js';
import {
  $, showScreen, currentScreen, toast, initSettingsMenu, renderLobby, renderEnd,
  initTabs, showTab, initSkinGrid, initInventory, renderLoadoutCards, renderMainSide,
} from './ui.js';

// ---------------- Création des briques du jeu ----------------
const world = createWorld($('game'));
const input = new Input(world.renderer.domElement);
const effects = new Effects(world.scene);
const hud = new HUD();
const player = new LocalPlayer(world.camera);
const weapons = new WeaponSystem(world.vmScene, world.vmCamera, world.camera, effects);
const showcase = new Showcase(world.scene, world.camera);
weapons.setVisible(false);

const ctx = { scene: world.scene, camera: world.camera, effects, hud, player, weapons };

let session = null; // partie en cours : SoloSession ou NetGame (ou null dans les menus)
let net = null;     // connexion multijoueur (créée au premier besoin)
let returnTo = 'menu-main'; // écran où revenir après les Paramètres
let currentTab = 'play';
const FRAMES = { play: 0.2, skins: 1.25, inventory: -0.4 }; // cadrage du personnage selon l'onglet

// ---------------- Réseau : adresse à mettre dans le lien d'invitation ----------------
// "localhost" ne marche QUE sur ton propre PC. En local, on utilise l'adresse du PC sur le Wi-Fi.
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
let netInfo = { local: isLocal, lan: null, publicUrl: null };
fetch('/api/info').then(r => r.json()).then(info => {
  netInfo = { local: isLocal && !info.publicUrl, lan: info.lan?.[0] || null, publicUrl: info.publicUrl };
}).catch(() => {});

function inviteLink(code) {
  const base = netInfo.publicUrl || (isLocal && netInfo.lan) || location.origin;
  return `${base}/?room=${code}`;
}

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { prompt('Copie ceci :', text); }
}

// ---------------- Personnage affiché dans les menus ----------------
function refreshShowcase() {
  if (session) return;
  const screen = currentScreen();
  if ((screen === 'menu-lobby' || screen === 'menu-lobby-skins' || screen === 'menu-end') && net?.lobby) showcase.showLobby(net.lobby.players);
  else { showcase.frame = FRAMES[currentTab] ?? 0.2; showcase.showMe(settings.skins, activeLoadout()); }
}

// ---------------- Lancer / quitter ----------------
function enterGame(needClick) {
  showcase.hide();
  input.enabled = true;
  hud.show(true);
  if (needClick) showScreen('menu-click');
  else { showScreen(null); input.lock(); }
}

function startSolo(botsShoot) {
  initAudio();
  hud.clearFeed();
  session = new SoloSession(ctx, botsShoot);
  enterGame(false);
}

function leaveGameView() {
  input.enabled = false;
  input.unlock();
  hud.show(false);
  hud.scoreboard(false);
  weapons.setVisible(false);
  player.zoom = 1;
  world.camera.rotation.z = 0;
}

function quitToMenu() {
  if (session && session !== net) session.dispose();
  if (net) net.leave();
  session = null;
  leaveGameView();
  input.exitFullscreen();
  history.replaceState(null, '', '/');
  renderMainSide();
  showScreen('menu-main');
  refreshShowcase();
}

function getName() {
  const n = $('name-input').value.trim() || `Joueur${Math.floor(100 + Math.random() * 900)}`;
  $('name-input').value = n;
  settings.name = n; saveSettings();
  return n;
}

const lobbyActions = {
  addBot: (team, level) => net?.addBot(team, level),
  removeBot: (id) => net?.removeBot(id),
};
const drawLobby = () => { if (net?.lobby) { renderLobby(net.lobby, net.myId, netInfo, lobbyActions); refreshShowcase(); } };

function ensureNet() {
  if (net) return net;
  net = new NetGame(ctx, {
    onLobby: () => drawLobby(),
    onMatchStart: () => {
      session = net;
      enterGame(true); // le navigateur exige un clic pour capturer la souris
    },
    onMatchEnd: (e, myTeam) => {
      session = null;
      leaveGameView();
      renderEnd(e, myTeam);
      showScreen('menu-end');
      refreshShowcase();
    },
    onBackToLobby: (e) => {
      session = null;
      leaveGameView();
      showScreen('menu-lobby');
      drawLobby();
      if (e?.message) toast(e.message);
    },
    onError: (msg) => { $('main-error').textContent = msg; toast(msg); },
  });
  return net;
}

// ---------------- Menu principal : onglets ----------------
$('name-input').value = settings.name || '';
$('name-input').addEventListener('input', renderMainSide);
initTabs((tab) => { currentTab = tab; if (tab === 'inventory') renderInventory(); if (tab === 'skins') renderSkins(); refreshShowcase(); });

// Onglet Jouer
$('btn-solo-passive').onclick = () => startSolo(false);
$('btn-solo-active').onclick = () => startSolo(true);

async function openLobby(res) {
  if (!res?.ok) return ($('main-error').textContent = res?.error || 'Erreur');
  $('main-error').textContent = '';
  history.replaceState(null, '', `/?room=${res.code}`);
  showScreen('menu-lobby');
  drawLobby();
}
$('btn-create').onclick = async () => { initAudio(); openLobby(await ensureNet().create(getName())); };
$('btn-join').onclick = async () => {
  initAudio();
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 5) return ($('main-error').textContent = 'Le code fait 5 caractères.');
  openLobby(await ensureNet().join(code, getName()));
};
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

// Quand les skins ou le loadout changent : on met à jour l'arme en main, l'aperçu et le serveur
function onGearChange() {
  if (!session) weapons.reset(activeLoadout());
  if (net?.lobby) { net.setSkins(settings.skins); net.sendLoadout(); }
  renderMainSide();
  refreshShowcase();
}
// Onglet Personnage (skins)
const renderSkins = initSkinGrid(document.querySelector('#tab-skins .locker-tabs'), $('locker-grid'), onGearChange);
// Onglet Inventaire (loadouts)
const renderInventory = initInventory(onGearChange);

// ---------------- Lobby ----------------
$('btn-copy-code').onclick = () => copy(net.lobby.code, `Code copié : ${net.lobby.code}`);
$('btn-copy-link').onclick = () => { const l = inviteLink(net.lobby.code); copy(l, `Lien copié : ${l}`); };
document.querySelectorAll('.mode-btn').forEach(b => { b.onclick = () => net?.setMode(b.dataset.mode); });
document.querySelectorAll('.join-team').forEach(b => { b.onclick = () => net?.setTeam(b.dataset.team); });
$('btn-ready').onclick = () => {
  const me = net?.lobby?.players.find(p => p.id === net.myId);
  net?.setReady(!me?.ready);
};
$('btn-leave').onclick = quitToMenu;
$('lobby-loadout-select').onchange = (e) => { settings.activeLoadout = +e.target.value; saveSettings(); onGearChange(); };
// Skins depuis le lobby
const renderLobbySkins = initSkinGrid($('lobby-locker-tabs'), $('lobby-locker-grid'), onGearChange);
$('btn-lobby-skins').onclick = () => { renderLobbySkins(); showScreen('menu-lobby-skins'); };
$('btn-lobby-skins-back').onclick = () => { showScreen('menu-lobby'); drawLobby(); };

// ---------------- Paramètres ----------------
const refreshSettings = initSettingsMenu();
const openSettings = () => { returnTo = currentScreen(); refreshSettings(); showScreen('menu-settings'); };
$('btn-settings-main').onclick = openSettings;
$('btn-settings-pause').onclick = openSettings;
$('btn-settings-back').onclick = () => { renderMainSide(); showScreen(returnTo); };

// ---------------- Choix du loadout en jeu (touche M) ----------------
function openLoadout() {
  if (!session) return;
  const dead = !player.alive;
  const freeze = session === net && net.phase === 'freeze';
  $('loadout-hint').textContent = session !== net
    ? (dead ? 'Tu réapparaîtras avec ce loadout.' : 'Changement immédiat (mode entraînement).')
    : (freeze && !dead ? 'Préparation de manche : changement immédiat !' : 'Tu l\'auras à la prochaine manche.');
  renderLoadoutCards($('loadout-cards'), settings.activeLoadout, (i) => {
    const now = session.setLoadout(i);
    const l = settings.loadouts[i];
    if (session !== net) toast(now ? `${l.name} équipé` : `${l.name} à la réapparition`);
    renderMainSide();
    resume();
  });
  showScreen('menu-loadout');
  input.unlock();
}
function resume() { showScreen(null); input.lock(); }
$('btn-loadout-close').onclick = resume;
$('btn-loadout-pause').onclick = openLoadout;

// ---------------- Pause ----------------
$('btn-resume').onclick = resume;
$('btn-quit').onclick = quitToMenu;
input.onUnlock = () => {
  if (session && !currentScreen()) {
    $('pause-hint').textContent = session === net ? 'La partie continue pendant la pause !' : '';
    showScreen('menu-pause');
  }
};
$('menu-click').onclick = resume;
world.renderer.domElement.addEventListener('click', () => { if (session && !currentScreen()) input.lock(); });

// Fin de partie
$('btn-replay').onclick = () => net?.playAgain();
$('btn-end-quit').onclick = quitToMenu;

// Sécurité : si Ctrl+W passe quand même, le navigateur demande confirmation pendant une partie.
addEventListener('beforeunload', (e) => {
  if (session || net?.lobby) { e.preventDefault(); e.returnValue = ''; }
});

// Lien d'invitation : http://.../?room=ABCDE
const invited = new URLSearchParams(location.search).get('room');
if (invited) {
  $('code-input').value = invited.toUpperCase();
  toast(`Invitation reçue (${invited.toUpperCase()}) : choisis un pseudo puis « Rejoindre »`, 5000);
}
renderMainSide();
showTab('play');
showScreen('menu-main');
refreshShowcase();

// ---------------- Boucle de jeu ----------------
let last = performance.now();

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05); // évite les gros sauts si l'onglet a été mis en pause
  last = now;

  if (session) {
    if (input.was('loadout') && input.locked) openLoadout();
    if (player.alive) {
      if (input.locked) player.look(input);
      player.update(dt, input, session.canMove());
    }
    weapons.update(dt, input, player, session, session.canFire() && input.locked);
    session.update(dt);
    hud.update({
      hp: player.hp, weapon: weapons.current, primary: weapons.primary, ads: weapons.ads,
      optic: weapons.currentOptic, overlay: player.alive ? weapons.overlay : null,
      mag: weapons.mag, reserve: weapons.reserve, reloading: weapons.reloading, spread: weapons.lastSpread,
      ...session.hudState(),
    });
    hud.scoreboard(input.is('scoreboard') && input.locked, session.scoreboardPlayers());
    $('dead-hint').classList.toggle('hidden', player.alive);
    $('dead-key').textContent = keyLabel(settings.keys.loadout);
  } else {
    showcase.update(dt);
  }

  effects.update(dt);
  world.render();
  input.endFrame();
}
loop();

// Outil de debug : ouvre http://localhost:3000/?debug pour accéder au jeu depuis la console (F12)
if (new URLSearchParams(location.search).has('debug')) {
  window.DEBUG = { ctx, input, showcase, get session() { return session; }, get net() { return net; }, startSolo };
}
