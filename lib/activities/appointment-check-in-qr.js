import "server-only";

import { prisma } from "@/lib/prisma";
import { qrPngAttachment } from "@/lib/qrcode";
import { CHECK_IN_KINDS, ensureCheckInCode } from "@/lib/activities/check-in-code";

/**
 * Mints (or reuses) an appointment's check-in code and returns it as an
 * e-mail attachment, or null if either step fails.
 *
 * Every caller invokes this AFTER its own confirmation transaction has
 * committed, never inside it — a unique-index collision on the generated
 * code must never sit on the same rollback path as a captured Stripe charge
 * or a confirmed appointment. ensureCheckInCode is idempotent (conditional on
 * checkInCode: null), so calling it from several confirmation paths, or
 * after the customer's own profile already minted one lazily, is a no-op.
 */
export async function buildAppointmentCheckInEmailAssets(appointmentId) {
  const checkInCode = await ensureCheckInCode(prisma, CHECK_IN_KINDS.APPOINTMENT, appointmentId).catch((err) => {
    console.error("[buildAppointmentCheckInEmailAssets] check-in code generation failed:", err);
    return null;
  });
  if (!checkInCode) return { checkInCode: null, attachment: null };

  const attachment = await qrPngAttachment(checkInCode, `billet-rendez-vous-${checkInCode}.png`).catch((err) => {
    console.error("[buildAppointmentCheckInEmailAssets] ticket QR generation failed:", err);
    return null;
  });

  // Keep the readable code in the message even if PNG generation fails.
  return { checkInCode, attachment };
}
