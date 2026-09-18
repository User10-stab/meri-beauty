# Retour arrière — Connect sur les activités

Procédure de secours pour la mise en production de la branche
`feat/connect-activites-animatrice` (PR #39), qui ajoute deux migrations :

| Migration | Contenu |
|---|---|
| `20260917150000_add_payment_payee_and_animator_staff` | colonnes `Payment.payeeStaffId`, `Payment.stripeAccountId`, `animators.staffId` |
| `20260918090000_backfill_payment_payee` | réattribue les paiements passés à leur propriétaire |

Les deux ont été **répétées sur une restauration réelle du dump de production**
le 18/09/2026 : `prisma migrate deploy` s'est appliqué proprement, sans conflit.

---

## 1. La sauvegarde

Prise avant la bascule, et **vérifiée par restauration effective** — pas
seulement par l'absence d'erreur de `pg_dump` :

- Sur le VPS : `/home/ubuntu/meristudio_backups/pre-connect-20260918-120718.dump`
- Copie hors serveur : `Desktop\meri-backups\pre-connect-20260918-120718.dump`

La copie locale compte, et pas seulement par prudence : les sauvegardes
automatiques vivent **uniquement sur le VPS**, donc une panne matérielle OVH
emporterait la base et ses sauvegardes ensemble
(`VPS_OPERATIONS_GUIDE.md`, § 4).

Avant toute bascule, en reprendre une fraîche — la nuit sépare celle-ci des
données du jour :

```bash
TS=$(date +%Y%m%d-%H%M%S)
sudo -u postgres pg_dump -Fc -d meristudio -f /tmp/pre-connect-$TS.dump
sudo mv /tmp/pre-connect-$TS.dump /home/ubuntu/meristudio_backups/
```

---

## 2. Ce que le retour arrière doit défaire

Les deux migrations sont **additives** : elles ne suppriment ni ne modifient
aucune colonne existante. Aucune donnée d'avant la bascule n'est écrasée — le
backfill ne fait qu'écrire dans `payeeStaffId`, qui était `NULL` partout.

**Conséquence importante : une restauration complète n'est presque jamais
nécessaire.** Supprimer les colonnes suffit, et c'est bien moins risqué que
réécrire toute la base — une restauration perdrait toute commande, tout
rendez-vous et tout paiement enregistrés depuis la sauvegarde.

### Option A — annuler le code, garder les colonnes (recommandé)

Si le problème vient du comportement de l'application et non du schéma :

```bash
# revenir au commit précédent la bascule, rebuild, redémarrer
cd /var/www/meribeauty && npm run build && pm2 restart meribeauty --update-env
pm2 jlist   # vérifier AUSSI ferracad et terramad-backend
```

Les colonnes restent en place mais plus personne ne les lit. Aucune perte.

### Option B — retirer aussi le schéma

```sql
BEGIN;
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_payeeStaffId_fkey";
DROP INDEX IF EXISTS "Payment_payeeStaffId_idx";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "payeeStaffId";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "stripeAccountId";

ALTER TABLE "animators" DROP CONSTRAINT IF EXISTS "animators_staffId_fkey";
DROP INDEX IF EXISTS "animators_staffId_key";
ALTER TABLE "animators" DROP COLUMN IF EXISTS "staffId";

DELETE FROM "_prisma_migrations"
 WHERE migration_name IN (
   '20260917150000_add_payment_payee_and_animator_staff',
   '20260918090000_backfill_payment_payee'
 );
COMMIT;
```

Cela **efface l'attribution** (les 185 € de Julie retournent dans les livres du
salon). C'est récupérable : le backfill est rejouable à l'identique, puisqu'il
se déduit des rendez-vous et des sessions, pas d'un état perdu.

### Option C — restauration complète

Dernier recours seulement, en cas de corruption réelle. **Tout ce qui a été
enregistré depuis la sauvegarde est perdu.**

```bash
sudo -u postgres createdb meristudio_restore
sudo -u postgres pg_restore -d meristudio_restore --no-owner --no-privileges \
  /home/ubuntu/meristudio_backups/pre-connect-<TS>.dump
# vérifier AVANT de basculer
sudo -u postgres psql -d meristudio_restore -c 'SELECT count(*) FROM "Payment";'
```

Puis basculer les noms de bases, et seulement après vérification.

---

## 3. Vérifier que la bascule s'est bien passée

```sql
-- doit rendre exactement 4 lignes, 185 €, toutes des rendez-vous de Julie
SELECT u."fullName", count(*), sum(p."paidAmount")
FROM "Payment" p
JOIN "Staff" s ON s.id = p."payeeStaffId"
JOIN "User"  u ON u.id = s."userId"
GROUP BY 1;

-- doivent rendre 0 toutes les deux
SELECT count(*) FROM "Payment" p LEFT JOIN "Invoice" i ON i."paymentId" = p.id
 WHERE p."payeeStaffId" IS NOT NULL
   AND (p."ticketNumber" IS NOT NULL OR i.id IS NOT NULL
        OR p."transactionReference" IS NOT NULL);

SELECT count(*) FROM "Payment"
 WHERE "payeeStaffId" IS NOT NULL
   AND ("formationReservationId" IS NOT NULL OR "workshopReservationId" IS NOT NULL);
```

Les 9 sessions à venir doivent toutes rester au salon (3 formations animées par
Marie, 6 ateliers). Si l'une d'elles pointe vers une indépendante, **arrêter** :
l'exemption de Marie n'a pas tenu.

---

## 4. Ce qui bloque encore une vraie bascule

- **Lyly Hannecart** — `stripeChargesEnabled = false`. Toute formation qu'elle
  animerait deviendrait non réservable en ligne.
- **Sabrina Favazza** — aucun compte Stripe.
- **Julie Schoemans** — compte Express, donc incapable de rembourser
  elle-même : soit elle ouvre un compte Standard, soit Marie le fait pour elle.

Aucun de ces points n'est un risque le premier jour : aucune des trois n'anime
de session à venir.
