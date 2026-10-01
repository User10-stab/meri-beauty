/**
 * Hooks prospects — fire-and-forget.
 *
 * Règle métier : les prospects sont UNIQUEMENT créés manuellement depuis
 * le dashboard (POST /api/prospects, bouton "+ Nouveau prospect").
 * L'inscription, la réservation, le contact, la newsletter et les demandes
 * de location ne doivent JAMAIS créer de prospect.
 *
 * Ces hooks ne font donc qu'enrichir un prospect DÉJÀ existant (même
 * e-mail saisi manuellement) avec une activité + éventuelle promotion.
 * S'il n'existe pas, on ne fait rien.
 */

import { addActivity, promoteToStatus } from "@/lib/prospects/prospect-service";

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
 * DÉPRÉCIÉ — ne crée plus rien (sécurité anti-remplissage auto).
 * Redirige vers trackExistingProspect : journalise uniquement si le
 * prospect a été ajouté manuellement au préalable.
 * Conservé pour compatibilité des anciens imports.
 */
export function trackNewUser(input = {}) {
  const activityType = input?.activityType;
  if (!activityType || activityType === "prospect_created") return;
  trackExistingProspect(input?.email, {
    type: activityType,
    refId: input?.refId ?? null,
    refModel: input?.refModel ?? null,
    metadata: input?.metadata ?? null,
    description: input?.activityDescription ?? null,
    promoteTo: input?.promoteTo ?? null,
    promoteNote: input?.promoteNote ?? null,
  });
}

/**
 * Journalise une activité (+ promotion éventuelle) sur un prospect
 * existant UNIQUEMENT. Ne crée jamais de prospect.
 * @param {string} email
 * @param {{ type, description?, refId?, refModel?, metadata?, promoteTo?, promoteNote? }} activity
 */
export function trackExistingProspect(email, activity) {
  runDetached(
    (async () => {
      const { findProspectByEmail } = await import("@/lib/prospects/prospect-service");
      const prospect = await findProspectByEmail(email);
      if (!prospect || !activity?.type) return null;
      const logged = await addActivity(prospect, {
        type: activity.type,
        refId: activity.refId ?? null,
        refModel: activity.refModel ?? null,
        metadata: activity.metadata ?? null,
        description: activity.description ?? null,
      });
      if (activity.promoteTo) {
        await promoteToStatus(prospect, activity.promoteTo, {
          note: activity.promoteNote ?? "Activité constatée",
        });
      }
      return logged;
    })(),
    `trackExistingProspect(${email})`
  );
}
