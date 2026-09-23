import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * A paid order can never be invoiced without the buyer's billing address
 * (art. 226(5)) — issueInvoice already refuses one that has none
 * (assertBuyerLegalDataComplete). Until now that refusal only fired AFTER
 * Stripe had captured the payment, inside the same transaction as the rest
 * of order fulfillment, so a signed-in customer with no address on file
 * ended up with money taken and an order stuck at PENDING_PAYMENT forever
 * (order cmtbaqxua0003gczkbigl9x23, 2026-08-27).
 *
 * The fix moves the same check to before checkout ever reaches Stripe — for
 * guests it already existed (ADDRESS_REQUIRED); this closes the gap for an
 * already-authenticated customer, which the address check skipped entirely.
 */
describe("a signed-in customer with no billing address cannot reach Stripe", () => {
  test("resolveOrCreateCustomer checks the authenticated user's own address, not just guests'", () => {
    const orders = source("actions/boutique/orders.js");
    const fn = orders.slice(
      orders.indexOf("async function resolveOrCreateCustomer"),
      orders.indexOf("async function resolveOrCreateCustomer") + 2000
    );

    // suppliedAddress must be computed before the authenticated branch can
    // use it — previously it was computed after, so it wasn't available yet.
    const suppliedIdx = fn.indexOf("const suppliedAddress");
    const authBranchIdx = fn.indexOf("if (authenticatedUserId)");
    expect(suppliedIdx).toBeGreaterThan(-1);
    expect(authBranchIdx).toBeGreaterThan(suppliedIdx);

    // The authenticated branch must inspect the user's own address and use
    // the same ADDRESS_REQUIRED / persist-supplied-address pattern as the
    // guest path below it, not return the user unconditionally. Narrowed to
    // only fire when the order will actually be invoiced (willBeInvoiced) —
    // a particulier account never needs an address on file, only an
    // Entreprise/VAT one does; the ADDRESS_REQUIRED guard itself is unchanged.
    const authBranch = fn.slice(authBranchIdx, fn.indexOf("const email = customerInfo.email"));
    expect(authBranch).toContain("if (!user.addressLine1 && willBeInvoiced(user))");
    expect(authBranch).toContain('throw new Error("ADDRESS_REQUIRED")');
    expect(authBranch).toContain("prisma.user.update({ where: { id: user.id }, data: suppliedAddress })");
  });

  test("the checkout page fetches the signed-in customer's address so the client can tell it apart from 'never entered'", () => {
    const page = source("app/(public)/boutique/checkout/page.jsx");
    for (const field of ["addressLine1", "addressCity", "addressPostalCode", "addressCountry"]) {
      expect(page, `checkout page select is missing ${field}`).toContain(`${field}: true`);
    }
  });

  test("the client requires the address whenever the account doesn't already have one — not just for guests", () => {
    const checkout = source("components/boutique/CheckoutPageClient.jsx");
    // `effectiveSession` is a local alias for the `customerSession` prop
    // introduced alongside the checkout identity-verification refactor —
    // same value, just not read as the raw prop name inline anymore.
    expect(checkout).toContain("const effectiveSession = customerSession");
    expect(checkout).toContain("const hasAddressOnFile = isAuthenticated && Boolean(effectiveSession.addressLine1)");
    // Narrowed to Entreprise orders only (see actions/boutique/orders.js's
    // willBeInvoiced) — a particulier checkout never needs a billing address.
    expect(checkout).toContain("if (customerInfo.isCompany && !hasAddressOnFile) {");
    // The address check must not still be nested inside the guest-only
    // `if (!isAuthenticated)` block — it needs its own top-level gate so it
    // also runs for an authenticated customer with no address on file.
    const guestBlockStart = checkout.indexOf("if (!isAuthenticated) {");
    const guestBlockEnd = checkout.indexOf("\n    }\n", guestBlockStart);
    const guestBlock = checkout.slice(guestBlockStart, guestBlockEnd);
    expect(guestBlock).not.toContain("addressLine1.trim()");
  });

  test("a signed-in customer's typed address actually reaches the server", () => {
    const checkout = source("components/boutique/CheckoutPageClient.jsx");
    const payloadIdx = checkout.indexOf("customerInfo: isAuthenticated");
    const authenticatedPayload = checkout.slice(payloadIdx, payloadIdx + 1400);
    // Identity fields stay session-sourced (IDOR guard); the address is the
    // one field that has to come from what was just typed, since there is
    // no server-known value yet when hasAddressOnFile is false.
    expect(authenticatedPayload).toContain("fullName: effectiveSession.fullName");
    expect(authenticatedPayload).toContain("addressLine1: customerInfo.addressLine1");
    expect(authenticatedPayload).toContain("addressPostalCode: customerInfo.addressPostalCode");
  });
});
