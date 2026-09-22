import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A parcel the customer never collects can never reach COMPLETED (returns.js
// requires a real collectedAt, only ever set by staff confirming an actual
// pickup), so without this action a SHIPPED order with no collection would
// sit unrefundable and unrestockable forever — see markOrderReturnedUndelivered.
const root = fileURLToPath(new URL("../../", import.meta.url));
const orders = readFileSync(`${root}actions/boutique/orders.js`, "utf8");

describe("markOrderReturnedUndelivered", () => {
  const fn = orders.slice(
    orders.indexOf("export async function markOrderReturnedUndelivered"),
    orders.indexOf("export async function markOrderReturnedUndelivered") + 2000
  );

  test("is admin-only", () => {
    expect(fn).toContain("if (!isAdminRole(guard.session.user.role)) {");
  });

  test("only reachable from a SHIPPED order — no other status", () => {
    expect(fn).toContain('if (order.status !== "SHIPPED") {');
  });

  test("reuses the shared cancellation core with SHIPPED explicitly allowed and the label override implied", () => {
    expect(fn).toContain('{ allowLabelledOverride: true, extraClaimableStatuses: ["SHIPPED"] }');
  });

  test("tags a distinct, greppable reason rather than a generic cancellation", () => {
    expect(orders).toContain('const UNDELIVERED_PARCEL_REASON = "Colis non retiré — retourné par Mondial Relay";');
  });

  test("has no arbitrary timer/threshold gating it — deliberately admin judgement, not a guessed schedule", () => {
    expect(fn).not.toMatch(/shippedAt.*Date\.now|olderThan|THRESHOLD/);
  });
});
