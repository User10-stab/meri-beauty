import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeStockTotals } from "@/lib/stock/build-stock-movements-report";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const RANGE = { fromDate: new Date("2026-09-01T00:00:00"), toDate: new Date("2026-09-10T23:59:59.999") };

/**
 * 17 Sep 2026: the printed Mouvements de stock closes on the catalogue's
 * total stock (début + entrées − sorties = fin) so a stock inspector reading
 * a list of movements is not left without the totals to check them against.
 */
describe("computeStockTotals", () => {
  it("works back from today's stock: end = now − later movements, start = end − the period's net", async () => {
    const aggregate = vi.fn(async ({ where }) => {
      if (where.createdAt?.gt) return { _sum: { quantity: -144 } }; // sales after the period
      if (where.quantity && "gt" in where.quantity) return { _sum: { quantity: 63 } };
      if (where.quantity && "lt" in where.quantity) return { _sum: { quantity: -83 } };
      throw new Error("unexpected aggregate");
    });
    const client = {
      productVariant: { aggregate: vi.fn().mockResolvedValue({ _sum: { stockQuantity: 865 } }) },
      inventoryMovement: { aggregate },
    };

    const totals = await computeStockTotals(client, RANGE);

    expect(totals).toEqual({ atStart: 1029, unitsIn: 63, unitsOut: 83, atEnd: 1009 });
    expect(totals.atStart + totals.unitsIn - totals.unitsOut).toBe(totals.atEnd);
  });

  it("is never narrowed by the report's type filter, so the arithmetic always holds on paper", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _sum: { quantity: null } });
    const client = {
      productVariant: { aggregate: vi.fn().mockResolvedValue({ _sum: { stockQuantity: 10 } }) },
      inventoryMovement: { aggregate },
    };

    expect(await computeStockTotals(client, RANGE)).toEqual({ atStart: 10, unitsIn: 0, unitsOut: 0, atEnd: 10 });
    for (const [args] of aggregate.mock.calls) expect(args.where).not.toHaveProperty("type");
  });

  it("both stock PDFs print the generation time and a closing stock total", () => {
    for (const file of ["lib/pdf/StockMovementsDocument.jsx", "lib/pdf/InventorySnapshotDocument.jsx"]) {
      const document = source(file);
      expect(document).toContain("Document généré le {formatDateTime(generatedAt)}");
      expect(document).toContain('hour: "2-digit"');
      expect(document).toContain("STOCK TOTAL");
    }
  });
});
