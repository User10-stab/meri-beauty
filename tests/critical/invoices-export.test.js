import { describe, it, expect, vi } from "vitest";
import { buildInvoicesExport } from "@/lib/invoices/build-invoices-export";
import { buildInvoicesCsv } from "@/lib/invoices/invoices-csv";
import { buildInvoicesWorkbook } from "@/lib/invoices/invoices-excel";
import { renderInvoicesListPdf } from "@/lib/pdf/render";
import { normalizeInvoiceFilters } from "@/lib/invoices/list-filters";

const invoice = (n, ttc, credited = 0) => ({
  number: `F-2026-00000${n}`,
  source: "MANUAL",
  paymentId: `p${n}`,
  issuedAt: new Date("2026-10-05T10:00:00Z"),
  dueDate: null,
  customerName: "Alice",
  customerLegalName: null,
  customerVatNumber: null,
  subtotalExclVat: ttc / 1.21,
  vatAmount: ttc - ttc / 1.21,
  totalInclVat: ttc,
  emailSentAt: n === 1 ? new Date() : null,
  peppyrusSentAt: null,
  supersededAt: null,
  creditNotes: credited ? [{ totalInclVat: credited }] : [],
  payment: { status: "PAID" },
});

describe("Factures export", () => {
  const client = { invoice: { findMany: vi.fn().mockResolvedValue([invoice(1, 121), invoice(2, 242, 121)]) } };
  const filters = normalizeInvoiceFilters({ from: "2026-10-01", to: "2026-10-20" });

  it("filters by the issue date and totals net of credit notes", async () => {
    const data = await buildInvoicesExport(client, filters);
    expect(client.invoice.findMany.mock.calls[0][0].where.AND[0].issuedAt.gte).toBeInstanceOf(Date);
    expect(data.summary).toMatchObject({ count: 2, totalTtc: 363, credited: 121, net: 242 });
    expect(data.rows[0].sentLabel).toBe("E-mail");
  });

  it("produces a CSV, an xlsx and a PDF", async () => {
    const data = await buildInvoicesExport(client, filters);
    expect(buildInvoicesCsv(data)).toContain("F-2026-000001");
    expect((await buildInvoicesWorkbook(data)).subarray(0, 2).toString()).toBe("PK");
    expect((await renderInvoicesListPdf(data)).subarray(0, 4).toString()).toBe("%PDF");
  });
});
