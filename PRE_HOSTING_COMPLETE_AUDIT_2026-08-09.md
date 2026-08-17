# Meri Beauty — Audit complet avant hébergement

**Date de contrôle :** 9 août 2026  
**Branche / commit audité :** `marwane` — `a4d3bc0`  
**Document de référence :** ce fichier remplace, pour décider du lancement, les listes dispersées dans `CURRENT_DB_LOGIC_AUDIT_2026-08-08.md`, `PROD_READINESS_AUDIT_2026-08-09.md` et `PROD_READINESS_CHECKLIST.md`.

## Verdict

**NO-GO pour une ouverture publique et pour Stripe live.**

Le projet a une bonne base : le schéma Prisma est valide, les migrations sont appliquées, les contraintes anti-chevauchement/stock/source de paiement existent et les données actuelles ne présentent pas d'incohérence comptable détectée. Cependant, plusieurs défauts permettent actuellement une prise de compte, un contournement de la confiance Stripe ou la création de rendez-vous invalides. Le routage des paiements de rendez-vous contredit aussi la règle métier confirmée : **tout l'argent doit arriver chez Marie**.

L'application peut être installée sur un serveur de préproduction privé, mais elle ne doit pas être rendue publique avant la fermeture de tous les éléments P0.

## Résumé exécutif

| Niveau | Signification | État |
|---|---|---:|
| P0 | Blocage absolu avant trafic public / argent réel | 12 groupes ouverts |
| P1 | À terminer idéalement avant lancement | 12 groupes ouverts |
| P2 | Qualité, traçabilité et maintenance | ouvert |

Les quatre premières corrections à effectuer lundi sont :

1. supprimer le mécanisme d'auto-connexion pouvant connecter un visiteur à un compte existant ;
2. rendre inaccessibles depuis le navigateur les helpers internes de webhook, cron, e-mail et Stripe ;
3. recalculer et valider tout créneau côté serveur, sans faire confiance à `isManualMode` ni aux données du navigateur ;
4. décider et appliquer le routage centralisé des paiements vers le compte Stripe de Marie.

---

## P0 — Obligatoire avant ouverture publique

### P0.1 — Prise de compte possible via le jeton d'auto-connexion

**Constat**

- `actions/reservation/create-reservation.js:88-100` retrouve un utilisateur existant à partir de l'e-mail ou du téléphone fourni par un visiteur non connecté.
- `actions/reservation/create-reservation.js:421-436` et `:703-716` renvoient ensuite un `autologinToken` pour cet utilisateur, qu'il soit nouveau ou déjà existant.
- `actions/payment/createCheckoutSession.js:46-60` fait la même résolution, puis génère le jeton à `:271-275`.
- `auth.js:97-102` accepte ce jeton à la place du mot de passe. Il ne limite pas ce chemin aux nouveaux comptes `CUSTOMER` et ne consomme aucun jeton à usage unique.

**Impact**

Une personne qui connaît l'adresse e-mail d'un compte actif peut soumettre une réservation invitée, recevoir un jeton valable pour cette adresse et tenter de se connecter à ce compte. Le risque concerne aussi les rôles STAFF/ADMIN/OWNER si leur e-mail est fourni.

**Correction**

- Désactiver immédiatement l'auto-login HMAC fondé seulement sur `email + expiration`.
- Pour un compte existant, exiger une session existante, le mot de passe, ou un lien OTP envoyé et consommé par le propriétaire de l'e-mail.
- Si l'auto-login reste nécessaire pour un **nouveau** client, utiliser un jeton aléatoire, haché en base, lié à `userId + purpose + resumeId`, à durée courte et atomiquement consommé une seule fois.
- Refuser le chemin pour tout rôle autre que `CUSTOMER`.
- Ajouter des tests : e-mail admin, e-mail staff, client existant, nouveau client, replay et appels concurrents.

**Acceptation :** connaître l'e-mail d'un utilisateur ne doit jamais suffire à obtenir une session pour celui-ci.

### P0.2 — Des helpers internes critiques sont exportés comme Server Actions

Les modules marqués `"use server"` doivent être considérés comme des frontières réseau. Plusieurs fonctions internes n'ont pourtant aucune authentification ou preuve Stripe :

- `actions/boutique/orders.js:639` exporte `fulfillOrderPayment(session)`. La fonction fait confiance à un objet `session` reçu en argument et peut créer le paiement, la facture, le mouvement de stock et changer l'état d'une commande. Elle doit être accessible uniquement après vérification de signature dans `app/api/webhooks/stripe/route.js`.
- `actions/shared/resume-checkout-after-verification.js:38-59` accepte un `userId`, remplace son mot de passe et envoie de nouveaux identifiants sans vérifier un jeton de vérification consommé.
- `actions/shared/resume-checkout-after-verification.js:71-82` permet de relancer une commande/réservation à partir d'un `resumeId` sans vérifier le propriétaire.
- `actions/stripe/createAccountLink.js:20-67` génère un lien Stripe Connect pour n'importe quel `staffId` sans garde interne.
- `actions/staff/independant-staff.js:17-117` contient trois anciennes mutations staff sans authentification.
- Les rappels, broadcasts et notifications de listes d'attente sont également exportés sans garde.

Le build généré référence bien les exports d'`actions/boutique/orders.js` comme actions serveur ; ce n'est donc pas seulement une question de convention interne.

**Correction**

- Déplacer tout helper webhook/cron dans `lib/server/*` avec `import "server-only"`, sans `"use server"` et sans export vers un composant client.
- Ne garder dans `actions/*` que les véritables points d'entrée UI, chacun avec auth, rôle, propriété de la ressource et validation Zod.
- Faire de `fulfillOrderPayment` une fonction interne appelée seulement avec un objet obtenu par la route Stripe après `constructEvent()`.
- Supprimer le fichier legacy `actions/staff/independant-staff.js`.
- Ajouter un test automatisé listant les Server Actions sensibles et vérifiant leur garde.

**Acceptation :** un appel direct d'action sans session/signature ne peut modifier ni utilisateur, ni paiement, ni commande, ni staff, ni déclencher un envoi massif.

### P0.3 — La création de rendez-vous ne valide pas le créneau côté serveur

`createReservation`, `createMultipleReservations`, `createCheckoutSession` et l'ancien `createAppointment` chargent un `StaffService` et vérifient surtout les chevauchements. Ils ne prouvent pas que l'heure reçue figure dans les fenêtres calculées par `lib/slot-availability.js`.

Un appel fabriqué peut donc demander :

- une heure hors horaires ;
- un jour fermé, un congé ou une fermeture du salon ;
- une date passée ;
- un staff/service inactif ou supprimé ;
- une période hors contrat ;
- une heure arbitraire qui n'était jamais proposée dans l'interface.

De plus, `actions/reservation/create-reservation.js:253` accepte `isManualMode` du client et l'utilise à `:332-345` pour remplacer le mode réel du staff. Un appel direct peut ainsi forcer une réservation sans le paiement normalement attendu.

**Correction**

- Construire une fonction serveur canonique `assertBookableSlot()` qui recharge salon, staff, contrat, horaires, congés, fermetures et rendez-vous.
- Vérifier que `time` correspond exactement à une fenêtre produite par `buildAvailabilityForDate()`.
- Refaire cette validation dans la même transaction que l'insertion ; conserver la contrainte DB de chevauchement comme dernier filet.
- Dériver le mode de confirmation et le moyen de paiement autorisé uniquement depuis la base ; supprimer `isManualMode` de l'entrée client.
- Supprimer ou rediriger l'ancien flux `actions/appointment/create-appointment.js` afin de ne garder qu'une implémentation.

### P0.4 — Le routage actuel n'envoie pas tous les paiements à Marie

La règle métier donnée est : **tout revenu, y compris les prestations d'un membre du staff, doit arriver directement à Marie**.

État actuel :

- boutique, ateliers et formations : paiement sur le compte Stripe plateforme ;
- rendez-vous : `actions/payment/createCheckoutSession.js:356-407` crée une **direct charge** sur `staff.stripeAccountId` ; l'argent appartient au compte Stripe du staff et la plateforme prend zéro commission ;
- paiements sur place : le logiciel ne peut pas garantir physiquement qui reçoit le cash ou le terminal.

**Correction recommandée**

- Créer tous les Checkout Sessions sur le compte Stripe de Marie, y compris les rendez-vous.
- Ne plus exiger Stripe Connect pour réserver une prestation si aucun versement automatique au staff n'est souhaité.
- Calculer séparément ce que Marie doit éventuellement au staff (commission, salaire ou loyer) dans un registre interne ; ne pas utiliser le destinataire Stripe comme substitut au contrat.
- Faire apparaître sur chaque `Payment/Transaction` le bénéficiaire, le canal, l'identifiant Stripe et l'état de rapprochement.
- Pour les paiements sur place, imposer une procédure caisse/terminal de Marie et une clôture de caisse quotidienne.

**Acceptation :** quatre tests Stripe distincts (rendez-vous, boutique, atelier, formation) apparaissent tous dans le compte plateforme de Marie, avec rapprochement DB exact.

### P0.5 — La conversion d'une demande de location crée des services actifs de durée zéro

`actions/staff/create-staff-from-rental.js:181-190` crée des `StaffService` avec `price: 0`, `duration: 0`, `photo: ""` et `isActive: true`.

`lib/slot-availability.js` génère les fenêtres avec une boucle qui avance de `duration`. Avec une durée zéro, la boucle ne progresse jamais : une consultation de disponibilité peut bloquer le processus Node.

**Correction**

- Créer les affectations inactives jusqu'à ce que prix, durée et photo soient configurés, ou exiger ces valeurs dans le formulaire de conversion.
- Ajouter une garde immédiate `duration > 0` dans le moteur de disponibilité.
- Ajouter des contraintes DB `StaffService.duration > 0`, `price >= 0`, `margin >= 0`.
- Tester durée 0, valeur négative et service incomplet.

### P0.6 — Les paiements de rendez-vous abandonnés bloquent les créneaux indéfiniment

`actions/payment/createCheckoutSession.js` crée `Appointment(PENDING)` et `Payment(PENDING)` avant Stripe. Il n'existe ni `holdExpiresAt` pour les rendez-vous, ni job qui clôt ces lignes après abandon. La contrainte `Appointment_no_overlap` considère `PENDING` comme occupé.

**Correction**

- Ajouter une expiration courte (par exemple 15 minutes), un job atomique et un état terminal explicite.
- Traiter un webhook tardif après expiration en remboursement automatique, sans ressusciter le créneau.
- Réutiliser proprement une tentative du même client sans prolongation infinie.

### P0.7 — Les remboursements ne sont pas suffisamment idempotents ni récupérables

- `app/api/webhooks/stripe/route.js:255-297` calcule le delta remboursé avant de verrouiller le paiement. Deux événements concurrents peuvent créer deux transactions de remboursement et deux notes de crédit.
- `Transaction` ne stocke pas d'identifiant unique d'événement/remboursement Stripe.
- Plusieurs annulations finalisent l'état local et la remise en stock avant l'appel Stripe. En cas d'échec, il n'existe pas de `REFUND_PENDING/FAILED` durable ni de file de retry ; un log/e-mail est la seule alerte.

**Correction**

- Ajouter `ProcessedStripeEvent(eventId @unique)` et revendiquer l'événement avant traitement.
- Verrouiller le `Payment`, puis recalculer le total remboursé dans la transaction.
- Enregistrer chaque tentative avec `stripeRefundId`, statut, erreur, compteur et prochaine tentative.
- Ajouter un job de réconciliation Stripe ↔ DB et une alerte dashboard.

### P0.8 — Le fuseau du salon n'est pas défini

Le code construit les rendez-vous avec `new Date(...)`, `setHours()` et formate avec `toLocale*()` sans `timeZone`. Le processus d'audit tourne actuellement en `Africa/Casablanca`, alors que le salon est à Bruxelles ; en août, ces zones n'ont pas la même heure. Un VPS OVH peut encore utiliser UTC.

Les colonnes sont des `TIMESTAMP(3)` sans fuseau. Aucun test ne couvre les changements d'heure Europe/Brussels.

**Correction**

- Définir la zone métier canonique `Europe/Brussels` dans le code et dans l'environnement du processus.
- Préférer le stockage d'instants UTC avec `timestamptz`, tout en conservant séparément la date/heure locale du salon si nécessaire.
- Fournir explicitement `timeZone: "Europe/Brussels"` aux formatages serveur.
- Ajouter des tests autour des passages heure d'été/hiver et d'un client hors Belgique.

La base ne contient actuellement aucun rendez-vous : c'est le meilleur moment pour corriger ce modèle sans migration de données ambiguë.

### P0.9 — Livraison Mondial Relay non prête et montants provisoires

- `lib/shipping.js:20-28` facture une grille placeholder issue de l'ancien bpost ; `7,50 €` est actuellement transformé par Stripe Adaptive Pricing en monnaie locale, par exemple `83,80 MAD`.
- Les trois variantes actives ont `weightGrams = 0`, donc elles tombent toutes dans le premier palier.
- Les identifiants widget/API Mondial Relay sont absents.
- Le fallback manuel accepte un point relais non vérifié ; les champs envoyés par le navigateur ne sont pas rechargés depuis Mondial Relay.
- Le widget charge jQuery et du JavaScript tiers depuis des CDN sans SRI. Le navigateur a déjà signalé un besoin d'`unsafe-eval`, alors que la CSP de production le refuse.

**Décision sûre**

- Soit terminer tarifs, poids, homologation API, validation serveur du point et CSP avant lancement ;
- soit désactiver complètement `SHIPPING_PREPAID` et lancer uniquement les retraits boutique.

Ne jamais activer publiquement le fallback de point relais manuel comme solution permanente.

### P0.10 — Identité légale, données et identifiants de démonstration

État de la base au 9 août :

- un seul salon `main-salon`, mais téléphone, e-mail, adresse et TVA sont vides ;
- la seule ADMIN active utilise encore le mot de passe configuré par le seed ;
- la seule STAFF active utilise encore `Staff@123` ;
- le seul CUSTOMER actif utilise encore `Client@123` ;
- le staff actif n'est pas prêt pour les charges/payouts Stripe ;
- zéro atelier et zéro formation publiés.

Les trois pages légales affichent toujours `[Nom et prénom complets de la responsable — à compléter]`.

**Correction**

- Remplir l'identité salon et faire valider CGV/mentions/confidentialité.
- Supprimer les comptes/données démo de la base destinée à la production, ou imposer un changement de mot de passe avant toute connexion.
- Rotater `AUTH_SECRET`, `CRON_SECRET`, secrets Stripe/webhooks et mot de passe admin au déploiement.
- Ne jamais exécuter `prisma/seed-demo.mjs` ou `prisma/create-client.mjs` en production.
- Supprimer/ignorer `..env.swp`, fichier swap non suivi susceptible de contenir des fragments de `.env`.

### P0.11 — Le build de production n'est pas reproductible

Le build exécuté pendant cet audit a compilé le code, puis a échoué au prerender de `/` lorsque l'appel Instagram a expiré : `TypeError: fetch failed / ETIMEDOUT`.

Causes :

- `lib/instagram.js:30-45` ne capture pas les erreurs réseau et n'impose pas de timeout applicatif ;
- `app/(public)/page.js:16-21` attend Instagram pendant le build ;
- `app/sitemap.js` dépend également de quatre lectures DB sans fallback ;
- `/boutique/cart` et `/boutique/checkout` capturent et loguent l'exception Next `DYNAMIC_SERVER_USAGE` au lieu de déclarer clairement leur rendu dynamique.

**Correction**

- Instagram : timeout + `try/catch` + contenu local de secours.
- Sitemap : toujours retourner les routes statiques si la DB est indisponible.
- Déclarer les pages panier/checkout dynamiques et ne pas avaler les signaux internes de Next.
- Exiger deux builds propres successifs avec Instagram et DB volontairement indisponibles.

### P0.12 — Vulnérabilités de dépendances et absence de tests de risque

`npm audit --omit=dev` retourne actuellement **3 vulnérabilités HIGH** : Next est affecté via ses versions embarquées de `postcss` et `sharp`. Le correctif proposé par npm passe par Next 16.3.0, donc nécessite un chantier de migration/test.

Les contrôles existants :

- ESLint : 0 erreur, 14 avertissements image ;
- TypeScript : OK ;
- Prisma validate : OK ;
- tests : un seul fichier de 65 lignes, 1 test réussi ;
- aucun script `npm test`.

**Correction**

- Tester une branche Next 16.3.x et ses migrations avant lancement, ou documenter une acceptation de risque très limitée après analyse d'exploitabilité.
- Ajouter des tests d'intégration réels pour auth, actions serveur, créneaux, stock, webhooks, remboursements, factures et autorisations.
- Ajouter `npm test` et l'exécuter en CI avec lint, types, Prisma et build.

---

## P1 — À terminer idéalement avant lancement

### P1.1 — Broadcasts, rappels et listes d'attente exposés / non atomiques

- Les actions de rappels et broadcasts sont exportées sans secret/role.
- Les marqueurs de rappel font `find → create/update` sans contrainte unique ; plusieurs workers peuvent envoyer deux fois.
- Les broadcasts `lowSeatsNotifiedAt` ne font pas de claim conditionnel avant l'envoi.
- `notifyAllInWaitingList` peut envoyer une campagne à toute la liste sans garde.
- `convertFormationWaitingListEntry` ne vérifie pas que la réservation correspond au même client et à la même session, contrairement à la version atelier.
- Les fonctions de statut de liste d'attente acceptent un e-mail public et révèlent position/statut.

Ajouter des claims atomiques, contraintes uniques et appels exclusivement internes.

### P1.2 — Les deadlines d'inscription ateliers/formations ne sont pas appliquées

`registrationDeadline` est affiché dans l'interface et sauvegardé, mais les actions de réservation ne le contrôlent pas. Une session `SCHEDULED` reste réservable après la date limite, voire après son début si le statut n'a pas changé.

### P1.3 — `Salon` n'est pas un singleton DB

Le code suppose partout un seul salon via `findFirst()` sans ordre. Le seed utilise `main-salon`, mais le schéma autorise plusieurs lignes et `updateSalon` fait un `findFirst → create` sujet à concurrence.

Utiliser exclusivement `findUnique/upsert({ id: "main-salon" })` ou ajouter un sentinel unique.

### P1.4 — Horaires et contrats peuvent être dupliqués ou modifiés de façon incohérente

- `WorkingHour` n'a pas `@@unique([staffId, day])`; l'upsert admin est un `findFirst → create` concurrent.
- Aucun index partiel ne garantit un seul contrat `ACTIVE` par staff.
- `actions/staff/upsert-staff-contract.js` permet à une STAFF de définir/modifier elle-même son loyer fixe. Cette donnée contractuelle devrait être approuvée par ADMIN/OWNER.

### P1.5 — Contraintes financières DB incomplètes

La base protège la source XOR du paiement et le stock, mais pas :

- montants `Payment` positifs et équation `paid + remaining = total` ;
- équation `Order subtotal + shipping - discount = total` ;
- quantités strictement positives ;
- prix/durée/marge des services ;
- capacité atelier strictement positive (seul `<= 8` est imposé) ;
- cohérence `startTime < endTime`.

Ajouter les CHECK après nettoyage et garder les validations Zod.

### P1.6 — Registre financier et audit métier insuffisants

- `Transaction` n'a pas de référence Stripe unique, `eventId`, bénéficiaire ou statut de rapprochement.
- `Appointment` n'enregistre ni `cancelledAt`, ni acteur/source, ni raison persistée.
- Il n'existe pas de journal d'audit immuable pour changements de prix, contrats, stock, remboursements et rôles.

### P1.7 — Recherche de retour trop faible comme preuve d'identité

La demande de retour est accessible avec un numéro de commande séquentiel + e-mail, sans session ni rate limit. Une personne connaissant ces deux valeurs peut voir les articles et déposer une demande qui consomme la quantité encore retournable.

Préférer compte client authentifié ou lien aléatoire signé à usage limité, avec rate limit partagé.

### P1.8 — Rate limiting seulement en mémoire

Le limiteur est local au processus, perdu au redémarrage et multiplié par le nombre d'instances. Il ne protège pas toutes les actions e-mail/lookup/promo/réservation. Utiliser Redis ou une table atomique partagée derrière le reverse proxy, avec limites IP + compte + action.

### P1.9 — Newsletter non durable et désabonnement incomplet

`sendNewsletter` marque les destinataires `SENT`, lance les envois sans les attendre, puis marque la newsletter `SENT`. Un restart peut perdre les e-mails alors que la DB annonce le contraire. Le mail renvoie seulement vers le compte pour se désabonner.

Ajouter une file/outbox, un worker idempotent, états réels et lien de désabonnement signé en un clic avec en-têtes `List-Unsubscribe`.

### P1.10 — Uploads locaux et validation de fichiers

- 45 fichiers occupent environ 117 Mo dans `public/uploads`.
- Un déploiement qui remplace le dossier de release peut perdre les uploads.
- Le contrôle se fonde sur le MIME déclaré, sans validation des magic bytes ni réencodage.
- Nginx peut refuser 20 Mo avec son `client_max_body_size` par défaut.

Utiliser un volume persistant sauvegardé ou un stockage objet, vérifier/réencoder les images, limiter dimensions/pixels et documenter la restauration.

### P1.11 — Scheduler, observabilité et reprise d'exploitation

- `instrumentation.js` démarre un interval dans chaque processus Node et les routes cron existent en parallèle.
- Aucune topologie n'impose un worker unique.
- Les logs sont presque exclusivement `console.*`; pas de healthcheck DB, suivi d'erreurs, métriques de webhook, alerte sur jobs ou file morte.

Choisir un seul propriétaire de cron, ajouter `/api/health` sans données sensibles, journalisation structurée, Sentry/équivalent et alertes sur remboursements/webhooks.

### P1.12 — Déploiement et base de données

- Il n'existe pas encore de configuration versionnée PM2/systemd, Nginx, rollback, healthcheck ou `.env.example` sans secrets.
- PostgreSQL est actuellement accessible sur le LAN `192.168.11.0/24`. Ce réglage est acceptable pour le test local, pas comme modèle de production public.
- Aucun test de restauration de backup n'est documenté.

En production : DB sur localhost/réseau privé, firewall limité à l'application, TLS si réseau distant, utilisateur DB sans superuser, sauvegardes quotidiennes chiffrées hors machine et restauration testée.

---

## P2 — Qualité et dette à planifier

- Relier `RentalRequest` au `Staff` et au `Contract` créés, et figer les conditions approuvées ; actuellement `commissionType` est ignoré lors de la conversion qui crée toujours `FIXED_RENT`.
- Supprimer l'enum Prisma `Language` inutilisé ; `Staff.languages` est un tableau de chaînes.
- Ajouter suppression/export/anonymisation de compte et une politique de rétention réellement exécutée, pas seulement écrite dans la page confidentialité.
- Décider si Stripe Adaptive Pricing reste actif. Il explique l'affichage MAD ; les factures et montants de base restent EUR.
- Ajouter favicon, manifest, Apple icon et corriger les 14 `<img>` signalés.
- Corriger les variantes de marque `Meri/Merri/Mery Beauty` et les placeholders anglais/US.
- Migrer complètement la config seed hors `package.json#prisma` avant Prisma 7.
- Retester les PDF facture/note de crédit sur un processus production propre avec cas non connecté, mauvais propriétaire et admin.

---

## État vérifié de la base — lecture seule

Connexion de contrôle : PostgreSQL LAN `192.168.11.130:5432`, base `meribeauty`.

- 43 migrations terminées, 0 rollback.
- 1 Salon (`main-salon`).
- 1 ADMIN, 1 STAFF, 1 CUSTOMER actifs/non supprimés.
- 3 variantes produit actives ; 3 avec poids nul ; aucune incohérence de stock.
- Aucun rendez-vous et aucun paiement dans la base au moment du contrôle.
- 2 commandes, toutes deux annulées ; équations de total valides.
- 0 atelier/formation publié.
- 0 source de paiement XOR invalide.
- 0 équation de paiement/commande invalide dans les données présentes.
- 0 liste d'attente polymorphique invalide ou doublon actif détecté.
- 0 session atelier/formation survendue.
- 0 doublon `(staffId, day)` actuellement, bien que le schéma ne l'empêche pas.
- Contraintes actives confirmées : `Appointment_no_overlap`, `Payment_exactly_one_source`, `WaitingListEntry_exactly_one_session`, contraintes de stock, capacités formation positives et capacité atelier maximale 8.

Cette bonne santé actuelle ne protège pas les futures écritures des lacunes décrites plus haut.

## Vérifications automatisées exécutées

| Contrôle | Résultat |
|---|---|
| `npm run lint` | Réussi, 0 erreur, 14 warnings `<img>` |
| `npx tsc --noEmit` | Réussi |
| `npx prisma validate` | Réussi, avertissement config Prisma dépréciée |
| `node --test tests/reservation-payment.test.js` | 1/1 réussi |
| `npm audit --omit=dev` | Échec sécurité : 3 HIGH |
| `npm run build` avec DB LAN | Échec au prerender de `/` sur timeout Instagram |
| scan simple des fichiers suivis pour clés Stripe/private keys | aucun secret évident trouvé |
| `.env` et `.env.local-backup` | ignorés et non suivis |

## Points déjà solides

- Mot de passe haché avec bcrypt coût 12.
- Session JWT limitée à 7 jours et revalidation DB périodique avec `sessionVersion`.
- Webhook Stripe vérifie la signature sur le corps brut.
- Contrainte DB anti-double-booking inter-services par staff.
- Stock réservé avec verrouillage de ligne et contraintes DB.
- Source polymorphique Payment protégée par CHECK.
- Prix et promo recalculés côté serveur dans les principaux checkouts.
- Factures et notes de crédit utilisent une numérotation atomique.
- Upload dashboard authentifié, extension imposée et dossier allowlisté.
- Routes cron protégées par secret comparé en temps constant.
- En-têtes CSP, frame deny, nosniff, referrer policy et HSTS production présents.

---

## Plan de travail recommandé pour la semaine

### Lundi — Fermer les vulnérabilités critiques

- [ ] Supprimer l'auto-login actuel et rotater `AUTH_SECRET` après correction.
- [ ] Déplacer les helpers internes hors des Server Actions.
- [ ] Rendre impossible l'appel direct de `fulfillOrderPayment` et des fonctions de reset/reprise.
- [ ] Supprimer le fichier legacy staff.
- [ ] Rotater/supprimer les comptes et mots de passe démo.
- [ ] Ajouter des tests de non-régression d'auth et d'autorisation.

**Mesure conservatoire :** tant que ce lot n'est pas déployé, ne pas exposer l'application actuelle sur Internet.

### Mardi — Rendez-vous, fuseau et argent

- [ ] Centraliser le validateur serveur des créneaux.
- [ ] Supprimer `isManualMode` client et revalider méthodes de paiement.
- [ ] Fixer `Europe/Brussels` et tester les DST.
- [ ] Modifier les paiements rendez-vous pour créditer Marie.
- [ ] Ajouter expiration des holds rendez-vous et remboursement des webhooks tardifs.
- [ ] Corriger le service durée zéro du workflow location.

### Mercredi — Webhooks, remboursements et contraintes DB

- [ ] Ajouter table d'événements Stripe traités + identifiants uniques.
- [ ] Ajouter état durable/retry/réconciliation des remboursements.
- [ ] Rendre reminders/broadcasts atomiques.
- [ ] Ajouter contraintes Payment/Order/StaffService/WorkingHour/Contract.
- [ ] Enforcer le singleton Salon et l'audit d'annulation.
- [ ] Écrire les migrations et tests concurrents.

### Jeudi — Intégrations et hébergement

- [ ] Choisir : livraison désactivée, ou Mondial Relay entièrement finalisé.
- [ ] Corriger la CSP/widget sans ouvrir globalement `unsafe-eval`.
- [ ] Rendre build, homepage et sitemap tolérants aux pannes externes.
- [ ] Préparer PM2/systemd, Nginx, HTTPS, healthcheck et environnement prod.
- [ ] Préparer stockage persistant des uploads, backups DB/uploads et rollback.
- [ ] Ajouter monitoring erreurs, webhooks, jobs et remboursements.

### Vendredi — Tests et décision GO/NO-GO

- [ ] CI : lint, types, Prisma, tests, build.
- [ ] UAT Stripe test pour les 4 flux, annulations, paiement partiel/final et remboursements.
- [ ] Rejouer le même webhook en parallèle et confirmer une seule écriture.
- [ ] Tester créneaux hors horaires, fermeture, congé, contrat, passé et DST.
- [ ] Tester rôles/IDOR sur chaque API/action/PDF.
- [ ] Tester backup puis restauration sur une base vide.
- [ ] Smoke test domaine HTTPS, cookies, e-mails, sitemap, robots, uploads et cron.
- [ ] Faire signer la checklist par Marie avant toute clé Stripe live.

## Réduction de périmètre si la semaine ne suffit pas

Une mise en ligne sûre peut être simplifiée :

- désactiver temporairement l'expédition et ne garder que le retrait boutique ;
- garder ateliers/formations non publiés tant que leurs tests ne sont pas prêts ;
- désactiver temporairement le paiement en ligne des rendez-vous plutôt que conserver le routage Connect incorrect ;
- conserver un seul processus web et un seul worker cron ;
- ouvrir d'abord en préproduction protégée, jamais directement avec Stripe live.

## Checklist finale GO

Le lancement est autorisé seulement quand :

- [ ] tous les P0 sont corrigés et testés ;
- [ ] aucun compte existant n'est accessible via une réservation invitée ;
- [ ] aucune mutation financière n'est appelable hors webhook signé/action autorisée ;
- [ ] tous les paiements en ligne arrivent au compte Stripe de Marie ;
- [ ] le fuseau Europe/Brussels est testé ;
- [ ] le build réussit sans DB/Instagram ;
- [ ] la livraison est désactivée ou entièrement homologuée ;
- [ ] identité légale et salon complètes ;
- [ ] secrets et mots de passe prod uniques et rotatés ;
- [ ] deux sauvegardes/restaurations testées ;
- [ ] UAT Stripe test signé ;
- [ ] monitoring et procédure de remboursement manuel disponibles ;
- [ ] `npm audit` est résolu ou fait l'objet d'une acceptation formelle et limitée.

## Limites de cet audit

Audit réalisé par lecture du code, compilation, contrôles automatisés, consultation npm et requêtes DB en lecture seule. Aucun paiement réel, attaque destructive, test de charge, pentest externe complet, revue juridique professionnelle ou restauration de backup n'a été effectué. Ces opérations restent nécessaires avant le GO final.
