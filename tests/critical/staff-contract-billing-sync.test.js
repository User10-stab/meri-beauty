import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Staff rent follows the contract by itself (user's call, 2026-09-22):
 * editing the rent, the payment delay or the start date flows into the
 * invoices still to come — an invoice already created never changes; every monthly
 * anniversary is billed, even one the job missed; and the money shows in
 * Opérations as well as the livre de recettes.
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    contract: { findFirst: vi.fn(), findMany: vi.fn() },
    staffMonthlyInvoice: { findMany: vi.fn(), update: vi.fn((args) => ({ op: "smi", ...args })) },
    invoice: { update: vi.fn((args) => ({ op: "invoice", ...args })) },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/pdf/render", () => ({ renderInvoicePdf: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureCriticalError: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ invoiceEmail: vi.fn() }));
vi.mock("@/lib/invoicing", () => ({ buildRentalDescription: vi.fn(), issueInvoice: vi.fn() }));

import { applyContractEdit } from "@/lib/staff-contract-sync";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");
const day = (date) => new Date(date).toISOString().slice(0, 10);

const ACTIVE = { id: "c_julie", startDate: new Date("2026-09-07T00:00:00Z"), dueDate: null };

function makeTx(active = ACTIVE) {
  return {
    contract: {
      findFirst: vi.fn().mockResolvedValue(active),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn((args) => Promise.resolve({ id: "c_new", ...args.data })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockResolvedValue([]);
});

describe("editing a contract updates it in place — a new contract only when the start date moves", () => {
  it("a new rent keeps the contract and its schedule: the next invoice uses it", async () => {
    const tx = makeTx();
    const outcome = await applyContractEdit(tx, "s_julie", { fixedRent: 550, startDate: "2026-09-07", endDate: "", dueDate: "", notes: "" });
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: "c_julie" },
      data: { fixedRent: 550, endDate: null, dueDate: null, notes: "" },
    });
    // nextInvoiceDate is not touched, nothing terminated, nothing created.
    expect(tx.contract.update.mock.calls[0][0].data).not.toHaveProperty("nextInvoiceDate");
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.create).not.toHaveBeenCalled();
    expect(outcome).toEqual({ created: null });
  });

  it("a new payment delay is saved on the contract, for the invoices to come", async () => {
    const tx = makeTx();
    await applyContractEdit(tx, "s_julie", { fixedRent: 500, startDate: "2026-09-07", dueDate: "10" });
    expect(tx.contract.update.mock.calls[0][0].data.dueDate).toBe("10");
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("a new start date is a new contract: the old one ends, the caller invoices the new one's first month", async () => {
    const tx = makeTx();
    const outcome = await applyContractEdit(tx, "s_julie", { fixedRent: 500, startDate: "2026-11-01", dueDate: "7" });
    expect(tx.contract.updateMany).toHaveBeenCalledWith({ where: { staffId: "s_julie", status: "ACTIVE" }, data: { status: "TERMINATED" } });
    expect(outcome.created).toMatchObject({ id: "c_new", staffId: "s_julie", status: "ACTIVE", fixedRent: 500, dueDate: "7" });
    expect(day(outcome.created.startDate)).toBe("2026-11-01");
  });

  it("a first contract for a staff member who had none is created the same way", async () => {
    const outcome = await applyContractEdit(makeTx(null), "s_new", { fixedRent: 400, startDate: "2026-10-15", dueDate: "" });
    expect(outcome.created).toMatchObject({ staffId: "s_new", fixedRent: 400 });
  });

  it("the staff form wires it: first-period invoice for a new contract, and no invoice already created is rewritten", () => {
    const action = source("actions/staff/update-independent-staff.js");
    expect(action).toContain("contractChange = await applyContractEdit(tx, id, contract);");
    expect(action).toContain("await createAndSendStaffContractInvoice({ contract: contractChange.created });");
    // Option A (user, 2026-09-22): nothing touches an existing invoice.
    const sync = source("lib/staff-contract-sync.js");
    expect(sync).not.toMatch(/invoice\.update|staffMonthlyInvoice\.update/);
    expect(action).not.toContain("refreshOpenRentDueDates");
    // The old terminate-and-recreate on every save is gone.
    expect(action).not.toContain("Terminate the current active contract (if different) and create new one");
  });
});

describe("the monthly job bills every anniversary, and only the active contract", () => {
  const billing = source("lib/staff-monthly-billing.js");

  it("a missed day is caught up: every date up to today is due, not only today's", () => {
    expect(billing).toContain("nextInvoiceDate: { lt: tomorrowDate },");
    expect(billing).not.toContain("nextInvoiceDate: { gte: todayDate, lt: tomorrowDate }");
    expect(billing).toContain("results.push(...(await billDueContract(staff, contract, todayDate)));");
    expect(billing).toContain("for (let i = 0; i < MAX_PERIODS_PER_RUN && billingDate && toUtcDateOnly(billingDate) <= today; i++) {");
  });

  it("a terminated contract is never billed, and a skip never overwrites a real rent", () => {
    expect(billing).toContain('where: { type: "FIXED_RENT", status: { not: "TERMINATED" }, fixedRent: { gt: 0 } },');
    expect(billing).toContain("if (await monthHoldsRealRent(staffId, billingYear, billingMonth)) return;");
  });

  it("a month already billed still moves the schedule on", () => {
    const alreadyBilled = billing.slice(billing.indexOf("already billed — status="), billing.indexOf("// ── 4. Build the rent due"));
    expect(alreadyBilled).toContain("await advanceSchedule(staff, contract, billingDate);");
  });
});

describe("rent money shows in Opérations, as it does in the livre de recettes", () => {
  it("each rent payment event is a « Loyer staff » row of the salon's ledger", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    expect(actions).toContain('const includeStaffRent = !sourceTypes && lifecycleStatus === "ALL" && scope.mode !== "STAFF";');
    expect(actions).toContain('SELECT t.id AS id, \'STAFF_RENT\' AS "sourceType", t."paidAt" AS "sortAt"');
    expect(actions).toContain('AND p."staffContractId" IS NOT NULL');
    expect(actions).toContain('AND p."payeeStaffId" IS NULL');
    expect(actions).toContain("hydrateStaffRentTransactions(idsBySource.STAFF_RENT),");
  });

  it("the table labels it and opens « Voir / gérer » like any other transaction", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain('kind: "Loyer staff",');
    expect(client).toContain('if (row.sourceType === "APPOINTMENT" || row.sourceType === "STAFF_RENT") {');
    // No detour to the Factures page any more (user, 2026-09-22).
    expect(client).not.toContain("Voir dans Factures");
    expect(client).toContain('event.method === "TRANSFER" ? "Virement"');
  });

  it("the detail drawer describes a rent and hides the booking cancel / refund / ticket flows", () => {
    const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");
    expect(drawer).toContain('kind: "Loyer staff",');
    expect(drawer).toContain("{isRent && <StaffRentSection payment={payment} />}");
    expect(drawer).toContain("const canGenerateNote = !isRent && isRefund");
    expect(drawer).toMatch(/const canCancelAndRefund =\n\s+!isRent &&/);
    expect(drawer).toMatch(/const canGenerateCreditNote =\n\s+!isRent &&/);
    expect(drawer).toContain("{payment?.id && !isRent && (");
    const detail = source("actions/dashboard/admin-operations.js");
    expect(detail).toContain("staffContract: { select: { fixedRent: true, startDate: true, dueDate: true,");
    expect(detail).toContain("staffRentPeriod: { select: { billingYear: true, billingMonth: true, lineDescription: true, dueDate: true, status: true } },");
  });

  it("Factures opens the same drawer: « Détails du paiement » on every invoice row", () => {
    const client = source("components/dashboard/invoices/InvoicesClient.jsx");
    expect(client).toContain("onClick={() => setDetailTransactionId(invoice.latestTransactionId)}");
    expect(client).toContain("disabled={!invoice.latestTransactionId}");
    expect(client).toContain("<TransactionDetailDrawer transactionId={detailTransactionId} onClose={() => setDetailTransactionId(null)} />");
    expect(source("actions/dashboard/invoices.js")).toContain("latestTransactionId: invoice.payment?.transactions?.[0]?.id ?? null,");
  });

  it("the livre de recettes already counts it: salon-owned rent payments, category « Loyers staff »", () => {
    expect(source("lib/payments/payment-category.js")).toContain('if (payment.staffContractId || payment.invoice?.source === "STAFF_CONTRACT") return "STAFF_RENT";');
    // The rent Payment names no payee: it is the salon's (SALON_PAYMENT_WHERE).
    const rentPayment = source("lib/staff-rent-payment.js");
    const data = rentPayment.slice(rentPayment.indexOf("export function pendingRentPaymentData("), rentPayment.indexOf("export async function createPendingRent("));
    expect(data).not.toContain("payeeStaffId");
  });
});
