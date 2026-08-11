# Meri Beauty — Full-Stack Production Reality

**Date :** 9 août 2026  
**Objectif :** distinguer ce qui est codé de ce qui est réellement exploitable en production, définir ce qui bloque le lancement, et couvrir tous les écarts sans construire une infrastructure inutilement complexe.

Ce document complète `PRE_HOSTING_COMPLETE_AUDIT_2026-08-09.md`. L'audit principal décrit les défauts précis ; celui-ci donne la carte globale du produit et de son infrastructure.

## Lecture des statuts

| Statut | Sens |
|---|---|
| ✅ Construit | Présent et globalement fonctionnel ; des tests finaux peuvent rester nécessaires |
| 🟠 Partiel | Présent, mais insuffisant ou non homologué pour la production |
| ❌ Absent | Aucun mécanisme opérationnel vérifié |
| ⏸ Différable | Utile plus tard, mais inutile pour un lancement à faible trafic |

## Résumé de décision

Meri Beauty est **une application métier presque complète**, mais pas encore **un service de production complet**.

- Le frontend, les parcours métier, PostgreSQL, Prisma, Stripe test, les e-mails et les espaces par rôle sont largement construits.
- La sécurité des actions serveur, la validation de certaines règles métier et la destination de certains paiements comportent encore des P0.
- Le déploiement reproductible, la CI, le monitoring, les sauvegardes/restaurations et le stockage durable des médias ne sont pas finalisés.
- Kubernetes, plusieurs serveurs, un load balancer dédié et un CDN avancé ne sont pas nécessaires pour le lancement du salon.

## 1. Frontend — ✅ largement construit, 🟠 à homologuer

### Construit

- site public responsive avec accueil, services, boutique, contact et contenu commercial ;
- parcours de réservation de rendez-vous ;
- parcours ateliers et formations avec listes d'attente ;
- boutique, panier, checkout, commandes et retours ;
- authentification, inscription, vérification e-mail et réinitialisation du mot de passe ;
- espace client ;
- dashboards ADMIN et STAFF ;
- gestion des produits, stock, services, horaires, fermetures, rendez-vous, factures, contrats, newsletters et promotions ;
- pages d'erreur, chargements et notifications utilisateur ;
- SEO et données structurées déjà travaillés.

### Partiel ou manquant

- recette complète mobile/tablette et multi-navigateur non documentée ;
- accessibilité WCAG non auditée ;
- Mondial Relay ne fonctionne pas encore de manière homologuée ;
- 14 usages `<img>` restent signalés par ESLint ;
- favicon/manifest/icônes et quelques contenus/orthographes de marque restent à terminer ;
- comportements hors ligne, connexion lente et erreurs d'intégrations externes peu testés.

### Pourquoi cela compte

Le frontend est le produit visible. Un défaut de livraison, de paiement ou de réservation produit directement une commande incorrecte, une perte de confiance ou une charge manuelle pour Marie. L'accessibilité et les optimisations d'image sont importantes, mais moins urgentes que la sécurité et l'argent.

**Priorité :** P0 pour checkout/réservation ; P1 pour mobile et erreurs ; P2 pour finition visuelle.

## 2. APIs et logique backend — 🟠 riche mais pas encore sûre

### Construit

- Server Actions et routes API pour toutes les fonctions métier principales ;
- validation Zod sur de nombreux formulaires ;
- transactions Prisma et contraintes de concurrence sur plusieurs flux sensibles ;
- webhooks Stripe ;
- calculs de prix, TVA, promotions, stock et facturation ;
- rappels, expirations et notifications planifiés ;
- génération de PDF, QR codes et e-mails transactionnels.

### Partiel ou manquant

- certains helpers internes sont exportés comme Server Actions et peuvent être invoqués comme des endpoints publics ;
- certaines actions historiques STAFF/Stripe/cron/broadcast n'appliquent pas toutes une autorisation locale ;
- les réservations ne prouvent pas toujours côté serveur que le créneau soumis appartient aux disponibilités réelles ;
- `isManualMode` fourni par le navigateur influence une règle de paiement ;
- les remboursements n'ont ni état durable de retry ni idempotence complète ;
- les contrats d'entrée/sortie des endpoints ne sont pas tous uniformisés ;
- aucune documentation API ni inventaire automatisé des actions exposées.

### Pourquoi cela compte

Le navigateur appartient à l'utilisateur : toute valeur envoyée peut être falsifiée. Une interface qui cache un bouton ne protège pas l'action derrière ce bouton. Les opérations financières doivent également survivre aux délais Stripe, doubles webhooks et redémarrages.

**Priorité : P0.** C'est un blocage avant exposition publique.

## 3. Base de données et stockage — 🟠 bonne base, exploitation incomplète

### Construit

- PostgreSQL 16 et Prisma ;
- schéma métier étendu et 43 migrations appliquées ;
- relations pour utilisateurs, staff, services, rendez-vous, produits, commandes, paiements, factures, ateliers et formations ;
- contraintes personnalisées anti-chevauchement, stock non négatif et source unique de paiement ;
- base live contrôlée sans incohérence comptable détectée au moment de l'audit ;
- Prisma Client partagé.

### Partiel ou manquant

- aucune contrainte DB garantissant un unique `Salon` ;
- pas d'audit complet des annulations de rendez-vous ;
- `RentalRequest` n'est pas relié au `Contract` produit ;
- pas de contrainte unique sur certains horaires/contrats actifs ;
- contraintes arithmétiques et valeurs positives encore incomplètes ;
- stratégie de migration production/rollback non automatisée ;
- aucune preuve de sauvegarde récurrente ni de restauration testée ;
- 117 Mo/45 fichiers sont stockés dans `public/uploads` sur disque local ;
- absence de stockage objet durable pour les médias ;
- timezone métier Europe/Brussels non appliquée de bout en bout.

### Pourquoi cela compte

Une base correcte aujourd'hui ne garantit pas qu'elle restera correcte sous concurrence. Sans sauvegarde restaurable, une erreur humaine ou une panne disque peut supprimer commandes, rendez-vous et comptes. Les fichiers placés sur le disque d'une instance disparaissent lors d'un remplacement de serveur et empêchent une mise à l'échelle propre.

**Priorité :** P0 pour backup/restore, timezone et contraintes affectant réservation/argent ; P1 pour médias durables et autres contraintes.

## 4. Authentification et permissions — 🟠 construit avec une faille critique

### Construit

- Auth.js/NextAuth avec adapter Prisma ;
- mots de passe bcrypt ;
- rôles `ADMIN`, `STAFF` et `CUSTOMER` ;
- middleware de session et protection des zones dashboard ;
- vérification d'e-mail et récupération de mot de passe ;
- invalidation périodique des sessions ;
- helpers d'autorisation réutilisables.

### Partiel ou manquant

- le mécanisme d'auto-login peut émettre un accès pour un compte existant trouvé par e-mail/téléphone ;
- plusieurs actions sensibles ne répètent pas l'autorisation au point de mutation ;
- pas de MFA pour ADMIN ;
- mots de passe de démonstration encore reconnaissables dans la base contrôlée ;
- pas de matrice RBAC testée action par action ;
- sessions et cookies à revalider sur le vrai domaine HTTPS.

### Pourquoi cela compte

La faille d'auto-login peut devenir une prise de compte. Une vérification uniquement dans la navigation ou le layout ne suffit pas : chaque mutation doit vérifier l'identité, le rôle et la propriété de la ressource.

**Priorité : P0.** MFA peut être P1 juste après le lancement si les autres protections sont solides.

## 5. Hébergement et déploiement — ❌ non finalisé

### Construit ou préparé

- application compatible avec `next build` / `next start` ;
- documentation de lancement et cible OVH/PM2 évoquée ;
- script de configuration PostgreSQL LAN ;
- headers CSP, HSTS en production, anti-frame et nosniff ;
- variables locales et secrets hors Git.

### Partiel ou manquant

- aucun fichier versionné PM2/systemd, Nginx, Docker ou plateforme de déploiement ;
- domaine final, DNS, TLS, reverse proxy et limites d'upload non vérifiés ;
- pas de `/api/health` testant au minimum processus et DB ;
- pas de procédure reproductible de première installation, migration, restart et rollback ;
- build de production actuellement en échec lorsqu'Instagram expire ;
- variables de production, Stripe live et webhooks live non configurés/validés ;
- PostgreSQL a été ouvert au LAN pour l'audit ; en production il doit rester privé et filtré.

### Pourquoi cela compte

“Ça marche avec `npm run dev`” ne prouve pas que l'application redémarre après un reboot, renouvelle HTTPS, exécute ses migrations au bon moment ou revient à la version précédente après un déploiement cassé.

**Priorité : P0 avant le 13 août.**

## 6. Cloud et compute — 🟠 décision simple à formaliser

### Construit ou disponible

- l'application peut fonctionner comme un serveur Node unique avec PostgreSQL ;
- les tâches périodiques peuvent tourner dans le processus Node ;
- architecture suffisante pour le trafic initial attendu d'un salon local.

### Partiel ou manquant

- dimensionnement CPU/RAM/disque non mesuré ;
- aucun environnement staging séparé et reproductible ;
- aucune surveillance disque/mémoire/CPU ;
- responsabilité exacte du serveur, de PostgreSQL, des backups et des mises à jour OS non formalisée ;
- les jobs démarrent dans chaque processus Node, ce qui interdit le clustering sans les rendre atomiques ou séparer un worker.

### Pourquoi cela compte

Un VPS unique est acceptable au lancement, mais seulement s'il est surveillé, sauvegardé et redémarre automatiquement. Ajouter des instances sans traiter les jobs et le stockage local créerait des doubles e-mails, doubles traitements et fichiers incohérents.

**Priorité :** P0 pour un VPS fiable et un seul worker ; ⏸ pour autoscaling/cloud complexe.

## 7. CI/CD et version control — 🟠 Git existe, CI/CD absent

### Construit

- dépôt Git avec remote GitHub ;
- historique de migrations Prisma ;
- scripts `build` et `lint` ;
- TypeScript configuré ;
- secrets principaux ignorés par Git.

### Partiel ou manquant

- aucune GitHub Action trouvée ;
- aucun script `test` dans `package.json` ;
- une seule petite suite de tests connue ;
- pas de branche protégée, revue obligatoire ou statut CI vérifié ;
- pas de déploiement automatique vers staging/production ;
- migrations et rollback non intégrés au pipeline ;
- pas de scan dépendances/secrets automatisé ;
- aucun artefact de build immuable ni version de release.

### Pourquoi cela compte

Sans CI, une correction urgente peut casser le build ou réintroduire une faille juste avant le lancement. Sans déploiement reproductible, le serveur peut différer du dépôt et un rollback devient lent et risqué.

**Priorité :** P0 pour une CI minimale ; P1 pour CD automatique complet.

## 8. Sécurité et RLS — 🟠 sécurité applicative présente, RLS absent

### Construit

- autorisation applicative par rôles ;
- validations Zod ;
- protections HTTP CSP/HSTS/frame/nosniff/referrer/permissions ;
- webhooks Stripe signés ;
- secrets non suivis dans Git selon l'audit ;
- plusieurs contraintes DB défensives.

### Partiel ou manquant

- défauts critiques d'autorisation et d'auto-login décrits plus haut ;
- aucune Row-Level Security PostgreSQL ;
- compte DB applicatif et privilèges minimaux non audités ;
- pas de rotation documentée des secrets ;
- pas de SRI pour les scripts tiers Mondial Relay/jQuery ;
- uploads validés principalement par métadonnées/MIME déclarés ;
- pas de pentest externe, DAST ou scan SAST en CI ;
- conformité RGPD opérationnelle incomplète : export, suppression/anonymisation, rétention.

### RLS : important ou non ?

La RLS est **utile mais pas obligatoire au lancement** pour cette architecture, car seul le serveur Prisma doit accéder à PostgreSQL et les clients ne parlent pas directement à la base. Elle devient prioritaire si la DB est exposée via une API directe, si plusieurs applications utilisent le même compte DB, ou si l'on veut une défense supplémentaire contre une erreur d'autorisation Prisma.

Avant RLS, il faut corriger les actions serveur, fermer la DB au réseau public et appliquer le moindre privilège au compte PostgreSQL.

**Priorité :** P0 pour les failles applicatives et secrets ; P1/P2 pour RLS selon l'architecture retenue.

## 9. Rate limiting — 🟠 présent mais local au processus

### Construit

- limiteur en mémoire avec nettoyage des clés expirées ;
- utilisé sur login, inscription, reset, vérification d'e-mail, contact, TVA, listes d'attente et certains checkouts invités.

### Partiel ou manquant

- les compteurs disparaissent au redémarrage ;
- chaque instance possède ses propres compteurs ;
- toutes les actions sensibles ne sont pas couvertes ;
- pas de limite globale au reverse proxy/CDN ;
- pas de protection progressive, blocage distribué ou alerte d'abus ;
- lookup de retour par numéro+e-mail insuffisamment protégé.

### Pourquoi cela compte

Il limite mal le brute force et l'abus d'e-mails lorsque plusieurs processus existent. Pour un serveur unique, il constitue une première défense mais pas une garantie.

**Priorité :** P0 pour couvrir auth/actions sensibles ; P1 pour Redis/stockage partagé avant scaling.

## 10. Caching et CDN — 🟠 primitives Next présentes, stratégie absente

### Construit

- cache et revalidation natifs de Next utilisés (`revalidatePath`) ;
- optimisation d'images Next configurée pour plusieurs origines ;
- fichiers statiques servis par Next et cache navigateur standard.

### Partiel ou manquant

- pas de politique documentée par route/donnée ;
- pas de CDN explicitement configuré ;
- pas de cache partagé/Redis ;
- médias locaux et Wix/Instagram externes créent des dépendances de disponibilité ;
- Instagram peut faire échouer le build au lieu d'utiliser un cache/fallback ;
- aucune mesure du cache hit ratio ou des requêtes lentes.

### Pourquoi cela compte

Le cache améliore vitesse et coût, mais mettre en cache des disponibilités, stocks ou sessions incorrectement est dangereux. Il faut d'abord rendre les données dynamiques critiques correctes, puis optimiser les pages publiques.

**Priorité :** P0 pour le fallback Instagram ; P2 pour CDN/cache avancé au trafic initial.

## 11. Load balancing et scaling — ⏸ non construit et non nécessaire maintenant

### Construit

- rien de spécifique ; l'application vise actuellement un processus principal.

### Manquant

- load balancer ;
- autoscaling horizontal ;
- sessions/jobs/rate limits distribués ;
- stockage partagé ;
- tests de charge et limites de capacité ;
- stratégie de connexion PostgreSQL/pooling sous plusieurs instances.

### Pourquoi cela compte plus tard

Avec plusieurs instances, les jobs et rate limits actuels se dupliquent et les uploads locaux divergent. Cependant, le trafic initial d'un salon ne justifie probablement pas cette complexité.

**Décision recommandée :** lancer avec **un serveur Node + un worker logique unique + PostgreSQL privé**, mesurer, puis scaler verticalement. Ajouter un load balancer seulement lorsque les mesures montrent un besoin ou qu'une haute disponibilité stricte est exigée.

**Priorité : ⏸ différable.** Faire un test de charge simple reste P1.

## 12. Error tracking et logs — ❌ insuffisant

### Construit

- pages/limites d'erreur Next ;
- logs `console.*` ;
- certains échecs importants déclenchent un e-mail ;
- logs PM2 prévus dans la documentation de lancement.

### Partiel ou manquant

- aucun Sentry ou équivalent ;
- logs non structurés, sans request/correlation ID ;
- pas de centralisation ni politique de rétention ;
- aucune alerte vérifiée pour erreur 5xx, webhook, remboursement, cron ou DB ;
- pas de métriques métier : paiements attendus/reçus, commandes bloquées, holds expirés, e-mails en erreur ;
- pas de tableau de santé ni suivi de performance.

### Pourquoi cela compte

Sans observabilité, le premier signal d'une panne sera un client. Une erreur de remboursement seulement écrite dans la console peut être perdue après rotation ou crash.

**Priorité : P0** pour capture d'erreurs, alertes critiques et logs persistants ; P1 pour dashboards avancés.

## 13. Availability et recovery — ❌ non prouvé

### Construit

- PM2 est envisagé pour redémarrer Node ;
- certaines opérations métier sont transactionnelles et idempotentes ;
- des copies de configuration PostgreSQL ont été créées par le script LAN.

### Partiel ou manquant

- pas de healthcheck opérationnel ;
- pas de backup DB automatique vérifié ;
- pas de sauvegarde des uploads ;
- aucune restauration testée sur base vide ;
- pas de RPO/RTO défini ;
- pas de procédure incident, rollback, maintenance ou remboursement manuel ;
- dépendances externes non systématiquement protégées par timeout/fallback ;
- serveur unique sans failover.

### Pourquoi cela compte

Un backup non restauré n'est qu'une hypothèse. Il faut savoir combien de données peuvent être perdues (RPO) et combien de temps le site peut être arrêté (RTO). Pour ce lancement, un serveur unique est acceptable si la restauration est testée et rapide.

**Priorité : P0** pour backup/restore, healthcheck et runbook ; ⏸ pour failover automatique multi-région.

## Éléments importants absents de la liste initiale

### 14. Paiements, comptabilité et rapprochement — 🟠 critique

**Construit :** Stripe Checkout, Bancontact côté code, webhooks, paiements partiels/finaux, factures, notes de crédit, remboursements et transactions internes.

**Manque :** faire arriver tous les flux sur le compte de Marie, idempotence complète des remboursements, états `REFUND_PENDING/FAILED`, retry durable, référence Stripe unique, journal bénéficiaire et procédure quotidienne de rapprochement Stripe ↔ DB ↔ banque.

**Pourquoi :** un site peut répondre 200 tout en perdant financièrement de l'argent. C'est la surface la plus importante avec l'authentification.

**Priorité : P0.**

### 15. Jobs, queues et e-mails — 🟠 construit sans garantie distribuée

**Construit :** Resend, modèles d'e-mails, rappels, expirations de commandes et notifications, scheduler toutes les cinq minutes.

**Manque :** file durable/outbox, retry, déduplication atomique partout, propriétaire unique du scheduler, statut réel d'envoi, alerte sur dead letters et désinscription newsletter signée en un clic.

**Pourquoi :** un crash entre la mise à jour DB et l'e-mail peut perdre un message ; plusieurs processus peuvent envoyer des doublons.

**Priorité :** P0 pour paiements/rappels indispensables ; P1 pour queue complète.

### 16. Tests et assurance qualité — ❌ couverture insuffisante

**Construit :** lint, vérification TypeScript, validation Prisma et un test automatisé existant.

**Manque :** tests unitaires significatifs, intégration DB, tests RBAC/IDOR, E2E navigateur, webhooks rejoués/concurrents, tests de fuseau/DST, charge, UAT Stripe et parcours de restauration.

**Pourquoi :** les corrections rapides par IA augmentent la vitesse mais aussi le risque de régression. Les tests sont la preuve que les correctifs coexistent.

**Priorité : P0** pour tests ciblés des flux critiques ; P1/P2 pour couverture large.

### 17. Intégrations externes — 🟠 plusieurs dépendances non homologuées

**Construit :** Stripe, Resend, Instagram, VIES/TVA, Mondial Relay, cartes/tiles et médias Wix.

**Manque :** secrets et webhooks live, timeouts/retries/fallbacks cohérents, homologation Mondial Relay, vérification Bancontact dans Stripe Dashboard et modes dégradés.

**Pourquoi :** une API externe peut être lente ou indisponible sans que tout le site doive tomber. Le build Instagram démontre déjà ce risque.

**Priorité :** P0 pour Stripe et build ; désactiver Mondial Relay au lancement s'il n'est pas prêt.

### 18. Données, RGPD et contenu légal — 🟠 incomplet

**Construit :** pages légales/confidentialité et modèle utilisateur.

**Manque :** identité complète du salon dans la DB/pages, politique de rétention exécutée, export/suppression/anonymisation, registre des sous-traitants/cookies et validation juridique finale.

**Pourquoi :** les factures, communications et obligations belges/européennes doivent identifier correctement l'entreprise et traiter les demandes des personnes.

**Priorité :** P0 pour identité/facturation/consentements essentiels ; P1 pour automatisation RGPD complète.

### 19. Exploitation métier — ❌ procédure à écrire

**Manque :** propriétaire de chaque alerte, rapprochement quotidien, traitement des paiements sur place, remboursement manuel, support client, gestion d'une réservation bloquée, fermeture d'urgence et calendrier de maintenance.

**Pourquoi :** certaines pannes ne se résolvent pas par du code. Marie doit savoir quoi vérifier et qui appeler.

**Priorité : P0** sous forme d'un runbook court.

## Ce qui est important pour le 13 août

### Obligatoire avant trafic public et Stripe live

1. fermer l'auto-login et toutes les actions serveur non autorisées ;
2. valider les créneaux et prix exclusivement côté serveur ;
3. centraliser tous les paiements chez Marie ;
4. rendre webhooks/remboursements idempotents avec état de retry ;
5. corriger le build Instagram et obtenir un build reproductible ;
6. déployer HTTPS avec secrets prod, webhook live et DB privée ;
7. ajouter healthcheck, Sentry/logs persistants et alertes critiques ;
8. automatiser puis tester la restauration DB et médias ;
9. remplacer les comptes/mots de passe de démonstration ;
10. réaliser UAT des parcours rendez-vous, boutique, paiement, annulation et remboursement.

### Peut être désactivé ou réduit pour respecter la date

- Mondial Relay/livraison : retrait salon uniquement ;
- ateliers/formations : rester non publiés ;
- Stripe Connect STAFF : désactivé si tout doit revenir à Marie ;
- newsletter en masse : envoi manuel limité ;
- uploads admin : gelés ou copiés manuellement tant que le stockage objet n'est pas prêt.

### Peut attendre après le lancement

- RLS PostgreSQL si la DB reste privée derrière Prisma ;
- Redis/cache distribué ;
- CDN avancé ;
- load balancer et autoscaling ;
- Kubernetes, multi-région et failover automatique ;
- couverture de tests exhaustive, tant que les flux P0 ont des tests ciblés ;
- nettoyage de l'enum `Language` et autres dettes sans impact utilisateur.

## Plan pour couvrir tous les écarts

### Phase 0 — Réduction immédiate du périmètre (1 heure)

- décider officiellement : rendez-vous + boutique + retrait salon ;
- garder livraison, ateliers/formations et fonctionnalités non homologuées désactivés ;
- geler les nouvelles fonctionnalités jusqu'au GO ;
- nommer une personne technique et Marie comme responsables de validation.

### Phase 1 — Sécurité et argent (jour 1)

- remplacer l'auto-login par un jeton aléatoire, mono-usage, expirant et réservé aux nouveaux CUSTOMER ;
- déplacer les helpers internes hors des modules `use server` ;
- ajouter auth + rôle + ownership + Zod à chaque mutation publique ;
- retirer `isManualMode` de la décision serveur ;
- valider chaque slot dans la même transaction que la réservation ;
- router tous les paiements vers le compte plateforme de Marie ;
- ajouter idempotence, références Stripe et état durable des remboursements ;
- corriger durée zéro et holds de rendez-vous sans expiration ;
- écrire des tests ciblés pour chaque correction.

### Phase 2 — Build et infrastructure minimale (jour 2 matin)

- rendre Instagram optionnel avec timeout, fallback et cache ;
- faire passer lint, types, Prisma, tests et build hors dépendances externes ;
- ajouter configuration versionnée PM2/systemd + Nginx ;
- configurer domaine, DNS, TLS, HSTS, taille d'upload et variables prod ;
- créer `/api/health` sans données sensibles ;
- garantir un seul propriétaire des jobs ;
- garder PostgreSQL privé/localhost ou réseau privé strict.

### Phase 3 — Données, observabilité et recovery (jour 2 après-midi)

- configurer Sentry ou équivalent et logs JSON persistants ;
- alerter sur 5xx, DB, webhooks, remboursements et jobs ;
- sauvegarder automatiquement PostgreSQL et `public/uploads` ;
- restaurer les deux sur un environnement vide et noter la durée ;
- écrire rollback, incident, remboursement manuel et rapprochement quotidien ;
- remplir identité légale/salon et faire tourner tous les secrets/mots de passe.

### Phase 4 — Recette et lancement contrôlé (12 août)

- exécuter les scénarios RBAC/IDOR et tentatives d'accès direct aux Server Actions ;
- tester Stripe test : succès, refus, doublon, webhook rejoué, annulation et remboursement ;
- tester créneaux hors horaires, passé, fermeture, congé, conflit et DST ;
- tester mobile, Safari/Chrome/Firefox, e-mails et PDFs ;
- faire un test de charge léger et vérifier DB/CPU/RAM ;
- faire signer à Marie prix, destination des fonds, e-mails et parcours ;
- ne passer Stripe live qu'après validation de toute la checklist P0.

### Phase 5 — Après lancement, semaine 1

- surveiller erreurs et rapprochement quotidiennement ;
- migrer les uploads vers S3/R2/équivalent ;
- mettre le rate limit dans Redis ou PostgreSQL atomique ;
- mettre en place une outbox/queue durable pour e-mails et remboursements ;
- compléter tests E2E et intégration DB ;
- terminer RGPD, audit immuable et contraintes P1 ;
- homologuer Mondial Relay avant de réactiver la livraison.

### Phase 6 — Seulement lorsque la mesure le justifie

- CDN explicite et cache public optimisé ;
- pooling DB renforcé ;
- plusieurs instances Node ;
- load balancer/autoscaling ;
- séparation worker/web ;
- haute disponibilité PostgreSQL et failover.

## Architecture minimale recommandée au lancement

```text
Internet
   |
HTTPS / Nginx (rate limits simples, taille upload, logs)
   |
1 processus Next.js géré par PM2/systemd
   |-- Server Actions / API / Auth.js
   |-- 1 scheduler de jobs
   |
PostgreSQL privé

Services externes : Stripe + Resend
Surveillance : Sentry + uptime monitor
Backups : DB + médias vers stockage hors serveur
```

Cette architecture est volontairement simple. Elle permet de lancer vite sans introduire les problèmes distribués d'un cluster. Sa condition est d'avoir des sauvegardes restaurables, des alertes et un rollback.

## Définition finale de “production ready”

Le projet est prêt lorsque :

- le code critique est sécurisé et couvert par des tests ciblés ;
- chaque euro est traçable jusqu'au compte de Marie ;
- le build et le déploiement sont reproductibles ;
- le serveur redémarre seul et expose un healthcheck ;
- les erreurs importantes alertent une personne identifiable ;
- la DB et les médias peuvent être restaurés ;
- les fonctions non prêtes sont désactivées ;
- Marie a validé les parcours et dispose d'une procédure en cas d'incident.

