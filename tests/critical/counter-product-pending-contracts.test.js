import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const surface = source("components/dashboard/boutique/counter/CounterSurface.jsx");
const cart = source("components/dashboard/boutique/counter/CounterCart.jsx");

// 8 Sep 2026: selecting a PRODUCT row from the counter's top search used to
// only show a toast — "Utilisez la caisse ci-dessous pour ajouter ce produit
// au panier" — pointing at CounterCart's own, separate product search, which
// staff then had to retype the same name into. If the till happened to have
// no open cash session, that section renders "Caisse fermée" instead of any
// search box at all, so the toast's instruction pointed at nothing usable.
describe("selecting a product from the counter search adds it straight to the till", () => {
  test("CounterSurface routes a PRODUCT row to pendingProduct, not a toast", () => {
    expect(surface).toContain('row.type === "PRODUCT"');
    expect(surface).toContain("setPendingProduct(row)");
    // The old toast text must be gone — it no longer describes what happens.
    expect(surface).not.toContain("Utilisez la caisse ci-dessous pour ajouter ce produit au panier");
  });

  test("CounterCart adds the pending product directly, it does not just focus a search box", () => {
    const start = cart.indexOf("if (!pendingProduct) return;");
    expect(start).toBeGreaterThan(-1);
    const block = cart.slice(start, start + 500);
    expect(block).toContain("addProductToCart(pendingProduct)");
    expect(block).not.toContain("setProductQuery(pendingProduct");
  });

  test("the cart still queues the line even with no till session open — cart state isn't gated on that render branch", () => {
    // addProductToCart writes straight to `cart` state via setCart, entirely
    // outside the `if (!cashSessionOpen) return (...)` early-return branch —
    // so a product added while the till is closed is simply invisible until
    // a session opens, not lost.
    const closedBranchStart = cart.indexOf("if (!cashSessionOpen) {");
    const addProductStart = cart.indexOf("const addProductToCart = useCallback");
    expect(closedBranchStart).toBeGreaterThan(-1);
    expect(addProductStart).toBeGreaterThan(-1);
    expect(addProductStart).toBeLessThan(closedBranchStart);
  });

  test("the till section carries a stable id so the page can scroll to it after adding", () => {
    const occurrences = cart.split('id="counter-cart"').length - 1;
    // Both render branches (open and closed) need it — whichever is live.
    expect(occurrences).toBe(2);
    expect(cart).toContain('document.getElementById("counter-cart")?.scrollIntoView(');
  });

  test("a service or session row without permission still gets an explicit refusal, not silence", () => {
    expect(surface).toContain("function notifyNotPermitted()");
    expect(surface).toContain("Vous n'avez pas la permission d'encaisser cette vente depuis la caisse.");
  });
});
