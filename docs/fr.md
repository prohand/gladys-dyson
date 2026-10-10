# Dyson

Cette intégration relie Gladys à vos **purificateurs, ventilateurs et
chauffages Dyson** connectés (gammes Pure Cool, Purifier Cool, Hot+Cool,
Humidify+Cool, Big+Quiet et les anciens modèles « Link »). Vous pouvez les
allumer, régler la vitesse, l'oscillation, le mode nuit, le chauffage, et
suivre la qualité de l'air qu'ils mesurent.

## Ce dont vous avez besoin

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

| Fonction                  | Modèles                                     |
| ------------------------- | ------------------------------------------- |
| Marche / arrêt            | tous                                        |
| Vitesse (1 à 10)          | tous                                        |
| Mode auto                 | tous                                        |
| Oscillation               | tous                                        |
| Mode nuit                 | tous                                        |
| Chauffage + consigne (°C) | Hot+Cool                                    |
| Humidification            | Humidify+Cool                               |
| Température, humidité     | tous                                        |
| PM2.5, PM10 (µg/m³)       | modèles depuis 2018                         |
| Indice COV, indice NO2    | modèles depuis 2018 (COV seul sur « Link ») |
| Formaldéhyde (mg/m³)      | modèles « Formaldehyde » (suffixe K)        |
| Usure des filtres         | % (HEPA, charbon), heures sur « Link »      |

Les indices COV et NO2 sont ceux de Dyson : de 0 (air propre) à 10.

Choisir une vitesse allume l'appareil et coupe le mode auto, comme sur la
télécommande. En mode auto, aucune vitesse n'est affichée.

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

## Widget du tableau de bord

Le widget **Qualité de l'air Dyson** affiche un appareil, choisi dans ses
réglages :

- 4 tuiles en direct : PM2.5, COV, température, humidité (selon le modèle) ;
- l'état : qualité de l'air, connexion, mode, filtres, minuterie ;
- des boutons : allumer / éteindre, mode auto, actualiser les relevés.

## Réglages

- **Adresses des appareils (local)** : l'adresse de chaque appareil sur votre
  réseau, sous la forme `numéro_de_série=adresse_IP`, séparées par des
  virgules. Exemple : `NK6-EU-MHA0000A=192.168.1.20`. Un appareil sans adresse
  ici passe par le cloud Dyson (badge avec un point orange). Le numéro de série est sur l'étiquette de
  l'appareil et dans l'application MyDyson. Donnez une adresse fixe à
  l'appareil dans votre box pour qu'elle ne change pas.
- **Rafraîchissement des capteurs (s)** : fréquence de lecture des capteurs de
  qualité de l'air, de 15 à 3600 secondes (60 par défaut). Les changements de
  marche, vitesse, etc. arrivent eux tout de suite, sans attendre.

## Boutons

- **Recevoir un code** / **Valider le code** : connexion au compte Dyson.
- **Tester la connexion** : relit la liste des appareils du compte et affiche,
  pour chacun, le chemin utilisé (local, cloud Dyson, injoignable).
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
- **Badge « injoignable »** : l'appareil est éteint au secteur, hors Wi-Fi, ou
  ni le réseau local ni le cloud ne répondent. L'intégration réessaie seule.
- **Un capteur reste vide** : certains capteurs ont besoin de quelques minutes
  après la mise sous tension. Un modèle sans ce capteur n'envoie jamais de
  valeur.

Les journaux de l'intégration (onglet **Supervision**) donnent le détail. Ils
ne contiennent jamais votre mot de passe ni votre jeton.

## Vie privée

Votre e-mail et votre mot de passe ne sont envoyés qu'à Dyson
(`appapi.cp.dyson.com`). Le jeton de connexion et la liste des appareils sont
gardés dans le volume de données de l'intégration, lisible par elle seule.
