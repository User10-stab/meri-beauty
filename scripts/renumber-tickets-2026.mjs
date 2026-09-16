/**
 *   node scripts/renumber-tickets-2026.mjs                      # dry run
 *   node scripts/renumber-tickets-2026.mjs --apply              # write
 *   node scripts/renumber-tickets-2026.mjs --database-url=<url> # choisir la base
 *   DATABASE_URL=<url> node scripts/renumber-tickets-2026.mjs --apply
 *
 * La base visée est affichée, avec sa provenance, avant toute action.
 * Lire cette ligne à chaque fois.
 *
 * One-shot data correction, 16/09/2026.
 *
 * Every practitioner at Meri Beauty is legally independent, with her own VAT
 * number, so a sale one of them collects is documented under HER number, not
 * the salon's. The code now refuses to mint a ticket for such a sale at all
 * (lib/tickets/allocate-ticket-number.js). Three tickets were minted before
 * that landed: T-2026-000035/36/37, all three Julie Schoemans'. They are the
 * salon's numbers on someone else's sales.
 *
 * Clearing them alone would punch three holes in a sequence whose entire
 * purpose is to have none, so the 41 that remain are renumbered 1..41 in
 * their original chronological order — the exact ordering
 * scripts/backfill-ticket-numbers.mjs used to mint them: an Order dates from
 * its payment's paidAt, a Payment from its LAST live collection leg, ties
 * broken by table then id.
 *
 * What it does NOT touch: the transactions, the payments and the
 * appointments themselves. Julie's three sales stay in the database in full.
 * Only the salon's numbering is withdrawn from them.
 *
 * Idempotent. Run it twice and the second run reports "already applied" and
 * writes nothing. Everything happens in ONE transaction: a failure anywhere
 * leaves the sequence exactly as it was.
 *
 * Deliberately NOT importing lib/tickets/allocate-ticket-number.js: that
 * module mints the NEXT number and is now guarded against staff actors. This
 * script rewrites EXISTING numbers, which is a different operation, and
 * borrowing the allocator would both fight the guard and burn counter
 * values. It also keeps this file free of the CommonJS/ESM interop problem
 * that forces the backfill to run through an npm script (see that file's
 * header) — plain `node` is enough here.
 *
 * Exit code 0 on a clean dry run or apply, 1 on any refusal or failed
 * verification.
 */

// MUST stay above the @prisma/client import — it snapshots the caller's
// DATABASE_URL before Prisma loads `.env` over it. That module's header
// explains why resolving this any other way picks the wrong database.
import { resolveDatabaseUrl, describeTarget } from "./resolve-database-url.mjs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const YEAR = 2026;
const COUNTER_KEY = `TICKET-${YEAR}`;
const SERIES = `T-${YEAR}-`;
// A second, disjoint namespace to park numbers in between the two passes.
// Both Order.ticketNumber and Payment.ticketNumber are UNIQUE, so assigning
// 1..41 directly would collide with whichever row currently holds the number
// being written the moment the two sets overlap — which, renumbering 35..44
// downwards, they do immediately.
const TEMP_SERIES = `TMPRENUM-${YEAR}-`;

// The sales whose numbers are being withdrawn, and who they must belong to.
// Both are asserted before anything is written — this script refuses to run
// against a database that does not look exactly like the one it was written
// for.
const TARGET_TICKETS = [`${SERIES}000035`, `${SERIES}000036`, `${SERIES}000037`];
const TARGET_OWNER_EMAIL = "julieschoemans@gmail.com";

const pad = (n) => String(n).padStart(6, "0");

class Refusal extends Error {}
class DryRunRollback extends Error {}

/**
 * Every 2026 ticket in existence, across both tables, each carrying the
 * timestamp the backfill would have dated it by and enough identity to log.
 */
async function loadTickets(tx) {
  const [orders, payments] = await Promise.all([
    tx.order.findMany({
      where: { ticketNumber: { startsWith: SERIES } },
      select: {
        id: true,
        ticketNumber: true,
        orderNumber: true,
        payment: { select: { paidAt: true } },
        createdByStaff: { select: { email: true } },
      },
    }),
    tx.payment.findMany({
      where: { ticketNumber: { startsWith: SERIES } },
      select: {
        id: true,
        ticketNumber: true,
        appointment: { select: { staff: { select: { user: { select: { email: true } } } } } },
        transactions: {
          where: { isDeleted: false, transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] }, amount: { gt: 0 } },
          orderBy: [{ paidAt: "asc" }, { id: "asc" }],
          select: { paidAt: true },
        },
      },
    }),
  ]);

  const rows = [
    ...orders.map((o) => ({
      table: "order",
      id: o.id,
      ticketNumber: o.ticketNumber,
      label: `commande n°${o.orderNumber}`,
      // Same rule as the backfill: an Order is dated by its payment.
      timestamp: o.payment?.paidAt ? new Date(o.payment.paidAt) : null,
      owner: o.createdByStaff?.email ?? null,
    })),
    ...payments.map((p) => ({
      table: "payment",
      id: p.id,
      ticketNumber: p.ticketNumber,
      label: "paiement réservation",
      // ...and a Payment by the leg that finished the sale, not the first.
      timestamp: p.transactions.at(-1)?.paidAt ? new Date(p.transactions.at(-1).paidAt) : null,
      owner: p.appointment?.staff?.user?.email ?? null,
    })),
  ];

  // The backfill's own tie-break, reproduced exactly so the 41 survivors keep
  // the relative order they were first issued in.
  rows.sort(
    (a, b) =>
      (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0) ||
      a.table.localeCompare(b.table) ||
      a.id.localeCompare(b.id)
  );
  return rows;
}

/**
 * Step 1 — decide which of three situations this database is in, and refuse
 * anything that is none of them.
 *
 * The signal is OWNERSHIP, not the numbers. Numbering is what this script
 * rewrites: after a successful run T-2026-000035/36/37 exist again, on three
 * of the salon's own sales, so "do those numbers exist?" answers a different
 * question on the second run than on the first and makes a re-run look like
 * a corrupted database. "Does any ticket still belong to an independent?"
 * means the same thing before and after.
 */
function classifyState(rows) {
  const owned = rows.filter((r) => r.owner === TARGET_OWNER_EMAIL);
  if (owned.length === 0) return { done: true, targets: [] };

  const found = owned.map((r) => r.ticketNumber).sort();
  const expected = [...TARGET_TICKETS].sort();
  if (found.length !== expected.length || found.some((n, i) => n !== expected[i])) {
    throw new Refusal(
      `les tickets de ${TARGET_OWNER_EMAIL} sont ${found.join(", ")}, ` +
        `attendu ${expected.join(", ")} — ce n'est pas la base attendue`
    );
  }
  return { done: false, targets: owned };
}

function verifyResult(rows) {
  const numbers = rows.map((r) => r.ticketNumber).sort();
  const problems = [];

  if (new Set(numbers).size !== numbers.length) problems.push("des numéros en double subsistent");
  const leftovers = numbers.filter((n) => n.startsWith(TEMP_SERIES));
  if (leftovers.length) problems.push(`préfixe temporaire résiduel : ${leftovers.join(", ")}`);

  const expected = rows.map((_, i) => `${SERIES}${pad(i + 1)}`).sort();
  const missing = expected.filter((n) => !numbers.includes(n));
  if (missing.length) problems.push(`trous dans la série : ${missing.join(", ")}`);

  return problems;
}

async function main() {
  const { url, from } = resolveDatabaseUrl();
  if (!url) {
    console.error("✗ Abandon : aucune DATABASE_URL (ni --database-url=, ni .env.local, ni .env).");
    process.exitCode = 1;
    return;
  }
  console.log(`Base cible : ${describeTarget(url)}   [source : ${from}]`);
  console.log(APPLY ? "Mode       : ÉCRITURE (--apply)\n" : "Mode       : SIMULATION (aucune écriture ; --apply pour écrire)\n");

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  // Distinguishes "corrected" from "there was nothing to correct" in the
  // closing line — a re-run that reports success reads as a second correction
  // having happened, which is exactly the doubt this script must not create.
  let changed = false;
  try {
    await prisma.$transaction(
      async (tx) => {
        const before = await loadTickets(tx);

        // ── Idempotence ────────────────────────────────────────────────────
        const { done, targets } = classifyState(before);
        if (done) {
          const counter = await tx.numberingCounter.findUnique({ where: { key: COUNTER_KEY } });
          const problems = verifyResult(before);
          console.log(
            `Déjà appliqué : aucun ticket au nom du salon ne reste attaché à ${TARGET_OWNER_EMAIL}.\n` +
              `  ${before.length} tickets, compteur ${COUNTER_KEY} = ${counter?.lastNumber ?? "(absent)"}.`
          );
          // A re-run is also a free re-verification: say so if the sequence
          // has drifted since, rather than reporting "nothing to do" over a
          // series that has since grown a hole.
          if (problems.length) throw new Refusal(`la série n'est plus saine — ${problems.join(" ; ")}`);
          if (counter && counter.lastNumber !== before.length) {
            throw new Refusal(
              `compteur ${COUNTER_KEY} = ${counter.lastNumber} mais ${before.length} tickets existent`
            );
          }
          console.log("  Série contiguë, compteur cohérent. Rien à faire.");
          return;
        }

        // ── Step 2: the log IS the way back. Printed before anything moves.
        console.log(`État actuel — ${before.length} tickets ${SERIES}* :\n`);
        for (const row of before) {
          const mark = TARGET_TICKETS.includes(row.ticketNumber) ? "  ← À RETIRER" : "";
          console.log(
            `  ${row.ticketNumber}  ${row.table.padEnd(7)}  ${row.timestamp?.toISOString() ?? "(sans date)"}  ` +
              `${(row.owner ?? "en ligne / salon").padEnd(30)} ${row.id}${mark}`
          );
        }

        const survivors = before.filter((r) => !TARGET_TICKETS.includes(r.ticketNumber));
        console.log(
          `\nÀ retirer : ${targets.length} (${targets.map((t) => t.ticketNumber).join(", ")}) — ` +
            `${TARGET_OWNER_EMAIL}\nÀ renuméroter : ${survivors.length} → ${SERIES}000001..${pad(survivors.length)}\n`
        );

        // ── Step 3: withdraw the three numbers. The transactions, payments
        //    and appointments themselves are untouched.
        for (const row of targets) {
          await tx[row.table].update({ where: { id: row.id }, data: { ticketNumber: null } });
        }

        // ── Step 4, pass 1: park every survivor in the temp namespace, so the
        //    unique index never sees two rows wanting the same final number.
        const plan = survivors.map((row, i) => ({ ...row, final: `${SERIES}${pad(i + 1)}`, temp: `${TEMP_SERIES}${pad(i + 1)}` }));
        for (const row of plan) {
          await tx[row.table].update({ where: { id: row.id }, data: { ticketNumber: row.temp } });
        }
        // ── pass 2: land them on their final numbers.
        for (const row of plan) {
          await tx[row.table].update({ where: { id: row.id }, data: { ticketNumber: row.final } });
        }

        const moved = plan.filter((r) => r.ticketNumber !== r.final);
        console.log(`Renumérotation — ${moved.length} tickets changés de numéro :`);
        for (const row of moved) console.log(`  ${row.ticketNumber} → ${row.final}  (${row.label})`);
        if (plan.length !== moved.length) console.log(`  (${plan.length - moved.length} déjà au bon numéro)`);

        // ── Step 5: the counter must agree, or the next sale reuses a number.
        await tx.numberingCounter.upsert({
          where: { key: COUNTER_KEY },
          update: { lastNumber: plan.length },
          create: { key: COUNTER_KEY, lastNumber: plan.length },
        });
        console.log(`\nCompteur ${COUNTER_KEY} → ${plan.length}`);

        // ── Step 6: re-read from the database, never from the plan above.
        const after = await loadTickets(tx);
        const problems = verifyResult(after);
        console.log(
          `Vérification : ${after.length} tickets, ` +
            (problems.length ? `ÉCHEC — ${problems.join(" ; ")}` : "aucun trou, aucun doublon, aucun préfixe temporaire")
        );
        if (problems.length) throw new Refusal(problems.join(" ; "));

        changed = true;
        if (!APPLY) throw new DryRunRollback();
      },
      // 44 rows x up to 3 updates, plus the reads. Generous on purpose: this
      // runs once, and a timeout mid-way is the one outcome worth ruling out.
      { timeout: 120000, maxWait: 20000 }
    );

    if (!changed) console.log("\n✓ Rien à corriger.");
    else console.log(APPLY ? "\n✓ Appliqué et validé." : "\n✓ Simulation validée — transaction annulée, rien n'a été écrit.");
  } catch (error) {
    if (error instanceof DryRunRollback) {
      console.log("\n✓ Simulation validée — transaction annulée, rien n'a été écrit.");
      return;
    }
    if (error instanceof Refusal) {
      console.error(`\n✗ Abandon : ${error.message}`);
      console.error("  Rien n'a été écrit.");
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\n✗ Échec :", error);
  process.exitCode = 1;
});
