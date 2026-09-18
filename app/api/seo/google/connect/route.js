import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { buildGoogleConsentUrl, isGoogleOAuthConfigured } from "@/lib/seo/google-oauth";
import { isTokenEncryptionConfigured } from "@/lib/token-encryption";

/**
 * GET /api/seo/google/connect
 *
 * Démarre le consentement OAuth Google Search Console : redirige
 * l'administrateur vers l'écran d'autorisation de Google.
 *
 * Emplacement volontaire : /api/seo/google/..., et surtout PAS
 * /api/auth/google/... — app/api/auth/[...nextauth]/route.js est un
 * catch-all NextAuth v5 qui possède tous les chemins sous /api/auth, et une
 * route ajoutée là passerait devant lui et casserait la connexion du site
 * entier.
 *
 * Réservé aux OWNER/ADMIN : la connexion vaut pour tout le salon, et les
 * jetons obtenus donnent accès aux données de référencement du site.
 */

export const dynamic = "force-dynamic";

/**
 * Renvoie l'utilisateur sur l'écran SEO avec un code d'erreur que la page
 * traduit en message. Un code court plutôt qu'un message complet : l'URL
 * reste lisible et ne laisse rien filtrer des détails internes.
 *
 * @param {Request & { nextUrl: URL }} request
 * @param {string} errorKey
 * @returns {NextResponse}
 */
function redirectToSeo(request, errorKey) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const url = new URL("/dashboard/seo", baseUrl);
  url.searchParams.set("erreur", errorKey);
  return NextResponse.redirect(url);
}

export async function GET(request) {
  const session = await auth();

  // Un visiteur non authentifié n'a rien à faire ici : pas de redirection
  // vers l'écran SEO (qui le renverrait vers la connexion de toute façon),
  // juste un refus net.
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Authentification requise." }, { status: 401 });
  }

  if (!isAdminRole(session.user.role)) {
    return NextResponse.json({ message: "Accès non autorisé." }, { status: 403 });
  }

  if (!isGoogleOAuthConfigured()) {
    return redirectToSeo(request, "config_absente");
  }

  // Sans clé de chiffrement, le callback ne pourrait pas stocker les jetons.
  // Mieux vaut refuser avant d'envoyer l'administrateur chez Google que de
  // le laisser accorder un consentement qu'on perdra au retour.
  if (!isTokenEncryptionConfigured()) {
    return redirectToSeo(request, "cle_absente");
  }

  try {
    return NextResponse.redirect(buildGoogleConsentUrl({ userId: session.user.id }));
  } catch (error) {
    console.error("[GET /api/seo/google/connect] Échec de construction de l'URL de consentement :", error);
    return redirectToSeo(request, "config_absente");
  }
}
