import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PAYMENT_STATUS_LABELS } from "@/lib/dashboard/operation-filters";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Reported from the floor: a fully refunded atelier row read
 *
 *     Paiement complet · 45,00 €   Remboursé · 45,00 €
 *
 * with no indication of where the row actually stood — the two badges look
 * like competing statements of the same thing.
 *
 * Two separate causes, and only one of them was the badges.
 *
 * The "État paiement" column, which is supposed to answer exactly that
 * question, rendered `payment.status` raw — "REFUNDED", "PARTIALLY_REFUNDED",
 * Prisma enum values in English, in an otherwise entirely French table. It
 * reads as debug output rather than as a state, so staff skip it and read
 * the money badges beside it as the status instead.
 *
 * The badges themselves are *not* a status and are right to show both: this
 * column records what money moved, and dropping the collection once a refund
 * lands would erase the fact that 45 € was ever taken. The books need that.
 * What was missing was any statement that the two cancel out.
 */
describe("a refunded row says so in the column meant for it", () => {
  const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
  const filters = source("lib/dashboard/operation-filters.js");

  test("the payment state is translated, never printed as a Prisma enum", () => {
    expect(client).toContain("PAYMENT_STATUS_LABELS[status]");
    // The raw read is what produced "REFUNDED" on screen.
    expect(client).not.toContain("const status = row.payment?.status ?? \"—\"");
  });

  test("every PaymentStatus the schema can store has a French label", () => {
    // A status with no entry falls through to the raw enum, which is the
    // exact bug — so the map has to cover the whole enum, not the common few.
    const schema = source("prisma/schema.prisma");
    const block = schema.slice(schema.indexOf("enum PaymentStatus"));
    const body = block.slice(0, block.indexOf("}"));
    const values = body
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z_]+$/.test(line));

    expect(values.length).toBeGreaterThan(5);
    for (const value of values) {
      expect(PAYMENT_STATUS_LABELS[value], `PaymentStatus.${value} has no French label`).toBeTruthy();
    }
  });

  test("the label map is shared, not a fourth private copy", () => {
    // Identical copies already exist in the workshops and formations reservation
    // rows. Adding a third inline in Opérations is how the vocabulary drifts
    // apart one screen at a time.
    expect(filters).toContain("export const PAYMENT_STATUS_LABELS");
    expect(client).toContain("PAYMENT_STATUS_LABELS,\n} from \"@/lib/dashboard/operation-filters\"");
  });

  test("the refunded total is summed from the row's own transactions", () => {
    // It used to read row.refundState.totalRefunded, which only the
    // order/workshop/formation hydrators supply. Appointment rows carry a
    // different refundState (admin-operations.js builds them per transaction,
    // not per entity), so on a rendez-vous that read was permanently
    // undefined and the refund line never rendered. Same shape of defect as
    // B2 in E2E_FINDINGS.md: reading a field the row does not carry.
    expect(client).not.toContain("row.refundState?.totalRefunded");
    expect(client).toContain('transaction.transactionType === "REFUND"');
  });

  test("a fully refunded row states its net instead of repeating the amount", () => {
    expect(client).toContain("Net encaissé");
    expect(client).toContain("const fullyRefunded =");
    // The collections stay on screen — struck through, not deleted. Removing
    // them would hide that money was ever taken.
    expect(client).toContain("line-through");
    expect(client).toContain("Paiement complet");
  });
});
