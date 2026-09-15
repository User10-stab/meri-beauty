/**
 * Backfills the new global ticket-number sequence (lib/tickets/allocate-ticket-number.js)
 * onto every historical Order and Payment that settled before this system
 * existed.
 *
 * Before this script, "ticket number" was never a real database column — it
 * was computed at render time, differently per sale type (T-C-<orderNumber>
 * for a boutique Order, T-<raw cuid> for an appointment/workshop/formation
 * Payment). This assigns each already-settled row a real, permanent
 * T-<year>-<seq> number, in the order it would have been issued live: sorted
 * by its actual settlement timestamp, one shared sequence per Brussels
 * calendar year, walked chronologically and allocated through the exact same
 * `allocateOrderTicketNumber`/`allocatePaymentTicketNumber` the live code
 * now calls at settlement — never a separate reimplementation of "how a
 * number is minted".
 *
 * SELECTION
 *   Orders   : payment.status = "PAID" AND ticketNumber IS NULL.
 *              Timestamp = payment.paidAt (an Order's payment is always
 *              one-shot, never partial, so this is reliable).
 *   Payments : status = "PAID" AND ticketNumber IS NULL, exactly one of
 *              appointmentId/workshopReservationId/formationReservationId set.
 *              Timestamp = the LAST live settlement Transaction.paidAt
 *              (DEPOSIT/FINAL_PAYMENT, amount > 0, not deleted) — the same
 *              "final leg" definition lib/cash-book/ticket-identity.js's
 *              consolidatedTicketFields already uses. NOT payment.paidAt,
 *              which stays pinned to the *original* deposit date and is
 *              never rewritten when a balance is collected later.
 *
 * KNOWN LIMITATION: a no-show'd deposit-only payment
 * (lib/reservations/settle-reservation.js#markReservationNoShow,
 * actions/appointment/manage-appointment.js#markAppointmentNoShow) has no
 * "marked no-show" timestamp anywhere in the schema, so its backfilled
 * position uses the original deposit date instead — a small, pre-existing
 * data gap this script cannot fully correct.
 *
 * WHAT IT NEVER TOUCHES: every other field on Order/Payment. Only
 * ticketNumber and ticketKind are written, and only on rows where
 * ticketNumber is currently NULL.
 *
 * Idempotent and resumable — re-running only ever touches rows still
 * matching `ticketNumber IS NULL`, so a crash mid-run (or a deliberate stop
 * to inspect progress) is safe to resume by just invoking --apply again.
 * Dry run by default.
 *
 *   node scripts/backfill-ticket-numbers.mjs            # report only
 *   node scripts/backfill-ticket-numbers.mjs --apply    # write
 *   DATABASE_URL=<prod-url> node scripts/backfill-ticket-numbers.mjs --apply
 *
 * Exit code is 0 on a clean report/apply, 1 if the post-run invariant check
 * (zero gaps, zero duplicates, no previously-set ticketNumber changed) fails.
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { allocateOrderTicketNumber, allocatePaymentTicketNumber, ticketYear } from "../lib/tickets/allocate-ticket-number.js";

config({ path: [".env.local", ".env"], quiet: true });

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

// Each row costs two round trips inside the allocator (find + update) against
// a remote Neon connection — Prisma's 5s default interactive-transaction
// timeout was measured failing well before a 100-row batch could finish
// (P2028), the same class of issue documented at every settlement
// transaction in lib/reservations/settle-reservation.js and friends. A
// smaller batch with real headroom is safer than a longer timeout on a huge
// one — less rework if a single batch does fail partway through.
const BATCH_SIZE = 25;
const BATCH_TRANSACTION_OPTIONS = { timeout: 30000, maxWait: 10000 };
const LIVE_COLLECTION = { isDeleted: false, transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] }, amount: { gt: 0 } };

async function loadCandidateOrders() {
  const rows = await prisma.order.findMany({
    where: { ticketNumber: null, payment: { status: "PAID" } },
    select: { id: true, payment: { select: { paidAt: true } } },
  });
  return rows
    .filter((o) => o.payment?.paidAt)
    .map((o) => ({ table: "order", id: o.id, timestamp: new Date(o.payment.paidAt) }));
}

async function loadCandidatePayments() {
  const rows = await prisma.payment.findMany({
    where: {
      ticketNumber: null,
      status: "PAID",
      OR: [{ appointmentId: { not: null } }, { workshopReservationId: { not: null } }, { formationReservationId: { not: null } }],
    },
    select: {
      id: true,
      appointmentId: true,
      workshopReservationId: true,
      formationReservationId: true,
      workshopReservation: { select: { session: { select: { workshop: { select: { type: true } } } } } },
      transactions: { where: LIVE_COLLECTION, orderBy: [{ paidAt: "asc" }, { id: "asc" }], select: { paidAt: true } },
    },
  });

  const out = [];
  for (const p of rows) {
    const lastLeg = p.transactions.at(-1);
    if (!lastLeg?.paidAt) continue; // No recorded collection — nothing to date this by; skip rather than guess.
    const kind = p.appointmentId ? "APPOINTMENT" : p.workshopReservationId ? "WORKSHOP" : "FORMATION";
    const activityType = kind === "WORKSHOP" ? p.workshopReservation?.session?.workshop?.type ?? null : null;
    out.push({ table: "payment", id: p.id, timestamp: new Date(lastLeg.paidAt), kind, activityType });
  }
  return out;
}

function groupByYear(rows) {
  const byYear = new Map();
  for (const row of rows) {
    const year = ticketYear(row.timestamp);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }
  for (const list of byYear.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp || a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
}

async function allocateBatch(batch) {
  await prisma.$transaction(async (tx) => {
    for (const row of batch) {
      if (row.table === "order") {
        await allocateOrderTicketNumber(tx, row.id, row.timestamp);
      } else {
        await allocatePaymentTicketNumber(tx, row.id, row.kind, row.activityType, row.timestamp);
      }
    }
  }, BATCH_TRANSACTION_OPTIONS);
}

/** Zero gaps, zero duplicates, per year, across both tables combined. */
async function assertContiguous() {
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({ where: { ticketNumber: { not: null } }, select: { ticketNumber: true } }),
    prisma.payment.findMany({ where: { ticketNumber: { not: null } }, select: { ticketNumber: true } }),
  ]);
  const all = [...orders, ...payments].map((r) => r.ticketNumber);

  const seen = new Map();
  for (const t of all) seen.set(t, (seen.get(t) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t);

  const byYear = new Map();
  for (const t of all) {
    const m = /^T-(\d{4})-(\d+)$/.exec(t);
    if (!m) continue;
    const [, year, seq] = m;
    if (!byYear.has(year)) byYear.set(year, new Set());
    byYear.get(year).add(Number(seq));
  }
  const gaps = [];
  for (const [year, seqs] of byYear) {
    const max = Math.max(...seqs);
    for (let i = 1; i <= max; i++) {
      if (!seqs.has(i)) gaps.push(`T-${year}-${String(i).padStart(6, "0")}`);
    }
  }
  return { duplicates, gaps, total: all.length };
}

async function main() {
  const before = apply
    ? await prisma.$transaction([
        prisma.order.findMany({ where: { ticketNumber: { not: null } }, select: { id: true, ticketNumber: true } }),
        prisma.payment.findMany({ where: { ticketNumber: { not: null } }, select: { id: true, ticketNumber: true } }),
      ])
    : null;

  const [orderRows, paymentRows] = await Promise.all([loadCandidateOrders(), loadCandidatePayments()]);
  const grouped = groupByYear([...orderRows, ...paymentRows]);
  const totalCandidates = orderRows.length + paymentRows.length;

  console.log(apply ? "APPLYING" : "DRY RUN — nothing will be written");
  console.log("");
  console.log(`  orders missing a ticket   : ${orderRows.length}`);
  console.log(`  payments missing a ticket : ${paymentRows.length}`);
  console.log("");
  for (const [year, rows] of grouped) {
    console.log(`  ${year}: ${rows.length} to number, earliest ${rows[0].timestamp.toISOString()}, latest ${rows.at(-1).timestamp.toISOString()}`);
  }

  if (totalCandidates === 0) {
    console.log("");
    console.log("Nothing to do — every settled Order/Payment already has a ticket number.");
    return;
  }

  if (!apply) {
    console.log("");
    console.log("Re-run with --apply to write these ticket numbers.");
    return;
  }

  let done = 0;
  for (const [, rows] of grouped) {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await allocateBatch(batch);
      done += batch.length;
      console.log(`  ...${done}/${totalCandidates} allocated`);
    }
  }

  console.log("");
  console.log("Verifying: zero gaps, zero duplicates, no previously-set ticketNumber changed...");

  const beforeMap = new Map(before.flat().map((r) => [r.id, r.ticketNumber]));
  const afterOrders = await prisma.order.findMany({ where: { id: { in: [...beforeMap.keys()] } }, select: { id: true, ticketNumber: true } });
  const afterPayments = await prisma.payment.findMany({ where: { id: { in: [...beforeMap.keys()] } }, select: { id: true, ticketNumber: true } });
  const changed = [...afterOrders, ...afterPayments].filter((r) => beforeMap.has(r.id) && beforeMap.get(r.id) !== r.ticketNumber);
  if (changed.length > 0) {
    console.error(`REFUSING TO REPORT SUCCESS — ${changed.length} row(s) that already had a ticketNumber changed value.`);
    console.error(changed.slice(0, 10));
    process.exitCode = 1;
    return;
  }

  const { duplicates, gaps, total } = await assertContiguous();
  if (duplicates.length > 0) {
    console.error(`REFUSING TO REPORT SUCCESS — ${duplicates.length} duplicate ticket number(s): ${duplicates.slice(0, 10).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (gaps.length > 0) {
    console.error(`REFUSING TO REPORT SUCCESS — ${gaps.length} gap(s) in the sequence: ${gaps.slice(0, 10).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Done. ${total} ticket numbers total, contiguous, no duplicates.`);
}

main()
  .catch((error) => {
    console.error("[backfill-ticket-numbers]", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
