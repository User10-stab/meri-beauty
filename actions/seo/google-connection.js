"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { isTokenEncryptionConfigured } from "@/lib/token-encryption";
import { getConfiguredSiteUrl, isGoogleOAuthConfigured } from "@/lib/seo/google-oauth";
import { getActiveConnection } from "@/lib/seo/search-console";
import { invalidateCache } from "@/lib/seo/cache";
import { SEO_ERROR_CODES, failure } from "@/lib/seo/errors";

/**
 * Server actions de gestion de la connexion Google Search Console.
 *
 * Règle non négociable de ce fichier : aucune valeur renvoyée ne contient de
 * jeton, chiffré ou non. Tout ce qui sort d'ici est destiné à traverser le
 * réseau vers le navigateur.
 */

/**
 * Garde d'accès commune : OWNER/ADMIN uniquement.
 * @returns {Promise<{ session: object } | { failure: object }>}
 */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return {
      failure: { success: false, code: "ACCES_REFUSE", message: "Accès non autorisé.", data: null },
    };
  }
  return { session };
}

/**
 * L'état de l'intégration, tel que l'écran SEO doit l'afficher.
 *
 * Renvoie toujours `success: true` avec un état descriptif quand l'appelant
 * a le droit d'être là : « non configuré » et « non connecté » sont des
 * états normaux de l'écran, pas des erreurs.
 *
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: object | null }>}
 */
export async function getGoogleConnectionStatus() {
  const guard = await requireAdmin();
  if (guard.failure) return guard.failure;

  const configured = isGoogleOAuthConfigured();
  const encryptionReady = isTokenEncryptionConfigured();

  if (!configured || !encryptionReady) {
    return {
      success: true,
      data: {
        configured: false,
        encryptionReady,
        connected: false,
        googleEmail: null,
        siteUrl: getConfiguredSiteUrl(),
        connectedAt: null,
        // Ce que l'administrateur doit renseigner : listé explicitement pour
        // que l'écran dise quoi faire au lieu d'un « non configuré » opaque.
        missingEnv: [
          !process.env.GOOGLE_CLIENT_ID?.trim() ? "GOOGLE_CLIENT_ID" : null,
          !process.env.GOOGLE_CLIENT_SECRET?.trim() ? "GOOGLE_CLIENT_SECRET" : null,
          !encryptionReady ? "GOOGLE_TOKEN_ENCRYPTION_KEY" : null,
        ].filter(Boolean),
      },
    };
  }

  const connection = await getActiveConnection();

  return {
    success: true,
    data: {
      configured: true,
      encryptionReady: true,
      connected: Boolean(connection),
      googleEmail: connection?.googleEmail ?? null,
      siteUrl: connection?.siteUrl ?? getConfiguredSiteUrl(),
      connectedAt: connection?.createdAt ?? null,
      missingEnv: [],
    },
  };
}

/**
 * Supprime la connexion enregistrée.
 *
 * La ligne est supprimée, pas seulement vidée : un refresh token chiffré qui
 * traîne reste un accès au compte Google du salon. La révocation côté Google
 * n'est pas tentée ici — elle appartient à l'utilisateur, depuis son compte
 * Google, et une révocation qui échoue ne doit pas empêcher la suppression
 * locale.
 *
 * @returns {Promise<{ success: boolean, message: string, data: null }>}
 */
export async function disconnectGoogleSearchConsole() {
  const guard = await requireAdmin();
  if (guard.failure) return guard.failure;

  const connection = await getActiveConnection();
  if (!connection) {
    return { success: false, message: "Aucune connexion Google à supprimer.", data: null };
  }

  await prisma.googleConnection.delete({ where: { id: connection.id } });
  invalidateCache();
  revalidatePath("/dashboard/seo");

  return { success: true, message: "Connexion Google Search Console supprimée.", data: null };
}

/**
 * Enregistre la propriété Search Console à interroger.
 *
 * @param {string} siteUrl - Tel que Google l'identifie
 *   ("https://exemple.com/" ou "sc-domain:exemple.com").
 * @returns {Promise<{ success: boolean, message: string, data: null }>}
 */
export async function setSearchConsoleSite(siteUrl) {
  const guard = await requireAdmin();
  if (guard.failure) return guard.failure;

  if (typeof siteUrl !== "string" || !siteUrl.trim()) {
    return { success: false, message: "Aucune propriété sélectionnée.", data: null };
  }

  const connection = await getActiveConnection();
  if (!connection) return failure(SEO_ERROR_CODES.NON_CONNECTE);

  await prisma.googleConnection.update({
    where: { id: connection.id },
    data: { siteUrl: siteUrl.trim() },
  });

  // Les chiffres en cache portent sur l'ancienne propriété.
  invalidateCache();
  revalidatePath("/dashboard/seo");

  return { success: true, message: "Propriété enregistrée.", data: null };
}
