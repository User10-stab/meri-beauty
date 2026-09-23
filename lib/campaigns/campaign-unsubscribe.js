/**
 * Désinscription aux campagnes pour les destinataires SANS compte
 * (prospects). Les destinataires AVEC compte utilisent le mécanisme
 * existant (buildUnsubscribeUrl, lié à userId — voir lib/newsletter-consent.js).
 *
 * Même philosophie : token HMAC lié à l'email, jamais de session requise.
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/prospects/prospect-service";

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — cannot generate or verify prospect unsubscribe tokens.");
  }
  return secret;
}

export function generateProspectUnsubscribeToken(email) {
  const normalized = normalizeEmail(email);
  return crypto.createHmac("sha256", getSecret()).update(`prospect:${normalized}`).digest("hex");
}

export function verifyProspectUnsubscribeToken(email, token) {
  const normalized = normalizeEmail(email);
  if (!normalized || !token) return false;
  try {
    const expected = Buffer.from(generateProspectUnsubscribeToken(normalized), "hex");
    const provided = Buffer.from(String(token), "hex");
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

export function buildProspectUnsubscribeUrl(baseUrl, email) {
  const normalized = normalizeEmail(email);
  const token = generateProspectUnsubscribeToken(normalized);
  return `${baseUrl}/newsletter/desabonnement?e=${encodeURIComponent(normalized)}&t=${token}`;
}

/**
 * Applique l'opt-out : flag marketingOptOut + activité
 * `newsletter_unsubscribed`. Idempotent.
 */
export async function unsubscribeProspect(email, token) {
  const normalized = normalizeEmail(email);
  if (!normalized || !verifyProspectUnsubscribeToken(normalized, token)) {
    return { success: false, message: "Ce lien de désinscription est invalide." };
  }
  const prospect = await prisma.prospect.findUnique({ where: { email: normalized } });
  if (!prospect) {
    return { success: true, message: "Vous êtes bien désinscrit(e) de nos campagnes." };
  }
  if (!prospect.marketingOptOut) {
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { marketingOptOut: true },
    });
    await prisma.prospectActivity.create({
      data: {
        prospectId: prospect.id,
        type: "newsletter_unsubscribed",
        description: "Désinscription des campagnes via le lien e-mail",
      },
    });
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { lastActivityAt: new Date(), lastEventType: "newsletter_unsubscribed" },
    });
  }
  return { success: true, message: "Vous avez bien été désinscrit(e) de nos campagnes." };
}
