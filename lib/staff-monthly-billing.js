/**
 * Anniversary-based automatic monthly invoicing engine for staff members.
 *
 * Instead of calendar-month-based billing (1st of each month), each staff member's
 * invoices are generated on their contract anniversary date.
 *
 * Example:
 *   - Staff starts on 20/09/2026 → invoiced on 20/09, 20/10, 20/11, etc.
 *   - Staff starts on 31/01/2026 → invoiced on 31/01, 28/02 (month-end), 31/03, etc.
 *
 * Entry point: sendDailyStaffInvoices()
 *   Called daily, checks each staff's nextInvoiceDate against today.
 *   If nextInvoiceDate <= today, generates the invoice (never emailed —
 *   the admin sends it manually from the dashboard), then advances
 *   nextInvoiceDate.
 *
 * Workflow per staff member:
 *   1. Load all active staff with FIXED_RENT contracts
 *   2. Check if today >= staff.nextInvoiceDate (or contract.nextInvoiceDate if multiple)
 *   3. Validate staff & contract eligibility
 *   4. Create StaffMonthlyInvoice row (with billingYear/billingMonth for dedup)
 *      with a PENDING transfer Payment
 *   5. Issue its invoice (source STAFF_CONTRACT), unpaid, with its échéance —
 *      so it can be sent before the staff member pays; « Accepter » on the
 *      Factures page only records the money (lib/staff-rent-payment.js)
 *   6. Advance nextInvoiceDate
 *
 * Then, every run: any rent still recorded WITHOUT its invoice (issued
 * before this rule, or refused for missing data since fixed) gets it, oldest
 * first — rent invoices are never issued by hand (user's call, 2026-09-22).
 */

import { prisma } from "@/lib/prisma";
import { buildRentalDescription } from "@/lib/invoicing";
import { createPendingRent, issueRentInvoiceNow, UNISSUED_RENT_ORDER, UNISSUED_RENT_WHERE } from "@/lib/staff-rent-payment";
import { sendEmail } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { captureCriticalError } from "@/lib/monitoring";
import { invoiceEmail } from "@/lib/email-templates";
import { calculateVatTotals, BELGIUM_VAT_RATE } from "@/lib/tax-policy";

// ─── TIMEZONE & DATE HELPERS ──────────────────────────────────────────────────

/**
 * Returns today's date in Europe/Brussels timezone.
 * { year: 2026, month: 9, day: 10 }
 */
export function todayInBrussels() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === "year").value),
    month: Number(parts.find((p) => p.type === "month").value),
    day: Number(parts.find((p) => p.type === "day").value),
  };
}

/**
 * Normalizes a date to midnight UTC on its calendar date (as seen in Brussels).
 * Used to compare nextInvoiceDate (stored as UTC DateTime) as a calendar date,
 * not a timestamp. E.g. 2026-09-10T14:30:00Z → 2026-09-10T00:00:00Z.
 */
function toUtcDateOnly(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

/**
 * Calculate the next anniversary invoice date based on a start date.
 *
 * If the billing day (e.g., 31st) doesn't exist in the target month,
 * use the last day of that month (month-end handling).
 *
 * @param {Date} startDate - The contract/billing start date
 * @param {Date} fromDate - Calculate next anniversary from this date
 * @param {Date|null} contractEndDate - If set, don't return date after contract ends
 * @returns {Date|null} - Next invoice date, or null if past contract end
 */
export function calculateNextAnniversaryDate(startDate, fromDate = new Date(), contractEndDate = null) {
  const billingDay = startDate.getUTCDate(); // Day of month (1-31)
  
  // Start with the first day of next month (UTC)
  const year = fromDate.getUTCFullYear();
  const month = fromDate.getUTCMonth(); // 0-11
  
  // Next month
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  
  // Get the max day in that month
  const lastDayOfNextMonth = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  
  // Use the minimum of billingDay and last day
  const dayToUse = Math.min(billingDay, lastDayOfNextMonth);
  
  // Create the date at UTC
  const nextDate = new Date(Date.UTC(nextYear, nextMonth, dayToUse, 0, 0, 0));
  
  // If contract has endDate and next_date would be after it, return null
  if (contractEndDate && nextDate > new Date(contractEndDate)) {
    return null;
  }
  
  return nextDate;
}

/**
 * Extract year/month from a date for use in StaffMonthlyInvoice dedup constraint.
 * Since billing is now anniversary-based, we still use calendar year/month for dedup,
 * but calculated from the nextInvoiceDate.
 */
function extractBillingPeriod(date) {
  const d = new Date(date);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1, // 1-12
  };
}

/**
 * First and last instant (inclusive) of the calendar month for a given date,
 * returned in UTC so Prisma date comparisons work correctly.
 *
 * Used for contract date range validation and invoice line descriptions.
 */
function brusselsMonthBounds(year, month) {
  // Midnight Brussels on the 1st of the month
  const approxFirstUtc = new Date(Date.UTC(year, month - 1, 1));
  const firstDayOffset = getBrusselsOffsetMs(approxFirstUtc);
  const firstDay = new Date(approxFirstUtc.getTime() - firstDayOffset);

  // Midnight Brussels on the 1st of the NEXT month (= exclusive upper bound)
  const approxNextUtc = new Date(Date.UTC(year, month, 1));
  const nextOffset = getBrusselsOffsetMs(approxNextUtc);
  const nextMonthFirstDay = new Date(approxNextUtc.getTime() - nextOffset);

  // lastDay = 1ms before the next month starts (inclusive end)
  const lastDay = new Date(nextMonthFirstDay.getTime() - 1);

  return { firstDay, lastDay };
}

/**
 * Get the UTC offset for a given UTC date in Brussels timezone (handles DST).
 */
function getBrusselsOffsetMs(utcDate) {
  const local = new Date(
    utcDate.toLocaleString("en-US", { timeZone: "Europe/Brussels" })
  );
  return local.getTime() - utcDate.getTime();
}

/** Month name in French for email copy and invoice descriptions. */
function frenchMonthName(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

/**
 * The rent's échéance: its billing date (the contract anniversary, the day the
 * invoice is issued) + N days, N = Contract.dueDate ("7" = 7 days), 7 when
 * unset. Billed on the 8th with N = 7 → due the 15th, every month (user's
 * call, 2026-09-22). It used to count from the 1st of the month, which put the
 * échéance before the invoice for any contract not starting on the 1st.
 * Same rule as the first period (lib/staff-invoice.js: start date + N).
 */
export function resolveDueDate(contractDueDateStr, billingDate) {
  let days = 7;
  if (contractDueDateStr != null && String(contractDueDateStr).trim() !== "") {
    const n = Number(String(contractDueDateStr).trim());
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 365) days = n;
  }
  const d = toUtcDateOnly(new Date(billingDate));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ─── PER-STAFF BILLING ─────────────────────────────────────────────────────────

/**
 * Bills a single staff member for a specific contract based on their anniversary date.
 *
 * @param {object} staff - The staff record with user and contracts
 * @param {object} contract - The specific contract to bill (must be eligible)
 * @param {Date} billingDate - The contract's nextInvoiceDate (used for billing period + dedup)
 * @returns {{ staffId, status, invoiceNumber?, emailed?, emailError?, skippedReason?, error? }}
 */
async function billStaffMember(staff, contract, billingDate) {
  const tag = `[monthly-billing] staff=${staff.id} contract=${contract.id} billingDate=${billingDate.toISOString().split("T")[0]}`;

  // ── 1. Staff eligibility ───────────────────────────────────────────────────
  if (!staff.user?.isActive || staff.user?.isDeleted) {
    console.log(`${tag} skip: staff user inactive or deleted`);
    await upsertSkipped(staff.id, billingDate, null, "Staff inactif ou supprimé");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Staff inactif ou supprimé" };
  }

  if (!staff.isActive || staff.isDeleted) {
    console.log(`${tag} skip: staff record inactive or deleted`);
    await upsertSkipped(staff.id, billingDate, null, "Fiche staff inactive ou supprimée");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Fiche staff inactive ou supprimée" };
  }

  // ── 2. Contract eligibility ────────────────────────────────────────────────
  if (contract.type !== "FIXED_RENT" || contract.status === "TERMINATED") {
    console.log(`${tag} skip: contract not eligible (type=${contract.type}, status=${contract.status})`);
    await upsertSkipped(staff.id, billingDate, contract.id, "Contrat non éligible");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Contrat non éligible" };
  }

  if (!contract.fixedRent || Number(contract.fixedRent) <= 0) {
    console.log(`${tag} skip: fixedRent <= 0`);
    await upsertSkipped(staff.id, billingDate, contract.id, "Loyer fixe invalide");
    return { staffId: staff.id, status: "SKIPPED", skippedReason: "Loyer fixe invalide" };
  }

  const { year: billingYear, month: billingMonth } = extractBillingPeriod(billingDate);
  const { firstDay, lastDay } = brusselsMonthBounds(billingYear, billingMonth);

  // ── 3. Dedup check — is there already an invoice for this billing period? ───
  const existing = await prisma.staffMonthlyInvoice.findUnique({
    where: {
      staffId_billingYear_billingMonth: {
        staffId: staff.id,
        billingYear,
        billingMonth,
      },
    },
    include: { invoice: true },
  });

  if (existing && existing.status !== "PENDING" && existing.status !== "ERROR") {
    console.log(`${tag} already billed — status=${existing.status}, skipping`);
    // This month is covered (first-period invoice, or an earlier run): move
    // the schedule on, or the catch-up would pick this date again every day.
    await advanceSchedule(staff, contract, billingDate);
    return {
      staffId: staff.id,
      status: existing.status,
      invoiceNumber: existing.invoice?.number ?? null,
      skippedReason: "Facture déjà générée pour ce mois",
    };
  }

  // ── 4. Build the rent due ──────────────────────────────────────────────────
  const amount = Number(contract.fixedRent);
  const dueDate = resolveDueDate(contract.dueDate, billingDate);

  // ── 5. Record the rent due, then invoice it ───────────────────────────────
  // The row and its PENDING Payment first; the invoice right after, in its
  // own transaction (step 5b), so a refused invoice never loses the rent.
  let pending;
  try {
    pending = await prisma.$transaction(
      (tx) =>
        createPendingRent(tx, {
          staffId: staff.id,
          contractId: contract.id,
          billingYear,
          billingMonth,
          amount,
          lineDescription: buildRentalDescription({
            startDate: firstDay,
            endDate: lastDay,
            rentalType: contract.rentalRequest?.rentalType ?? null,
          }),
          dueDate,
        }),
      { timeout: 30_000 }
    );
  } catch (err) {
    if (err?.code === "P2002") {
      console.log(`${tag} concurrent run beat us — skipping`);
      await advanceSchedule(staff, contract, billingDate);
      return { staffId: staff.id, status: "SKIPPED", skippedReason: "Créé par une exécution concurrente" };
    }

    const msg = err?.message ?? "Erreur lors de l'enregistrement du loyer";
    console.error(`${tag} transaction failed`, err);
    captureCriticalError(err, { area: "monthly-billing", staffId: staff.id, billingYear, billingMonth });
    await upsertError(staff.id, billingDate, contract.id, msg);
    return { staffId: staff.id, status: "ERROR", error: msg };
  }

  // ── 5b. Issue the invoice, unpaid, with its échéance ──────────────────────
  // A failure leaves the rent recorded and waiting: the next daily run
  // retries it (issueMissingRentInvoices) once the missing data is filled in.
  let invoiceNumber = null;
  try {
    invoiceNumber = (await issueRentInvoiceNow(pending.id)).number;
  } catch (err) {
    console.error(`${tag} rent recorded but its invoice could not be issued`, err);
    captureCriticalError(err, { area: "monthly-billing-invoice", staffId: staff.id, billingYear, billingMonth });
  }

  // ── 6. Advance the schedule ────────────────────────────────────────────
  // nextInvoiceDate advances here so the next cycle is scheduled whether or
  // not this rent has been paid yet.
  const nextDate = await advanceSchedule(staff, contract, billingDate);

  console.log(
    `${tag} ✓ rent due recorded (row=${pending.id}, invoice=${invoiceNumber ?? "NOT ISSUED — retried next run"}), nextInvoiceDate=${nextDate?.toISOString().split("T")[0] ?? "NULL"}`
  );
  return { staffId: staff.id, status: invoiceNumber ? "GENERATED" : "AWAITING_PAYMENT", invoiceNumber, emailed: false };
}

/** Schedules the anniversary after `billingDate` (null past the contract's end). */
async function advanceSchedule(staff, contract, billingDate) {
  const nextDate = calculateNextAnniversaryDate(
    new Date(contract.startDate),
    billingDate,
    contract.endDate ? new Date(contract.endDate) : null
  );
  await prisma.$transaction([
    prisma.contract.update({ where: { id: contract.id }, data: { nextInvoiceDate: nextDate } }),
    prisma.staff.update({ where: { id: staff.id }, data: { nextInvoiceDate: nextDate } }),
  ]);
  return nextDate;
}

/**
 * Bills every anniversary of this contract that is due — today's, and any
 * the job missed (the server was down that day, or the date was set in the
 * past), oldest first, at most a year's worth per run. Month dedup
 * (staff + year + month) means a month is never billed twice.
 */
const MAX_PERIODS_PER_RUN = 12;
async function billDueContract(staff, contract, today) {
  const results = [];
  let billingDate = contract.nextInvoiceDate ? new Date(contract.nextInvoiceDate) : null;
  for (let i = 0; i < MAX_PERIODS_PER_RUN && billingDate && toUtcDateOnly(billingDate) <= today; i++) {
    const result = await billStaffMember(staff, contract, billingDate);
    results.push(result);
    // Ineligible or failed: stop here, the next run retries this same date.
    if (result.status === "SKIPPED" && result.skippedReason !== "Créé par une exécution concurrente") break;
    if (result.status === "ERROR") break;
    billingDate = calculateNextAnniversaryDate(
      new Date(contract.startDate),
      billingDate,
      contract.endDate ? new Date(contract.endDate) : null
    );
  }
  return results;
}

// ─── UPSERT HELPERS ────────────────────────────────────────────────────────────

/**
 * A month already holding a real rent (recorded, invoiced, sent) is never
 * overwritten by a skip or error note — that used to happen when a
 * terminated contract of the same staff came due the same day, wiping the
 * active contract's rent for that month.
 */
async function monthHoldsRealRent(staffId, billingYear, billingMonth) {
  const row = await prisma.staffMonthlyInvoice.findUnique({
    where: { staffId_billingYear_billingMonth: { staffId, billingYear, billingMonth } },
    select: { status: true, invoiceId: true, paymentId: true },
  });
  return Boolean(row && (row.invoiceId || row.paymentId || !["PENDING", "ERROR", "SKIPPED"].includes(row.status)));
}

async function upsertSkipped(staffId, billingDate, contractId, reason) {
  const { year: billingYear, month: billingMonth } = extractBillingPeriod(billingDate);
  try {
    if (await monthHoldsRealRent(staffId, billingYear, billingMonth)) return;
    await prisma.staffMonthlyInvoice.upsert({
      where: { staffId_billingYear_billingMonth: { staffId, billingYear, billingMonth } },
      create: { staffId, billingYear, billingMonth, contractId, status: "SKIPPED", emailError: reason },
      update: { status: "SKIPPED", emailError: reason },
    });
  } catch (err) {
    console.warn("[monthly-billing] upsertSkipped failed (non-fatal)", err?.message);
  }
}

async function upsertError(staffId, billingDate, contractId, msg) {
  const { year: billingYear, month: billingMonth } = extractBillingPeriod(billingDate);
  try {
    if (await monthHoldsRealRent(staffId, billingYear, billingMonth)) return;
    await prisma.staffMonthlyInvoice.upsert({
      where: { staffId_billingYear_billingMonth: { staffId, billingYear, billingMonth } },
      create: { staffId, billingYear, billingMonth, contractId, status: "ERROR", emailError: msg },
      update: { status: "ERROR", emailError: msg },
    });
  } catch (err) {
    console.warn("[monthly-billing] upsertError failed (non-fatal)", err?.message);
  }
}

// ─── CATCH-UP ────────────────────────────────────────────────────────────────

/**
 * Issues the invoice of every rent recorded without one, oldest first and
 * one at a time, so their numbers follow the rents' age. Each is claimed
 * inside issueRentInvoiceNow, so a concurrent run can never double-issue.
 * A refusal (missing buyer or salon data) is logged and retried next run.
 */
export async function issueMissingRentInvoices() {
  const rents = await prisma.staffMonthlyInvoice.findMany({
    where: UNISSUED_RENT_WHERE,
    orderBy: UNISSUED_RENT_ORDER,
    select: { id: true, staffId: true, billingYear: true, billingMonth: true },
  });
  let issued = 0;
  let failed = 0;
  for (const rent of rents) {
    try {
      const invoice = await issueRentInvoiceNow(rent.id);
      issued++;
      console.log(`[monthly-billing] catch-up: rent ${rent.id} invoiced ${invoice.number}`);
    } catch (err) {
      if (err?.message === "STAFF_RENT_ALREADY_INVOICED") continue;
      failed++;
      console.error(`[monthly-billing] catch-up: rent ${rent.id} still not invoiced`, err?.message);
      captureCriticalError(err, { area: "monthly-billing-catch-up", staffId: rent.staffId, billingYear: rent.billingYear, billingMonth: rent.billingMonth });
    }
  }
  return { issued, failed };
}

// ─── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

/**
 * Daily billing check: find all staff whose nextInvoiceDate <= today and process them.
 * Called once per day by the background job scheduler.
 *
 * Before billing, initializes any eligible staff/contracts with null nextInvoiceDate
 * by calculating startDate + 1 month. No invoice is created during initialization.
 *
 * @returns {{
 *   billingDate: Date,
 *   processed: number,
 *   generated: number,
 *   sent: number,
 *   skipped: number,
 *   emailFailed: number,
 *   errors: number,
 *   initialized: number,
 *   results: Array,
 * }}
 */
export async function sendDailyStaffInvoices() {
  const today = todayInBrussels();
  const todayDate = toUtcDateOnly(new Date(Date.UTC(today.year, today.month - 1, today.day)));
  const tomorrowDate = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);

  console.log(`[monthly-billing] starting daily check for ${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`);

  // ── Phase 1: Initialize null nextInvoiceDate for eligible staff/contracts ──
  const uninitializedContracts = await prisma.contract.findMany({
    where: {
      type: "FIXED_RENT",
      status: { not: "TERMINATED" },
      fixedRent: { gt: 0 },
      nextInvoiceDate: null,
      staff: {
        isActive: true,
        isDeleted: false,
      },
    },
    select: { id: true, staffId: true, startDate: true, endDate: true },
  });

  let initialized = 0;
  for (const c of uninitializedContracts) {
    const nextDate = calculateNextAnniversaryDate(
      new Date(c.startDate),
      new Date(c.startDate),
      c.endDate ? new Date(c.endDate) : null
    );
    try {
      await prisma.$transaction([
        prisma.contract.update({
          where: { id: c.id },
          data: { nextInvoiceDate: nextDate },
        }),
        prisma.staff.update({
          where: { id: c.staffId },
          data: { nextInvoiceDate: nextDate },
        }),
      ]);
      initialized++;
    } catch (err) {
      console.error(`[monthly-billing] failed to initialize nextInvoiceDate for contract ${c.id}`, err);
    }
  }
  if (initialized > 0) {
    console.log(`[monthly-billing] initialized ${initialized} contract(s) with null nextInvoiceDate`);
  }

  // ── Phase 2: Load staff with due contracts ─────────────────────────────────
  // Everything before tomorrow: today's anniversaries AND any missed ones (a
  // day the server was down used to skip that month for good). Compared as a
  // calendar date: 2026-09-10T14:30:00Z is still "the 10th".
  const allStaff = await prisma.staff.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      contracts: {
        some: {
          type: "FIXED_RENT",
          status: { not: "TERMINATED" },
          fixedRent: { gt: 0 },
          nextInvoiceDate: { lt: tomorrowDate },
        },
      },
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          isActive: true,
          isDeleted: true,
          isCompany: true,
          vatNumber: true,
          vatValidatedAt: true,
          vatValidationAddress: true,
          vatValidationName: true,
          addressLine1: true,
          addressLine2: true,
          addressCity: true,
          addressPostalCode: true,
          addressCountry: true,
        },
      },
      // Only the contracts still running: a terminated one keeps its old
      // nextInvoiceDate, and used to be "billed" (skipped) the same day as
      // the active one, clobbering that month's real rent.
      contracts: {
        where: { type: "FIXED_RENT", status: { not: "TERMINATED" }, fixedRent: { gt: 0 } },
        include: {
          rentalRequest: { select: { rentalType: true } },
        },
      },
    },
  });

  console.log(`[monthly-billing] found ${allStaff.length} staff with billing dates due today`);

  // ── Phase 3: Collect all due (staff, contract) pairs ───────────────────────
  const duePairs = [];
  for (const staff of allStaff) {
    for (const contract of staff.contracts) {
      if (!contract.nextInvoiceDate) continue;
      // Normalize nextInvoiceDate to date-only for calendar-date comparison
      const contractDate = toUtcDateOnly(contract.nextInvoiceDate);
      if (contractDate.getTime() <= todayDate.getTime()) {
        duePairs.push({ staff, contract, billingDate: contract.nextInvoiceDate });
      }
    }
  }

  console.log(`[monthly-billing] ${duePairs.length} contract(s) due for billing`);

  // ── Phase 4: Process each due contract ─────────────────────────────────────
  // One after the other, so invoice numbers follow the order rents fall due.
  const results = [];
  for (const { staff, contract } of duePairs) {
    try {
      results.push(...(await billDueContract(staff, contract, todayDate)));
    } catch (err) {
      captureCriticalError(err, { area: "monthly-billing", staffId: staff.id });
      results.push({ staffId: staff.id, status: "ERROR", error: err?.message ?? "Erreur inattendue" });
    }
  }

  // ── Phase 5: invoice every rent still recorded without one ─────────────────
  let catchUp = { issued: 0, failed: 0 };
  try {
    catchUp = await issueMissingRentInvoices();
  } catch (err) {
    console.error("[monthly-billing] catch-up failed", err);
    captureCriticalError(err, { area: "monthly-billing-catch-up" });
  }

  const summary = {
    billingDate: todayDate,
    catchUpIssued: catchUp.issued,
    catchUpFailed: catchUp.failed,
    processed: results.length,
    generated: results.filter((r) => r.status === "GENERATED").length,
    awaitingPayment: results.filter((r) => r.status === "AWAITING_PAYMENT").length,
    sent: results.filter((r) => r.status === "SENT").length,
    skipped: results.filter((r) => r.status === "SKIPPED").length,
    emailFailed: results.filter((r) => r.status === "EMAIL_FAILED").length,
    errors: results.filter((r) => r.status === "ERROR").length,
    initialized,
    results,
  };

  console.log(
    `[monthly-billing] done — processed=${summary.processed} awaitingPayment=${summary.awaitingPayment} generated=${summary.generated} ` +
    `sent=${summary.sent} skipped=${summary.skipped} emailFailed=${summary.emailFailed} errors=${summary.errors} initialized=${summary.initialized} ` +
    `catchUpIssued=${summary.catchUpIssued} catchUpFailed=${summary.catchUpFailed}`
  );

  return summary;
}

/**
 * Manually sends the invoice email for a given StaffMonthlyInvoice row.
 * This is the ONLY path that ever emails a staff invoice (automatic sending
 * is disabled): the admin clicks "Envoyer la facture" (GENERATED row) or
 * "Renvoyer" (EMAIL_FAILED row) on the dashboard. Does NOT regenerate invoice.
 * Does NOT advance nextInvoiceDate (already advanced at generation time).
 *
 * @param {string} monthlyInvoiceId
 * @returns {{ success: boolean, error?: string }}
 */
export async function resendMonthlyInvoiceEmail(monthlyInvoiceId) {
  const row = await prisma.staffMonthlyInvoice.findUnique({
    where: { id: monthlyInvoiceId },
    include: {
      invoice: { include: { lines: true } },
      staff: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              isCompany: true,
              vatNumber: true,
              vatValidatedAt: true,
              vatValidationAddress: true,
              addressLine1: true,
              addressLine2: true,
              addressCity: true,
              addressPostalCode: true,
              addressCountry: true,
              billingProfile: true,
            },
          },
        },
      },
    },
  });

  if (!row) return { success: false, error: "Ligne de facturation introuvable" };
  if (!row.invoice) return { success: false, error: "Facture introuvable" };
  if (row.status === "SENT") return { success: false, error: "La facture a déjà été envoyée avec succès" };
  if (row.status === "SKIPPED") return { success: false, error: "Cette facture a été ignorée (staff inéligible)" };

  const invoice = row.invoice;
  const monthLabel = frenchMonthName(row.billingYear, row.billingMonth);

  try {
    const pdf = await renderInvoicePdf(invoice);

    const vatRate = Number(invoice.vatRate ?? BELGIUM_VAT_RATE);
    const subtotalExclVat = Number(invoice.subtotalExclVat ?? 0);
    const vatAmount = Number(invoice.vatAmount ?? 0);
    const totalInclVat = Number(invoice.totalInclVat ?? 0);

    const { subject, text, html } = invoiceEmail({
      customerName: invoice.customerName,
      invoiceNumber: invoice.number,
      issuedAt: invoice.issuedAt ?? new Date(),
      dueDate: invoice.dueDate ?? null,
      lines: (invoice.lines ?? []).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: Number(l.unitPriceExclVat ?? l.unitPrice),
        lineTotal: Number(l.lineTotalExclVat ?? l.lineTotal),
      })),
      subtotalExclVat,
      vatRate,
      vatAmount,
      totalInclVat,
    });

    const emailResult = await sendEmail({
      to: invoice.customerEmail,
      subject,
      text,
      html,
      attachments: [{ filename: `facture-${invoice.number}.pdf`, content: pdf }],
    });

    if (emailResult?.success === false) {
      const emailErr = emailResult.error ?? "Échec de l'envoi de l'e-mail";
      await prisma.staffMonthlyInvoice.update({
        where: { id: row.id },
        data: { status: "EMAIL_FAILED", emailError: emailErr },
      });
      return { success: false, error: emailErr };
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.staffMonthlyInvoice.update({
        where: { id: row.id },
        data: { status: "SENT", emailSentAt: now, emailError: null },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { emailSentAt: now },
      }),
    ]);

    return { success: true };
  } catch (err) {
    const msg = err?.message ?? "Erreur inattendue lors de l'envoi";
    await prisma.staffMonthlyInvoice.update({
      where: { id: row.id },
      data: { status: "EMAIL_FAILED", emailError: msg },
    }).catch(() => {});
    return { success: false, error: msg };
  }
}
