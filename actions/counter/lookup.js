"use server";

import { parseCheckInCode, PICKUP_KIND } from "@/lib/activities/check-in-code";
import { lookupActivityCheckIn } from "@/actions/activities/check-in";
import { lookupOrderByPickupCode } from "@/actions/boutique/orders";

/**
 * The one field the counter scanner types or scans into. Routes on the
 * code's own shape rather than asking staff which kind of ticket they are
 * holding: R-/A-/F- go to the rendez-vous/atelier/formation check-in, a bare
 * 8-hex code goes to a boutique pickup order — one scanner, four doors,
 * instead of staff keeping a second device for pickup codes.
 */
export async function lookupCounterCode(rawCode) {
  const parsed = parseCheckInCode(rawCode);

  if (parsed?.kind === PICKUP_KIND) {
    const result = await lookupOrderByPickupCode(parsed.code);
    return result.success ? { success: true, data: { domain: "PICKUP", ...result.data } } : result;
  }

  const result = await lookupActivityCheckIn(rawCode);
  return result.success ? { success: true, data: { domain: "TICKET", ...result.data } } : result;
}
