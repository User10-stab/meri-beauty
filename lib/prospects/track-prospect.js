/**
 * Hooks automatiques prospect — fire-and-forget.
 *
 * Chaque point d'entrée (inscription, contact, newsletter, réservation,
 * demande de location, …) appelle trackNewUser() SANS await : un échec du
 * tracking marketing ne doit jamais faire échouer le parcours client.
 */

import { createProspect, addActivity, promoteToStatus } from "@/lib/prospects/prospect-service";

function runDetached(promise, label) {
  Promise.resolve(promise).catch((error) =>
    console.error(`[track-prospect] ${label} failed:`, error?.message ?? error)
  );
}

export function splitName(fullName) {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Crée (idempotent) le prospect + journalise l'activité d'origine.
 * @param {{ email, firstName?, lastName?, fullName?, phone?, company?, source?, utm?, userId?, activityType?, refId?, refModel?, promoteTo? }} input
 */
export function trackNewUser(input = {}) {
  runDetached(
    (async () => {
      const { firstName, lastName } = input.firstName || input.lastName
        ? { firstName: input.firstName ?? null, lastName: input.lastName ?? null }
        : splitName(input.fullName);
      const prospect = await createProspect({
        email: input.email,
        firstName,
        lastName,
        phone: input.phone,
        company: input.company,
        source: input.source || "site_web",
        utm: input.utm,
        userId: input.userId,
        sourceRefType: input.refModel,
        sourceRefId: input.refId,
      });
      if (!prospect) return null;
      if (input.activityType && input.activityType !== "prospect_created") {
        await addActivity(prospect, {
          type: input.activityType,
          refId: input.refId ?? null,
          refModel: input.refModel ?? null,
          metadata: input.metadata ?? null,
          description: input.activityDescription ?? null,
        });
      }
      if (input.promoteTo) {
        await promoteToStatus(prospect, input.promoteTo, { note: input.promoteNote ?? "Activité constatée" });
      }
      return prospect;
    })(),
    `trackNewUser(${input?.email})`
  );
}

/** Journalise une activité sur un prospect existant (sans le créer). */
export function trackExistingProspect(email, activity) {
  runDetached(
    (async () => {
      const { findProspectByEmail } = await import("@/lib/prospects/prospect-service");
      const prospect = await findProspectByEmail(email);
      if (!prospect || !activity?.type) return null;
      return addActivity(prospect, activity);
    })(),
    `trackExistingProspect(${email})`
  );
}
