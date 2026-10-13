# Dyson

Cette intégration relie Gladys à vos **purificateurs, ventilateurs et
chauffages Dyson** connectés (gammes Pure Cool, Purifier Cool, Hot+Cool,
Humidify+Cool, Big+Quiet et les anciens modèles « Link »). Vous pouvez les
allumer, régler la vitesse, l'oscillation, le mode nuit, le chauffage, et
suivre la qualité de l'air qu'ils mesurent.

## Ce dont vous avez besoin

- Gladys **5.2** ou plus.
- Un compte **MyDyson** (l'application mobile Dyson), avec vos appareils déjà
  ajoutés et connectés au Wi-Fi.
- L'adresse e-mail et le mot de passe de ce compte.
- Accès à la boîte e-mail du compte : Dyson envoie un **code à usage unique**
  à chaque connexion.

## Local et cloud

L'intégration sait parler à un appareil de deux façons :

- **Local** : directement sur votre réseau (MQTT, port 1883). C'est rapide et
  cela marche même sans Internet. Il faut donner l'adresse de l'appareil
  dans la configuration (voir **Réglages** plus bas).
- **Cloud Dyson** : par les serveurs de Dyson, depuis n'importe où. Il faut
  Internet et un compte connecté.

Le compte Dyson est toujours nécessaire une première fois : c'est lui qui
donne la liste des appareils et le mot de passe local de chacun.

Dans l'écran de configuration, l'interrupteur **Préférer la connexion
locale** (activé par défaut) choisit le chemin essayé en premier. L'autre sert
de secours. Chaque appareil affiche un **badge** qui dit le chemin utilisé :
local, cloud ou injoignable. Un **point orange** sur le badge veut dire « ça
marche, mais par le chemin de secours » : survolez-le pour en voir la raison.

## Mise en route

1. Dans Gladys, ouvrez **Intégrations → Dyson → Configuration**.
2. Renseignez :
   - **E-mail MyDyson** : l'e-mail de votre compte ;
   - **Mot de passe MyDyson** ;
   - **Pays du compte** : le code à deux lettres du pays choisi à la création
     du compte (`FR`, `BE`, `CH`, `GB`, `US`…).
3. Cliquez sur **Enregistrer**.
4. Cliquez sur **Recevoir un code**. Dyson vous envoie un e-mail avec un code
   à 6 chiffres.
5. Dans **Valider le code**, saisissez ce code et validez. Le message indique
   combien d'appareils ont été trouvés.
6. Ouvrez l'onglet **Découverte** et ajoutez vos appareils.
7. Pour la connexion locale, saisissez l'adresse de chaque appareil dans
   **Adresses des appareils** (voir **Réglages**), puis enregistrez.

La connexion est gardée : vous n'aurez pas à refaire le code au redémarrage.
Si Dyson met fin à la session (changement de mot de passe, par exemple), l'état
de la connexion vous demande un nouveau code.

## Ce que vous obtenez

Selon le modèle :

| Fonction                                | Modèles                                     |
| --------------------------------------- | ------------------------------------------- |
| Marche / arrêt                          | tous                                        |
| Liste des modes (arrêt, faible, moyen…) | tous                                        |
| Vitesse (1 à 10)                        | tous                                        |
| Mode auto                               | tous                                        |
| Oscillation                             | tous                                        |
| Angle d'oscillation (45°, 90°, 180°…)   | tours Pure Cool, Purifier Cool, Hot+Cool    |
| Mode nuit                               | tous                                        |
| Sens du flux d'air (avant / arrière)    | Pure Cool, Purifier Cool, Hot+Cool          |
| Chauffage + consigne (°C)               | Hot+Cool                                    |
| Humidification                          | Humidify+Cool                               |
| Température, humidité                   | tous                                        |
| PM2.5, PM10 (µg/m³)                     | modèles depuis 2018                         |
| Indice COV, indice NO2                  | modèles depuis 2018 (COV seul sur « Link ») |
| Formaldéhyde (mg/m³)                    | modèles « Formaldehyde » (suffixe K)        |
| Usure des filtres                       | % (HEPA, charbon), heures sur « Link »      |

Les noms des fonctions sont en français quand le pays du compte est
francophone (France, Belgique, Suisse, Luxembourg, Monaco), en anglais sinon.
Un appareil déjà ajouté garde ses noms : renommez une fonction dans la page
de l'appareil (Intégrations → Dyson → Appareils). Dans une boîte
« Appareils », Gladys nomme une fonction seule de son genre d'après son type
(« Sélection » pour l'angle d'oscillation) : donnez à la ligne un nom à vous
dans les réglages de la boîte.

Les valeurs sont celles de l'application MyDyson. Les indices COV et NO2 sont
ceux de Dyson : de 0 (air propre) à 10, en nombres entiers comme dans
l'application.

Choisir une vitesse allume l'appareil et coupe le mode auto, comme sur la
télécommande. En mode auto, aucune vitesse n'est affichée.

La **liste des modes** marche comme pour les ventilateurs Matter : Arrêt,
Faible (vitesse 1), Moyen (vitesse 5), Fort (vitesse 10) et Auto. Elle suit la
vitesse : la liste et le curseur sont toujours d'accord. Les vitesses 1 à 3
affichent Faible, 4 à 6 Moyen, 7 à 10 Fort. Le sens du flux d'air est aussi une liste.
L'oscillation et le mode nuit sont des interrupteurs marche / arrêt.

La liste **Angle d'oscillation** propose les largeurs de l'application Dyson :
45°, 90°, 180° et 350°. En choisir une lance l'oscillation, autour de la
direction où pointe l'appareil. Pour l'arrêter, utilisez l'interrupteur
Oscillation. Une largeur réglée autrement (autre application) n'affiche
aucune entrée dans la liste.

**Appareil ajouté avant cette version ?** Ouvrez l'onglet **Découverte** et
cliquez sur **Mettre à jour** sur l'appareil pour obtenir les dernières
fonctions (angle d'oscillation, interrupteurs, icônes PM et humidité).
L'historique et les scènes sont gardés. Le bouton
apparaît dès que l'intégration a redémarré dans sa nouvelle version.

L'état affiché dans Gladys est celui que l'appareil **confirme** : un ordre
refusé par l'appareil ne s'affiche pas comme fait. Un changement fait avec la
télécommande ou l'application Dyson remonte aussi dans Gladys.

## Scènes

### Déclencheurs

Dans l'éditeur de scènes, catégorie **Intégrations** :

- **Qualité de l'air modifiée** : le niveau mesuré par un appareil change.
  Niveaux : bonne, moyenne, mauvaise, très mauvaise. C'est le pire de PM2.5,
  PM10, COV et NO2 qui décide, avec les seuils de l'application Dyson
  (PM2.5 : 35 / 53 / 70 µg/m³ ; PM10 : 50 / 75 / 100 µg/m³ ; COV et NO2 :
  3 / 6 / 8). Variables : `level`, `previous_level`, `pm25`, `pm10`, `voc`,
  `no2`.
- **Filtre bientôt à changer** : un filtre passe sous 10 % (400 heures sur
  les modèles Link). Variables : `filter` (`hepa`, `carbon`, `combined`),
  `remaining`.
- **Connexion modifiée** : un appareil passe en local, en cloud, ou devient
  injoignable. Variables : `transport`, `previous_transport`, `degraded`.

Chaque déclencheur peut se limiter à un appareil. Un événement part une seule
fois par changement. Au démarrage, la première valeur sert de référence : un
redémarrage ne relance pas vos scènes.

### Actions

- **Appliquer des réglages Dyson** : marche, mode (auto / manuel), vitesse,
  oscillation et mode nuit, en un seul ordre. Un champ vide ne change rien.
  « Éteint » ignore les autres réglages.
- **Régler la minuterie** : l'appareil s'éteint seul après N minutes (de 1 à 540) ; 0 annule la minuterie.

Les deux renvoient `sent` (ordre envoyé ou non) et `transport` (connexion
utilisée). Un appareil injoignable ne fait pas échouer la scène :
`sent` vaut alors `false`.

## Widgets du tableau de bord

Chaque widget affiche un appareil, choisi dans ses réglages.

**Qualité de l'air Dyson** :

- jusqu'à 6 tuiles en direct : PM2.5, PM10, COV, NO2, température, humidité
  (selon le modèle). Chaque tuile de polluant prend la couleur de son niveau :
  vert (bonne), bleu (moyenne), orange (mauvaise), rouge (très mauvaise), avec
  les seuils des scènes ci-dessus ;
- l'état : qualité de l'air globale (le pire polluant), formaldéhyde sur les
  modèles K, connexion, usure des filtres (ce sont eux qui nettoient l'air) ;
- un bouton pour actualiser les relevés.

Dyson ne donne pas d'indice AQI unique : le niveau global est calculé à partir
des quatre polluants.

**Commandes Dyson** :

- une tuile : le ventilateur (éteint, auto, ou une jauge de vitesse en
  direct). Les relevés de l'air sont dans le widget qualité de l'air ;
- un dessin de l'appareil (tour, Hot+Cool, ventilateur de bureau,
  humidificateur ou Big+Quiet), avec des lignes d'air quand le ventilateur
  tourne. Les photos Dyson ne peuvent pas être fournies et le compte n'en
  donne pas : ce sont des dessins. Le réglage **Afficher le dessin de
  l'appareil** le masque ;
- l'état : oscillation (avec son angle), mode nuit, flux d'air, chauffage,
  connexion, minuterie. Avec les boutons d'oscillation, les lignes
  oscillation et mode nuit sont retirées : les boutons les montrent ;
- jusqu'à quatre boutons, au choix dans le réglage **Boutons** du widget :
  - **Marche, auto, vitesse - et +** (par défaut) : allumer / éteindre, mode
    auto (ou retour en manuel), vitesse - et vitesse +. Vitesse - et + ne
    s'affichent que si l'appareil est allumé et en mode manuel : éteint, on
    voit seulement **Allumer** et **Mode auto** ; en auto, **Éteindre** et
    **Mode manuel**. Au plus bas (1), vitesse - disparaît ; au plus haut
    (10), vitesse + disparaît ;
  - **Marche, oscillation, mode nuit, flux d'air** : un réglage actif est un
    bouton plein, un clic l'inverse. Sur les modèles qui soufflent dans un
    seul sens, le mode auto remplace le flux d'air ;
  - **Marche, mode nuit, minuterie** : la télécommande du coucher.
    **Minuterie** ouvre un petit formulaire dans le widget qui demande les
    minutes (0 à 540, 0 annule la minuterie), prérempli avec la minuterie en
    cours, ou 60 ; le bouton est plein tant qu'une minuterie tourne. Il règle
    la même minuterie que l'action de scène **Régler la minuterie**.

Après un clic, le widget se met à jour dès que l'appareil a répondu. Pour
avoir plusieurs jeux de boutons, ajoutez le widget plusieurs fois.

Gladys limite un widget à quatre boutons. Pour tout piloter au même endroit
(liste des modes, curseur de vitesse, oscillation, mode nuit, flux d'air),
ajoutez aussi l'appareil dans une boîte « Appareils » de votre tableau de
bord. Le panneau de commande qui s'ouvre depuis une lumière dans cette boîte
est dessiné par Gladys pour les lumières seulement : une intégration ne peut
pas en ajouter un pour un ventilateur.

## Réglages

- **Adresses des appareils (local)** : l'adresse de chaque appareil sur votre
  réseau, sous la forme `numéro_de_série=adresse_IP`, séparées par des
  virgules. Exemple : `NK6-EU-MHA0000A=192.168.1.20`. Avec un seul appareil
  Dyson dans le compte, l'adresse seule suffit : `192.168.1.20`. Un appareil
  sans adresse ici passe par le cloud Dyson (badge avec un point orange) ; le
  message du badge et **Tester la connexion** donnent le numéro de série à
  saisir. Le numéro de série est sur l'étiquette de
  l'appareil et dans l'application MyDyson. Donnez une adresse fixe à
  l'appareil dans votre box pour qu'elle ne change pas.

  Pour trouver l'adresse, regardez la liste des appareils connectés de votre
  box : l'appareil y apparaît en général sous son numéro de série. L'intégration ne sait pas encore la trouver seule : Gladys ne lui
  permet pas d'écouter les annonces `_dyson_mqtt._tcp` des appareils.

- **Rafraîchissement des capteurs (s)** : fréquence de lecture des capteurs de
  qualité de l'air, de 15 à 3600 secondes (60 par défaut). Les changements de
  marche, vitesse, etc. arrivent eux tout de suite, sans attendre.

## Boutons

- **Recevoir un code** / **Valider le code** : connexion au compte Dyson.
- **Tester la connexion** : relit la liste des appareils du compte et affiche,
  pour chacun, le chemin utilisé (local, cloud Dyson, injoignable) et, en cas
  de secours, pourquoi.
- **Se déconnecter** : supprime le jeton et la liste des appareils gardés par
  l'intégration. Les appareils restent dans Gladys.

## En cas de problème

- **« Dyson a refusé le code ou le mot de passe »** : vérifiez le mot de passe
  enregistré, puis demandez un nouveau code. Un code n'est valable que
  quelques minutes.
- **Pas de code reçu** : regardez les courriers indésirables, et vérifiez l'e-mail
  et le pays du compte.
- **Badge « cloud » avec un point orange** : l'adresse de l'appareil manque
  dans **Adresses des appareils**, ou la connexion locale a été refusée
  (mauvaise adresse, appareil sur un autre réseau que Gladys ne voit pas). Une remise à zéro de l'appareil change son mot de
  passe local : cliquez alors sur **Tester la connexion** pour le relire.
  Si la connexion locale a échoué (appareil redémarré, Wi-Fi coupé),
  l'intégration la réessaie toutes les 4 minutes et y revient seule.
- **Badge « injoignable »** : l'appareil est éteint au secteur, hors Wi-Fi, ou
  ni le réseau local ni le cloud ne répondent. L'intégration réessaie seule.
- **Les tuiles du widget « Qualité de l'air » restent bleues** : avec le thème
  « verre » de Gladys, la couleur de l'icône des tuiles n'est pas appliquée
  (à corriger côté Gladys). Le niveau global reste coloré dans l'état.
- **Un capteur reste vide** : certains capteurs ont besoin de quelques minutes
  après la mise sous tension. Un modèle sans ce capteur n'envoie jamais de
  valeur.

Les journaux de l'intégration (onglet **Supervision**) donnent le détail. Ils
ne contiennent jamais votre mot de passe ni votre jeton.

## Vie privée

Votre e-mail et votre mot de passe ne sont envoyés qu'à Dyson
(`appapi.cp.dyson.com`). Le jeton de connexion et la liste des appareils sont
gardés dans le volume de données de l'intégration, lisible par elle seule.
