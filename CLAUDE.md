# Anime Tracker — cahier des charges

PWA personnelle (un seul utilisateur, en français) de suivi d'animes pour iPhone 17 Pro (402 pt de large),
installée via Safari sur l'écran d'accueil. Développement sous Windows, pas de Mac.

## Stack
- Vite + React + TypeScript strict. Pas de framework UI ; CSS moderne + design tokens (`src/ui/tokens.css`, **toutes** les couleurs y sont).
- vite-plugin-pwa (manifest, SW, hors ligne, toast « Nouvelle version — Recharger »).
- Dexie (IndexedDB). Aucun backend, aucun compte.
- API GraphQL AniList (https://graphql.anilist.co), sans auth.
- Vitest pour la logique métier.
- Hébergement futur GitHub Pages : base Vite configurable via `VITE_BASE` (ex. `VITE_BASE=/anime-tracker/ npm run build`).

## Modules
- `src/api` : client AniList unique (file ≤ 25 req/min, 429 + Retry-After, regroupement `id_in` par pages de 50), cache IndexedDB (fiche 12 h, recherche 1 h, purge > 30 j), exclusion `isAdult`, titre = anglais sinon romaji.
- `src/db` : schéma Dexie, export / import JSON.
- `src/domain` : franchises, progression, règles de Ma liste, rafraîchissement.
- `src/ui` : composants, écrans, onglets.

## Budget de stockage
- Jamais d'images en IndexedDB. Jaquettes via le SW en CacheFirst (300 entrées, 30 jours). Taille `large`/`medium`, jamais `extraLarge`.
- Fiches réduites aux champs utiles.
- `navigator.storage.persist()` au premier lancement.
- Réglages : espace utilisé, « Vider le cache » (ne touche jamais aux données perso), export / import JSON, date du dernier export.

## Modèle de données
- **Franchise** : saisons liées par SEQUEL/PREQUEL au format TV, TV_SHORT, ONA (films/OVA/spéciaux ignorés). `franchiseId` = fiche la plus ancienne de la chaîne. Calcul par parcours des relations, mis en cache (table `franchises`).
- **Entrée de suivi** (une par saison) : mediaId, franchiseId, status, progress, score? (0,5–5 par 0,5), addedAt, startedAt?, completedAt?, updatedAt.
- **Statuts** : `PLANNING` (À voir), `CURRENT` (En cours), `COMPLETED` (Terminé), `DROPPED` (Abandonné). Archiver = Abandonné.
- **Journal** : `{ mediaId, episode, at }`.
- **Fiche en cache** : id, titres, jaquette, couleur, format, épisodes, durée, statut de diffusion, saison/année, prochain épisode (n° + date), genres, tags (nom + rang), studios d'animation, note moyenne, popularité, relations.

## Règles métier « Ma liste »
- À suivre = franchises avec une saison En cours ou À voir.
- Franchise entièrement Terminée + SEQUEL annoncé (NOT_YET_RELEASED/RELEASING) absent de la liste → revient avec badge « Nouvelle saison » + bouton Ajouter. Franchise avec saison Abandonnée : ne revient jamais.
- Dernier épisode d'une saison finie de diffusion atteint → Terminé, proposition de note (facultative), proposition de saison suivante. Toast « Annuler » 5 s.
- En diffusion : impossible de dépasser le dernier épisode sorti (`nextAiringEpisode.episode - 1`).
- Au lancement, au plus toutes les 12 h, rafraîchissement par lots des fiches suivies non terminées de diffusion + franchises terminées.

## UX
- 4 onglets en bas (icône + libellé) : Ma liste, Saisons, Pour toi, Stats. Réglages : icône discrète en haut de Stats. Saisons / Pour toi / Stats = « Bientôt » pour l'instant.
- Ma liste : segmenté « À suivre · Terminés · Archivés » + bouton recherche. Ordre À suivre : En cours (plus récent d'abord), nouvelles saisons, À voir.
- Carte : jaquette, titre, « Saison 2 · Ép. 7 / 12 », barre fine (repère des épisodes sortis si en diffusion), gros bouton « +1 épisode ». Rien d'autre.
- Feuille modale : - / +, statut, étoiles, saisons de la franchise avec leur barre, Archiver (avec Annuler).
- Recherche : délai 400 ms, 2 caractères min ; ajout en À voir, option « Je l'ai déjà commencé ».
- États vides chaleureux, squelettes, hors ligne depuis le cache.
- HIG Apple : -apple-system, cibles ≥ 44 pt, safe-area, standalone, apple-touch-icon, écran de démarrage, champs ≥ 16 px, retours visuels au tap.
- Thème clair/sombre auto, palette neutre douce. Animations courtes, coupées si `prefers-reduced-motion`. Contrastes AA, libellés VoiceOver.

## Ordre de livraison
1. Ma liste + navigation + Réglages (ce prompt) ✅
2. Saisons
3. Pour toi
4. Stats

## Décisions
- Icônes PNG générées par `scripts/gen-icons.mjs` (zlib natif, aucune dépendance).
- Numéro de saison = rang dans la franchise triée par date de début.
- Cache API dans une base Dexie séparée (`anime-cache`) : « Vider le cache » la supprime sans toucher `anime-tracker`.
- Pas de routeur : l'état d'onglet suffit ; les onglets visités restent montés (défilement conservé).
- Jaquette = `coverImage.large` (servie par AniList depuis le dossier `/medium/`), sinon `medium`.
- Franchise : on traverse films/OVA via SEQUEL/PREQUEL (S1 → film → S2) mais seuls TV/TV_SHORT/ONA sont des saisons ; parcours plafonné à 40 fiches. Un film ajouté seul = sa propre franchise.
- Purge (30 j) et « Vider le cache » épargnent les fiches et franchises de ma liste (affichage hors ligne).
- Changer d'épisode sur une saison À voir ou Abandonnée la passe En cours.
- Archiver = toutes les saisons En cours / À voir de la franchise passent en Abandonné.
- Une carte par franchise : saison En cours la plus récente, sinon première À voir dans l'ordre de la franchise. « Saison N » masqué si la franchise n'a qu'une saison.
- À voir trié par date d'ajout décroissante.
- Export : feuille de partage iOS (`navigator.share` avec fichier) sinon téléchargement.
- Le service worker et `storage.persist()` exigent HTTPS : en `vite --host` (HTTP sur le réseau local) l'appli marche mais sans hors ligne ni installation complète ; tester ça sur GitHub Pages.

## Commandes
- `npm run dev` (vite --host), `npm test`, `npm run build`, `npm run icons` (régénère icônes/écrans de démarrage).
- Build GitHub Pages : `VITE_BASE=/anime-tracker/ npm run build`.
