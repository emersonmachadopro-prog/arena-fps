# 🎯 Arena Strike — FPS multijoueur dans le navigateur

FPS 1v1 / 2v2 entre potes, en 3D (Three.js), avec un serveur Node.js + Socket.io
qui gère les PV, les kills et le score (anti-triche).

---

## 1. Lancer le jeu sur ton PC

### a) Installer Node.js (une seule fois)
1. Va sur **https://nodejs.org** et télécharge la version **LTS**.
2. Installe-la (suivant, suivant, terminer).
3. Vérifie : ouvre un terminal (Windows : touche Windows → tape `cmd` → Entrée) et tape :
   ```
   node -v
   ```
   Tu dois voir un numéro de version (ex : `v22.x.x`).

### b) Démarrer le serveur
1. Dézippe le dossier `arena-fps` où tu veux (ex : sur le Bureau).
2. Dans le terminal, va dans le dossier :
   ```
   cd Desktop/arena-fps
   ```
   (astuce Windows : dans l'explorateur, ouvre le dossier, clique dans la barre d'adresse, tape `cmd` et Entrée → le terminal s'ouvre directement au bon endroit)
3. Installe les dépendances (une seule fois, ça crée le dossier `node_modules`) :
   ```
   npm install
   ```
4. Lance le serveur :
   ```
   npm start
   ```
   Tu dois voir : `✅ Serveur lancé : http://localhost:3000`
5. Ouvre **http://localhost:3000** dans Chrome, Edge ou Firefox.

Pour arrêter le serveur : `Ctrl + C` dans le terminal.

> 💡 Pour tester le multijoueur tout seul : ouvre 2 onglets (ou une fenêtre normale + une fenêtre privée), crée une partie dans l'un et rejoins-la dans l'autre.

---

## 2. Inviter des potes : quel lien envoyer ?

⚠️ **`localhost` ne marche QUE sur ton propre PC.** Si tu envoies `http://localhost:3000` à un pote,
son navigateur cherche le jeu sur SON ordi → « Ce site est inaccessible ».

Le jeu choisit maintenant le bon lien tout seul (bouton « Copier le lien d'invitation » du lobby) :

| Ton pote est… | Ce qu'il faut faire |
|---|---|
| **Chez toi, sur le même Wi-Fi** | Rien de spécial : le lien utilise l'adresse de ton PC sur le Wi-Fi (ex : `http://192.168.1.42:3000`). Elle s'affiche aussi dans le terminal au lancement. Si Windows demande d'autoriser Node.js dans le pare-feu → **Autoriser** (réseau privé). |
| **Chez lui** | Il faut que le jeu soit accessible sur Internet : **option A** (rapide, ton PC reste allumé) ou **option B** (hébergé 24h/24, partie 3). |

### Option A — Lien Internet temporaire avec Cloudflare Tunnel (gratuit, 5 min)
Ton PC fait serveur, Cloudflare fournit une adresse publique temporaire.
1. Installe l'outil officiel de Cloudflare. Dans un terminal :
   ```
   winget install --id Cloudflare.cloudflared
   ```
   (ferme puis rouvre le terminal après l'installation)
2. Lance le jeu normalement (`npm start`) dans un premier terminal.
3. Dans un **deuxième** terminal :
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
4. Il affiche une adresse du style `https://quelque-chose.trycloudflare.com`.
   **Ouvre TOI-MÊME cette adresse** (pas localhost), crée la partie, puis « Copier le lien d'invitation » :
   le lien sera directement le bon.
5. L'adresse change à chaque lancement de cloudflared, et le jeu s'arrête si tu éteins ton PC.

---

## 3. Mettre le jeu en ligne (jouer avec des potes partout)

On va utiliser **GitHub** (pour stocker le code) + **Render** (pour héberger le serveur gratuitement).
Les deux sont gratuits.

### Étape 1 — Mettre le code sur GitHub
1. Crée un compte sur **https://github.com**.
2. En haut à droite : **+** → **New repository**.
   - Nom : `arena-fps`
   - Coche **Public** ou **Private** (les deux marchent)
   - Clique **Create repository**.
3. Sur la page du dépôt, clique **uploading an existing file**.
4. Glisse-dépose **le contenu** du dossier `arena-fps` (les dossiers `public`, `server`, `shared` et les fichiers `package.json`, `package-lock.json`, `README.md`, `.gitignore`).
   ⚠️ **N'envoie PAS le dossier `node_modules`** (il est énorme et Render le recrée tout seul).
5. Clique **Commit changes**.

### Étape 2 — Créer le serveur sur Render
1. Crée un compte sur **https://render.com** (le plus simple : « Sign in with GitHub »).
2. Clique **New +** → **Web Service**.
3. Choisis ton dépôt `arena-fps` (autorise Render à accéder à GitHub si demandé).
4. Remplis :
   | Champ | Valeur |
   |---|---|
   | Name | `arena-fps` (ou ce que tu veux) |
   | Language / Runtime | `Node` |
   | Branch | `main` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |
5. Clique **Create Web Service** (ou **Deploy**). Attends 2-3 minutes : le journal doit afficher `✅ Serveur lancé`.
6. Ton jeu est en ligne à l'adresse affichée en haut, du style **https://arena-fps.onrender.com** 🎉

### Étape 3 — Jouer
1. Ouvre ton adresse Render, mets ton pseudo, clique **Créer une partie**.
2. Clique **Copier le lien d'invitation** et envoie-le à tes potes (Discord, WhatsApp…).
3. Choisis 1v1 ou 2v2, chacun choisit son équipe et clique **Prêt** → la partie démarre.

### À savoir sur l'offre gratuite de Render
- Le serveur **s'endort après 15 minutes sans joueur**. La première visite après ça prend **environ 1 minute** à charger : c'est normal, attends un peu puis tes potes peuvent rejoindre.
- Pendant une partie, il reste éveillé (les messages du jeu comptent comme de l'activité).
- Si tu veux qu'il ne dorme jamais : offre payante « Starter » (environ 7 $/mois).

### Mettre à jour le jeu en ligne
Modifie tes fichiers → renvoie-les sur GitHub (Add file → Upload files, même nom = remplacement) →
Render redéploie automatiquement en 2-3 minutes.

---

## 3bis. Rendre les comptes joueurs permanents (MongoDB Atlas, gratuit)

Sans rien faire, les comptes (e-mail + mot de passe + pseudo, onglet **Profil**) sont stockés
dans un simple fichier sur le serveur. Ça marche très bien pour tester, **mais sur Render ce
fichier est effacé à chaque fois que tu mets le jeu à jour** (le disque gratuit est "jetable").

Pour que les comptes restent pour de vrai, pour toujours, même après une mise à jour :

1. Va sur **https://www.mongodb.com/cloud/atlas/register** et crée un compte gratuit
   (aucune carte bancaire demandée pour l'offre **M0 Free**, 512 Mo — largement assez pour
   commencer).
2. Crée un cluster **M0 (Free)**, région au choix (Europe de préférence).
3. **Database Access** → crée un utilisateur (identifiant + mot de passe — note-les).
4. **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`)
   — Render se connecte depuis une adresse qui change, c'est le plus simple.
5. **Connect** → **Drivers** → copie l'adresse du style :
   ```
   mongodb+srv://tonUtilisateur:tonMotDePasse@cluster0.xxxxx.mongodb.net/
   ```
6. Sur **Render**, ouvre ton service → **Environment** → **Add Environment Variable** :
   | Clé | Valeur |
   |---|---|
   | `MONGODB_URI` | l'adresse copiée à l'étape 5 (remplace `tonMotDePasse` par le vrai mot de passe) |

Render redéploie tout seul. Dans les logs, tu dois voir :
`✅ Comptes joueurs stockés dans MongoDB (base « arenastrike ») — permanents.`

À partir de là, tous les comptes créés restent **pour toujours**, même si tu mets le jeu à
jour cent fois. Sans cette variable, le jeu continue de marcher normalement (il revient tout
seul au fichier local) — pratique pour tester sur ton PC sans toucher à Atlas.

---

## 4. Commandes du jeu (modifiables dans ⚙ Paramètres)

| Action | Touche par défaut |
|---|---|
| Se déplacer | Z Q S D (AZERTY) / W A S D (QWERTY) |
| Tirer | Clic gauche |
| Viser / lunette du sniper | Clic droit (maintenir) |
| Courir (maintenir) | Maj gauche |
| Glisser | C pendant que tu cours |
| Sauter | Espace (pendant une glissade = saut avec l'élan) |
| S'accroupir | C |
| Recharger | R |
| Inspecter l'arme | Y |
| Arme principale / Glock 18 / Couteau | 1 / 2 / 3 |
| Arme suivante / précédente | molette bas / haut (modifiable ou retirable, ex. molette = sauter) |
| Choisir son loadout | M — en jeu, même mort en attendant de réapparaître |
| Tableau des scores | Tab |
| Pause / libérer la souris | Échap |

Les paramètres (touches, sensibilité, FOV, volumes, viseur, skins) sont sauvegardés dans le navigateur.

**Boutons de la souris :** dans ⚙ Paramètres → Commandes, clique sur une action puis appuie sur une touche
**ou** sur un bouton de souris (clic molette, boutons latéraux « Souris 4 / 5 », molette haut/bas).

**Viseur (réticule) :** ⚙ Paramètres → Viseur : forme (croix, T, cercle, point, croix + point), couleur,
longueur, écart, épaisseur, opacité, contour, point central, dynamique ou fixe. Aperçu en direct.

**Son :** ⚙ Paramètres → Son & graphismes : volume général, effets, musique des menus, et le pack de sons de kill
(Classique, Néon, Impact) avec un bouton pour les écouter. Les kills d'affilée montent dans les aigus jusqu'au 4e,
le 5e a son petit son spécial. Ajouter un pack : `KILL_PACKS` dans `public/js/audio.js`.

**Qualité graphique :** Basse (PC modestes), Moyenne, Haute (ombres douces, halo lumineux, anticrénelage, détails du décor).

**Couteau :** dans l'Inventaire → carte Couteau, choisis le **couteau de combat** (animations sobres) ou le **couteau papillon** (sortie en rotation, figures autour de l'annulaire avec Y).

**Spectateur :** quand tu regardes un coéquipier, tu vois quand il vise (zoom + lunette), inspecte, court, tire et recharge.

**Ping :** affiché dans le tableau des scores (Tab), à côté de chaque joueur (« BOT » pour les bots).

**Précision :** sans viser, les armes sont imprécises (même immobile) ; en visant (clic droit) elles sont très précises.
Le Kar98k dans la lunette est parfaitement précis si tu ne bouges pas.

**Ctrl+W :** en jeu, le navigateur passe en plein écran et bloque Ctrl+W (Chrome, Edge, Opera).
Si ton navigateur ne le permet pas, il te demande au moins une confirmation avant de fermer l'onglet.
Option désactivable dans ⚙ Paramètres.

**Menu :** onglets **Jouer** (créer / rejoindre une partie, entraînement), **Personnage** (tenue du personnage),
**Inventaire** (5 loadouts façon armurerie : 3 cartes **Arme principale** (+ viseur), **Arme secondaire** (Glock 18)
et **Couteau** ; clique sur une carte pour changer l'arme, le viseur et le skin. Le loadout « Équipé » est utilisé en jeu).
**Musique :** `public/sounds/lobby_music.mp3` tourne en boucle dans les menus et le salon (volume réglable).
Pour ajouter un skin : `shared/skins.js` (une ligne = un skin).

**Sons :** les bruitages sont dans `public/sounds/` (générés avec ElevenLabs). Pour en changer un, remplace le
fichier .mp3 en gardant le même nom. S'il en manque un, le jeu utilise un son fabriqué par le code.

**Armes principales :** AK-47 (fusil d'assaut), **MP5** (mitraillette rapide, la « claque » du levier au rechargement à vide),
**M870** (fusil à pompe : 9 plombs avec un motif fixe, mortel de près, pompe après chaque tir, cartouches rouges chargées une par une),
Kar98k (verrou manœuvré par la main droite, on voit les balles dans la fenêtre et celle qui part dans la chambre).
Arme secondaire : Glock 18. Équilibrage : `WEAPONS` dans `shared/constants.js`.

**Viseurs :** mire (de base), point rouge, lunette x2.5, lunette sniper x4 (Kar98k uniquement).

**Recul :** l'AK et le MP5 ont un motif de recul fixe (`RECOIL_PATTERN` dans `weapons.js`) : on peut apprendre à le contrôler.

**Réseau :** 30 mises à jour par seconde, WebSocket direct, retard d'interpolation qui s'adapte à la connexion,
marqueur de touche affiché tout de suite (le serveur confirme ensuite). Pour le meilleur ping en France,
crée ton service Render dans la région **Frankfurt (EU Central)**.

**Bots en multijoueur :** dans le salon, l'hôte peut compléter une place libre avec un bot
(Débutant, Intermédiaire ou Fort). Si un vrai joueur rejoint et que le salon est plein, un bot lui laisse sa place.
Réglages des bots : `BOT_LEVELS` dans `shared/constants.js`.

---

## 5. Organisation du code

```
arena-fps/
├── package.json          ← dépendances + commande "npm start"
├── server/
│   ├── index.js          ← serveur web + Socket.io, création des salons
│   ├── Room.js           ← logique d'une partie (lobby, manches, PV, score)
│   └── Bot.js            ← intelligence des bots en multijoueur
├── shared/               ← code utilisé PAR LE CLIENT ET LE SERVEUR
│   ├── constants.js      ← ⚖️ équilibrage : dégâts, vitesse, manches…
│   ├── map.js            ← la map (liste de boîtes) + spawns
│   ├── skins.js          ← liste des skins (armes + tenues)
│   └── physics.js        ← collisions et lancer de rayons (tirs)
└── public/               ← ce que le navigateur télécharge
    ├── index.html        ← menus + HUD
    ├── css/style.css
    └── js/
        ├── main.js       ← point d'entrée, boucle de jeu, menus
        ├── world.js      ← scène 3D, lumières, construction de la map
        ├── player.js     ← déplacements du joueur
        ├── weapons.js    ← AK-47, Kar98k, Glock 18, couteau : modèles, animations, recul, rechargement
        ├── avatars.js    ← personnages des autres joueurs (contour violet/orange selon l'équipe)
        ├── models.js     ← outils pour fabriquer les modèles 3D (boîtes, bras, contour)
        ├── textures.js   ← textures réalistes dessinées par le code (béton, bois, tôle…)
        ├── effects.js    ← traçantes, impacts, douilles éjectées
        ├── body.js       ← tes jambes et ton ombre (vue à la 1re personne)
        ├── crosshair.js  ← dessin du viseur personnalisable
        ├── hud.js        ← PV, munitions, killfeed…
        ├── audio.js      ← sons générés par code
        ├── settings.js   ← paramètres sauvegardés
        ├── input.js      ← clavier / souris
        ├── ui.js         ← menus (onglets, inventaire, lobby, paramètres, fin)
        ├── showcase.js   ← personnages affichés en 3D dans les menus
        ├── solo.js       ← mode entraînement avec bots
        └── net.js        ← mode multijoueur (client Socket.io)
```

### Modifier facilement
- **Dégâts, cadence, chargeur, précision, zoom, vitesse, nombre de manches** → `shared/constants.js`
- **Skins** → `shared/skins.js`
- **La map** (ajouter une caisse, un mur…) → `shared/map.js` : ajoute une ligne `box(x, z, largeur, profondeur, hauteur)`.
  La map est automatiquement symétrique (chaque équipe a les mêmes couvertures).
- **Couleurs / style** → `public/js/world.js` (tableau `STYLE`) et `public/css/style.css`.

### Comment marche l'anti-triche ?
Le navigateur envoie seulement « je suis ici » et « je tire dans cette direction ».
Le serveur vérifie la cadence de tir, les munitions, la vitesse de déplacement, recalcule le tir
depuis la position qu'il connaît (en tenant compte des murs) et décide seul des dégâts, des kills et du score.

**Compensation de latence :** chaque tir indique l'instant affiché sur l'écran du tireur. Le serveur garde
1 seconde d'historique des positions et vérifie la touche là où le tireur voyait vraiment sa cible
(sinon, à cause du délai réseau, une balle qui touche à l'écran peut passer à côté sur le serveur).
Les autres joueurs sont affichés avec 100 ms de retard volontaire pour que leurs mouvements soient fluides.

### Debug
Ouvre `http://localhost:3000/?debug` puis la console (F12) : l'objet `DEBUG` donne accès au joueur et à la partie.
