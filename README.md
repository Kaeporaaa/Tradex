# Répertoire accordéon

Petit site statique (pas de serveur, pas de base de données) pour classer tes morceaux
de musique trad joués à l'accordéon, et les rejouer en boucle sur la portion de ton choix
(idéal pour bosser un passage).

## Structure du projet

```
repertoire-accordeon/
  index.html
  style.css
  app.js
  data/
    tracks.json      <- le catalogue (métadonnées de chaque morceau)
  audio/
    (tes fichiers .mp3 vont ici)
```

`tracks.json` est la source de vérité. Il contient un objet à deux clés :

```json
{
  "musiciens": ["Julien", "Camille"],
  "morceaux": [ { "id": "...", "titre": "...", ... } ]
}
```

`musiciens` est la liste des musiciens que tu connais (gérée depuis la colonne de
gauche de l'appli). Chaque morceau dans `morceaux` a : un titre, un type de danse/rythme
(`type` — les rythmes irlandais incluent maintenant aussi `slide` et `barndance`, en
plus de reel/jig/slip jig/hornpipe/air ; il y a aussi `hora`, pour les danses rondes
d'Europe de l'Est), une catégorie/origine (`categorie` : irish,
morvan, auvergne, pays-de-l-est, breton, ecosse, angleterre, autre), une tonalité
structurée en deux champs (`toniqueNote` + `toniqueMode`, ex.
`"mi"` + `"mineur"`), une source/collectage, un niveau de maîtrise, des notes, la liste
des musiciens qui la jouent aussi (`joueAvec`, tableau de noms), un groupe (`groupe` —
« Trad » par défaut, ou le nom d'un groupe que tu tapes toi-même ; les noms déjà saisis
sont ensuite suggérés automatiquement dès que tu retapes les premières lettres, et un
filtre dans la colonne de gauche permet de trier par groupe), éventuellement des
points de boucle (`loopDebut` / `loopFin`, en secondes), et un booléen `titreProvisoire`
(case « Titre ? » à côté du titre dans l'appli) pour marquer un titre que tu n'es pas
sûr d'avoir bien identifié — un badge « ? » apparaît alors dans la liste, et un filtre
dans la colonne de gauche permet d'afficher uniquement ces morceaux-là pour les corriger
plus tard. C'est ce fichier que tu verses dans git pour que ton répertoire soit
permanent.

**Ancien format :** si ton `tracks.json` déployé est encore l'ancien format (un simple
tableau de morceaux, sans roster de musiciens ni tonalité structurée), l'appli continue
de le charger sans erreur — mais les morceaux qu'il contient n'auront pas de catégorie
ni de tonalité tant que tu ne les auras pas rééditées avec les nouveaux champs.

## Tester en local avant de déployer

Les navigateurs bloquent souvent `fetch()` quand on ouvre `index.html` directement
depuis le disque (`file://`). Sers plutôt le dossier avec un petit serveur local :

```bash
cd repertoire-accordeon
python3 -m http.server 8080
# puis ouvre http://localhost:8080 dans ton navigateur
```

(N'importe quel serveur statique fait l'affaire : `npx serve`, l'extension VS Code
"Live Server", etc.)

## Ajouter tes morceaux

Deux façons de faire, qui se combinent bien :

**1. Directement dans les fichiers (le plus fiable, à faire avant de déployer) :**
1. Copie ton mp3 dans `audio/`.
2. Ajoute une entrée dans `data/tracks.json`, sur le modèle des deux exemples fournis
   (que tu peux supprimer une fois que tu as tes propres morceaux).
3. Recharge la page.

**2. Depuis l'appli, bouton « + Ajouter un morceau » :**
Tu choisis un fichier audio sur ton ordinateur, il est immédiatement jouable et
éditable (titre, type, tonalité, niveau, notes, points de boucle) — pratique pour
essayer avant de committer. Cet audio est stocké uniquement dans le navigateur
(IndexedDB), pas encore dans le dépôt : un encart dans le panneau du morceau te donne
le bloc JSON prêt à coller dans `tracks.json`, et te rappelle de copier le fichier
dans `audio/`. Le bouton **« ⭳ Exporter tracks.json »** en haut télécharge une version
à jour du fichier complet (base + tes modifications + tes ajouts locaux) — le moyen le
plus simple de resynchroniser : tu remplaces `data/tracks.json` par ce téléchargement,
tu copies les fichiers audio correspondants dans `audio/`, et tu commits.

Toute édition (titre, tags, notes, points de boucle...) est aussi sauvegardée en direct
dans le `localStorage` du navigateur, donc rien n'est perdu si tu rafraîchis la page —
mais ça reste local à ce navigateur/cet ordinateur tant que tu n'as pas exporté et
committé `tracks.json`.

## Interface : liste et lecteur

L'appli a deux vues, à toute taille d'écran (téléphone comme ordinateur) : une vue
**liste** (filtres en haut — Groupe, Rythme, Tonalité, Origine, En commun avec, Niveau,
et la case « Titres à déf. » pour n'afficher que les titres provisoires — puis la liste
des morceaux, avec un résumé type/tonalité/groupe/niveau) et une vue **lecteur**, qui
s'ouvre en tapant sur un morceau. Le bouton « ← Retour » en haut du lecteur revient à
la liste. Les boutons sont volontairement grands pour rester faciles à toucher au doigt
sur le terrain.

Dans la vue lecteur, taper/cliquer sur la forme d'onde lance la lecture depuis cet
endroit — pas besoin d'ouvrir quoi que ce soit pour ça. Le bouton **« ⭳ Télécharger »**
à côté de Lecture/Boucle récupère le fichier audio du morceau affiché pour l'écouter
hors connexion (pratique pour bosser sur le terrain sans réseau) — sur iPhone/Safari,
le fichier s'ouvre d'abord dans le lecteur audio du navigateur ; utilise ensuite le
bouton de partage pour l'enregistrer dans l'appli Fichiers si tu veux le garder en
dehors du navigateur.

Juste en dessous des boutons de lecture, un encart affiche en lecture seule toutes
les infos du morceau (rythme, origine, tonalité, groupe, niveau, source, joué avec,
notes) — pratique pour un coup d'œil rapide sans rien pouvoir modifier par erreur.
Pour changer une de ces valeurs, il faut ouvrir le panneau « ✎ Edit » ; l'encart se
met à jour tout seul dès que tu modifies un champ dedans.

Le lien **« ✎ Edit »** déplie un panneau, toujours en dessous de la forme d'onde (sur
petit comme sur grand écran), avec tous les réglages détaillés du morceau : type,
tonalité, groupe, notes, et les points de boucle. Sur grand écran, dès que ce panneau
est ouvert, la forme d'onde s'agrandit (quasi pleine largeur, plus haute) pour rendre
les clics de précision plus faciles quand tu définis les points de boucle. C'est
uniquement panneau ouvert que glisser sur la forme d'onde redéfinit la boucle (voir
plus bas) — repliée, la forme d'onde ne sert qu'à naviguer dans le morceau.

La forme d'onde s'affiche en vert vif, et la zone de boucle est surlignée par une
teinte verte transparente par-dessus.

Niveaux de maîtrise disponibles (`niveau`) : à apprendre, **à bosser**, en cours,
maîtrisé.

## Le lecteur et la boucle

Le morceau est décodé avec la Web Audio API, ce qui permet une boucle **sans coupure**
(contrairement à la balise `<audio loop>`, qui laisse souvent un petit silence audible
à chaque tour avec des mp3). Pour définir la portion à boucler, ouvre d'abord le panneau
« ✎ Edit », puis :

- fais glisser sur la forme d'onde pour sélectionner une zone (elle s'applique
  immédiatement), ou
- lance la lecture, clique sur « Définir ici » à l'endroit voulu pour le début et la
  fin, ou
- tape les secondes directement dans les champs.

Décoche « Boucle » pour lire le morceau en entier sans boucler, ou clique
« Boucle = morceau entier » pour effacer la sélection.

## Héberger le site (gratuit)

Le site est 100% statique : n'importe quel hébergeur de sites statiques gratuit
convient. Deux options simples :

- **GitHub Pages** — pousse ce dossier dans un dépôt GitHub, puis active Pages dans
  Settings → Pages (branche `main`, dossier `/root`). Ton site est en ligne à
  `https://ton-compte.github.io/nom-du-depot/`. Limite confortable pour un répertoire
  perso : environ 1 Go par dépôt, 100 Mo par fichier.
- **Netlify** (ou Cloudflare Pages) — si tu préfères éviter git : glisse-dépose le
  dossier sur netlify.com/drop. Ton site est en ligne à `https://un-nom.netlify.app/`.

## Nom de domaine gratuit (optionnel)

Le sous-domaine offert par l'hébergeur (`.github.io`, `.netlify.app`, `.pages.dev`)
est gratuit et suffit largement pour un usage personnel — pas de démarche
supplémentaire. Freenom (qui distribuait autrefois des `.tk`/`.ml`/`.ga` gratuits) a
cessé les enregistrements en 2023 (procès de Meta) et n'est plus fiable.

Si tu veux quand même un vrai nom de domaine gratuit, distinct du sous-domaine par
défaut :

- **eu.org** — un sous-domaine du type `toncompte.eu.org`, associatif, gratuit,
  actif depuis longtemps.
- **is-a.dev** — pensé pour les devs (`toncompte.is-a.dev`), demande une petite pull
  request sur leur dépôt GitHub.

Dans les deux cas, une fois le sous-domaine obtenu, tu le pointes vers GitHub
Pages/Netlify via un enregistrement DNS CNAME — la doc de l'hébergeur choisi explique
la marche à suivre.

## Idées d'évolution possibles

- Export/import complet (avec l'audio) en un seul fichier `.zip`, pour transférer sa
  bibliothèque locale d'un ordinateur à l'autre.
- Ralenti sans changement de tonalité : testé avec un simple `playbackRate`, abandonné
  car ça déforme trop le son (comme un vinyle ralenti). Faisable proprement avec une
  librairie de time-stretch (ex. SoundTouchJS), mais plus lourd à intégrer.
- Vue "playlist de bal" : sélectionner plusieurs morceaux et les enchaîner.
