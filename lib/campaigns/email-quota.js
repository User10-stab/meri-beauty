/**
 * Quota journalier d'e-mails sortants (Resend gratuit : 100/jour).
 *
 * Le quota est PARTAGÉ entre campagnes marketing et e-mails
 * transactionnels (réservations, factures…) : chaque envoi Resend réussi
 * l'incrémente (voir lib/email.js), et les campagnes ne consomment que
 * le RESTE du jour. Sans ça, une campagne de 150 prospects mangerait
 * tout et bloquerait les confirmations de rendez-vous.
 *
 * Jour calendaire Europe/Brussels (fuseau du salon), jamais de remise
 * à zéro manuelle. Dépassable via RESEND_DAILY_LIMIT (défaut 100).
 */

import { prisma } from "@/lib/prisma";

export function getDailyLimit() {
  const raw = Number(process.env.RESEND_DAILY_LIMIT || 100);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

/** Clé du jour (YYYY-MM-DD) dans le fuseau du salon. */
export function brusselsDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function getTodayUsage(day = brusselsDayKey()) {
  const row = await prisma.emailQuotaDay.findUnique({ where: { day } });
  return row?.count ?? 0;
}

/** Incrémente le compteur du jour (appelé à chaque envoi Resend réussi). */
export async function recordEmailSent(n = 1, day = brusselsDayKey()) {
  try {
    await prisma.emailQuotaDay.upsert({
      where: { day },
      create: { day, count: n },
      update: { count: { increment: n } },
    });
  } catch (error) {
    // Le comptage ne doit jamais faire échouer un envoi.
    console.error("[email-quota] recordEmailSent failed:", error?.message ?? error);
  }
}

/** Combien d'e-mails la campagne peut encore envoyer aujourd'hui. */
export async function remainingQuota() {
  const used = await getTodayUsage();
  return Math.max(0, getDailyLimit() - used);
}

/**
 * Taille de la prochaine tranche : min(reste quota, reste file).
 * Pure (testée) — l'appel DB reste dans remainingQuota().
 */
export function computeBatchSize(remaining, pendingCount) {
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  if (!Number.isFinite(pendingCount) || pendingCount <= 0) return 0;
  return Math.min(Math.floor(remaining), Math.floor(pendingCount));
}

/** Prochaine reprise : dans 24 h (le "lendemain" pour le quota jour). */
export function nextResumeAt(from = new Date()) {
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}
