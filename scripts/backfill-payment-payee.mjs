/**
 * Backfills the two ownership links introduced for Stripe Connect:
 *
 *   Animator.staffId       the staff profile an animator IS (was matched by e-mail)
 *   Payment.payeeStaffId   whose money a payment is (null = the salon)
 *
 * New payments get payeeStaffId from lib/payments/resolve-payee.js when they
 * are created. This script gives the same answer to the rows written before
 * that existed — with one deliberate exception.
 *
 * A past payment is only handed to an independent when nothing already says
 * it was the salon's:
 *   - no salon document was issued for it (no Invoice, no ticket number) —
 *     a salon invoice or ticket is a legal statement that it was a salon
 *     sale, and relabelling the payment would contradict a document that
 *     cannot be taken back;
 *   - and the money did not land on the salon's own Stripe account (an online
 *     atelier/formation seat before the switch was charged to the platform).
 * Those rows stay the salon's and are LISTED, so the call on each one is a
 * human one.
 *
 * "Independent" is the same rule as resolve-payee.js, restated here because a
 * plain node script cannot import the app's "@/…" modules: Staff.type
 * INDEPENDENT, and not the salon itself (an ADMIN/OWNER account, or the
 * TILL_CASH_OPERATOR_EMAIL account — Marie Mercier). Keep the two in step.
 *
 * Dry run by default. Idempotent — only rows still null are considered.
 *
 *   node scripts/backfill-payment-payee.mjs            # report only
 *   node scripts/backfill-payment-payee.mjs --apply    # write
 *   DATABASE_URL=<prod-url> node scripts/backfill-payment-payee.mjs
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: [".env.local", ".env"], quiet: true });

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();
const OPERATOR_EMAIL = (process.env.TILL_CASH_OPERATOR_EMAIL || "contact@meribeautystudio.com").toLowerCase();

async function main() {
  console.log(apply ? "== APPLY ==" : "== DRY RUN (pass --apply to write) ==");

  // ── 1. Animator.staffId ────────────────────────────────────────────────
  const animators = await prisma.animator.findMany({
    where: { staffId: null, email: { not: null } },
    select: { id: true, name: true, email: true },
  });
  const animatorLinks = [];
  for (const animator of animators) {
    const staff = await prisma.staff.findFirst({
      where: { isDeleted: false, user: { email: { equals: animator.email, mode: "insensitive" } } },
      select: { id: true, user: { select: { fullName: true } } },
    });
    if (staff) animatorLinks.push({ animator, staff });
  }
  console.log(`\nAnimators linked to a staff profile: ${animatorLinks.length}`);
  for (const { animator, staff } of animatorLinks) {
    console.log(`  ${animator.name} <${animator.email}> → ${staff.user.fullName}`);
  }
  if (apply) {
    for (const { animator, staff } of animatorLinks) {
      await prisma.animator.update({ where: { id: animator.id }, data: { staffId: staff.id } });
    }
  }
  // Payee resolution below reads the links — use them even on a dry run.
  const animatorStaff = new Map(animatorLinks.map(({ animator, staff }) => [animator.id, staff.id]));
  const linkedAnimators = await prisma.animator.findMany({ where: { staffId: { not: null } }, select: { id: true, staffId: true } });
  for (const a of linkedAnimators) animatorStaff.set(a.id, a.staffId);

  // ── 2. Who is independent ──────────────────────────────────────────────
  const salonUsers = await prisma.user.findMany({
    where: { OR: [{ role: { in: ["ADMIN", "OWNER"] } }, { email: { equals: OPERATOR_EMAIL, mode: "insensitive" } }] },
    select: { staff: { select: { id: true } } },
  });
  const salonStaffIds = new Set(salonUsers.map((u) => u.staff?.id).filter(Boolean));
  const independents = await prisma.staff.findMany({
    where: { type: "INDEPENDENT" },
    select: { id: true, user: { select: { fullName: true } } },
  });
  const independentNames = new Map(
    independents.filter((s) => !salonStaffIds.has(s.id)).map((s) => [s.id, s.user.fullName])
  );
  console.log(`\nIndependent payees: ${[...independentNames.values()].join(", ") || "(none)"}`);

  // ── 3. Payment.payeeStaffId ────────────────────────────────────────────
  const payments = await prisma.payment.findMany({
    where: {
      payeeStaffId: null,
      OR: [{ appointmentId: { not: null } }, { workshopReservationId: { not: null } }, { formationReservationId: { not: null } }],
    },
    select: {
      id: true,
      paymentType: true,
      paidAmount: true,
      ticketNumber: true,
      transactionReference: true,
      invoice: { select: { number: true } },
      appointment: { select: { staffId: true, date: true } },
      workshopReservation: {
        select: { session: { select: { animatorId: true, startDate: true, workshop: { select: { animatorId: true, title: true } } } } },
      },
      formationReservation: {
        select: { session: { select: { animatorId: true, startDate: true, formation: { select: { animatorId: true, title: true } } } } },
      },
    },
  });

  const toAssign = [];
  const keptSalon = [];
  for (const p of payments) {
    let staffId = null;
    let label = "";
    let chargedToPlatform = false;
    if (p.appointment) {
      staffId = p.appointment.staffId;
      label = `RDV ${p.appointment.date.toISOString().slice(0, 10)}`;
      // Appointment checkouts have always been direct charges on the
      // practitioner's connected account, never the platform's.
    } else {
      const res = p.workshopReservation ?? p.formationReservation;
      const catalogue = res.session.workshop ?? res.session.formation;
      const animatorId = res.session.animatorId ?? catalogue.animatorId;
      staffId = animatorId ? animatorStaff.get(animatorId) ?? null : null;
      label = `${catalogue.title} ${res.session.startDate.toISOString().slice(0, 10)}`;
      chargedToPlatform = Boolean(p.transactionReference);
    }
    if (!staffId || !independentNames.has(staffId)) continue;

    const salonDocuments = [p.invoice?.number, p.ticketNumber].filter(Boolean);
    const row = { id: p.id, staffId, who: independentNames.get(staffId), label, amount: Number(p.paidAmount) };
    if (salonDocuments.length > 0 || chargedToPlatform) {
      keptSalon.push({
        ...row,
        reason: salonDocuments.length > 0 ? `document salon ${salonDocuments.join(" / ")}` : "payé sur le Stripe du salon",
      });
    } else {
      toAssign.push(row);
    }
  }

  console.log(`\nPayments handed to their independent: ${toAssign.length}`);
  for (const r of toAssign) console.log(`  ${r.id}  ${r.who}  ${r.label}  ${r.amount.toFixed(2)} €`);
  console.log(`\nPayments KEPT as the salon's — review each one: ${keptSalon.length}`);
  for (const r of keptSalon) console.log(`  ${r.id}  ${r.who}  ${r.label}  ${r.amount.toFixed(2)} €  (${r.reason})`);

  if (apply) {
    for (const r of toAssign) {
      await prisma.payment.update({ where: { id: r.id }, data: { payeeStaffId: r.staffId } });
    }
    console.log("\nWritten.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
