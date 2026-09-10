import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSettlementInvoice } from "../../lib/invoicing.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * A minimal Prisma transaction client — enough for issueCreditNote and the
 * invoice.update that supersedeInvoice performs, and nothing else. The point of
 * these tests is which documents come out the far end, not how the sequence
 * counter allocates numbers (tests/critical covers that separately).
 */
function fakeTx({ invoice }) {
  const calls = { creditNotes: [], updates: [] };
  return {
    calls,
    $queryRaw: async () => [{ lastNumber: 7 }],
    invoice: {
      findUnique: async () => (invoice ? { totalInclVat: invoice.totalInclVat, vatRate: 21 } : null),
      update: async (args) => {
        calls.updates.push(args);
        return { ...invoice, ...args.data };
      },
    },
    creditNote: {
      aggregate: async () => ({ _sum: { totalInclVat: null } }),
      create: async (args) => {
        calls.creditNotes.push(args.data);
        return { id: "cn-1", ...args.data };
      },
    },
  };
}

const EXISTING = { id: "inv-original", totalInclVat: 60 };

/**
 * What happens to an invoice already on file when the till reprices the booking
 * it belongs to.
 *
 * Two real defects sat here. A B2B client who had paid online already has an
 * invoice; the balance-due settlement path called issueInvoice with no guard at
 * all, and Invoice.paymentId is unique — so raising that client's price at the
 * counter hit P2002 and rolled the entire settlement back behind a generic
 * "Erreur lors de la clôture". On the paths that *did* guard, the opposite
 * happened: the stale invoice was silently kept, so the filed document stopped
 * matching Payment.totalAmount with no credit note and no audit trail, which
 * Belgian VAT law does not allow.
 */
describe("an adjusted booking's invoice is corrected, never edited or abandoned", () => {
  test("an unchanged price keeps the invoice on file and issues nothing", async () => {
    const tx = fakeTx({ invoice: EXISTING });
    const issue = vi.fn();

    const result = await resolveSettlementInvoice(tx, {
      existingInvoice: EXISTING,
      priceChanged: false,
      adjustmentReason: null,
      shouldIssue: true,
      issue,
    });

    expect(result.invoice).toBe(EXISTING);
    expect(result.creditNote).toBeNull();
    // The P2002 that used to abort the whole settlement: reissuing against a
    // paymentId that already carries an invoice.
    expect(issue, "a second invoice was issued for a price that never moved").not.toHaveBeenCalled();
    expect(tx.calls.creditNotes).toHaveLength(0);
  });

  test("a changed price credits the original in full and reissues, linked", async () => {
    const tx = fakeTx({ invoice: EXISTING });
    const issue = vi.fn(async (supersedesInvoiceId) => ({ id: "inv-replacement", supersedesInvoiceId }));

    const result = await resolveSettlementInvoice(tx, {
      existingInvoice: EXISTING,
      priceChanged: true,
      adjustmentReason: "geste commercial",
      shouldIssue: true,
      issue,
    });

    // Full credit, never partial — the replacement states the new total, so a
    // partial note would leave the two documents overlapping.
    expect(tx.calls.creditNotes).toHaveLength(1);
    expect(Number(tx.calls.creditNotes[0].totalInclVat)).toBe(60);
    expect(tx.calls.creditNotes[0].reason).toContain("geste commercial");

    // paymentId freed in the same transaction, which is what lets the
    // replacement claim the unique slot immediately.
    expect(tx.calls.updates[0].data.paymentId).toBeNull();
    expect(tx.calls.updates[0].data.supersededAt).toBeInstanceOf(Date);

    expect(issue).toHaveBeenCalledWith("inv-original");
    expect(result.invoice.supersedesInvoiceId, "the replacement does not point back at what it voids").toBe(
      "inv-original",
    );
    expect(result.creditNote.id).toBe("cn-1");
  });

  test("an adjustment with no reason still names itself on the credit note", async () => {
    const tx = fakeTx({ invoice: EXISTING });
    await resolveSettlementInvoice(tx, {
      existingInvoice: EXISTING,
      priceChanged: true,
      adjustmentReason: null,
      shouldIssue: true,
      issue: async () => ({ id: "inv-replacement" }),
    });
    expect(tx.calls.creditNotes[0].reason).toBe("Ajustement de prix au comptoir");
  });

  test("no invoice on file — one is issued only when the VAT identity earns it", async () => {
    const issued = vi.fn(async () => ({ id: "inv-first" }));
    const withIdentity = await resolveSettlementInvoice(fakeTx({ invoice: null }), {
      existingInvoice: null,
      priceChanged: true,
      adjustmentReason: "correction de tarif",
      shouldIssue: true,
      issue: issued,
    });
    expect(issued).toHaveBeenCalledWith(null);
    expect(withIdentity.invoice.id).toBe("inv-first");
    expect(withIdentity.creditNote).toBeNull();

    const skipped = vi.fn();
    const particulier = await resolveSettlementInvoice(fakeTx({ invoice: null }), {
      existingInvoice: null,
      priceChanged: true,
      adjustmentReason: "geste commercial",
      shouldIssue: false,
      issue: skipped,
    });
    expect(skipped, "a particulier was invoiced").not.toHaveBeenCalled();
    expect(particulier.invoice).toBeNull();
  });

  test("a VAT number that stopped validating fails by name, not as a raw B2C refusal", async () => {
    const tx = fakeTx({ invoice: EXISTING });
    // The original is already credited by the time the reissue is attempted, so
    // the settlement has to abort — and say why, rather than surface a message
    // about issuing an invoice to a particulier.
    await expect(
      resolveSettlementInvoice(tx, {
        existingInvoice: EXISTING,
        priceChanged: true,
        adjustmentReason: "geste commercial",
        shouldIssue: true,
        issue: async () => {
          throw new Error("B2C_INVOICE_NOT_ALLOWED");
        },
      }),
    ).rejects.toThrow("INVOICE_REPLACEMENT_VAT_EXPIRED");
  });

  test("any other reissue failure is left alone to roll the transaction back", async () => {
    await expect(
      resolveSettlementInvoice(fakeTx({ invoice: EXISTING }), {
        existingInvoice: EXISTING,
        priceChanged: true,
        adjustmentReason: "geste commercial",
        shouldIssue: true,
        issue: async () => {
          throw new Error("SELLER_LEGAL_DATA_INCOMPLETE");
        },
      }),
    ).rejects.toThrow("SELLER_LEGAL_DATA_INCOMPLETE");
  });
});

/**
 * The rule above is only worth anything if every settlement path actually goes
 * through it. Both files reach invoicing from two branches — money collected,
 * and the balance written off to zero — and the write-off branches are exactly
 * the ones that used to skip the correction.
 */
describe("both settlement paths route their invoicing through the shared rule", () => {
  const paths = ["actions/appointment/manage-appointment.js", "lib/reservations/settle-reservation.js"];

  test("each path calls resolveSettlementInvoice on both of its branches", () => {
    for (const path of paths) {
      const code = source(path);
      const calls = code.match(/resolveSettlementInvoice\(tx, \{/g) ?? [];
      expect(calls.length, `${path} does not resolve its invoice through the shared rule twice`).toBe(2);
      expect(code, path).toContain("supersedesInvoiceId,");
    }
  });

  test("neither path issues an invoice outside the rule any more", () => {
    for (const path of paths) {
      const code = source(path);
      // Every remaining issueInvoice( in these files is the `issue` callback
      // handed to resolveSettlementInvoice, never a bare call that could race
      // Invoice.paymentId's unique constraint.
      expect(code, path).not.toContain("payment.invoice ?? (");
      expect(code, path).not.toContain("!payment?.invoice &&");
    }
  });

  test("each path reports an expired VAT identity to the operator", () => {
    for (const path of paths) {
      expect(source(path), path).toContain("INVOICE_REPLACEMENT_VAT_EXPIRED");
    }
  });
});
