/**
 * Prospect Service — Marketing Campaign + Prospect Tracking.
 *
 * Adapté au métier Meri Beauty (salon de beauté : RDV, boutique, ateliers,
 * formations). Il n'y a ici NI licences NI abonnements : la notion de
 * "client" = au moins un Payment PAID sur l'un des 4 flux, et "demo_essai" =
 * la personne a déjà testé un service (RDV honoré, atelier/formation
 * réservé, commande passée) sans être encore cliente payée.
 *
 * Règles de promotion (STATUS_RANK) :
 * - on ne fait que MONTER (jamais de downgrade), sauf depuis `perdu`
 *   qui peut toujours remonter ;
 * - `perdu` absorbe tout (rank -1) : passer en perdu est toujours autorisé.
 */

import { prisma } from "@/lib/prisma";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  PROSPECT_SOURCE_CHOICES,
  getSourceLabel,
} from "@/lib/prospects/prospect-choices";

// Ré-exportés pour compatibilité (les imports existants depuis ce module
// continuent de fonctionner).
export {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  PROSPECT_SOURCE_CHOICES,
  getSourceLabel,
};

export const STATUS_RANK = Object.freeze({
  nouveau: 0,
  contacte: 1,
  engage: 2,
  interesse: 3,
  demo_essai: 4,
  client: 5,
  perdu: -1,
});

const PROSPECT_SOURCES = new Set(PROSPECT_SOURCE_CHOICES.map((c) => c.value));

export function isValidSource(source) {
  return PROSPECT_SOURCES.has(source);
}

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * Mappe un utm_source libre (formulaire, lien tracké) vers l'enum
 * ProspectSource. Inconnu -> "autre", jamais d'exception.
 */
export function normalizeSource(utmSource) {
  const raw = String(utmSource ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (PROSPECT_SOURCES.has(raw)) return raw;
  if (raw.includes("google")) return raw.includes("ad") ? "google_ads" : "google";
  if (raw.includes("face")) return "facebook";
  if (raw.includes("insta")) return "instagram";
  if (raw.includes("linkedin")) return "linkedin";
  if (raw.includes("news") || raw.includes("mail")) return "email";
  if (raw.includes("campagne") || raw.includes("campaign")) return "campagne";
  if (raw.includes("salon") || raw.includes("event") || raw.includes("evenement")) return "salon_evenement";
  if (raw.includes("reco") || raw.includes("parrain")) return "recommandation";
  if (raw.includes("site") || raw.includes("web")) return "site_web";
  if (raw.includes("resa") || raw.includes("rdv") || raw.includes("booking")) return "reservation";
  // Avant "shop" : "workshop" contient "shop" mais désigne un atelier.
  if (raw.includes("atelier") || raw.includes("workshop")) return "atelier";
  if (raw.includes("boutique") || raw.includes("shop") || raw.includes("order")) return "boutique";
  if (raw.includes("formation") || raw.includes("training")) return "formation";
  if (raw.includes("contact") || raw.includes("form")) return "contact";
  return "autre";
}

/**
 * Nettoie un objet UTM ( borne chaque champ à 100 caractères, supprime
 * les vides). N'importe quelle source (URL, formulaire, metadata Stripe).
 */
export function sanitizeUtm(utm) {
  if (!utm || typeof utm !== "object") return {};
  const out = {};
  for (const key of ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"]) {
    const value = utm[key];
    if (value == null) continue;
    const str = String(value).trim().slice(0, 100);
    if (str) out[key] = str;
  }
  return out;
}

export async function findProspectByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return prisma.prospect.findUnique({ where: { email: normalized } });
}

/**
 * Création idempotente : si l'email existe déjà, retourne le prospect
 * existant (sans écraser ses données). Gère le race P2002 (duplicate).
 * Crée toujours l'activité `prospect_created`.
 */
export async function createProspect({
  email,
  firstName,
  lastName,
  phone,
  company,
  city,
  website,
  country,
  source,
  utm,
  sourceRefType,
  sourceRefId,
  userId,
  createdBy,
} = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) return null;

  const existing = await findProspectByEmail(normalized);
  if (existing) {
    // Backfill doux : ne remplit que les champs encore vides.
    const patch = {};
    if (!existing.firstName && firstName) patch.firstName = String(firstName).trim() || null;
    if (!existing.lastName && lastName) patch.lastName = String(lastName).trim() || null;
    if (!existing.phone && phone) patch.phone = String(phone).trim() || null;
    if (!existing.company && company) patch.company = String(company).trim() || null;
    if (!existing.city && city) patch.city = String(city).trim() || null;
    if (!existing.website && website) patch.website = String(website).trim() || null;
    if (!existing.userId && userId) patch.userId = userId;
    if (Object.keys(patch).length > 0) {
      return prisma.prospect.update({ where: { id: existing.id }, data: patch });
    }
    return existing;
  }

  const cleanUtm = sanitizeUtm(utm);
  try {
    const prospect = await prisma.prospect.create({
      data: {
        email: normalized,
        firstName: firstName ? String(firstName).trim() || null : null,
        lastName: lastName ? String(lastName).trim() || null : null,
        phone: phone ? String(phone).trim() || null : null,
        company: company ? String(company).trim() || null : null,
        city: city ? String(city).trim() || null : null,
        website: website ? String(website).trim() || null : null,
        country: country ? String(country).trim() || null : "BE",
        source: PROSPECT_SOURCES.has(source) ? source : normalizeSource(cleanUtm.utmSource),
        ...cleanUtm,
        status: "nouveau",
        statusHistory: [
          { status: "nouveau", changedAt: new Date().toISOString(), byUserId: createdBy ?? null, note: "Création du prospect" },
        ],
        ...(userId ? { userId } : {}),
      },
    });
    await addActivity(prospect, {
      type: "prospect_created",
      refId: sourceRefId ?? null,
      refModel: sourceRefType ?? null,
      metadata: { source: prospect.source, ...cleanUtm },
      description: "Prospect créé",
      createdBy,
    });
    return prospect;
  } catch (error) {
    // Race : deux créations concurrentes sur le même email -> P2002.
    if (error?.code === "P2002") {
      return findProspectByEmail(normalized);
    }
    throw error;
  }
}

/**
 * Ajoute une activité + met à jour lastActivityAt / lastEventType /
 * lastCampaignId du prospect.
 */
export async function addActivity(
  prospect,
  { type, campaignId, refId, refModel, metadata, description, createdBy } = {}
) {
  const prospectId = typeof prospect === "string" ? prospect : prospect?.id;
  if (!prospectId || !type) return null;

  const activity = await prisma.prospectActivity.create({
    data: {
      prospectId,
      type,
      campaignId: campaignId ?? null,
      refId: refId ?? null,
      refModel: refModel ?? null,
      metadata: metadata ?? null,
      description: description ?? null,
      createdById: createdBy ?? null,
    },
  });

  await prisma.prospect.update({
    where: { id: prospectId },
    data: {
      lastActivityAt: new Date(),
      lastEventType: type,
      ...(campaignId ? { lastCampaignId: campaignId } : {}),
    },
  });

  return activity;
}

/**
 * Passage de statut explicite (action admin). Pousse statusHistory +
 * activité `status_changed`. Autorise tout, y compris `perdu` et les
 * retours en arrière volontaires (c'est un acte humain assumé).
 */
export async function setStatus(prospect, status, { note, byUserId } = {}) {
  const prospectId = typeof prospect === "string" ? prospect : prospect?.id;
  if (!prospectId || !PROSPECT_STATUSES.includes(status)) return null;

  const current = typeof prospect === "string"
    ? await prisma.prospect.findUnique({ where: { id: prospectId } })
    : prospect;
  if (!current) return null;
  if (current.status === status) return current;

  const history = Array.isArray(current.statusHistory) ? current.statusHistory : [];
  const updated = await prisma.prospect.update({
    where: { id: prospectId },
    data: {
      status,
      statusHistory: [
        ...history,
        { status, changedAt: new Date().toISOString(), byUserId: byUserId ?? null, note: note ?? null },
      ],
    },
  });

  await addActivity(updated, {
    type: "status_changed",
    metadata: { from: current.status, to: status },
    description: `Statut : ${PROSPECT_STATUS_LABELS[current.status] ?? current.status} → ${PROSPECT_STATUS_LABELS[status] ?? status}${note ? ` — ${note}` : ""}`,
    createdBy: byUserId ?? null,
  });

  return updated;
}

/**
 * Promotion automatique (tracking, sync salon, envoi campagne) : ne monte
 * que si targetRank > currentRank, OU si le prospect est `perdu` (toute
 * reprise de contact le réactive). Jamais de downgrade silencieux.
 */
export async function promoteToStatus(prospect, target, { note, byUserId } = {}) {
  const prospectId = typeof prospect === "string" ? prospect : prospect?.id;
  if (!prospectId || !PROSPECT_STATUSES.includes(target)) return null;

  const current = typeof prospect === "string"
    ? await prisma.prospect.findUnique({ where: { id: prospectId } })
    : prospect;
  if (!current || current.status === target) return current;

  const currentRank = STATUS_RANK[current.status] ?? 0;
  const targetRank = STATUS_RANK[target] ?? 0;

  const isReactivation = current.status === "perdu";
  const isUpgrade = targetRank > currentRank;
  // `perdu` absorbe tout sauf réactivation explicite : un perdu ne redescend
  // pas vers un rang inférieur via une promotion.
  if (!isUpgrade && !isReactivation) return current;
  if (isReactivation && target === "perdu") return current;

  return setStatus(current, target, { note: note ?? "Promotion automatique", byUserId });
}

/**
 * Synchronise le statut d'un prospect avec l'activité réelle du salon
 * (même email) — remplace l'ancienne logique "licences/abonnements",
 * inexistante dans ce projet :
 * - un Payment PAID (boutique, RDV, atelier, formation) -> `client` ;
 * - sinon une réservation/RDV/commande existante (même non payée) ->
 *   `demo_essai` (a testé / est en cours) ;
 * - sinon un compte User existant sans achat -> `interesse`.
 * Toujours via promoteToStatus : ne fait que monter.
 */
export async function syncStatusWithSalonActivity(prospect, { note } = {}) {
  const full = typeof prospect === "string"
    ? await prisma.prospect.findUnique({ where: { id: prospect } })
    : prospect;
  if (!full?.email) return full ?? null;

  const emailLower = normalizeEmail(full.email);

  const user = await prisma.user.findFirst({
    where: { email: emailLower, isDeleted: false },
    select: { id: true },
  });

  // 1. Paiement réel -> client (tous les flux : boutique, RDV, ateliers, formations).
  const paidPayment = await prisma.payment.findFirst({
    where: {
      status: "PAID",
      OR: [
        user ? { order: { userId: user.id } } : { order: { user: { email: emailLower } } },
        user ? { appointment: { userId: user.id } } : { appointment: { user: { email: emailLower } } },
        user ? { workshopReservation: { customerId: user.id } } : { workshopReservation: { customer: { email: emailLower } } },
        user ? { formationReservation: { customerId: user.id } } : { formationReservation: { customer: { email: emailLower } } },
      ],
    },
    select: { id: true },
  });
  if (paidPayment) {
    const withUser = !full.userId && user ? await prisma.prospect.update({
      where: { id: full.id },
      data: { userId: user.id },
    }) : full;
    return promoteToStatus(withUser, "client", { note: note ?? "Paiement constaté au salon" });
  }

  // 2. Activité non payée (RDV, réservation atelier/formation, commande) -> demo_essai.
  const [appointment, workshop, formation, order] = await Promise.all([
    user
      ? prisma.appointment.findFirst({ where: { userId: user.id, isDeleted: false }, select: { id: true } })
      : null,
    user
      ? prisma.workshopReservation.findFirst({ where: { customerId: user.id }, select: { id: true } })
      : null,
    user
      ? prisma.formationReservation.findFirst({ where: { customerId: user.id }, select: { id: true } })
      : null,
    user
      ? prisma.order.findFirst({ where: { userId: user.id }, select: { id: true } })
      : null,
  ]);
  if (appointment || workshop || formation || order) {
    const withUser = !full.userId && user ? await prisma.prospect.update({
      where: { id: full.id },
      data: { userId: user.id },
    }) : full;
    return promoteToStatus(withUser, "demo_essai", { note: note ?? "Activité constatée (RDV / réservation / commande)" });
  }

  // 3. Compte existant sans activité -> interesse.
  if (user) {
    const withUser = !full.userId ? await prisma.prospect.update({
      where: { id: full.id },
      data: { userId: user.id },
    }) : full;
    return promoteToStatus(withUser, "interesse", { note: note ?? "Compte client existant" });
  }

  return full;
}
