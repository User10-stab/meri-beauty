# Guide d'exploitation du VPS — Meri Beauty

Ce document explique comment fonctionne le serveur qui héberge
meribeautystudio.com : comment déployer une nouvelle version du code,
comment sont gérées les sauvegardes automatiques, et comment surveiller
que tout va bien (PM2, Sentry, disque, base de données).

Écrit après l'incident du 13/08/2026 où un déploiement a semblé réussir
alors que le nouveau code n'avait en réalité jamais atteint le serveur —
voir la Section 3 pour comprendre pourquoi et comment l'éviter.

---

## 1. Vue d'ensemble du serveur

Le VPS (OVH, IP `51.75.205.36`) est **partagé entre 4 applications
différentes**, pas seulement Meri Beauty :

| App | Dossier | Process PM2 |
|---|---|---|
| Meri Beauty (ce projet) | `/var/www/meribeauty` | `meribeauty` |
| ferracad | `/var/www/ferracad-backend` | `ferracad` |
| terramad-backend | `/var/www/terramad-backend` | `terramad-backend` |
| dalytrac | — | (géré séparément, cron dédié) |

**Règle d'or : après toute action sur le serveur (redémarrage, build,
migration...), toujours vérifier que les 3 autres apps tournent encore**
(`pm2 jlist` — voir Section 5). Une erreur sur Meri Beauty ne doit jamais
faire tomber les projets des autres clients hébergés sur la même machine.

Composants techniques :
- **Node.js 20**, application Next.js lancée via `npm start` sous PM2.
- **PostgreSQL 16** en local sur le serveur (base réelle : `meristudio` —
  ce n'est **pas** Neon, qui n'est utilisé qu'en développement).
- **Nginx** en reverse proxy devant les 4 apps, avec certificats HTTPS
  Let's Encrypt (renouvellement automatique déjà configuré via `certbot`,
  rien à faire manuellement).
- **4 Go de swap** configurés (`/swapfile`) — nécessaire car la RAM
  physique (3,7 Go, partagée entre les 4 apps) ne suffit pas toujours pour
  compiler (`npm run build`) sans ça ; sans le swap, le build peut être tué
  par le système (erreur "out of memory").

Accès SSH : voir `ssh.txt` sur le Bureau. Ne jamais partager ce fichier ni
son contenu en dehors de ce cadre.

---

## 2. Variables d'environnement (`.env` sur le serveur)

Le fichier `.env` du serveur (`/var/www/meribeauty/.env`) n'est **pas**
dans le dépôt Git — il contient les vrais secrets de production (clés
Stripe, base de données, Sentry, etc.) et doit le rester.

Point important à connaître, il évite des rebuilds inutiles :

- **Variables serveur uniquement** (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `SENTRY_DSN`, `DATABASE_URL`, `RESEND_API_KEY`...) :
  lues en direct par le serveur à chaque requête. Un simple
  `pm2 restart meribeauty --update-env` suffit après les avoir modifiées —
  **pas besoin de rebuild**.
- **Variables `NEXT_PUBLIC_*`** (`NEXT_PUBLIC_SENTRY_DSN`,
  `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID`...) : intégrées "en dur" dans le
  code envoyé au navigateur au moment du `npm run build`. Les modifier
  **nécessite un vrai rebuild** (Section 3) pour que le changement soit
  visible côté client.

---

## 3. Déployer une nouvelle version du code

**Point essentiel à comprendre : le dossier `/var/www/meribeauty` sur le
serveur n'est pas un dépôt Git.** Le code y a été déposé par transfert de
fichiers (archive tarball), pas par `git clone`. Conséquence directe :
`git pull` ne fonctionne pas là-bas et **ne préviendra jamais que le
serveur a du retard sur GitHub**. C'est exactement ce qui s'est passé le
13/08 : un script de déploiement a lancé `git pull` en pensant mettre le
code à jour, la commande a échoué silencieusement (pas de `.git`), et le
build suivant a recompilé... l'ancien code. Le correctif n'a été réellement
appliqué qu'au 2ᵉ essai, en transférant le fichier directement.

**Procédure de déploiement fiable, étape par étape :**

1. **Développer et tester en local** (`npm run dev`, puis idéalement
   `npm run build` en local pour repérer les erreurs de compilation avant
   d'aller sur le serveur).
2. **Committer et pousser sur GitHub** (`git push origin master`) — sert de
   sauvegarde du code et d'historique, même si le serveur ne l'utilise pas
   directement aujourd'hui.
3. **Transférer les fichiers modifiés sur le VPS.** Le SFTP classique est
   bloqué sur ce serveur ; le transfert se fait par SSH (base64 sur le
   canal de commande, pour un ou quelques fichiers) ou par archive tarball
   complète pour une mise à jour plus large.
4. **Si des fichiers ont été supprimés ou renommés côté code** : une
   extraction d'archive (`tar xzf`) est **additive uniquement** — elle
   n'efface jamais un fichier qui existe sur le serveur mais plus dans le
   nouveau code. Il faut alors comparer manuellement `git ls-files` (en
   local) avec un `find` côté serveur pour repérer et supprimer les
   fichiers orphelins. C'est déjà arrivé une fois (fichiers liés à
   l'ancienne version de Next.js).
5. **Si `package.json` a changé** : `npm install` sur le serveur.
6. **Si le schéma de base de données a changé** (`prisma/schema.prisma`) :
   - `npx prisma migrate status` pour vérifier l'état.
   - **Toujours faire une sauvegarde fraîche avant** (`pg_dump`, voir
     Section 4 — au-delà de la sauvegarde automatique nocturne, une
     sauvegarde juste avant une migration est une sécurité supplémentaire).
   - `npx prisma migrate deploy`.
7. **Rebuild** : `npm run build`. C'est l'étape qui peut échouer par
   manque de mémoire (déjà réglé grâce au swap) — si elle échoue quand
   même, vérifier `free -h` et `df -h` avant de recommencer.
8. **Redémarrer l'application** : `pm2 restart meribeauty --update-env`.
9. **Vérifier** : `pm2 jlist` pour confirmer que `meribeauty` est bien
   `online` **et** que `ferracad`/`terramad-backend` le sont toujours
   aussi. Puis un vrai test dans le navigateur sur le site en production.

**Piste d'amélioration, pas faite aujourd'hui :** transformer
`/var/www/meribeauty` en vrai dépôt Git (`git clone` une fois, puis
`git pull` à chaque déploiement) supprimerait tout ce risque de transfert
manuel incomplet. C'est un changement ponctuel simple à faire quand vous
voudrez — dites-le-moi et je m'en occupe.

---

## 4. Base de données — sauvegardes automatiques

**Bonne nouvelle : les sauvegardes automatiques existent déjà et
fonctionnent.** Le détail complet (script, procédure de restauration testée
réellement, avec vérification des données) est dans
[`BACKUP_RESTORE_RUNBOOK.md`](BACKUP_RESTORE_RUNBOOK.md) à la racine du
projet — ce qui suit est le résumé pratique.

- **Script** : `/home/ubuntu/meristudio_backup.sh` sur le VPS.
- **Fréquence** : tous les jours à 3h du matin (heure serveur, UTC).
- **Ce qui est sauvegardé** : uniquement la vraie base `meristudio` (celle
  utilisée par l'app) — pas les autres bases présentes sur le même
  serveur Postgres (`old_app_backup`, `terramad`, etc., qui appartiennent
  à d'autres projets ou sont des restes non liés à Meri Beauty).
- **Conservation** : 14 jours glissants, les sauvegardes plus anciennes
  sont supprimées automatiquement.
- **Emplacement** : `/home/ubuntu/meristudio_backups/` sur le VPS.
- **Restauration** : procédure testée pour de vrai (vérifiée ligne par
  ligne, pas juste "sans erreur") — voir `BACKUP_RESTORE_RUNBOOK.md`.

**Lacunes connues, non traitées à ce jour :**
- Les sauvegardes restent **uniquement sur le même serveur**. Si le VPS
  entier est perdu (panne matérielle grave, incident OVH), les sauvegardes
  disparaissent avec le reste. Une copie régulière vers un stockage
  externe (ex. OVH Object Storage) réglerait ça — nécessite de choisir la
  destination avant de la mettre en place.
- **Les fichiers uploadés** (photos produits/services ajoutées via le
  dashboard, dans `public/uploads`) **ne sont pas sauvegardés du tout**
  aujourd'hui — seule la base de données l'est.
- Le rythme actuel (une fois par jour) donne jusqu'à 24h de données
  potentiellement perdues en cas de pépin juste avant la prochaine
  sauvegarde. C'était un choix assumé tant qu'il n'y avait pas de vraies
  commandes/paiements ; à revoir maintenant que le site reçoit de vrais
  achats — passer à toutes les 6h est un changement simple (une ligne de
  configuration) si vous le souhaitez.

---

## 5. PM2 — gérer l'application qui tourne

PM2 est l'outil qui garde l'application Next.js démarrée en permanence
(la relance automatiquement si elle plante, la redémarre si le serveur
redémarre).

Commandes utiles (à lancer en SSH sur le serveur) :

```bash
pm2 jlist                          # état des 4 apps (en JSON)
pm2 restart meribeauty --update-env   # redémarrer Meri Beauty en relisant le .env
pm2 logs meribeauty --lines 100    # voir les 100 dernières lignes de logs
pm2 monit                          # CPU/RAM en direct, toutes les apps
```

**Redémarrage automatique au reboot du serveur** : déjà configuré
(`pm2 save` + service système `pm2-ubuntu` activé). Si le VPS redémarre
pour une raison quelconque (maintenance OVH, panne...), les 4 applications
repartent seules, sans intervention.

---

## 6. Monitoring — savoir si quelque chose ne va pas

### Sentry (erreurs de l'application)

Sentry capture automatiquement :
- les erreurs qui se produisent dans le navigateur des visiteurs (JS côté
  client),
- les erreurs côté serveur (pages, actions, API).

Consultable dans le dashboard Sentry du compte associé au DSN configuré.
Depuis le 13/08, les rapports d'erreur passent par une route interne au
site (`/monitoring`) plutôt que d'appeler directement les serveurs Sentry —
ça évite que les bloqueurs de publicité des visiteurs empêchent l'envoi des
rapports (c'était le cas avant ce correctif).

**Ce qui n'est pas configuré aujourd'hui** : aucune alerte automatique
(email, etc.) quand une nouvelle erreur apparaît — il faut aller consulter
le dashboard Sentry pour le savoir. Une alerte par email en cas d'erreur
répétée serait un réglage utile à faire directement dans les paramètres du
projet Sentry (pas une modification de code).

### Santé générale du serveur

```bash
df -h      # espace disque (actuellement ~72% utilisé, 11 Go libres)
free -h    # RAM et swap (3,7 Go RAM + 4 Go swap au total)
```

**Ce qui n'est pas configuré aujourd'hui** : aucun outil externe qui
vérifie que le site répond (type UptimeRobot) — en cas de panne complète
du serveur, personne n'est prévenu automatiquement, le premier signal
serait un client qui ne peut plus accéder au site. Un outil de ce type est
gratuit pour un usage basique et rapide à mettre en place si vous voulez
être alerté avant vos clients.

---

## 7. Résumé des points à décider (rien d'urgent, à votre rythme)

- [ ] Transformer le déploiement en vrai dépôt Git sur le serveur (évite
      les erreurs de transfert manuel comme celle du 13/08).
- [ ] Copier les sauvegardes de base de données vers un stockage externe
      au VPS.
- [ ] Mettre en place une sauvegarde des fichiers uploadés
      (`public/uploads`).
- [ ] Passer les sauvegardes de la base à un rythme plus fréquent (6h) une
      fois que de vraies commandes/paiements sont réguliers.
- [ ] Activer une alerte email dans Sentry en cas d'erreur.
- [ ] Ajouter un contrôle externe de disponibilité du site (type
      UptimeRobot).

Aucun de ces points ne bloque le fonctionnement actuel — ce sont des
renforcements à faire quand vous le déciderez.
