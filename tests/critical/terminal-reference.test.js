import { describe, expect, it, vi } from "vitest";
import { allocateBookingTerminalReference, orderTerminalReference } from "@/lib/payments/terminal-reference";

/**
 * 2026-09-28: staff no longer type the terminal ticket's reference. What is
 * recorded instead must still read as a reference: « Produit n°36 »,
 * « Atelier n°01 »…
 */

function txReturning(lastNumber) {
  return { $queryRaw: vi.fn().mockResolvedValue([{ lastNumber }]) };
}

describe("terminal payment references", () => {
  it("a boutique sale or pickup is referenced by its numéro de commande", () => {
    expect(orderTerminalReference(36)).toBe("Produit n°36");
  });

  it("each booking kind reads as its own numbered series", async () => {
    expect(await allocateBookingTerminalReference(txReturning(1), "WORKSHOP", "WORKSHOP")).toBe("Atelier n°01");
    expect(await allocateBookingTerminalReference(txReturning(2), "WORKSHOP", "EVENT")).toBe("Événement n°02");
    expect(await allocateBookingTerminalReference(txReturning(3), "FORMATION")).toBe("Formation n°03");
    expect(await allocateBookingTerminalReference(txReturning(112), "APPOINTMENT")).toBe("Prestation n°112");
  });

  it("allocates from the kind's own counter, inside the caller's transaction", async () => {
    const tx = txReturning(1);
    await allocateBookingTerminalReference(tx, "WORKSHOP", "EVENT");
    const [, key] = tx.$queryRaw.mock.calls[0];
    expect(key).toBe("TERMINAL-EVENT");
  });
});
