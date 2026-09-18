import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { encryptSecret, isTokenEncryptionConfigured } from "@/lib/token-encryption";
import {
  createOAuthClient,
  getConfiguredSiteUrl,
  isGoogleOAuthConfigured,
  readEmailFromIdToken,
  verifyGoogleOAuthState,
} from "@/lib/seo/google-oauth";
import { invalidateCache } from "@/lib/seo/cache";

/**
 * GET /api/seo/google/callback
 *
 * Google renvoie ici le navigateur après le consentement (ou le refus).
 *
 * Déroulé :
 *   1. refus explicite de l'utilisateur → retour avec un message ;
 *   2. vérification du `state` signé (signature, flux, expiration) ;
 *   3. l'utilisateur qui termine le flux doit être celui qui l'a démarré ;
 *   4. échange du code contre les jetons ;
 *   5. stockage CHIFFRÉ des jetons ;
 *   6. retour sur /dashboard/seo.
 *
 * Le `state` prouve que le retour n'a pas été forgé, mais il voyage dans une
 * URL de redirection qui peut fuir (historique, en-tête referer, écran
 * partagé). La session vivante est donc revérifiée à l'étape 3 — sans
 * session, c'est traité comme un échec, jamais comme un laissez-passer.
 */

export const dynamic = "force-dynamic";

/** Clés d'erreur traduites côté page (app/dashboard/seo/page.jsx). */
const ERROR_KEYS = {
  REFUS: "refus",
  ETAT_INVALIDE: "etat_invalide",
  SESSION_DIFFERENTE: "session_differente",
  CODE_ABSENT: "code_absent",
  ECHANGE_ECHOUE: "echange_echoue",
  REFRESH_ABSENT: "refresh_absent",
  CONFIG_ABSENTE: "config_absente",
  CLE_ABSENTE: "cle_absente",
  INATTENDUE: "inattendue",
};

/**
 * @param {Request & { nextUrl: URL }} request
 * @param {{ success?: boolean, error?: string | null }} [result]
 * @returns {NextResponse}
 */
function redirectToSeo(request, { success = false, error = null } = {}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const url = new URL("/dashboard/seo", baseUrl);

  if (success) url.searchParams.set("connecte", "1");
  if (error) url.searchParams.set("erreur", error);

  return NextResponse.redirect(url);
}

export async function GET(request) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const googleError = params.get("error");

  // ── 1. Refus ou erreur renvoyée par Google ──────────────────────────────
  if (googleError) {
    return redirectToSeo(request, { error: ERROR_KEYS.REFUS });
  }

  if (!isGoogleOAuthConfigured()) {
    return redirectToSeo(request, { error: ERROR_KEYS.CONFIG_ABSENTE });
  }
  if (!isTokenEncryptionConfigured()) {
    return redirectToSeo(request, { error: ERROR_KEYS.CLE_ABSENTE });
  }

  // ── 2. Vérification du state signé ──────────────────────────────────────
  const decoded = verifyGoogleOAuthState(state);
  if (!decoded) {
    console.warn("[GET /api/seo/google/callback] State OAuth invalide");
    return redirectToSeo(request, { error: ERROR_KEYS.ETAT_INVALIDE });
  }

  // ── 3. Même personne qu'au départ, et toujours administratrice ──────────
  const session = await auth();
  if (!session?.user?.id || session.user.id !== decoded.userId) {
    console.warn("[GET /api/seo/google/callback] Session différente du state");
    return redirectToSeo(request, { error: ERROR_KEYS.SESSION_DIFFERENTE });
  }
  // Le rôle a pu être retiré pendant que l'utilisateur était chez Google.
  if (!isAdminRole(session.user.role)) {
    return redirectToSeo(request, { error: ERROR_KEYS.SESSION_DIFFERENTE });
  }

  if (!code) {
    return redirectToSeo(request, { error: ERROR_KEYS.CODE_ABSENT });
  }

  // ── 4. Échange du code contre les jetons ────────────────────────────────
  let tokens;
  try {
    const client = createOAuthClient();
    const response = await client.getToken(code);
    tokens = response?.tokens;
  } catch (error) {
    console.error("[GET /api/seo/google/callback] Échec de l'échange du code :", error);
    return redirectToSeo(request, { error: ERROR_KEYS.ECHANGE_ECHOUE });
  }

  if (!tokens?.access_token) {
    return redirectToSeo(request, { error: ERROR_KEYS.ECHANGE_ECHOUE });
  }

  // Sans refresh token, la connexion mourrait au bout d'une heure sans
  // pouvoir se renouveler. Cela n'arrive que si `prompt=consent` n'a pas été
  // honoré (consentement déjà accordé à ce client) : mieux vaut refuser
  // franchement et renvoyer vers une révocation manuelle que d'enregistrer
  // une connexion qui s'éteindra silencieusement.
  if (!tokens.refresh_token) {
    console.warn("[GET /api/seo/google/callback] Aucun refresh token renvoyé par Google");
    return redirectToSeo(request, { error: ERROR_KEYS.REFRESH_ABSENT });
  }

  // ── 5. Stockage chiffré ─────────────────────────────────────────────────
  try {
    const googleEmail = readEmailFromIdToken(tokens.id_token) ?? "compte Google";
    const accessToken = encryptSecret(tokens.access_token);
    const refreshToken = encryptSecret(tokens.refresh_token);
    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    const existing = await prisma.googleConnection.findUnique({
      where: { userId: session.user.id },
      select: { siteUrl: true },
    });

    // La propriété déjà choisie est conservée à travers une reconnexion —
    // on ne veut pas qu'un simple renouvellement de consentement ramène
    // l'écran sur la propriété par défaut de l'environnement.
    const siteUrl = existing?.siteUrl ?? getConfiguredSiteUrl();

    await prisma.googleConnection.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        googleEmail,
        accessToken,
        refreshToken,
        expiresAt,
        siteUrl,
      },
      update: {
        googleEmail,
        accessToken,
        refreshToken,
        expiresAt,
        siteUrl,
      },
    });
  } catch (error) {
    console.error("[GET /api/seo/google/callback] Échec de l'enregistrement de la connexion :", error);
    return redirectToSeo(request, { error: ERROR_KEYS.INATTENDUE });
  }

  // Les chiffres en cache appartiennent au compte précédent.
  invalidateCache();

  console.log(`[GET /api/seo/google/callback] Search Console connecté par l'utilisateur ${session.user.id}`);

  return redirectToSeo(request, { success: true });
}
