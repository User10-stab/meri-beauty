/**
 * Clears the outstanding-balance fields on bookings that were cancelled
 * before those fields were being reset.
 *
 * Cancelling a reservation leaves the money wherever it lands — refunded to
 * the customer, or forfeited as a non-refundable deposit — but either way the
 * salon will never collect another cent against it. Two fields were left
 * saying otherwise:
 *
 *   Payment.remainingAmount          "this booking still owes X"
 *   WorkshopReservation.balanceDue   idem
 *   FormationReservation.balanceDue  idem
 *
 * so a row could read "REFUNDED" and "still owes 60 €" at the same time. The
 * cancellation paths now zero both (actions/{workshops,formations}/manage-
 * reservation.js, cleared once before the money branches rather than inside
 * one — the refund branch is where most of the wrong rows came from). This
 * script fixes the rows written before that.
 *
 * Nothing surfaces the contradiction today: the counter only searches
 * CONFIRMED reservations, so a cancelled one never appears. It matters for
 * anything that answers "how much is outstanding?", which would count money
 * that is never coming.
 *
 * WHAT IT NEVER TOUCHES
 *   paidAmount     — what actually arrived, and what the revenue reports sum
 *                    (REVENUE_STATUSES in actions/dashboard/get-reports-data.js).
 *                    Income is unchanged by this script.
 *   totalAmount    — the agreed price, kept so the row still shows this was a
 *   totalPrice       part-payment on a larger booking.
 *   paymentType    — DEPOSIT stays DEPOSIT.
 *   status         — PAID stays PAID, REFUNDED stays REFUNDED. The status was
 *                    never the wrong part.
 *   Transaction    — untouched entirely. The money events are the ledger.
 *
 * Only ever writes zeros into the two forward-looking fields, and only on
 * bookings whose status is already CANCELLED.
 *
 * Dry run by default. Idempotent — running it twice changes nothing the
 * second time, so it is safe to re-run after a deploy.
 *
 *   node scripts/clear-cancelled-booking-balances.mjs            # report only
 *   node scripts/clear-cancelled-booking-balances.mjs --apply    # write
 *   DATABASE_URL=<prod-url> node scripts/clear-cancelled-booking-balances.mjs
 *
 * Exit code is 0 on a clean report and on a successful apply; 1 only if the
 * write itself failed.
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: [".env.local", ".env"], quiet: true });

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

const money = (n) => `${Number(n ?? 0).toFixed(2)} €`;
const EPSILON = 0.01;

/** Payments whose booking is cancelled but which still claim an amount due. */
const stalePaymentWhere = {
  isDeleted: false,
  remainingAmount: { gt: EPSILON },
  OR: [
    { workshopReservation: { status: "CANCELLED" } },
    { formationReservation: { status: "CANCELLED" } },
  ],
};

const staleReservationWhere = { status: "CANCELLED", balanceDue: { gt: EPSILON } };

async function main() {
  const payments = await prisma.payment.findMany({
    where: stalePaymentWhere,
    select: {
      id: true,
      status: true,
      paymentType: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      workshopReservation: { select: { id: true } },
      formationReservation: { select: { id: true } },
    },
  });

  const workshops = await prisma.workshopReservation.count({ where: staleReservationWhere });
  const formations = await prisma.formationReservation.count({ where: staleReservationWhere });

  const phantom = payments.reduce((sum, p) => sum + Number(p.remainingAmount), 0);
  const byStatus = new Map();
  for (const p of payments) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);

  console.log(apply ? "APPLYING" : "DRY RUN — nothing will be written");
  console.log("");
  console.log(`  payments   remainingAmount -> 0 : ${payments.length}`);
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  currently ${status}`);
  }
  console.log(`  workshops  balanceDue      -> 0 : ${workshops}`);
  console.log(`  formations balanceDue      -> 0 : ${formations}`);
  console.log("");
  console.log(`  phantom "outstanding" removed   : ${money(phantom)}`);
  console.log(`  collected money touched         : 0.00 € (paidAmount is never written)`);

  if (payments.length === 0 && workshops === 0 && formations === 0) {
    console.log("");
    console.log("Nothing to do — every cancelled booking already reports a zero balance.");
    return;
  }

  if (!apply) {
    console.log("");
    console.log("Re-run with --apply to write these zeros.");
    return;
  }

  // Sum what was collected before and after, and refuse to finish if it moved.
  // The one thing this script must never do is disturb real income, so it is
  // checked rather than asserted in a comment.
  const collectedBefore = await prisma.payment.aggregate({ _sum: { paidAmount: true } });

  const [updatedPayments, updatedWorkshops, updatedFormations] = await prisma.$transaction([
    prisma.payment.updateMany({ where: stalePaymentWhere, data: { remainingAmount: 0 } }),
    prisma.workshopReservation.updateMany({ where: staleReservationWhere, data: { balanceDue: 0 } }),
    prisma.formationReservation.updateMany({ where: staleReservationWhere, data: { balanceDue: 0 } }),
  ]);

  const collectedAfter = await prisma.payment.aggregate({ _sum: { paidAmount: true } });
  const drift = Number(collectedAfter._sum.paidAmount ?? 0) - Number(collectedBefore._sum.paidAmount ?? 0);

  console.log("");
  console.log(`  payments updated   : ${updatedPayments.count}`);
  console.log(`  workshops updated  : ${updatedWorkshops.count}`);
  console.log(`  formations updated : ${updatedFormations.count}`);
  console.log("");
  if (Math.abs(drift) > EPSILON) {
    console.error(`REFUSING TO REPORT SUCCESS — total collected moved by ${money(drift)}.`);
    console.error("Nothing in this script writes paidAmount. Investigate before trusting this run.");
    process.exitCode = 1;
    return;
  }
  console.log(`Total collected unchanged (${money(collectedAfter._sum.paidAmount)}). Done.`);
}

main()
  .catch((error) => {
    console.error("[clear-cancelled-booking-balances]", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
