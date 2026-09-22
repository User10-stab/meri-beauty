import { describe, expect, it } from "vitest";
import { isBoutiqueShippingEnabledFor } from "../../lib/commerce-availability.js";

// isBoutiqueShippingEnabledFor is what lets the real Mondial Relay prod key
// go live on the VPS (BOUTIQUE_SHIPPING_ENABLED=true) while shipping stays
// invisible to every customer except the pilot account(s) — see the
// Mondial Relay test plan.
describe("Mondial Relay pilot allowlist", () => {
  const base = { NODE_ENV: "production", BOUTIQUE_SHIPPING_ENABLED: "true" };

  it("is identical to the base flag when no pilot list is configured", () => {
    expect(isBoutiqueShippingEnabledFor("anyone@example.com", base)).toBe(true);
    expect(isBoutiqueShippingEnabledFor(null, base)).toBe(true);
    expect(isBoutiqueShippingEnabledFor(undefined, { ...base, BOUTIQUE_SHIPPING_ENABLED: "false" })).toBe(false);
  });

  it("restricts to the allowlist once MONDIAL_RELAY_PILOT_EMAILS is set", () => {
    const env = { ...base, MONDIAL_RELAY_PILOT_EMAILS: "marie@meribeautystudio.com, Dev@Example.com" };
    expect(isBoutiqueShippingEnabledFor("marie@meribeautystudio.com", env)).toBe(true);
    // Case-insensitive and whitespace-tolerant on both sides.
    expect(isBoutiqueShippingEnabledFor("DEV@example.com", env)).toBe(true);
    expect(isBoutiqueShippingEnabledFor("customer@gmail.com", env)).toBe(false);
    expect(isBoutiqueShippingEnabledFor(null, env)).toBe(false);
  });

  it("still refuses everyone when the base flag is off, even a pilot e-mail", () => {
    const env = { NODE_ENV: "production", BOUTIQUE_SHIPPING_ENABLED: "false", MONDIAL_RELAY_PILOT_EMAILS: "marie@meribeautystudio.com" };
    expect(isBoutiqueShippingEnabledFor("marie@meribeautystudio.com", env)).toBe(false);
  });

  it("treats a blank pilot list the same as unset", () => {
    const env = { ...base, MONDIAL_RELAY_PILOT_EMAILS: "   " };
    expect(isBoutiqueShippingEnabledFor("anyone@example.com", env)).toBe(true);
  });
});
