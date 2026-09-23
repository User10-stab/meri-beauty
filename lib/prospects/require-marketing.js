import { auth } from "@/auth";
import {
  DASHBOARD_PERMISSIONS,
  hasPermission,
  AUTH_ERRORS,
} from "@/lib/authorization";
import { unauthorized, forbidden } from "@/lib/api-response";

/**
 * Garde partagé des API marketing (prospects + campagnes).
 * OWNER/ADMIN uniquement — le STAFF est exclu (praticiennes
 * indépendantes : pas d'accès aux données commerciales du salon).
 *
 * @returns {Promise<{ session }|{ error: Response }>}
 */
export async function requireMarketingApi() {
  const session = await auth();
  if (!session?.user) return { error: unauthorized(AUTH_ERRORS.NOT_AUTHENTICATED) };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.MARKETING)) {
    return { error: forbidden(AUTH_ERRORS.INSUFFICIENT_PERMISSIONS) };
  }
  return { session };
}
