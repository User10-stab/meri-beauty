/**
 * Relance des demandes d'avis envoyées avec le lien cassé.
 *
 * Du 6 octobre au 9 novembre 2026, le bouton « Donner mon avis » menait à une
 * page introuvable (mauvais domaine + jeton perdu, corrigé par la PR #95,
 * déployée le 2026-11-09 à 09:46 UTC). Ce script renvoie un email avec un
 * lien valide aux clientes concernées, sur une période de prestations donnée.
 *
 * Sont relancées : rendez-vous / ateliers / formations TERMINÉS, sans avis,
 * dont la demande d'avis est partie AVANT le correctif. Les commandes
 * boutique sont exclues : leur avis ne peut pas encore être enregistré.
 *
 * ÉTAPES (rien n'est envoyé sans --test ou --envoyer) :
 *
 *   1. Lister, n'envoie rien :
 *        npm run relance:avis
 *   2. Tester sur SA boîte pour une réservation de la liste (ne modifie rien) :
 *        npm run relance:avis -- --test <id> --a moi@exemple.com
 *   3. Relancer UNE vraie cliente :
 *        npm run relance:avis -- --envoyer <id>
 *   4. Relancer toutes les clientes de la liste :
 *        npm run relance:avis -- --envoyer tout
 *
 * Aucune copie n'est envoyée à contact@meribeautystudio.com, sauf avec --copie.
 * Un envoi raté s'affiche en ✗ et la cliente reste dans la liste.
 *
 * Période : par défaut la semaine passée (lundi → dimanche, heure de
 * Bruxelles). Pour une autre : --du 2026-11-02 --au 2026-11-08 (inclus).
 *
 * Une cliente relancée reçoit une nouvelle date de demande, donc elle sort
 * de la liste : relancer deux fois la même commande ne renvoie rien.
 */

import { config } from "dotenv";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({ path: [".env.local", ".env"], quiet: true });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { prisma } = await jiti.import("@/lib/prisma");
const { sendReviewRequestEmail } = await jiti.import("@/lib/reviews/send-review-requests");

// Toute demande partie avant ce moment contenait le lien cassé.
const FIX_DEPLOYED_AT = new Date("2026-11-09T09:46:23Z");
const TZ = "Europe/Brussels";
const PAUSE_MS = 1500; // entre deux envois, pour ne pas être pris pour du spam

// ── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? "");
}
const testId = arg("--test");
const testTo = arg("--a");
const sendTarget = arg("--envoyer");
const withCopy = args.includes("--copie");

// Minuit à Bruxelles pour une date AAAA-MM-JJ, en instant UTC.
function brusselsMidnight(ymd) {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  return new Date(guess.getTime() - (local.getTime() - guess.getTime()));
}
function ymdInBrussels(date) {
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function lastWeek() {
  const today = ymdInBrussels(new Date());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = dimanche
  const thisMonday = addDays(today, -((dow + 6) % 7));
  return { du: addDays(thisMonday, -7), au: addDays(thisMonday, -1) };
}

const defaults = lastWeek();
const du = arg("--du") || defaults.du;
const au = arg("--au") || defaults.au;
if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || !/^\d{4}-\d{2}-\d{2}$/.test(au)) {
  console.error("Dates attendues au format AAAA-MM-JJ (ex. --du 2026-11-02 --au 2026-11-08).");
  process.exit(1);
}
const from = brusselsMidnight(du);
const to = brusselsMidnight(addDays(au, 1));

// ── Recherche des clientes concernées ───────────────────────────────────────
const requested = { not: null, lt: FIX_DEPLOYED_AT };
const inPeriod = { gte: from, lt: to };
// La tâche automatique n'a jamais réussi à traiter ateliers et formations
// (elle plantait sur session.startTime, le champ s'appelle startDate) : leurs
// clientes n'ont reçu AUCUNE demande, on les inclut donc aussi quand
// reviewRequestedAt est vide.
const requestedOrNever = { OR: [{ reviewRequestedAt: null }, { reviewRequestedAt: requested }] };

async function findTargets() {
  const [appointments, workshops, formations] = await Promise.all([
    prisma.appointment.findMany({
      where: { status: "COMPLETED", review: null, reviewRequestedAt: requested, startTime: inPeriod },
      select: {
        id: true,
        startTime: true,
        user: { select: { email: true, fullName: true } },
        staffService: { select: { service: { select: { name: true } } } },
      },
    }),
    prisma.workshopReservation.findMany({
      where: { status: "COMPLETED", review: null, ...requestedOrNever, session: { startDate: inPeriod } },
      select: {
        id: true,
        customer: { select: { email: true, fullName: true } },
        session: { select: { startDate: true, workshop: { select: { title: true } } } },
      },
    }),
    prisma.formationReservation.findMany({
      where: { status: "COMPLETED", review: null, ...requestedOrNever, session: { startDate: inPeriod } },
      select: {
        id: true,
        customer: { select: { email: true, fullName: true } },
        session: { select: { startDate: true, formation: { select: { title: true } } } },
      },
    }),
  ]);

  return [
    ...appointments.map((a) => ({
      type: "APPOINTMENT", label: "Rendez-vous", id: a.id, date: a.startTime,
      email: a.user?.email, name: a.user?.fullName,
      service: a.staffService?.service?.name ?? "votre rendez-vous",
    })),
    ...workshops.map((r) => ({
      type: "WORKSHOP", label: "Atelier", id: r.id, date: r.session?.startDate,
      email: r.customer?.email, name: r.customer?.fullName,
      service: r.session?.workshop?.title ?? "atelier",
    })),
    ...formations.map((r) => ({
      type: "FORMATION", label: "Formation", id: r.id, date: r.session?.startDate,
      email: r.customer?.email, name: r.customer?.fullName,
      service: r.session?.formation?.title ?? "formation",
    })),
  ]
    .filter((t) => t.email)
    .sort((a, b) => a.date - b.date);
}

async function markRequested(t) {
  const data = { reviewRequestedAt: new Date() };
  if (t.type === "APPOINTMENT") return prisma.appointment.update({ where: { id: t.id }, data });
  if (t.type === "WORKSHOP") return prisma.workshopReservation.update({ where: { id: t.id }, data });
  return prisma.formationReservation.update({ where: { id: t.id }, data });
}

function send(t, toAddress) {
  return sendReviewRequestEmail({
    reservationType: t.type,
    reservationId: t.id,
    email: t.email,
    customerName: t.name,
    serviceName: t.service,
    to: toAddress,
    // Pas de copie à contact@ : une relance groupée en déposerait une par
    // cliente dans la boîte du salon. --copie pour la remettre — forcée, car
    // lancé à la main, NODE_ENV n'est pas « production » et sendEmail
    // n'enverrait sinon jamais la copie.
    skipCc: !withCopy,
    forceCc: withCopy,
  });
}

function fmt(date) {
  return date ? date.toLocaleString("fr-BE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }) : "?";
}

// ── Main ────────────────────────────────────────────────────────────────────
try {
  const targets = await findTargets();
  console.log(`\nPrestations du ${du} au ${au} (Bruxelles) — demande partie avec le lien cassé, sans avis :`);
  console.log(`${targets.length} cliente(s) à relancer.\n`);
  for (const t of targets) {
    console.log(`  ${t.label.padEnd(11)} ${fmt(t.date).padEnd(17)} ${String(t.name ?? "").padEnd(24)} ${t.email.padEnd(32)} ${t.id}`);
  }
  console.log("");

  if (testId) {
    if (!testTo || !testTo.includes("@")) throw new Error("Indique ton adresse : --test <id> --a moi@exemple.com");
    const t = targets.find((x) => x.id === testId);
    if (!t) throw new Error(`Réservation ${testId} absente de la liste ci-dessus.`);
    const link = await send(t, testTo);
    console.log(`TEST envoyé à ${testTo} (la cliente n'a rien reçu, rien n'a été modifié).`);
    console.log(`Lien : ${link}`);
    console.log("Ouvre le lien et vérifie que le formulaire s'affiche, MAIS ne valide pas l'avis :");
    console.log("il serait enregistré au nom de la cliente.\n");
  } else if (sendTarget) {
    const batch = sendTarget === "tout" ? targets : targets.filter((x) => x.id === sendTarget);
    if (batch.length === 0) throw new Error(`Réservation ${sendTarget} absente de la liste ci-dessus.`);
    let ok = 0;
    for (const [i, t] of batch.entries()) {
      try {
        await send(t);
        await markRequested(t);
        ok++;
        console.log(`  ✓ ${t.email} (${t.label}, ${fmt(t.date)})`);
      } catch (err) {
        console.error(`  ✗ ${t.email} : ${err.message}`);
      }
      if (i < batch.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    console.log(`\n${ok}/${batch.length} relance(s) envoyée(s).\n`);
  } else {
    console.log("Rien n'a été envoyé. Étape suivante : --test <id> --a ton@email.com\n");
  }
} catch (err) {
  console.error(`\nErreur : ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
