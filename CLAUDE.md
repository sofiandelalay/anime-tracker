# Anime Tracker — cahier des charges

PWA personnelle (un seul utilisateur, en français) de suivi d'animes pour iPhone 17 Pro (402 pt de large),
installée via Safari sur l'écran d'accueil. Développement sous Windows, pas de Mac.

## Stack
- Vite + React + TypeScript strict. Pas de framework UI ; CSS moderne + design tokens (`src/ui/tokens.css`, **toutes** les couleurs y sont).
- vite-plugin-pwa (manifest, SW, hors ligne, toast « Nouvelle version — Recharger »).
- Dexie (IndexedDB). Aucun backend, aucun compte.
- API GraphQL AniList (https://graphql.anilist.co), sans auth.
- Vitest pour la logique métier.
- Hébergé sur GitHub Pages (https://sofiandelalay.github.io/anime-tracker/) : chaque push sur `main` passe les tests, construit avec `VITE_BASE=/anime-tracker/` et déploie (`.github/workflows/deploy.yml`). L'appli propose ensuite « Recharger ». Nom de l'appli : « Anime ».

## Modules
- `src/api` : client AniList unique (`client.ts`), file ≤ 25 req/min, 429 + Retry-After, regroupement `id_in` par pages de 50 ; titres d'épisodes par Jikan (`episodes.ts`, file séparée : 3 req/s et 60 req/min, 429 + Retry-After) ; cache IndexedDB (fiche 12 h, recherche 1 h, page de saison 6 h, recommandations 24 h par anime, titres : sans expiration si la saison est finie de diffusion, sinon 12 h ; purge > 30 j), exclusion `isAdult`, titre = anglais sinon romaji.
- `src/db` : schéma Dexie, export / import JSON (entrées, journal, animes masqués).
- `src/domain` : `episodes.ts` (ensemble d'épisodes vus, logique de coche, pur), `progress.ts` (statut déduit des cases), `tracking.ts` (entrées à créer à l'ajout, pur), `actions.ts` (écritures), franchises, règles de Ma liste, rafraîchissement, saisons, stats. `recommend.ts` = algorithme de Pour toi, **pur** (aucun réseau) ; `suggestions.ts` = orchestration réseau + cache.
- `src/ui` : composants, écrans, onglets. `AnimeFlow` = feuille modale, page anime, « Tu en es où ? » et fin de saison, communs à tous les onglets. `AnimeParts` = accordéon des saisons et cases, partagés par la feuille et la page.

## Robustesse
- Réseau coupé ou erreur 5xx : deux nouveaux essais silencieux (1 s, 3 s), délai maximal de 15 s par requête. 429 : Retry-After, sinon 20 s (en navigateur, cet en-tête n'est lisible que si le serveur l'expose).
- Une panne qui dure : message calme sans détail technique (« AniList ne répond pas pour le moment. On réessaie tout seul. »), nouvel essai toutes les 20 s et au retour du réseau (`useAutoRetry`). Un `ErrorBoundary` à la racine : jamais d'écran blanc.
- Hors ligne : Ma liste, Stats et les cases fonctionnent depuis IndexedDB ; jaquettes depuis le SW.

## Budget de stockage
- Jamais d'images en IndexedDB. Jaquettes via le SW en CacheFirst (300 entrées, 30 jours), vignettes d'épisodes à part (100 entrées). Taille `large`/`medium`, jamais `extraLarge`.
- Fiches réduites aux champs utiles.
- `navigator.storage.persist()` au premier lancement.
- Réglages : espace utilisé, « Vider le cache » (ne touche jamais aux données perso), export / import JSON, date du dernier export.

## Modèle de données
- **Franchise** : saisons liées par SEQUEL/PREQUEL au format TV, TV_SHORT, ONA (films/OVA/spéciaux ignorés). `franchiseId` = fiche la plus ancienne de la chaîne. Calcul par parcours des relations, mis en cache (table `franchises`).
- **Entrée** (une par saison, pour TOUT anime coché, noté ou suivi) : mediaId, franchiseId, status, viewings (visionnages), followed, score? (0,5–5 par 0,5), addedAt, startedAt?, completedAt?, updatedAt. « Suivi » décide seulement si l'anime apparaît dans À suivre ; mes données ne sont jamais effacées par une action courante.
- **Statuts** de saison, déduits des cases : `PLANNING` (À voir), `CURRENT` (En cours), `COMPLETED` (Terminé), `DROPPED` (Abandonné). Archiver = Abandonné. Statut, suivi et archivage se font au niveau de l'anime entier ; la note reste par saison, note globale = moyenne des saisons notées.
- **Visionnage** : numéro (1, 2, 3…), watched (plages d'épisodes cochés, ex. `[[1, 12], [15, 15]]`), startedAt, endedAt (nuls = date inconnue), état : en cours, terminé ou interrompu. Un seul en cours par saison. Les cases, la barre, « +1 épisode » et la confirmation n'agissent que sur lui (sans visionnage en cours, les cases montrent le dernier terminé ; le corriger le rouvre). Rien n'est perdu, sauf par la suppression explicite d'un visionnage.
- **Journal** : `{ mediaId, episode, at, viewing }`, une ligne par coche, décocher la retire. `at` nul = date inconnue (coché en lot) : compté dans les totaux, pas dans « ce mois-ci ».
- **Détail d'un épisode** : résumé, note, date, filler, récap, adresse de la vignette ; table `episodes` du cache, chargé à l'ouverture de l'épisode, sans expiration s'il est sorti depuis plus de 30 jours, sinon 24 h. Une panne de Jikan n'est jamais figée : on redemande à la prochaine ouverture. Images : cache plafonné du SW (`episode-images`, 100 entrées), jamais IndexedDB.
- **Titres d'épisodes** : texte seul, table `titles` du cache, chargés à l'ouverture d'une saison, jamais en masse. Jikan (`title`, sinon `title_romanji`), sinon `streamingEpisodes` d'AniList, sinon « Épisode N ». Ne bloquent jamais l'interface.
- **Fiche en cache** : id, idMal, titres, jaquette, bannière, couleur, format, épisodes, durée, statut de diffusion, saison/année, prochain épisode (n° + date), genres, tags (nom + rang ; rang ≥ 60 et hors spoilers uniquement), studios d'animation, note moyenne, popularité, relations. Le synopsis n'en fait pas partie : chargé à la demande, 1 200 caractères au plus, dans la table `kv`.
- **Masqué** (« Pas pour moi ») : `{ mediaId, at }`, dans mes données et l'export.

## Règles métier « Ma liste »
- Ajouter un anime = toute la franchise : une entrée par saison TV, TV_SHORT, ONA, y compris annoncée. Une seule question, « Tu en es où ? » : « Pas commencé », « Déjà commencé » (saison + épisode ; avant : cochées et Terminées ; choisie : cochée jusque-là et En cours) ou « J'ai tout vu » (compteur facultatif « Combien de fois ? », tous les épisodes sortis cochés en une écriture, autant de visionnages terminés à date inconnue, puis feuille de note facultative, puis toast « Marqué comme vu · Annuler » 5 s). Encore en diffusion : reste dans À suivre, à jour ; sinon Terminés, toujours suivi. Depuis une saison du milieu, c'est l'anime entier, et la question propose cette saison.
- 4 segments : À suivre = anime suivi non terminé ; Terminés = entièrement vus, suivis ou non ; Mis de côté = non suivis avec une progression partielle ou une note ; Archivés = abandonnés. Chaque carte non suivie propose « Suivre ».
- Nouvelle saison annoncée : rattachée automatiquement à la franchise. Anime suivi → revient dans À suivre avec le badge « Nouvelle saison ». Non suivi → badge discret dans Terminés ou Mis de côté. Franchise avec saison Abandonnée : ne revient jamais.
- « +1 épisode » coche le premier épisode non vu. Tous les épisodes cochés d'une saison finie de diffusion → Terminé, proposition de note (facultative). Toast « Annuler » 5 s.
- Cocher K avec des précédents manquants : feuille d'action « Marquer aussi les X épisodes précédents comme vus ? » (Oui, tout marquer / Seulement l'épisode K / Annuler). Aucun manquant : coche directe. Décocher : celui-là seul, sans fenêtre.
- « Ne plus suivre » : retire de À suivre sans archiver ni rien effacer ; les données comptent toujours dans les Stats et le profil. Pas de confirmation, toast Annuler 5 s. Aussi au balayage d'une carte vers la gauche (Archiver, Ne plus suivre).
- Revoir (bouton de l'onglet Épisodes, dès qu'un épisode a été coché ; tout l'anime = toutes ses saisons sorties, ou une saison) : nouveau visionnage aux cases décochées ; le précédent reste terminé, ou passe interrompu s'il ne l'était pas ; un visionnage en cours encore vide sert de départ. L'anime redevient suivi, sort des archives et passe En cours dans À suivre, badge discret « 2e visionnage ». Fin d'un revisionnage (saison finie de diffusion, toutes les cases) : Terminé, sans proposition de note, toast « Vu N fois · Annuler ». Une saison encore en diffusion reste en cours, à jour, comme au premier visionnage. « Arrêter le revisionnage » remplace « Archiver » : le visionnage passe interrompu, la saison retrouve son état d'avant (Terminé si un visionnage terminé existe, sinon le visionnage précédent reprend). Tout est annulable 5 s.
- Vue N fois = visionnages terminés. Ligne discrète dans l'accordéon, seulement si elle apporte une info (« Vue 2 fois », « Vue 2 fois · 3e visionnage en cours ») ; anime entier : « Vu 2 fois » = minimum des saisons sorties. « Historique des visionnages » replié : dates ou « date inconnue », état, progression ; « Ajouter un visionnage passé » (date facultative, tous les épisodes cochés, placé avant un visionnage en cours) ; suppression avec confirmation obligatoire, le seul cas de suppression.
- Cocher ou noter un anime non suivi l'enregistre sans le suivre : toast « Enregistré · Suivre ».
- En diffusion : impossible de dépasser le dernier épisode sorti (`nextAiringEpisode.episode - 1`).
- Au lancement, au plus toutes les 12 h, rafraîchissement par lots des saisons pas finies et de la dernière saison connue de chaque anime enregistré, sauf Abandonné.

## Règles métier « Sorties »
- Saison courante d'après la date (janv-mars WINTER, avr-juin SPRING, juil-sept SUMMER, oct-déc FALL) + saison suivante. TV, TV_SHORT, ONA, par popularité, pages de 50 au défilement, cache 6 h.
- En premier : ce que je suis (suivi et pas Abandonné), prochain épisode d'abord, avec le badge « Ép. 7 dans 2 j 4 h » (« dans 35 min » sous l'heure), actualisé chaque minute. Filtre « Ceux que je suis ».
- Saison suivante : date de début si connue (au moins le mois), sinon rien.

## Règles métier « Pour toi »
- Visionnages d'un anime, pour l'algorithme = le plus grand nombre de visionnages terminés parmi ses saisons ; les interrompus ne comptent pas. Mes notes ne changent jamais : seul leur poids change.
- Anime noté et revu : poids × (1 + 0,25 × (visionnages - 1)), plafonné à 1,75 dès 4 visionnages, sources A et B, seulement si la note de l'anime et celle de la saison sont au moins à ma moyenne.
- Notes implicites, pour l'algorithme seulement, jamais affichées, à l'échelle de l'anime (sa première saison). Terminé sans aucune note (y compris pendant un revisionnage), sources A et B : 1 visionnage = 4 poids 0,5 ; 2 = 4,5 poids 0,75 ; 3 ou plus = 4,5 poids 1. Archivé sans aucune note = 2, poids 0,5, source B seulement. En cours ou mis de côté : ignoré. Une vraie note sur une saison les remplace. Ma moyenne ne compte que mes vraies notes (3 si je n'en ai aucune).
- Aimés = notés ≥ 4 ; moins de 3 : mes 5 mieux notés. Recommandations : RATING_DESC, 10 premières par anime aimé.
- Score A = somme de poids × (ma note - 3) × log(1 + rating). Score B = 0,4 genres + 0,35 tags + 0,25 studios, chaque famille = somme des poids / √nombre, poids = somme de poids de la note × (ma note - ma moyenne), normalisés entre -1 et 1. Découverte : populaires des 3 dernières années dans mes 3 genres préférés.
- Final = 0,55 A + 0,35 B + 0,10 note moyenne AniList (normalisation min-max sur les candidats). Maximum 20.
- Une suggestion = un anime global (sa première saison), jamais une saison 2 ou 3 ; le détail se voit en ouvrant la feuille.
- Exclus : tout anime coché, noté, suivi, archivé ou que je ne suis plus (toute entrée, toute saison de sa franchise), les masqués, isAdult, le non sorti.
- Une ligne d'explication : la raison qui pèse le plus dans le score (« Parce que tu as aimé X » ; « revu » si cet anime a été vu au moins 2 fois ; « vu » pour une note implicite à 1 visionnage, « Du studio Y, que tu notes bien », « Genres que tu aimes : A, B »).
- Recalcul quand une note change, sinon cache 24 h ; bouton « Actualiser ». Moins de 3 animes notés ou terminés : message + populaires de la saison. Recalcul aussi quand un anime est terminé, archivé ou revu une fois de plus. Les notes de tous mes animes comptent, suivis ou non.

## Règles métier « Stats »
- Heures (épisodes vus × durée, tous visionnages compris, « ce mois-ci » depuis le journal, « dont 12 h en revisionnage » si plus de 0) et épisodes regardés sur la même ligne, bloc « Revisionnages » masqué s'il n'y en a pas (visionnages terminés au-delà du premier ; « Le plus revu » : la saison vue le plus de fois, si au moins 2), animes terminés, top 3 genres pondéré par les épisodes vus, studio favori (le plus d'épisodes parmi mes animes notés ≥ 4).

## UX
- 5 onglets en bas (icône + libellé, tous du même style) : Ma liste, Sorties, Rechercher, Pour toi, Stats. Réglages : icône discrète en haut de Stats.
- Ma liste : segmenté « À suivre · Terminés · Mis de côté · Archivés ». Ordre À suivre : En cours (plus récent d'abord), nouvelles saisons, À voir.
- Carte : jaquette, titre de l'anime, « Saison 2 · Ép. 7 / 12 », compte à rebours si en diffusion, barre fine de la saison en cours (repère des épisodes sortis si en diffusion), gros bouton « +1 épisode » (ou « Suivre » si non suivi). Rien d'autre.
- Feuille rapide (Sorties, Pour toi, Rechercher) : anime jamais touché : synopsis replié, genres, studio, « Ajouter à ma liste » et « Voir plus » ; anime enregistré : progression, note, saisons, « Voir plus », Archiver, Ne plus suivre. Dans Ma liste, toucher une carte ouvre directement la page anime.
- Ligne d'épisode : numéro discret, titre (2 lignes max), case ronde. Toucher la ligne ouvre la page de l'épisode ; seule la case coche (44 pt min). Non vu : cercle grisé, check à peine visible. Vu : fond `--color-done`, check blanc, petite animation. Pas encore sorti : atténué, case désactivée, avec « dans 2 j 4 h », la date ou « À venir ». Plus de 100 épisodes : tranches 1-100, 101-200.
- Page anime (vue détaillée unique) : plein écran, retour en haut à gauche et balayage depuis le bord gauche ; jaquette, titre, segmenté « À propos · Épisodes » (Épisodes par défaut si au moins un épisode est coché, décidé à l'ouverture). À propos : synopsis replié au-delà de 5 lignes, genres en pastilles, note de la communauté (averageScore ramené sur 5, masquée si absente), studio, format, saisons, épisodes, diffusion. Épisodes : progression, ma note (globale + par saison), « J'ai tout vu », saisons en accordéon (« Tout marquer comme vu » par saison). Archiver, Ne plus suivre en bas des deux onglets ; « Ajouter à ma liste » / « Suivi » fixé en bas. Cases et note disponibles sur TOUT anime, suivi ou non.
- Page épisode : en-tête 16:9 (vignette, sinon bannière, sinon jaquette floue ; dégradé sombre ; « S01 | E07 » et titre sur 2 lignes), puis date et case ronde (même règle de confirmation, désactivée si pas sorti), note de la communauté et badges Filler / Récap si Jikan les donne, résumé (« Pas encore de résumé pour cet épisode. » sinon). Balayer horizontalement change d'épisode ; « Précédent / Suivant » en bas. En-tête et case s'affichent tout de suite, le reste arrive ensuite.
- Pour toi et Stats : en-tête sur une ligne, titre à gauche, bouton à droite, sur la ligne de base du titre.
- Sorties : grille de 3 colonnes, titre sur 2 lignes au plus. Pour toi : jaquette de 80 pt de large à gauche, hauteur de la carte fixée par son contenu, jaquette de même hauteur ; à droite titre, la phrase d'explication (2 lignes au plus), puis « À voir » et « Pas pour moi » côte à côte (avec Annuler).
- Rechercher : champ en haut avec bouton d'effacement, focus à l'ouverture de l'onglet et en le touchant de nouveau ; la recherche en cours est conservée en changeant d'onglet. Délai 400 ms, 2 caractères min. Champ vide : mes 10 dernières recherches (supprimables une par une ou toutes), rien d'autre. Résultats : une ligne par anime (titre de la première saison, nombre de saisons et d'épisodes au total) et son état en petit (Suivi, Terminé, Mis de côté, Archivé). Toucher une ligne ouvre la feuille rapide ; « Ajouter » pose « Tu en es où ? », absent si l'anime est déjà suivi ou archivé.
- États vides chaleureux, squelettes, hors ligne depuis le cache.
- HIG Apple : -apple-system, cibles ≥ 44 pt, safe-area, standalone, apple-touch-icon, écran de démarrage, champs ≥ 16 px, retours visuels au tap.
- Thème clair/sombre auto, fond neutre doux. `--color-secondary` #E3BB16 (identique dans les deux thèmes) pour toutes les barres et les accents ; jamais en texte sur fond clair : `--color-secondary-text` (#7D6300 en clair, 5,2:1 ; #E3BB16 en sombre) ; sur fond jaune, texte foncé `--color-on-secondary`. `--color-done` : #34C759 / #30D158. Pistes et cases : `--color-track`. Animations courtes, coupées si `prefers-reduced-motion`. Contrastes AA, libellés VoiceOver.

## Ordre de livraison
1. Ma liste + navigation + Réglages ✅
2. Sorties ✅
3. Pour toi ✅
4. Stats ✅

## Décisions
- Icônes PNG générées par `scripts/gen-icons.mjs` (zlib natif, aucune dépendance).
- Numéro de saison = rang dans la franchise triée par date de début.
- Cache API dans une base Dexie séparée (`anime-cache`) : « Vider le cache » la supprime sans toucher `anime-tracker`.
- Focus de la recherche donné de façon synchrone dans le toucher de l'onglet (`flushSync`) : iOS refuse d'ouvrir le clavier autrement. Une recherche récente est enregistrée quand on la valide ou qu'on utilise un résultat, pas à chaque frappe ; stockée dans `meta`, hors de l'export.
- Pile de pages (`PushedPage`) branchée sur l'historique : le bouton retour, le geste natif de Safari et le balayage du bord ferment toujours la page du dessus.
- La note d'épisode vient de la liste Jikan (`/episodes?page=N`), gardée avec les titres ; le détail (`/episodes/{n}`) ne la donne pas toujours.
- Pas de routeur : l'état d'onglet suffit ; les onglets visités restent montés (défilement conservé).
- Jaquette = `coverImage.large` (servie par AniList depuis le dossier `/medium/`), sinon `medium`.
- Franchise : on traverse films/OVA via SEQUEL/PREQUEL (S1 → film → S2) mais seuls TV/TV_SHORT/ONA sont des saisons ; parcours plafonné à 40 fiches. Un film ajouté seul = sa propre franchise.
- Purge (30 j) et « Vider le cache » épargnent les fiches et franchises de ma liste (affichage hors ligne).
- Cocher sur un anime archivé l'enregistre sans le faire revenir (« Reprendre » pour cela) ; toutes les cases d'une saison la passent quand même en Terminé.
- Migration v3 : N épisodes vus → plages 1 à N, tout suivi. Dexie ne peut pas appeler le réseau : les saisons manquantes sont rattachées au lancement (`attachKnownSeasons` depuis le cache, sinon `ensureData`/`computeFranchise`). Export en version 2 ; un export v1 reste importable.
- Rattrapage en lot (les précédents de « Oui, tout marquer », « Tout marquer comme vu », « J'ai tout vu », « Déjà commencé ») : journalisé à date inconnue, sinon des années de visionnage compteraient dans « ce mois-ci ». Migration v4 du journal et exports : l'ancien marqueur `bulk` devient une date inconnue.
- Sources de recommandations implicites plafonnées à 40 terminés (les revus d'abord, puis les plus récents) (`MAX_IMPLICIT_SOURCES`), pour ne pas coûter des dizaines de requêtes par jour après un gros rattrapage ; les autres comptent dans le profil. La note de la feuille après « J'ai tout vu » est posée sur toutes les saisons commencées.
- La note reste unique par saison, indépendante des visionnages. Migration v5 : les cases deviennent le visionnage 1 ; une saison cochée uniquement en lot garde une date inconnue. Export en version 3 ; les exports v1 et v2 restent importables.
- Pas de sélecteur de statut : le statut se déduit des cases ; Archiver / Reprendre / Ne plus suivre sont des actions.
- Rafraîchissement : les franchises non abandonnées, suivies ou non, sont recalculées (seules les saisons pas finies et la dernière connue sont forcées).
- Jikan en panne : 8 s d'attente au plus, puis 10 min sans réessayer ; le repli AniList est gardé 12 h, pas définitivement.
- Archiver = toutes les saisons En cours / À voir de la franchise passent en Abandonné.
- Une carte par franchise : saison En cours la plus récente, sinon première À voir dans l'ordre de la franchise. « Saison N » masqué si la franchise n'a qu'une saison.
- À voir trié par date d'ajout décroissante.
- La saison affichée sur la carte : En cours la plus récente, sinon la première à voir déjà sortie. Saison finie et suivante pas commencée : l'anime reste « en cours », sur la suivante.
- Export : feuille de partage iOS (`navigator.share` avec fichier) sinon téléchargement.
- Le service worker et `storage.persist()` exigent HTTPS : en `vite --host` (HTTP sur le réseau local) l'appli marche mais sans hors ligne ni installation complète ; tester ça sur GitHub Pages.
- API AniList, vérifié sur la vraie API : complexité maximale 500 et 51 par alias de recommandations → lots de 8 alias. Un id disparu fait échouer tout le lot (404) → le lot est coupé en deux. `genre_in` exige TOUS les genres → découverte = un alias `Page` par genre, dans une seule requête.
- Budget de requêtes (`src/test/budget.test.ts`) : avec 100 animes tous notés, un cache vide et tous les candidats de Pour toi étant des saisons 3 (pire cas), lancement + Pour toi + une page de Saisons = 25 requêtes, soit le plafond de la file. `preloadChains` charge les chaînes de franchises par lots avant de les calculer (sinon une requête ou plus par franchise). Changer une note ne coûte qu'une requête par niveau de préquels à remonter : les recommandations sont en cache par anime.
- Anime global : Pour toi et la recherche montrent une ligne par anime, représenté par sa première saison (`resolveRoots` : remontée des PREQUEL, une requête par niveau quel que soit le nombre de fiches, cache des fiches accepté jusqu'à 30 j pour ce parcours car ces liens ne changent presque jamais). Pour toi ne remonte que les 150 candidats les mieux classés. Les saisons d'un même anime fusionnent : pour un anime aimé donné, seule la meilleure compte.
- Détail des saisons calculé à l'ouverture de la feuille (`computeFranchise`), jamais dans les listes. La saison ajoutée est celle affichée dans la feuille ; « Je l'ai déjà commencé » est dans la feuille.
- Recherche : un film, une OVA ou un spécial garde sa propre ligne, sinon on ne pourrait plus l'ajouter. Pour toi les ramène à l'anime dont ils sont la suite. Saisons reste par saison : c'est le but de cet onglet.
- Pour toi : 60 suggestions en cache, exclusions réappliquées à l'affichage ; ajouter ou masquer fait remonter la suivante sans recalcul. Recalcul uniquement si l'onglet est affiché, un seul essai automatique par situation.
- Saison en cours : mes animes encore en diffusion depuis une saison passée y figurent aussi (sinon leur compte à rebours n'apparaîtrait nulle part dans l'onglet).
- Compte à rebours écoulé : `refreshAired` recharge ces fiches (par lots, au plus toutes les 15 min) pour pouvoir cocher l'épisode sorti sans attendre le rafraîchissement de 12 h. En attendant, le badge affiche « Ép. 7 sorti ».
- Durée d'épisode inconnue (fréquent sur les séries en cours) : comptée 24 min dans les stats.
- Une seule minuterie partagée pour tous les comptes à rebours (`hooks/clock.ts`), recalée au retour dans l'appli car iOS suspend les minuteries.
- « Bien noté » (studio favori) = même seuil que « aimé » : 4 étoiles.
- Genres AniList traduits à l'affichage (`genreLabel`) ; titres et synopsis restent tels que fournis par AniList (anglais le plus souvent).
- Export : `hidden` optionnel, version 1 inchangée ; un ancien export importé ne touche pas aux masqués.
- Migration v2 des bases : table `kv` (cache), table `hidden` (mes données), fiches en cache marquées périmées pour purger les tags spoilers.

## Commandes
- `npm run dev` (vite --host), `npm test`, `npm run build`, `npm run icons` (régénère icônes/écrans de démarrage).
- Build GitHub Pages : `VITE_BASE=/anime-tracker/ npm run build`.
