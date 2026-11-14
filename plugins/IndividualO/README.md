Version 0.8.5
- Amélioration des traductions anglaises de l’interface.

Version 0.8.4
- Renforce la gestion du compteur Individual O sur les fiches performeurs : invalidation des rendus asynchrones obsolètes et suppression de toutes les insertions en double.
- Aucun changement aux données, aux compteurs natifs Stash ou aux autres fonctionnalités.

Version 0.8.1
- Les trois options suivantes sont activées par défaut lors de la première installation : proposition de création de marqueur, synchronisation du O classique des images et synchronisation du O classique des scènes.
- Les choix déjà enregistrés par l’utilisateur (y compris les options désactivées) sont conservés lors des mises à jour.

Version 0.8.0
- Suppression du paramètre redondant « Titre des marqueurs à afficher » : le titre de recherche des marqueurs existants est désormais automatiquement identique au « Titre du marqueur créé automatiquement ».
- Il ne reste que deux paramètres à renseigner : le titre du marqueur et son étiquette principale.
- Les données existantes, marqueurs et associations ne sont pas modifiés.

Version 0.7.115
- Remplace les confirmations de suppression et le choix de création de marqueur Splooge par des fenêtres modales intégrées au thème Stash.
- Le choix de marqueur propose explicitement : créer le marqueur et l’O, enregistrer sans marqueur, ou annuler.
- Les opérations et la logique de stockage restent inchangées.

Version 0.7.98
- Actualisation en direct du compteur O natif sur les cartes des performeurs après la création automatique d’un O classique.

Version 0.7.95

- Après la création automatique de l’O classique, met à jour le cache Apollo de la scène (o_counter et o_history) pour actualiser immédiatement le compteur natif et son historique, sans recharger la page.
- Compatible avec l’architecture de Stash v0.31.1 : utilise le client Apollo fourni par le contexte React de l’onglet Individual O.
- La logique de création automatique de l’O classique et les autres fonctionnalités restent basées sur la version 0.7.90.

Version 0.7.90

- Lors de l’enregistrement d’un O individuel sur une scène avec « Maintenant (date et heure actuelles) », crée également un O classique natif Stash.
- L’événement natif reçoit exactement le même timestamp que l’entrée Individual O.
- La réutilisation d’un O classique existant ou toute date personnalisée ne déclenche pas de création supplémentaire.
- Si la création native échoue après l’enregistrement individuel, le plugin signale explicitement l’échec partiel.

Version 0.7.89\n\n- Historique des images : affichage intégral des images sans recadrage, en conservant leur ratio d’origine. Hauteur maximale d’affichage : 520 px.\n\nVersion 0.7.88

Optimisation du tri des performers : les O des images sont comptabilisés à partir de l’index local des images, sans parcourir toute la bibliothèque.

Version 0.7.86
- Index local des images avec O individuels : l’onglet Images ne parcourt plus toute la bibliothèque.
- L’index est alimenté à l’ouverture d’une image annotée et lors de l’enregistrement/suppression d’un O.

VERSION 0.7.85 — HISTORIQUES SCÈNES / IMAGES SÉPARÉS
- Deux onglets distincts dans l’historique global : Scènes et Images.
- L’onglet Scènes conserve la collecte et le traitement de la 0.7.84 sans requête d’images.
- L’onglet Images lance une recherche dédiée, limitée aux images, uniquement à son ouverture.
- Filtres performer, titre, année, mois et dates disponibles dans chaque onglet.
- Modification et suppression des O d’images depuis l’onglet Images.

Version 0.7.84

Réintégration isolée des O d’images dans les compteurs et l’historique des fiches performers. Les recherches d’images restent exclues de l’historique global et du tri des markers.


Version du plugin : 0.7.84

Correctif 0.7.84 : les O des images sont de nouveau inclus dans le compteur et l’historique des fiches performers, ainsi que dans leur tri. Ces requêtes sont isolées : elles ne sont pas utilisées par l’historique global ni par le tri des markers. En cas d’erreur GraphQL sur les images, les compteurs basés sur les scènes continuent de fonctionner.

Correctif 0.7.82 : les chargements simultanés de l’historique global partagent désormais la même promesse. Les recherches de marqueurs attendent la collecte complète au lieu de recevoir une liste vide lorsqu’un autre écran charge déjà l’historique.

Version du plugin : 0.7.76

Version du plugin : 0.7.72
Version 0.7.10

WHAT IT DOES
- Adds an "Enregistrer un O individuel" action inside the left scene-details panel, immediately below the performer cards (not floating over the video).
- Lets you assign one recorded O to one or several performers from that scene.
- Stores date, scene association, and performer IDs in the scene custom field individual_o_history_v1.
- Shows and allows deleting records for the current scene.
- Adds a separate "O individuels" counter to performer detail pages.
- Adds the individual O count beside the native O counter on performer wall cards.
- The wall-card count is clickable and opens the individual history.
- Clicking the performer counter opens the individual history with dates and links to the scenes.
- The native Stash O counter remains separate from individual attribution counts. In the “Maintenant” mode, the plugin also creates a native classic O and updates its scene cache.

INSTALLATION / UPDATE
1. Keep your Stash backup.
2. Close Stash only if you prefer; it is not required for replacing plugin files.
3. Replace the existing IndividualO plugin folder contents with these files.
4. In Stash, open Settings > Plugins and click Reload Plugins.
5. Open a performer page to see the separate counter; open a scene page to record O entries.

DATA STORAGE
The history is stored per scene in Stash's own database through sceneUpdate(custom_fields.partial).
The performer total is calculated by reading all scenes associated with that performer and summing only entries that include their performer ID. Wall-card totals reuse a short-lived in-memory cache to limit repeated GraphQL requests.

NOTES
- Native Stash O counters remain distinct from Individual O counts; the automatic “Maintenant” mode creates a corresponding native O.
- The profile counter requires GraphQL scene filtering and scene custom_fields support.
- The plugin has been syntax-checked but cannot be tested against your live Stash instance from here.


Version 0.3.1: restores the performer profile counter to the native quality-group row; uses a distinct individual O pill on performer cards, positioned immediately after the native O counter when present. Creates a card count row when Stash omits it because all native counters are zero.


Version 0.4.1: moves the scene action from the bottom-right floating position into the left scene-details panel, directly after the performer-card row. The existing individual O history and counters are unchanged.

Version 0.4.1: removes the small “i” marker from all individual O button and counter symbols; the symbol is now simply “O”.


Version 0.5.0: the scene history now lets you edit the local date and time of each individual O entry. The edit preserves the entry ID, scene, and assigned performers; the updated ISO timestamp is saved in the scene custom field and performer-card caches are invalidated.


VERSION 0.6.0 — POSITION DANS LA VIDÉO
- La position du lecteur est capturée au moment où la fenêtre de gestion s'ouvre (mode A).
- Chaque nouvel O enregistre cette position en secondes, indépendamment de la date/heure d'enregistrement.
- L'historique affiche un bouton de timestamp permettant de repositionner le lecteur sur cette scène.
- La modification d'une entrée permet aussi de corriger le timestamp (MM:SS ou HH:MM:SS).
- Les anciennes entrées sans timestamp restent compatibles et continuent de s'afficher normalement.


VERSION 0.7.1 — ASSOCIATION AU MARQUEUR SPLOOGE
- Lors de l'enregistrement d'un O individuel, le plugin recherche dans les marqueurs de la scène un marqueur dont le titre est exactement « Splooge » (sans tenir compte de la casse ni des espaces en début/fin).
- L'association est faite si le marqueur se trouve à 2 secondes ou moins du timestamp capturé à l'ouverture de la fenêtre. Si plusieurs marqueurs correspondent, le plus proche est retenu.
- L'identifiant du marqueur, son titre et sa position sont conservés dans l'entrée Individual O. Le marqueur Stash existant n'est ni modifié ni créé.
- L'historique affiche un badge « Marqueur Splooge » cliquable pour revenir à la position exacte du marqueur.
- Si aucun marqueur correspondant n'existe, l'O est tout de même enregistré et le plugin l'indique clairement.
- Si le timestamp d'un O est modifié, l'association est recalculée. Les anciennes entrées restent compatibles.


Version 0.7.1
- Le bouton de timestamp utilise désormais l'API Video.js de Stash pour synchroniser correctement la timeline et les marqueurs.
- Le lien textuel « Marqueur Splooge » a été retiré de l'historique. L'association reste stockée en interne.
- Un badge O avec le nombre d'attributions individuelles apparaît à côté du marqueur Splooge dans le panneau des marqueurs de la scène.


VERSION 0.7.2 — COMPTEUR SUR LA TIMELINE
- Le compteur O individuel reste affiché à côté du titre du marqueur Splooge dans le panneau latéral.
- Un second compteur O est maintenant affiché directement au-dessus du repère correspondant dans la barre de progression Video.js.
- Le repère est identifié par sa position réelle sur la timeline, et non par son ordre dans le DOM.
- Le badge ne capte aucun clic : le comportement natif du marqueur et du lecteur reste inchangé.
- Le compteur est masqué lorsqu'aucune attribution individuelle n'est associée au marqueur.


VERSION 0.7.3 — COMPTEUR SUR L'APERÇU VIDÉO DU MARQUEUR
- Retire complètement le compteur de la barre de progression Video.js.
- Conserve le compteur à côté du titre Splooge dans le panneau latéral.
- Affiche le compteur en surimpression en bas à droite de l'aperçu vidéo/image du marqueur Splooge correspondant.
- Le média est identifié par l'URL Stash /scene/{sceneId}/scene_marker/{markerId}/stream (ou preview/screenshot), puis vérifié contre le titre du marqueur et les attributions Individual O.
- Le badge ne capte pas les clics et ne modifie pas le lecteur ni le marqueur natif.


VERSION 0.7.10
- Fixes global marker page detection for Stash route /scenes/markers.
- Based on the stable 0.7.4 plugin files; no other behavior changed.


VERSION 0.7.11
- Adds marker counter scanning on tag marker pages (/tags/{id}/markers).
- Retains the global marker page support from 0.7.10.
- Based on 0.7.10; no other plugin behavior changed.


VERSION 0.7.12
- Adds a selector to reuse a scene's native Stash O-history date/time for an individual O.
- The same native O event can be selected for multiple individual performer attributions.
- If no native O event is selected, the current date/time remains the default.
- The captured video timestamp and Splooge marker association behavior are unchanged.


VERSION 0.7.14
- Adds scene Individual O history directly below Stash's native .o-history sidebar block.
- Uses the exact .o-history DOM structure observed in Stash v0.31.1.
- Shows date/time, assigned performers, and clickable video timestamps when available.
- Refreshes after adding, editing, or deleting an individual O.
- Based on stable 0.7.12; native O history remains untouched.


VERSION 0.7.15
- Moves the Individual O history above Stash's reading history (.play-history).
- Keeps the native O history and all 0.7.14 behavior unchanged.


VERSION 0.7.16 — HISTORIQUE GLOBAL
- Ajoute une entrée « Historique O individuel » dans la navigation Stash.
- Ouvre une vue dédiée en plein écran, sans remplacer ni manipuler les composants React de Stash.
- Parcourt la bibliothèque par pages GraphQL de 100 scènes et rassemble les entrées enregistrées dans le champ custom individuel.
- Filtres : performeur, titre de scène, année, mois et intervalle de dates ; tri chronologique ascendant ou descendant.
- Affiche le total filtré, le timestamp vidéo et le marqueur Splooge associé lorsqu'il existe.
- Permet de modifier la date/heure et le timestamp, ou de supprimer une entrée. Les données restent enregistrées dans le custom field de la scène d'origine.
- Les fonctions existantes de la version 0.7.15 sont conservées.


VERSION 0.7.17 — INTÉGRATION NATIVE STASH
- Remplace la fenêtre plein écran par une route React enregistrée via PluginApi.register.route.
- La page est rendue dans le shell natif Stash (navigation, thème et mise en page habituels).
- Les résultats affichent la vignette du marqueur associé via /scene/{sceneId}/scene_marker/{markerId}/stream.
- Les filtres, le tri, l'actualisation et les actions de modification/suppression sont conservés.
- L'entrée de navigation pointe vers /plugin/individual-o/history.


VERSION 0.7.18 — CORRECTION DE NAVIGATION
- Le lien de navigation intercepte le clic et effectue une navigation côté client via l'historique du navigateur.
- Évite le rechargement HTTP direct de /plugin/individual-o/history, qui n'est pas servi comme une page autonome par Stash.
- Pour ouvrir la page, utiliser le lien depuis la navigation Stash ; un rechargement direct de l'URL peut rester non pris en charge par le serveur.


VERSION 0.7.19 — VIGNETTES DES MARQUEURS
- Corrige la source de la vignette : utilise l'endpoint statique /screenshot du marqueur associé à l'entrée O.
- La version précédente utilisait /stream, qui renvoie un flux vidéo et ne peut pas être affiché dans une balise image.
- Si aucune capture du marqueur n'est disponible, affiche un emplacement explicite « Miniature indisponible ».
- La vignette est liée au marker_id enregistré avec l'O individuel, pas à la miniature générale de la scène.


VERSION 0.7.20 — VIGNETTES DANS LES HISTORIQUES LOCAUX
- Ajoute la vignette du marqueur lié à chaque O dans l'historique de la barre latérale du visualiseur de scène.
- Ajoute la même vignette dans la liste de l'historique de la fenêtre « Gestion des O ».
- Réutilise l'identifiant marker_id stocké sur l'entrée individuelle et l'endpoint screenshot du marqueur.
- Les entrées sans marqueur associé conservent une présentation sans vignette.


VERSION 0.7.21 — TAILLE DES VIGNETTES ET TYPOGRAPHIE
- Augmente les vignettes des marqueurs dans l'historique de la barre latérale à 124 × 70 px (108 × 61 px sur petits écrans).
- Augmente la typographie des dates à 14 px et des performeurs à 13 px.
- Agrandit légèrement les boutons de timestamp.
- Aligne la taille du texte de cet historique sur celle de l'historique de lecture natif de Stash.


VERSION 0.7.24 — ONGLET O INDIVIDUEL NATIF
- Repart de la base stable 0.7.21.
- Ajoute l'onglet dans ScenePage.Tabs et son panneau dans ScenePage.TabContent via patch.before.
- Les enfants React existants sont conservés et étendus via props.children.
- Le panneau reste dans l'arbre React de Stash; aucun déplacement DOM ni modification de route.
- L'historique de lecture natif reste dans son onglet.


VERSION 0.7.25 — ONGLET SANS COMPTEUR
- Retire le badge numérique à côté du titre « O individuel ».
- Aucun changement au contenu ou au fonctionnement de l'onglet.


VERSION 0.7.26 — MINIATURES PLUS GRANDES
- Agrandit les miniatures des marqueurs dans l'onglet O individuel du visualiseur de scène à 150 × 84 px.
- Format réduit à 120 × 68 px sur les écrans étroits.
- Aucun changement fonctionnel.


VERSION 0.7.27 — MINIATURES AGRANDIES ET CLIQUABLES
- Miniatures de l'onglet O individuel portées à 170 × 96 px (contre 124 × 70 px dans la version précédente).
- Format réduit à 140 × 79 px sur les écrans étroits.
- Clic sur une miniature : repositionnement du lecteur sur le temps du marqueur associé (marker_seconds, avec timestamp en repli).
- Les boutons timestamp existants restent inchangés.


VERSION 0.7.28 — BADGES DE MARQUEURS SANS PRÉFIXE
- Retire le préfixe « O » des badges de comptage des marqueurs.
- Affiche uniquement le chiffre sur les vignettes de marqueurs et dans le panneau des marqueurs.
- Les compteurs de sections et les libellés de profil ne sont pas modifiés.


VERSION 0.7.30 — AUTOCOMPLÉTION DU FILTRE PERFORMEUR
- La recherche de performeur dans l'historique global propose une liste de suggestions Stash après deux caractères.
- Chaque suggestion affiche la miniature et le nom du performeur.
- La sélection filtre les entrées sur l'identifiant exact du performeur.
- Le champ reste utilisable en recherche textuelle libre si aucune suggestion n'est sélectionnée.


VERSION 0.7.32 — AUTOCOMPLÉTION DANS LA PAGE REACT
- Le champ de recherche de performeur de la vraie route Stash utilise maintenant findPerformers.
- Suggestions avec miniatures et noms après deux caractères.
- Sélection exacte par identifiant de performeur.


VERSION 0.7.33 — MENU DE SUGGESTIONS AGRANDI
- Le menu d'autocomplétion peut maintenant dépasser du panneau de filtres sans être coupé.
- Hauteur maximale portée à 60vh (520 px), avec défilement interne si nécessaire.


VERSION 0.7.34 — MENU D’AUTOCOMPLÉTION NON TRONQUÉ
- Le menu des performeurs est positionné par rapport à la fenêtre du navigateur, et non au panneau de filtres.
- Il peut donc dépasser la limite du panneau sans être coupé par les conteneurs Stash.


VERSION 0.7.35 — AUTOCOMPLÉTION DES SCÈNES
- Suggestions de scènes dès deux caractères, avec miniature, titre et identifiant.
- Sélection d'une scène exacte pour filtrer les entrées de son historique.
- Menu positionné dans la fenêtre du navigateur afin d'éviter le rognage par les conteneurs Stash.


VERSION 0.7.36 — FERMETURE DES LISTES DE SUGGESTIONS
- Les listes de performeurs et de scènes se ferment lorsque le champ perd le focus (clic ailleurs).
- La sélection d'une suggestion reste fonctionnelle : le clic sur une suggestion conserve le focus jusqu'à son traitement.
- La touche Échap ferme également les listes.


VERSION 0.7.37 — NAVIGATION DE L’HISTORIQUE GLOBAL
- Le lien du menu utilise une URL d’entrée compatible avec l’ouverture dans un nouvel onglet.
- L’application charge d’abord Stash, puis rejoint la route interne de l’historique individuel.
- Le lien cloné ne récupère plus l’état actif/focus du lien de navigation d’origine.


VERSION 0.7.38 — GRILLE ET PAGINATION DE L’HISTORIQUE GLOBAL
- Résultats en grille responsive, de gauche à droite puis sur les lignes suivantes, comme les cartes de scènes de Stash.
- Pagination avec choix de 10, 20 ou 50 résultats par page, ou un nombre personnalisé (1 à 500).
- Retour automatique à la première page lorsque les filtres ou le tri changent.
- Les vignettes restent celles des marqueurs associés et ouvrent la scène au timecode enregistré.


VERSION 0.7.39 — MÉMORISATION DE LA PAGINATION
- Le choix du nombre de résultats par page (10, 20, 50 ou personnalisé) et la valeur personnalisée sont conservés dans le stockage local du navigateur.
- Le réglage est restauré lorsque la page Historique O individuel est rouverte, y compris après navigation dans Stash ou rechargement.


VERSION 0.7.44 — BARRE DE COMMANDES ALIGNÉE
La pagination supérieure, le curseur de taille des marqueurs et le réglage du nombre de résultats sont regroupés sur une seule ligne. La pagination inférieure est conservée.

VERSION 0.7.43 — DOUBLE NAVIGATION DES PAGES
La navigation des pages est désormais affichée au-dessus et au-dessous des résultats. Les deux commandes pilotent la même page courante.

VERSION 0.7.42 — DIMENSION DES CARTES RÉGLABLE
Ajout d’un curseur pour régler la largeur des cartes de marqueurs de 180 à 500 px. Le réglage est mémorisé localement et restauré lors du retour sur la page.

VERSION 0.7.41 — APERÇUS AUTOMATIQUES DES MARQUEURS
Les aperçus vidéo des marqueurs associés se lancent automatiquement, sans survol. Lecture muette et en boucle ; la miniature fixe reste utilisée si le flux vidéo ne peut pas être lu.

VERSION 0.7.40 — APERÇUS DYNAMIQUES DES MARQUEURS
- Les cartes de l'historique utilisent le flux vidéo d'aperçu du marqueur Stash au survol de la miniature.
- Lecture muette, en boucle et uniquement au survol ; arrêt et retour au début lorsque le pointeur quitte la miniature.
- La capture fixe reste affichée comme poster et sert de solution de repli si l'aperçu vidéo du marqueur n'est pas disponible ou n'a pas été généré.


VERSION 0.7.63 — TRI NATIF « O INDIVIDUELS »
- Ajoute une seule option « O individuels » au menu de tri natif des performeurs.
- Réutilise le bouton natif de direction ASC/DESC et conserve les cartes, filtres et la pagination Stash.
- Calcule le classement global à partir des entrées Individual O stockées dans les custom fields des scènes. Chaque attribution à un performeur compte pour une entrée.
- Applique le classement avant la pagination : les résultats sont cohérents sur l'ensemble de la bibliothèque, et pas uniquement sur la page affichée.
- Le chargement global est paginé par lots de 100 performeurs, avec une concurrence limitée à cinq requêtes. Les résultats sont mis en cache en mémoire pendant 60 secondes et invalidés lors de l'enregistrement d'un historique Individual O.
- Les autres critères de tri natifs ne sont pas modifiés.


VERSION 0.7.76 — O INDIVIDUELS SUR LES IMAGES

- Ajout d’une commande O individuel sur les pages d’images, avec une fenêtre de gestion reprenant l’interface des scènes.
- Historique propre à chaque image, stocké dans son champ personnalisé individual_o_history_v1.
- Les O d’images sont agrégés avec ceux des scènes dans le compteur des performeurs et dans le tri « O individuels ».
- Les historiques des performeurs et l’historique global incluent désormais les images et leurs miniatures.
- Modification et suppression des entrées d’image depuis la fenêtre de gestion et l’historique global.
- Les données et associations des scènes restent stockées séparément ; les marqueurs Splooge ne concernent pas les images.

Version 0.7.107: reduces the weight of individual O counter numerals to match the lighter typography of Stash native O counters.
