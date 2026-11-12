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
import { initAudio } from './audio.js';
import { settings, saveSettings, keyLabel } from './settings.js';
import { WEAPONS } from '/shared/constants.js';
import {
  $, showScreen, currentScreen, toast, initSettingsMenu, renderLobby, renderEnd,
  initLocker, renderWeaponCards, renderMainSide,
} from './ui.js';

// ---------------- Création des briques du jeu ----------------
const world = createWorld($('game'));
const input = new Input(world.renderer.domElement);
const effects = new Effects(world.scene);
const hud = new HUD();
const player = new LocalPlayer(world.camera);
const weapons = new WeaponSystem(world.vmScene, world.vmCamera, world.camera, effects);
weapons.setVisible(false);

const ctx = { scene: world.scene, camera: world.camera, effects, hud, player, weapons };

let session = null; // partie en cours : SoloSession ou NetGame (ou null dans les menus)
let net = null;     // connexion multijoueur (créée au premier besoin)
let returnTo = 'menu-main'; // écran où revenir après Paramètres / Casier

// ---------------- Réseau : adresse à mettre dans le lien d'invitation ----------------
// "localhost" ne marche QUE sur ton propre PC. Si tu joues en local, on utilise
// l'adresse de ton PC sur le Wi-Fi (ex: http://192.168.1.42:3000).
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
let netInfo = { local: isLocal, lan: null, publicUrl: null };
fetch('/api/info').then(r => r.json()).then(info => {
  netInfo = { local: isLocal && !info.publicUrl, lan: info.lan?.[0] || null, publicUrl: info.publicUrl };
}).catch(() => {});

function inviteLink(code) {
  const base = netInfo.publicUrl || (isLocal && netInfo.lan) || location.origin;
  return `${base}/?room=${code}`;
}

// ---------------- Lancer / quitter ----------------
function enterGame(needClick) {
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
}

function getName() {
  const n = $('name-input').value.trim() || `Joueur${Math.floor(100 + Math.random() * 900)}`;
  $('name-input').value = n;
  settings.name = n; saveSettings();
  return n;
}

function ensureNet() {
  if (net) return net;
  net = new NetGame(ctx, {
    onLobby: (l) => renderLobby(l, net.myId, netInfo),
    onMatchStart: () => {
      session = net;
      enterGame(true); // le navigateur exige un clic pour capturer la souris
    },
    onMatchEnd: (e, myTeam) => {
      session = null;
      leaveGameView();
      renderEnd(e, myTeam);
      showScreen('menu-end');
    },
    onBackToLobby: (e) => {
      session = null;
      leaveGameView();
      showScreen('menu-lobby');
      if (net.lobby) renderLobby(net.lobby, net.myId, netInfo);
      if (e?.message) toast(e.message);
    },
    onError: (msg) => { $('main-error').textContent = msg; toast(msg); },
  });
  return net;
}

// ---------------- Menu principal ----------------
$('name-input').value = settings.name || '';
$('name-input').addEventListener('input', renderMainSide);
$('btn-solo-passive').onclick = () => startSolo(false);
$('btn-solo-active').onclick = () => startSolo(true);

$('btn-create').onclick = async () => {
  initAudio();
  const res = await ensureNet().create(getName());
  if (!res?.ok) return ($('main-error').textContent = res?.error || 'Erreur');
  history.replaceState(null, '', `/?room=${res.code}`);
  showScreen('menu-lobby');
  if (net.lobby) renderLobby(net.lobby, net.myId, netInfo);
};

$('btn-join').onclick = async () => {
  initAudio();
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 5) return ($('main-error').textContent = 'Le code fait 5 caractères.');
  const res = await ensureNet().join(code, getName());
  if (!res?.ok) return ($('main-error').textContent = res.error);
  $('main-error').textContent = '';
  history.replaceState(null, '', `/?room=${res.code}`);
  showScreen('menu-lobby');
  if (net.lobby) renderLobby(net.lobby, net.myId, netInfo);
};
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

// ---------------- Lobby ----------------
$('btn-copy-link').onclick = async () => {
  const link = inviteLink(net.lobby.code);
  try { await navigator.clipboard.writeText(link); toast(`Lien copié : ${link}`); }
  catch { prompt('Copie ce lien :', link); }
};
document.querySelectorAll('.mode-btn').forEach(b => { b.onclick = () => net?.setMode(b.dataset.mode); });
document.querySelectorAll('.join-team').forEach(b => { b.onclick = () => net?.setTeam(b.dataset.team); });
$('btn-ready').onclick = () => {
  const me = net?.lobby?.players.find(p => p.id === net.myId);
  net?.setReady(!me?.ready);
};
$('btn-leave').onclick = quitToMenu;

// ---------------- Casier (skins + arme principale) ----------------
const renderLocker = initLocker((primaryChanged) => {
  weapons.applySkins(settings.skins);
  if (primaryChanged && !session) weapons.reset(settings.primary);
  if (net?.lobby) { net.setSkins(settings.skins); if (primaryChanged) net.setLoadout(primaryChanged); }
  renderMainSide();
});
const openLocker = () => { returnTo = currentScreen(); renderLocker(); showScreen('menu-locker'); };
$('btn-locker-main').onclick = openLocker;
$('btn-locker-lobby').onclick = openLocker;
$('btn-locker-back').onclick = () => showScreen(returnTo);

// ---------------- Paramètres ----------------
const refreshSettings = initSettingsMenu();
const openSettings = () => { returnTo = currentScreen(); refreshSettings(); showScreen('menu-settings'); };
$('btn-settings-main').onclick = openSettings;
$('btn-settings-pause').onclick = openSettings;
$('btn-settings-back').onclick = () => { renderMainSide(); showScreen(returnTo); };

// ---------------- Choix d'arme en jeu (touche M) ----------------
function openLoadout() {
  if (!session) return;
  const dead = !player.alive;
  const freeze = session === net && net.phase === 'freeze';
  $('loadout-hint').textContent = session !== net
    ? (dead ? 'Tu réapparaîtras avec cette arme.' : 'Changement immédiat (mode entraînement).')
    : (freeze && !dead ? 'Préparation de manche : changement immédiat !' : 'Tu l\'auras à la prochaine manche.');
  renderWeaponCards($('loadout-cards'), settings.primary, (id) => {
    saveSettings();
    const now = session.setLoadout(id);
    saveSettings();
    if (session !== net) toast(now ? `${WEAPONS[id].name} équipée` : `${WEAPONS[id].name} à la réapparition`);
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

// Sécurité : si Ctrl+W passe quand même (navigateur sans plein écran),
// le navigateur demande confirmation avant de fermer pendant une partie.
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
showScreen('menu-main');

// ---------------- Boucle de jeu ----------------
let last = performance.now();
let menuAngle = 0;

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
      hp: player.hp, weapon: weapons.current, primary: weapons.primary, ads: weapons.ads, scoped: weapons.scoped && player.alive,
      mag: weapons.mag, reserve: weapons.reserve, reloading: weapons.reloading, spread: weapons.lastSpread,
      ...session.hudState(),
    });
    hud.scoreboard(input.is('scoreboard') && input.locked, session.scoreboardPlayers());
    $('dead-hint').classList.toggle('hidden', player.alive);
    $('dead-key').textContent = keyLabel(settings.keys.loadout);
  } else {
    // Dans les menus : la caméra tourne lentement autour de l'arène
    menuAngle += dt * 0.06;
    world.camera.position.set(Math.sin(menuAngle) * 22, 9, Math.cos(menuAngle) * 16);
    world.camera.lookAt(0, 1, 0);
    if (world.camera.fov !== settings.fov) { world.camera.fov = settings.fov; world.camera.updateProjectionMatrix(); }
  }

  effects.update(dt);
  world.render();
  input.endFrame();
}
loop();

// Outil de debug : ouvre http://localhost:3000/?debug pour accéder au jeu depuis la console (F12)
if (new URLSearchParams(location.search).has('debug')) {
  window.DEBUG = { ctx, input, get session() { return session; }, get net() { return net; }, startSolo };
}
