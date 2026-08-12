# Spécification — Facturation B2C/B2B, TVA et Peppol

# Important \-\>(Peppol Keep it till later)

Here's the setup and scope to paste into the other session:

**Setup:** Open the other Claude Code session in /home/yzz/Desktop/meri-beauty-invoicing-b2b (already created as a git worktree, branch marwane-invoicing-b2b, node\_modules and .env\* already copied in). It should NOT touch /home/yzz/Desktop/meri-beauty-invoicing-core — that's this session's worktree.

**Context to paste in:**

> Read /home/yzz/Desktop/meri-beauty/INVOICING\_TAX\_PEPPOL\_IMPLEMENTATION\_SPEC.md first. We're building **Phase A only** (launch blockers) — no live Peppol, no OSS activation, no per-line multi-VAT-rate mixing, no accounting-rate changes; those need accountant/provider sign-off first per the spec's own "Décisions métier à obtenir avant développement" section.

> Two sessions are splitting this. The other session (schema owner) is adding, on its own branch, fields you'll depend on — don't redefine them, just use them once merged:

> * prisma/schema.prisma: new BillingProfile model (1:1 with User, fields: companyLegalName (required), companyRegistrationNo, companyLegalForm, billingContactName, purchaseOrderReference, peppolParticipantId, addressLine1 (required), addressLine2, postalCode (required), city (required), countryCode).  
> * Salon model gets legalName, companyRegistrationNo, addressLine1/2, postalCode, city, countryCode — the salon's own legal identity (not your concern, but issueInvoice will start throwing SellerLegalDataIncompleteError once these are required — see below).  
> * Invoice gets a customerType InvoiceCustomerType @default(B2C) enum field (B2C/B2B) plus optional B2B snapshot fields: customerLegalName, customerContactName, customerRegistrationNo, customerAddressLine1/2, customerPostalCode, customerCity, customerCountryCode, purchaseOrderReference.  
> * lib/invoicing.js's issueInvoice(tx, {...}) signature is unchanged for existing callers, but the customer object now optionally accepts isCompany, legalName, companyRegistrationNo, billingContactName, purchaseOrderReference, addressLine1/2, postalCode, city, countryCode — pass these (pulled from the buyer's BillingProfile) when issuing a B2B invoice; omitting them just produces a B2C invoice like today.

> **Your scope:**

> 1. **B2B legal-name/address capture** — build the UI/action for a company customer to fill in their BillingProfile (registration form for isCompany accounts, and a self-service edit page, similar to the existing address self-service in actions/customer/settings.js). Validate BCE/VAT format reuse from lib/vat-validation.js.  
> 2. **B2B invoice flow \+ manual-fallback gating** — at checkout/order/appointment invoice issuance, when the buyer isCompany, pass the enriched customer object (see above) to issueInvoice so customerType becomes B2B and the snapshot fields populate. Since there's no live Peppol yet (Phase B, not now), gate B2B orders so they're clearly flagged for **manual** Peppol-compatible-software invoicing by staff — e.g. a dashboard flag/badge "B2B — à facturer manuellement via \[logiciel comptable\]" rather than silently treating it like a B2C sale. Don't build any real Peppol network code.  
> 3. **Numbering-year Brussels-TZ fix** — lib/invoicing.js\#nextSequenceNumber currently does new Date().getFullYear() (server-local/UTC year) for the invoice/credit-note sequence key. Fix it to resolve the year in Europe/Brussels, so a sale placed between UTC midnight and Brussels midnight around New Year's doesn't get miscategorized into the wrong year's sequence (spec acceptance test: "Le numéro de facture utilise l'année de Bruxelles à minuit du Nouvel An").  
> 4. **Accounting CSV export scaffold** — a dashboard-admin-only export (invoices \+ credit notes for a date range) with the columns listed in spec §"Rapports comptables à construire": number, date, source, country, customer name/VAT/B2B-or-B2C, HT/TVA/TTC by rate, VAT treatment, payment method, Peppol status (will just be null/"N/A" until Phase B), Stripe/terminal/POS reference, discounts, net total after credit notes.

> Coordinate before merging — message this session before you touch prisma/schema.prisma yourself (schema is centrally owned here to avoid migration conflicts, same as the returns/payments split before). Same DB is shared between worktrees: always prisma migrate deploy, never migrate dev, and sync migration folders \+ schema.prisma between worktrees whenever either side adds a migration.

I'll keep working on the schema/B2C-correctness side in the meantime.

## But

Rendre la facturation de Meri Beauty fiable pour les ventes boutique, POS, rendez-vous, ateliers et formations : facture PDF lisible, données TVA figées, notes de crédit correctes, et factures B2B structurées via Peppol.

Ce document est une spécification de développement. Les règles fiscales doivent être validées avant mise en production par le comptable de Marie, notamment pour les activités, les taux de TVA, les ventes internationales et les éventuelles exceptions.

## État constaté

Le projet possède déjà une base utile :

- `Invoice`, `InvoiceLine` et `CreditNote` dans `prisma/schema.prisma` ;  
- une numérotation annuelle atomique dans `lib/invoicing.js` ;  
- un PDF dans `lib/pdf/InvoiceDocument.jsx` ;  
- une politique TVA pour les biens dans `lib/tax-policy.js` ;  
- une validation VIES dans `lib/vat-validation.js` ;  
- des snapshots TVA sur `Order` ;  
- des notes de crédit séparées lors des remboursements.

L’audit a trouvé les manques suivants :

1. Les données légales du vendeur doivent être complètes avant émission : dénomination légale, adresse officielle, numéro BCE/TVA, email/téléphone.  
2. Il n’existe pas de raison sociale dédiée au client professionnel : la facture utilise aujourd’hui `User.fullName`.  
3. Le PDF affiche des lignes TTC sans le dire, puis un sous-total HT : cela crée une ambiguïté et les réductions ne figurent pas comme ligne dédiée.  
4. Une note de crédit ne contient que le TTC ; elle ne ventile ni HT ni TVA et ne reprend pas toutes les coordonnées B2B du client.  
5. Une seule TVA est stockée par facture : le modèle ne prend pas en charge correctement plusieurs taux sur une même facture.  
6. Les acomptes d’ateliers/formations sont encaissés sans facture d’acompte lorsque le solde n’est pas encore payé.  
7. Il n’existe ni UBL, ni Peppol, ni suivi d’envoi de facture structurée.  
8. Il n’existe pas de rapport fiscal/export comptable par taux, pays et traitement TVA.

## Périmètre fonctionnel

### B2C — particuliers

- Conserver un PDF clair et une copie durable de la vente.  
- La facture doit afficher les prix de manière non ambiguë (`HT` ou `TTC`).  
- Les ventes e-commerce à distance doivent pouvoir produire une facture.  
- Pour une vente magasin/POS, prévoir au minimum le reçu et l’inscription comptable/journal des recettes requis par le régime de Marie.  
- Les remises, frais de livraison, remboursements et avoirs doivent toujours rapprocher exactement le total payé.

### B2B — entreprises belges

- Facture adressée à la raison sociale légale, à son adresse et à son numéro TVA.  
- Production d’un PDF humain **et** d’une facture structurée Peppol.  
- Envoi par un point d’accès Peppol et suivi de l’état : `QUEUED`, `SENT`, `DELIVERED`, `FAILED`, `RETRYING`, `CANCELLED`.  
- Une note de crédit doit également être envoyable par Peppol.  
- Une modification après émission ne modifie jamais la facture originale : note de crédit \+ nouvelle facture uniquement.

### B2B UE / export

- Une vente au comptoir ou un retrait en Belgique reste taxée en Belgique, même si le client a une société étrangère.  
- Pour une livraison de biens B2B intra-UE à 0 %, exiger : TVA VIES valide, pays cohérent, preuve de transport/livraison, mention légale adéquate et validation comptable.  
- Pour une vente B2C UE, n’utiliser le taux du pays de destination que si le régime OSS est réellement opérationnel et déclaré par le comptable.  
- Pour un export hors UE, garder la revue manuelle et exiger les preuves douanières avant de marquer l’opération exonérée.

## Décisions métier à obtenir avant développement

1. Forme juridique exacte de Meri Beauty, dénomination officielle, BCE/TVA et adresse légale exacte.  
2. Les prestations (rendez-vous, formations, ateliers) sont-elles toutes à 21 % ? Le comptable doit confirmer les taux et règles de lieu de prestation.  
3. Quel logiciel comptable ou quel prestataire Peppol sera utilisé ?  
4. Meri Beauty est-elle inscrite à l’OSS, et si oui depuis quelle date ?  
5. Les B2B doivent-ils payer immédiatement ou faut-il gérer des échéances, IBAN, délais de paiement et relances ?  
6. Quel identifiant de commande/bon de commande le client professionnel peut exiger sur sa facture ?

Sans la réponse au point 3, ne pas prétendre qu’une facture PDF est un envoi Peppol. Pour le lancement, les B2B peuvent être facturés manuellement depuis le logiciel comptable compatible Peppol.

## Données à ajouter

### Profil entreprise / client

Ajouter sur `User` ou, préférablement, sur une table `BillingProfile` liée au client :

companyLegalName       String?

companyRegistrationNo  String?  // BCE/KBO ou équivalent si distinct de TVA

companyLegalForm       String?

billingContactName     String?

purchaseOrderReference String?

peppolParticipantId    String?  // ex. scheme \+ identifiant, validé

Conserver l’adresse de facturation en champs séparés, pas seulement comme une chaîne : ligne 1, ligne 2, code postal, ville, pays.

Le champ `fullName` est le contact humain ; il ne remplace jamais la raison sociale.

### Snapshot facture

Les données suivantes doivent être copiées dans `Invoice` et ne plus dépendre du profil vivant du client :

sellerLegalName          String

sellerAddressLine1       String

sellerAddressLine2       String?

sellerPostalCode         String

sellerCity               String

sellerCountryCode        String

sellerVatNumber          String

customerType             InvoiceCustomerType // B2C | B2B

customerLegalName        String?

customerContactName      String?

customerVatNumber        String?

customerAddressLine1     String?

customerAddressLine2     String?

customerPostalCode       String?

customerCity             String?

customerCountryCode      String?

purchaseOrderReference   String?

currency                 String @default("EUR")

supplyDate               DateTime?

paymentDueDate           DateTime?

paymentStatusSnapshot    String?

paymentMethodSnapshot    String?

Ne pas remplacer silencieusement des valeurs manquantes par une valeur vide. Bloquer l’émission B2B si les champs obligatoires ne sont pas présents.

### Lignes et TVA

Remplacer le modèle de ligne trop simple par des montants explicites. Chaque ligne doit porter son propre taux et ses montants :

unitPriceExclVat Decimal

lineSubtotalExclVat Decimal

vatRate Decimal

vatAmount Decimal

lineTotalInclVat Decimal

discountAmountExclVat Decimal @default(0)

Les remises doivent être une ligne négative ou être réparties de façon déterministe entre les lignes, en centimes. La somme des lignes HT, TVA et TTC doit toujours correspondre exactement aux totaux de facture.

### Facturation Peppol

Créer des données indépendantes de la facture afin de permettre les retries sans réémettre ou renuméroter une facture :

model ElectronicInvoiceDelivery {

  id                   String @id @default(cuid())

  invoiceId            String

  invoice              Invoice @relation(fields: \[invoiceId\], references: \[id\])

  documentType         ElectronicDocumentType // INVOICE | CREDIT\_NOTE

  provider             String

  recipientParticipantId String

  idempotencyKey       String @unique

  ublXml               String                 // ou stockage objet chiffré \+ URL immuable

  status               ElectronicDeliveryStatus

  providerMessageId    String?

  lastErrorCode        String?

  lastErrorMessage     String?

  attempts             Int @default(0)

  sentAt               DateTime?

  deliveredAt          DateTime?

  createdAt            DateTime @default(now())

  updatedAt            DateTime @updatedAt

}

Ne jamais conserver de clé API de prestataire dans la base. Utiliser des variables d’environnement et une rotation de secrets.

## Règles d’émission

1. Valider les données vendeur avant toute émission de facture. Si la TVA ou l’adresse légale du salon manque, échouer avec un message d’administration clair ; ne pas produire un document légalement incomplet.  
2. Créer le paiement, la facture, les lignes et la numérotation dans une même transaction DB. Conserver la protection de concurrence déjà présente.  
3. À l’émission, figer toutes les données vendeur/client, les produits, les prix, la remise, la TVA, le pays et le traitement fiscal.  
4. Générer le PDF à partir de ces snapshots uniquement.  
5. Pour le B2B belge, créer une livraison Peppol dans l’état `QUEUED` après la transaction. Le worker d’envoi ne doit jamais créer une deuxième facture.  
6. Sur une panne prestataire, garder la facture émise, marquer l’envoi `FAILED`, alerter l’admin et réessayer avec la même clé d’idempotence.  
7. Ne permettre aucune édition destructrice d’une facture émise. Toute correction passe par une note de crédit, puis une facture corrigée.

## Contenu PDF obligatoire à viser

Le rendu PDF doit afficher clairement :

- titre `FACTURE` ou `NOTE DE CRÉDIT` ;  
- numéro séquentiel unique et date d’émission ;  
- date de livraison/prestation lorsqu’elle diffère de la date de facture ;  
- vendeur : dénomination légale, adresse complète, BCE/TVA ;  
- client B2B : raison sociale, adresse complète, TVA ;  
- référence de bon de commande quand fournie ;  
- description, quantité, prix unitaire HT, remise HT, taux TVA, TVA et total TTC par ligne ou par groupe de taux ;  
- totaux HT/TVA/TTC par taux ;  
- devise ;  
- traitement fiscal/mention légale (`autoliquidation`, livraison intracommunautaire, OSS, export) lorsque applicable ;  
- référence complète de la facture d’origine sur une note de crédit ;  
- mode/date de paiement ou solde/due date quand utile.

Les libellés doivent être explicites : `Prix unitaire HT`, `TVA`, `Total TTC`. Ne pas afficher un prix TTC sous un libellé ambigu.

## Notes de crédit et remboursements

Une note de crédit doit :

1. avoir sa propre numérotation séquentielle ;  
2. référencer numéro et date de la facture originale ;  
3. reprendre le vendeur et le client complets ;  
4. préciser motif, lignes/quantités concernées, HT, TVA, TTC et taux ;  
5. être émise au même moment que le remboursement ou la correction ;  
6. être envoyée via Peppol lorsque la facture B2B originale y a été envoyée ;  
7. ne jamais dépasser la somme de la facture originale moins les avoirs déjà émis.

Le travail sur les retours doit aussi corriger la répartition des promotions : un retour partiel rembourse le prix réellement payé après remise, jamais le prix catalogue complet.

## Peppol : architecture recommandée

Peppol est un réseau d’échange de documents structurés ; ce n’est ni Stripe ni une banque. L’intégration doit passer par un point d’accès / prestataire Peppol ou le logiciel comptable déjà choisi.

Facture immuable en DB

        ↓

Générateur UBL / Peppol BIS

        ↓

Validation XML et règles métier

        ↓

API du point d’accès Peppol

        ↓

Réseau Peppol → logiciel comptable du client

        ↓

Statut, preuve d’envoi et retry dans Meri Beauty

### Contraintes Peppol

- Ne pas construire un point d’accès Peppol maison.  
- Choisir un prestataire qui expose une API et gère la conformité réseau.  
- Vérifier avant l’envoi que le destinataire est joignable sur Peppol.  
- Le PDF peut être joint comme représentation lisible, mais l’UBL structuré est le document d’échange.  
- Les notes de crédit doivent être des documents structurés distincts.  
- Conserver le XML exact envoyé, les identifiants prestataire et les statuts.  
- Utiliser une idempotence par facture/document afin qu’un retry ne double pas l’envoi ou ne crée pas une nouvelle facture.

## TVA et international

### Biens de la boutique

Conserver et renforcer `resolveGoodsVatPolicy` dans `lib/tax-policy.js` :

- comptoir/retrait Belgique → TVA BE ;  
- livraison B2C UE → TVA destination seulement si OSS réellement actif ;  
- livraison B2B UE → 0 % uniquement après VIES valide, preuve de transport et validation des critères ;  
- export hors UE → 0 % seulement après confirmation manuelle et preuve.

### Services, ateliers, formations et rendez-vous

Ne pas réutiliser automatiquement la règle des biens. Le lieu d’imposition des services peut dépendre du type de prestation et de son lieu réel. Documenter les décisions du comptable par type : rendez-vous au salon, formation au salon, atelier, prestation éventuellement réalisée à distance.

### OSS

Ne jamais activer `VAT_OSS_ENABLED=true` uniquement parce que le code le supporte. Avant activation, confirmer :

- inscription OSS effective ;  
- fréquence de déclaration ;  
- responsable comptable ;  
- export de toutes les ventes par pays/taux/période ;  
- conservation des preuves et registres requis.

## Rapports comptables à construire

Créer un export CSV/XLSX ou une intégration comptable contenant, pour une période donnée :

- factures et notes de crédit ;  
- numéro, date, source et pays ;  
- client, TVA client et type B2B/B2C ;  
- montant HT, TVA et TTC, ventilés par taux ;  
- traitement TVA (`DOMESTIC`, `EU_DISTANCE_SALE`, `EU_REVERSE_CHARGE`, `EXPORT`) ;  
- moyen de paiement ;  
- statut Peppol ;  
- références Stripe/terminal/caisse ;  
- remises et livraisons ;  
- total net après notes de crédit.

Le site ne doit pas être considéré comme le remplacement de la comptabilité ou de la déclaration TVA. Le comptable doit pouvoir rapprocher les données.

## Sécurité et intégrité

- Autoriser l’émission/renvoi de factures seulement aux rôles administratifs.  
- Ne jamais exposer les XML ou PDF d’un autre client par identifiant devinable.  
- Ajouter rate limiting aux endpoints publics de téléchargement si nécessaire.  
- Journaliser : émission, téléchargement admin, envoi Peppol, échec, retry, note de crédit et changement de données TVA.  
- Conserver factures, notes de crédit, XML Peppol et preuves d’envoi pendant la durée confirmée par le comptable (le SPF indique généralement 10 ans pour factures, copies et documents comptables).  
- Utiliser une date/année basée sur `Europe/Brussels` pour la série de numérotation : ne pas dépendre du fuseau UTC du serveur à minuit le 1er janvier.

## Plan d’implémentation

### Phase A — Bloquants de lancement

1. Remplir et verrouiller les données légales du salon dans les réglages.  
2. Faire échouer l’émission si les données vendeur obligatoires sont absentes.  
3. Corriger les lignes de promotion, les totaux et les libellés HT/TTC.  
4. Corriger les notes de crédit : HT, TVA, TTC, taux, identité client.  
5. Ajouter la raison sociale et l’adresse B2B.  
6. Désactiver ou traiter manuellement les commandes B2B tant que Peppol n’est pas configuré.

### Phase B — Peppol

1. Choisir le prestataire/point d’accès et obtenir les identifiants API.  
2. Ajouter les modèles de livraison électronique et une migration Prisma.  
3. Générer un UBL/Peppol BIS validé à partir du snapshot de facture.  
4. Envoyer via une queue/worker avec idempotence, retry borné et alertes.  
5. Ajouter notes de crédit UBL.  
6. Ajouter une page dashboard : statut, erreur, relancer, télécharger XML/PDF.

### Phase C — Fiscalité et comptabilité

1. Ajouter TVA par ligne / groupe de taux.  
2. Factures d’acompte et factures finales.  
3. Export TVA et rapprochement comptable.  
4. Validation comptable des services, OSS et international.

## Tests d’acceptation obligatoires

### Factures

- [ ] Une facture B2C affiche vendeur, numéro, date, lignes, HT, TVA, TTC.  
- [ ] Une facture B2B affiche raison sociale, adresse et TVA du client.  
- [ ] Une facture ne peut pas être émise si l’adresse ou TVA vendeur manque.  
- [ ] Le total de toutes les lignes est exactement égal au total facture.  
- [ ] Une remise de 20 € est explicitement visible et les retours partiels remboursent le montant net réellement payé.  
- [ ] Le changement ultérieur de profil client ne modifie pas une facture déjà émise.  
- [ ] Le numéro de facture utilise l’année de Bruxelles à minuit du Nouvel An.

### TVA

- [ ] Vente POS belge B2B/B2C : TVA belge normale.  
- [ ] Vente B2C UE avec OSS désactivé : comportement validé par comptable.  
- [ ] Vente B2C UE avec OSS actif : taux destination et export de registre.  
- [ ] Vente B2B UE : 0 % refusé sans VIES récent et preuve de transport.  
- [ ] Export : 0 % refusé sans validation manuelle.  
- [ ] Plusieurs taux TVA sur une facture : totaux corrects par taux.  
- [ ] Acompte : facture/avoir/facture finale comptablement cohérents.

### Peppol

- [ ] L’UBL généré est validé par le validateur du prestataire.  
- [ ] Une facture B2B est envoyée une seule fois malgré double-clic/retry.  
- [ ] Une indisponibilité prestataire n’efface pas la facture ni ne crée de nouvelle numérotation.  
- [ ] Le dashboard montre l’erreur et permet un retry sûr.  
- [ ] Une note de crédit est envoyée comme document structuré distinct.  
- [ ] Un PDF seul n’est jamais présenté comme « envoyé via Peppol ».

## Sources à vérifier avec le comptable

- SPF Finances — comptabilité et facturation : [https://finances.belgium.be/fr/node/1581](https://finances.belgium.be/fr/node/1581)  
- Portail officiel belge de l’e-facturation / Peppol : [https://efacture.belgium.be/fr](https://efacture.belgium.be/fr)  
- SPF Finances — registres OSS : [https://finances.belgium.be/fr/node/15479](https://finances.belgium.be/fr/node/15479)  
- Your Europe — TVA et facturation : [https://europa.eu/youreurope/business/finance-and-tax/vat/charging-deducting-vat/index\_en.htm](https://europa.eu/youreurope/business/finance-and-tax/vat/charging-deducting-vat/index_en.htm)

