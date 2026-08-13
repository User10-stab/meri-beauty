import { describe, expect, test, beforeAll, beforeEach, afterEach, vi } from "vitest";
import {
  createResumeCheckoutToken,
  verifyResumeCheckoutToken,
  isCheckoutAuthorized,
} from "@/lib/resume-checkout-token";

// vitest doesn't load .env — AUTH_SECRET must be present before any call
// reaches getSecret(), which is read lazily (inside sign()), not at import
// time, so setting it here is enough regardless of import order.
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-at-least-32-chars-long-for-hmac";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createResumeCheckoutToken / verifyResumeCheckoutToken", () => {
  test("a freshly minted token verifies for the exact (resumeType, resumeId) it was bound to", () => {
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_1", email: "buyer@example.com" });
    const result = verifyResumeCheckoutToken(token, { resumeType: "ORDER", resumeId: "order_1" });
    expect(result).toEqual({ ok: true, email: "buyer@example.com" });
  });

  test("rejects when resumeId doesn't match the token's bound resource — closes the IDOR this token exists to prevent", () => {
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_1", email: "buyer@example.com" });
    const result = verifyResumeCheckoutToken(token, { resumeType: "ORDER", resumeId: "order_2" });
    expect(result).toEqual({ ok: false });
  });

  test("rejects when resumeType doesn't match, even with the same resumeId", () => {
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "shared_id", email: "buyer@example.com" });
    const result = verifyResumeCheckoutToken(token, { resumeType: "WORKSHOP", resumeId: "shared_id" });
    expect(result).toEqual({ ok: false });
  });

  test("rejects a token with a tampered signature", () => {
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_1", email: "buyer@example.com" });
    const [payload] = token.split(".");
    const forged = `${payload}.${"a".repeat(43)}`;
    expect(verifyResumeCheckoutToken(forged, { resumeType: "ORDER", resumeId: "order_1" })).toEqual({ ok: false });
  });

  test("rejects a token whose payload was edited to point at a different order, even keeping the original signature", () => {
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_1", email: "buyer@example.com" });
    const [payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const forgedPayload = Buffer.from(JSON.stringify({ ...decoded, resumeId: "order_victim" })).toString("base64url");
    const forged = `${forgedPayload}.${signature}`;
    expect(verifyResumeCheckoutToken(forged, { resumeType: "ORDER", resumeId: "order_victim" })).toEqual({ ok: false });
  });

  test("rejects a token past its 30-minute expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_1", email: "buyer@example.com" });

    vi.setSystemTime(new Date("2026-01-01T00:29:00Z"));
    expect(verifyResumeCheckoutToken(token, { resumeType: "ORDER", resumeId: "order_1" }).ok).toBe(true);

    vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));
    expect(verifyResumeCheckoutToken(token, { resumeType: "ORDER", resumeId: "order_1" })).toEqual({ ok: false });
  });

  test("rejects malformed input (wrong shape, missing signature, garbage) without throwing", () => {
    expect(verifyResumeCheckoutToken(undefined, { resumeType: "ORDER", resumeId: "order_1" })).toEqual({ ok: false });
    expect(verifyResumeCheckoutToken("", { resumeType: "ORDER", resumeId: "order_1" })).toEqual({ ok: false });
    expect(verifyResumeCheckoutToken("no-dot-in-here", { resumeType: "ORDER", resumeId: "order_1" })).toEqual({ ok: false });
    expect(verifyResumeCheckoutToken("a.b.c", { resumeType: "ORDER", resumeId: "order_1" })).toEqual({ ok: false });
    expect(verifyResumeCheckoutToken("not-base64!!.sig", { resumeType: "ORDER", resumeId: "order_1" })).toEqual({ ok: false });
  });

  test("fails hard instead of silently minting a forgeable token when AUTH_SECRET is unset", () => {
    const original = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(() =>
        createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_1", email: "buyer@example.com" })
      ).toThrow("AUTH_SECRET is not configured");
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });
});

describe("isCheckoutAuthorized", () => {
  test("authorizes via a valid token alone — the guest / just-verified path with no session yet", () => {
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_1", email: "buyer@example.com" });
    const resource = { userId: "user_owner" };
    expect(
      isCheckoutAuthorized(resource, { resumeType: "ORDER", resumeId: "order_1", checkoutToken: token, sessionUserId: null })
    ).toBe(true);
  });

  test("authorizes a signed-in owner with no token at all (order-shaped resource: userId)", () => {
    const resource = { userId: "user_owner" };
    expect(
      isCheckoutAuthorized(resource, {
        resumeType: "ORDER",
        resumeId: "order_1",
        checkoutToken: null,
        sessionUserId: "user_owner",
      })
    ).toBe(true);
  });

  test("authorizes a signed-in owner with no token at all (reservation-shaped resource: customerId)", () => {
    const resource = { customerId: "cust_owner" };
    expect(
      isCheckoutAuthorized(resource, {
        resumeType: "WORKSHOP",
        resumeId: "res_1",
        checkoutToken: null,
        sessionUserId: "cust_owner",
      })
    ).toBe(true);
  });

  test("rejects a signed-in user who is not the resource's owner, with no token — the exact IDOR H1/M1 flagged", () => {
    const resource = { userId: "user_owner" };
    expect(
      isCheckoutAuthorized(resource, {
        resumeType: "ORDER",
        resumeId: "order_1",
        checkoutToken: null,
        sessionUserId: "user_attacker",
      })
    ).toBe(false);
  });

  test("rejects when there is neither a valid token nor a session", () => {
    const resource = { userId: "user_owner" };
    expect(
      isCheckoutAuthorized(resource, { resumeType: "ORDER", resumeId: "order_1", checkoutToken: null, sessionUserId: null })
    ).toBe(false);
  });

  test("rejects an expired/invalid token even if one was supplied, when there's also no valid session", () => {
    const resource = { userId: "user_owner" };
    expect(
      isCheckoutAuthorized(resource, {
        resumeType: "ORDER",
        resumeId: "order_1",
        checkoutToken: "garbage.token",
        sessionUserId: null,
      })
    ).toBe(false);
  });

  test("rejects a token minted for a different order even when a session is present but doesn't own the resource", () => {
    const token = createResumeCheckoutToken({ resumeType: "ORDER", resumeId: "order_other", email: "buyer@example.com" });
    const resource = { userId: "user_owner" };
    expect(
      isCheckoutAuthorized(resource, {
        resumeType: "ORDER",
        resumeId: "order_1",
        checkoutToken: token,
        sessionUserId: "user_attacker",
      })
    ).toBe(false);
  });
});
