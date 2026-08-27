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
plus de reel/jig/slip jig/hornpipe/air), une catégorie/origine (`categorie` : irish,
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

## Le lecteur et la boucle

Le morceau est décodé avec la Web Audio API, ce qui permet une boucle **sans coupure**
(contrairement à la balise `<audio loop>`, qui laisse souvent un petit silence audible
à chaque tour avec des mp3). Pour définir la portion à boucler :

- fais glisser la souris sur la forme d'onde pour sélectionner une zone (elle
  s'applique immédiatement), ou
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
- Réglage de la vitesse de lecture (`playbackRate`) pour travailler un morceau
  ralenti.
- Vue "playlist de bal" : sélectionner plusieurs morceaux et les enchaîner.
