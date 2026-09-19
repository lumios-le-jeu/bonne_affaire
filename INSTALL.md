# LaBonneAffaire — collecte par extension

## Pourquoi ce changement

L'ancien `worker.ts` pilotait Chrome à distance par AppleScript (`set URL of active tab`).
Vu de DataDome, c'était une navigation sans referrer, sans clic, sans mouvement de
souris, sur 8 pages d'affilée à 1,5 s d'intervalle. Le captcha de `datadome_block.png`
le dit d'ailleurs lui-même : *« vous surfez et cliquez à une vitesse surhumaine »*.

Ici, l'extension ne fabrique pas de trafic : elle **lit** les réponses JSON que
leboncoin.fr charge de lui-même, dans ta vraie session Chrome, avec tes vrais cookies
et ton vrai fingerprint. Les seules pages ouvertes le sont dans des onglets d'arrière-plan,
une à la fois, espacées de 45 à 180 secondes au hasard.

## Fichiers

```
extension/                    ← à charger dans Chrome
  manifest.json
  interceptor.js              monde MAIN : patche fetch/XHR, lit __NEXT_DATA__ et le payload RSC
  content.js                  monde isolé : relais + détection captcha + scroll humain
  background.js               planificateur, ouverture des onglets, envoi vers localhost
  popup.html / popup.js       état de la collecte
  icon16/48/128.png

lba-app/
  prisma/schema.prisma        + ScanRun, + isPro/hasShipping/publishedAt/raw, + medPrice
  lib/ingest.ts               ingestion + détection de vente enfin fiable
  app/api/ingest/route.ts     réception des lots
  app/api/queue/route.ts      plan de collecte du jour
```

`lib/scraper.ts`, `lib/worker.ts` et `AUTO_SCRAPE.bat` ne servent plus. Garde-les
le temps de vérifier que la collecte tourne, puis supprime-les.

## Installation

1. **Base de données**

   ```bash
   cd lba-app
   npx prisma migrate dev --name extension-collector
   ```

   Les colonnes ajoutées sont toutes optionnelles ou avec valeur par défaut :
   tes données existantes sont conservées.

2. **Extension**

   `chrome://extensions` → activer *Mode développeur* → *Charger l'extension non empaquetée*
   → choisir le dossier `extension/`.

   Utilise **le profil Chrome dans lequel tu navigues normalement**, pas un profil
   dédié : c'est tout l'intérêt (cookies DataDome déjà validés, historique crédible).

3. **Lancer l'app** — `LAUNCH_LBC.bat` comme avant. L'extension n'envoie rien tant
   que `localhost:3000` ne répond pas ; les lots sont mis de côté et repartent
   automatiquement au prochain démarrage.

4. **Vérifier** — clique sur l'icône : *Collecter maintenant*. Tu dois voir dans
   le journal `page 1 : 35 annonces`, et dans la console Next.js `[Ingest] page 1 … 35 annonces`.

## Comportement

| | |
|---|---|
| Cadence | ~4 vérifications/jour, une recherche traitée par passage, 20 h minimum entre deux passages d'une même recherche |
| Pages par recherche | calculées d'après le volume réel (`lastTotal`), plafond `LBA_MAX_PAGES` (8) |
| Captcha détecté | plan annulé, notification Chrome, pause 6 h |
| App éteinte | lots gardés en mémoire (400 max), renvoyés plus tard |
| Navigation manuelle | toute page leboncoin que tu ouvres toi-même est moissonnée aussi, gratuitement |

Variables d'environnement (`.env` de `lba-app`) : `LBA_MAX_PAGES`, `LBA_MIN_HOURS`.

## Ce qui est enfin correct : `daysToSell`

L'ancienne règle — 30 scans manqués et 14 jours — existait parce qu'on ne savait
pas si une annonce absente était vendue ou simplement reléguée en page 9. Un mois
de latence rendait la statistique « prix vs délai de vente » inutilisable.

`ScanRun` enregistre maintenant la couverture réelle de chaque passage
(`adsSeen` vs `total` annoncé par Leboncoin). Une annonce n'est comptée manquante
que si un passage **complet** ne l'a pas revue, ce qui autorise un seuil bien plus
serré : 3 passages complets et 3 jours. Et `soldAt` est daté à la dernière
observation, pas au jour du constat.

## Où brancher DeepSeek

Pas sur la collecte — sur la normalisation, une fois par annonce nouvelle :

- titre brut → `{marque, modèle, capacité, état, accessoires, lot oui/non}`,
  pour que « Mac mini M4 16/256 » et « mac mini m4 neuf scellé » entrent dans la
  même série de prix ;
- détection des annonces « pour pièces », des lots, des coques vides ;
- `estimer.js` sur la photo principale comme second signal, en cas de titre pauvre.

Quelques centaines d'annonces nouvelles par jour au maximum, un appel chacune,
jamais rejoué : le coût reste sous le centime par jour.
