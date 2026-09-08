import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const action = source("actions/counter/create-reservation.js");

describe("counter booking creation — createCounterReservation", () => {
  test("never touches Stripe — this is a staff-attested on-site sale", () => {
    expect(action).not.toContain('from "@/lib/stripe"');
    expect(action).not.toContain("stripe.checkout");
  });

  test("requires the staff attestation that payment was physically received", () => {
    expect(action).toContain("paymentConfirmed: z.literal(true)");
  });

  test("cash hard-blocks without an open till session; card never does", () => {
    expect(action).toContain('if (data.payment.method === "CASH")');
    expect(action).toContain('throw new Error("CASH_SESSION_REQUIRED")');
    expect(action).toContain("requiresCashSession: true");
  });

  test("allocates a cash-book piece number only for CASH, keyed off the activity type series", () => {
    expect(action).toContain('data.payment.method === "CASH" ? await allocatePieceNumber(tx, series) : null');
    expect(action).toContain("seriesForActivityType(catalogue.type)");
    expect(action).toContain("PIECE_SERIES.FORMATION");
  });

  test("a deposit is never invoiced; only a full payment from an invoiceable customer is", () => {
    const start = action.indexOf("const invoice =");
    const block = action.slice(start, start + 400);
    expect(block).toContain("isFullPayment && hasInvoiceableVatIdentity(user)");
  });

  test("session capacity is re-checked under a row lock before the seat count is trusted", () => {
    expect(action).toMatch(/FOR UPDATE`/);
    const lockIndex = action.indexOf("FOR UPDATE`");
    const occupancyIndex = action.indexOf("sessionOccupancy(tx");
    expect(occupancyIndex).toBeGreaterThan(lockIndex);
  });

  test("a session that has started but not ended can still be sold a seat — laxer than changeReservationSession", () => {
    expect(action).toContain("SESSION_ENDED");
    expect(action).toContain("new Date(session.endDate) <= new Date()");
    // Must not copy the stricter online-transfer cutoff.
    expect(action).not.toContain("target.startDate <= new Date()");
  });

  test("everything commits in one transaction — no compensating delete on failure", () => {
    expect(action).not.toContain(".delete(");
    expect(action).toMatch(/\$transaction\(\s*\n?\s*async \(tx\)/);
  });

  test("prices off the catalogue price via the shared VAT policy, not a hand-rolled rate", () => {
    expect(action).toContain("repriceTtcCataloguePrice(Number(catalogue.price), vatPolicy.vatRate)");
  });

  test("an operator price override still requires a reason, via the shared adjustment resolver", () => {
    expect(action).toContain("resolveCounterPriceAdjustment({");
  });

  test("the B2B address requirement is enforced up front, even for a deposit sale", () => {
    // Delegated entirely to resolveCounterCustomer, which throws before any
    // pricing/creation happens — not re-implemented here.
    expect(action).toContain("resolveCounterCustomer(tx, data.customer)");
    const resolver = source("lib/counter/resolve-counter-customer.js");
    expect(resolver).toContain("user.vatNumber && !user.addressLine1");
  });

  test("the check-in code and ticket QR are minted only after the transaction commits", () => {
    const commitIndex = action.indexOf("} catch (error) {");
    const mintIndex = action.indexOf("ensureCheckInCode(prisma,");
    expect(mintIndex).toBeGreaterThan(commitIndex);
  });

  test("is gated on the reservation permission for its own kind, not the catalogue-management permission", () => {
    expect(action).toContain("STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS");
    expect(action).toContain("STAFF_PERMISSIONS.FORMATION_RESERVATIONS");
    expect(action).not.toContain("STAFF_PERMISSIONS.WORKSHOPS");
    expect(action).not.toContain("STAFF_PERMISSIONS.FORMATIONS");
  });

  test("is audited under the same origin marker as the walk-in service counter sale", () => {
    expect(action).toContain('action: "reservation.created_at_counter"');
  });
});

describe("the composer's address prompt is VAT-gated, not the retail till's blanket rule", () => {
  const composer = source("components/dashboard/boutique/counter/CounterBookingComposer.jsx");

  test("does not import the retail till's 'new customer or none on file' address rule", () => {
    // The till's own rule (CounterCart.jsx) is `!addressOnFile` alone —
    // right for Order, wrong for a booking (trap #10 of the unified-counter
    // plan): an ordinary B2C atelier/formation sale must never be blocked
    // waiting on an address nobody needs. Only a VAT number attached makes
    // an address required, matching resolveCounterCustomer's own gate.
    expect(composer).toContain("Boolean(buyer.vatNumber.trim()) && !buyerAddressOnFile");
    expect(composer).not.toContain("buyerNeedsAddress = !buyerAddressOnFile");
  });

  test("reuses CounterBuyerForm rather than a bespoke VAT/address form", () => {
    expect(composer).toContain('import { CounterBuyerForm } from "@/components/dashboard/boutique/counter/CounterBuyerForm"');
    expect(composer).toContain("allowWalkIn={false}");
  });
});

describe("the buyer — identity, VAT/VIES, billing address — is one shared block for both modes", () => {
  const composer = source("components/dashboard/boutique/counter/CounterBookingComposer.jsx");

  test("SERVICE mode has no customer capture of its own — it reuses the same CounterBuyerForm as SESSION mode", () => {
    // A walk-in appointment used to have its own bespoke {fullName, email,
    // phone} form with no VAT/address fields at all — a brand-new
    // professional client could never get an invoiced appointment. There is
    // now exactly one CounterBuyerForm usage per mode, both bound to the
    // same `buyer` state.
    const occurrences = composer.split("<CounterBuyerForm").length - 1;
    expect(occurrences).toBe(2);
    expect(composer).not.toContain("customerForm");
    expect(composer).not.toContain("searchCustomersForManualBooking");
    expect(composer).not.toContain("selectedCustomer");
    expect(composer).not.toContain("newCustomer");
  });

  test("both submit paths build the customer payload through the same helper and the same front-door validation", () => {
    expect(composer).toContain("customer: buildBuyerPayload()");
    const submitStart = composer.indexOf("async function submit(event)");
    const submitSessionStart = composer.indexOf("async function submitSession(event)");
    expect(composer.slice(submitStart, submitStart + 400)).toContain("buyerValidationError()");
    expect(composer.slice(submitSessionStart, submitSessionStart + 400)).toContain("buyerValidationError()");
  });

  test("a VAT number with no address is refused client-side before any network round trip", () => {
    const start = composer.indexOf("function buyerValidationError()");
    const block = composer.slice(start, start + 400);
    expect(block).toContain("buyerNeedsAddress && !buyer.addressLine1.trim()");
  });

  test("the walk-in service schema lets an already-matched customer add a VAT number and address too", () => {
    // Without merging these onto the {userId} branch, zod's default
    // unknown-key stripping would silently drop a VAT number typed for an
    // existing customer — the sale would go through as pure B2C with no
    // invoice, the same bug the address requirement guards against.
    const action = source("actions/counter/walk-in-service.js");
    const start = action.indexOf("const customerSchema = z.union([");
    const block = action.slice(start, start + 500);
    expect(block).toContain("z.object({ userId: z.string().min(1) }).merge(");
    expect(block).toContain("vatNumber: true");
    expect(block).toContain("addressLine1: true");
  });
});

describe("a billing address is required, not just requested, once a VAT number is attached", () => {
  const buyerForm = source("components/dashboard/boutique/counter/CounterBuyerForm.jsx");

  test("the street, postal code and city inputs carry the HTML required attribute", () => {
    const start = buyerForm.indexOf("needsAddress && (");
    const block = buyerForm.slice(start, start + 2200);
    for (const field of ["addressLine1", "addressPostalCode", "addressCity"]) {
      const fieldIndex = block.indexOf(`value={customer.${field}}`);
      expect(fieldIndex).toBeGreaterThan(-1);
      // The <input ...> tag opens some lines above the value prop — "required"
      // must appear somewhere between that opening tag and the value prop.
      const tagStart = block.lastIndexOf("<input", fieldIndex);
      expect(block.slice(tagStart, fieldIndex)).toContain("required");
    }
    // addressLine2 (optional) must NOT be required.
    const line2Index = block.indexOf("value={customer.addressLine2}");
    const line2TagStart = block.lastIndexOf("<input", line2Index);
    expect(block.slice(line2TagStart, line2Index)).not.toContain("required");
  });
});

describe("the composer has no entry point of its own — the omnibar's search is it", () => {
  const composer = source("components/dashboard/boutique/counter/CounterBookingComposer.jsx");

  test("renders nothing until a pending service or session arrives — no standalone toggle button", () => {
    // The old always-visible "Prestation ou séance sans réservation en
    // ligne" button duplicated the omnibar's own search/scanner one screen
    // up; it is gone, along with the useState("open") that gated it.
    expect(composer).not.toContain("Prestation ou séance sans réservation en ligne");
    expect(composer).not.toContain("const [open, setOpen]"); // no more `open` state
    expect(composer).not.toContain("setOpen(true)");
    expect(composer).toContain("if (!mode) return null;");
  });

  test("mode is derived from which pending prop last fired, never chosen from a tab", () => {
    expect(composer).toContain('const mode = session ? "SESSION" : selectedService ? "SERVICE" : null;');
    // The old two-button toggle (setMode("SERVICE") / setMode("SESSION")) is gone.
    expect(composer).not.toContain('setMode("SERVICE")');
    expect(composer).not.toContain('setMode("SESSION")');
  });

  test("has no service search box or scanner of its own — searchCounterServices only runs behind the omnibar", () => {
    // createCounterWalkInService is still imported (SERVICE mode still
    // submits the sale) — searchCounterServices is not: nothing here
    // searches for a service any more, only the omnibar does.
    const importLine = composer.split("\n").find((line) => line.includes('from "@/actions/counter/walk-in-service"'));
    expect(importLine).not.toContain("searchCounterServices");
    expect(composer).not.toContain("CounterScanner");
    expect(composer).not.toContain("runServiceSearch");
  });

  test("accepts a pendingService prop mirroring the existing pendingSession one", () => {
    expect(composer).toContain("pendingService,");
    expect(composer).toContain("onConsumePendingService,");
    const start = composer.indexOf("if (!pendingService) return;");
    expect(start).toBeGreaterThan(-1);
    const block = composer.slice(start, start + 400);
    expect(block).toContain("setSelectedService(pendingService)");
    expect(block).toContain("onConsumePendingService?.()");
  });
});

describe("CounterSurface routes search results into the composer's pending props", () => {
  const surface = source("components/dashboard/boutique/counter/CounterSurface.jsx");

  test("a SESSION row goes to pendingSession, a SERVICE row goes to pendingService — both permission-gated", () => {
    expect(surface).toContain("setPendingSession(row)");
    expect(surface).toContain("setPendingService(row)");
    expect(surface).toContain("if (canCreateSessionBooking)");
    expect(surface).toContain("if (canCreateWalkInService)");
  });

  test("a scanned service QR is not force-fed through the ticket check-in lookup", () => {
    // handleDecoded used to call runCodeLookup unconditionally, which only
    // ever resolves R-/A-/F-/pickup codes — a scanned S:<id> service QR
    // would 404. It must branch the same way typed input already does.
    const start = surface.indexOf("const handleDecoded = useCallback(");
    const block = surface.slice(start, start + 700);
    expect(block).toContain("looksLikeCode(value)");
    expect(block).toContain("runNameSearch(value)");
  });
});

describe("CounterBuyerForm's walk-in branch can be turned off for a booking", () => {
  const buyerForm = source("components/dashboard/boutique/counter/CounterBuyerForm.jsx");

  test("allowWalkIn defaults to true — zero behaviour change for the retail till", () => {
    expect(buyerForm).toContain("allowWalkIn = true,");
  });

  test("the checkbox and its anonymous branch are gated on it", () => {
    const checkboxIndex = buyerForm.indexOf("Client de passage");
    const gateIndex = buyerForm.lastIndexOf("{allowWalkIn && (", checkboxIndex);
    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(checkboxIndex);
  });
});
