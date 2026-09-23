/**
 * Segments d'audience des campagnes — adaptés au métier du salon
 * (RDV, boutique, ateliers, formations), pas aux licences/abonnements.
 *
 * Segments "prospects_*" -> table Prospect (incl. contacts sans compte).
 * Autres segments -> union User / Newsletter(opt-in) / RentalRequest.
 */

import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/prospects/prospect-service";

export const SEGMENTS = Object.freeze([
  { value: "newsletter", label: "Abonnés newsletter (comptes)" },
  { value: "clients", label: "Tous les clients (comptes)" },
  { value: "prospects", label: "Tous les prospects (hors perdus)" },
  { value: "prospects_nouveau", label: "Prospects nouveaux" },
  { value: "prospects_actifs", label: "Prospects actifs (contactés → en essai)" },
  { value: "boutique", label: "Acheteurs boutique" },
  { value: "appointments", label: "Clients rendez-vous" },
  { value: "ateliers", label: "Participants ateliers & événements" },
  { value: "formations", label: "Participants formations" },
  { value: "all", label: "Tout le monde (comptes + prospects)" },
]);

export function isValidSegment(segment) {
  return SEGMENTS.some((s) => s.value === segment);
}

const BASE_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
};

function toRecipient({ email, fullName, firstName, lastName, company, userId }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  let resolvedFirst = firstName ?? null;
  let resolvedLast = lastName ?? null;
  if ((!resolvedFirst || !resolvedLast) && fullName) {
    const parts = String(fullName).trim().split(/\s+/);
    if (!resolvedFirst) resolvedFirst = parts[0] || null;
    if (!resolvedLast) resolvedLast = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }
  return {
    email: normalized,
    firstName: resolvedFirst,
    lastName: resolvedLast,
    company: company ? String(company).trim() || null : null,
    userId: userId ?? null,
  };
}

async function userRecipients(where) {
  const users = await prisma.user.findMany({
    where: { isDeleted: false, ...where },
    select: BASE_USER_SELECT,
  });
  return users
    .map((u) => toRecipient({ email: u.email, fullName: u.fullName, userId: u.id }))
    .filter(Boolean);
}

async function prospectRecipients(where) {
  const prospects = await prisma.prospect.findMany({
    where: { marketingOptOut: false, ...where },
    select: { email: true, firstName: true, lastName: true, company: true, userId: true },
  });
  return prospects
    .map((p) =>
      toRecipient({ email: p.email, firstName: p.firstName, lastName: p.lastName, company: p.company, userId: p.userId })
    )
    .filter(Boolean);
}

/**
 * Résout un segment en liste de destinataires dédupliqués par email.
 * @returns {Promise<Array<{ email: string, firstName: string|null, lastName: string|null, company: string|null, userId: string|null }>>}
 */
export async function getSegmentRecipients(segment) {
  switch (segment) {
    case "newsletter":
      return userRecipients({ role: "CUSTOMER", newsletterSubscribed: true });

    case "clients":
      return userRecipients({ role: "CUSTOMER" });

    case "prospects":
      return prospectRecipients({ status: { not: "perdu" } });

    case "prospects_nouveau":
      return prospectRecipients({ status: "nouveau" });

    case "prospects_actifs":
      return prospectRecipients({ status: { in: ["contacte", "engage", "interesse", "demo_essai"] } });

    case "boutique":
      return userRecipients({ role: "CUSTOMER", orders: { some: {} } });

    case "appointments":
      return userRecipients({ role: "CUSTOMER", appointments: { some: { isDeleted: false } } });

    case "ateliers":
      return userRecipients({ role: "CUSTOMER", workshopReservations: { some: {} } });

    case "formations":
      return userRecipients({ role: "CUSTOMER", formationReservations: { some: {} } });

    case "all": {
      const [users, prospects] = await Promise.all([
        userRecipients({ role: "CUSTOMER" }),
        prospectRecipients({ status: { not: "perdu" } }),
      ]);
      return dedupeRecipients([...users, ...prospects]);
    }

    default:
      return userRecipients({ role: "CUSTOMER", newsletterSubscribed: true });
  }
}

export function dedupeRecipients(recipients) {
  const seen = new Map();
  for (const r of recipients) {
    if (!r?.email) continue;
    const existing = seen.get(r.email);
    if (!existing) {
      seen.set(r.email, r);
    } else if (!existing.userId && r.userId) {
      seen.set(r.email, { ...existing, userId: r.userId });
    }
  }
  return [...seen.values()];
}

/**
 * Compteurs d'audience pour le wizard campagne (un compteur par segment).
 */
export async function getAudienceCounts() {
  const entries = await Promise.all(
    SEGMENTS.map(async (s) => {
      try {
        const recipients = await getSegmentRecipients(s.value);
        return [s.value, recipients.length];
      } catch {
        return [s.value, 0];
      }
    })
  );
  return Object.fromEntries(entries);
}
