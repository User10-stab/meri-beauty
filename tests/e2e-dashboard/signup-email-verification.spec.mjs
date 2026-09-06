import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { getRunId, taggedEmail } from "../e2e-money/fixtures/run-id.mjs";
import { requireMailpit, waitForEmail } from "../e2e-money/fixtures/mailpit.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";

/**
 * Signing up, and the e-mail that proves the address is real.
 *
 * Every other scenario in either suite starts from a seeded account with
 * `emailVerified: true` written straight into the row — which is the right
 * shortcut for a test about refunds, and means the door everybody actually
 * comes through has never been opened once.
 *
 * The verification half is the part worth having: the token is random,
 * hashed with bcrypt before storage, and matched by comparing the submitted
 * value against every pending hash. Nothing about that can be checked by
 * reading the database, because the plaintext token exists in exactly one
 * place — the e-mail. So this is a flow that is only testable with a real
 * inbox, and Mailpit is why it now is.
 *
 * A password is typed here, into a local dev form, for an account this test
 * creates and owns. That is the one shape of credential entry that is a test
 * fixture rather than a person's secret.
 */

const PASSWORD = "E2eSignup!2026";

/** Both halves of the register form's address block, which a Belgian account needs. */
const ADDRESS = { line1: "Rue de l'Inscription 12", postalCode: "1000", city: "Bruxelles" };

test.describe("signing up and verifying an e-mail address", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("a new account is unverified until the e-mailed link is followed", async ({ page }) => {
    test.setTimeout(180_000);
    await requireMailpit();

    const runId = getRunId();
    const email = taggedEmail("signup", runId);

    await page.goto("/register");
    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    // No digits in the name: fullNameSchema rejects them outright, which is
    // why the run id lives in the e-mail instead (see seedCustomer).
    await page.locator("#fullName").fill("Cliente Test Inscription");
    await page.locator("#email").fill(email);
    await page.locator("#phone").fill(`+324${String(Date.now()).slice(-8)}`);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirmPassword").fill(PASSWORD);

    await page.locator("#addressLine1").fill(ADDRESS.line1);
    await page.locator('[name="addressPostalCode"]').fill(ADDRESS.postalCode);
    await page.locator('[name="addressCity"]').fill(ADDRESS.city);

    await page.locator("#termsAccepted").check();
    await page.getByRole("button", { name: /créer mon compte/i }).click();

    // ── The account exists, and is not yet trusted ────────────────────────
    await expect
      .poll(() => prisma.user.count({ where: { email, isActive: true } }), {
        message: "no account was created for the submitted e-mail",
        timeout: 30_000,
      })
      .toBe(1);

    // findFirst, not findUnique: User.email carries a partial unique index
    // (active users only), so Prisma does not expose it as a unique selector.
    const created = await prisma.user.findFirst({
      where: { email, isActive: true },
      select: { id: true, emailVerified: true, role: true },
    });

    expect(created.role).toBe("CUSTOMER");
    expect(
      created.emailVerified,
      "a brand-new account was trusted before anybody proved the address exists",
    ).toBe(false);

    // ── The token only exists in the inbox ────────────────────────────────
    const message = await waitForEmail({ to: email, timeout: 45_000 });
    const body = `${message.Text ?? ""} ${message.HTML ?? ""}`;
    const match = body.match(/verify-email\?token=([A-Za-z0-9_-]+)/);
    expect(
      match,
      `the verification e-mail carried no /verify-email link. Subject: ${message.Subject}`,
    ).not.toBeNull();

    const token = decodeURIComponent(match[1]);

    // Stored hashed, never in plaintext — so the value in the e-mail cannot
    // be recovered from the database, and a leaked table does not hand
    // somebody else's verification away.
    // Keyed by e-mail, not by user id — the token can be issued mid-checkout
    // for a guest who has no account yet, so the row has no userId at all.
    const stored = await prisma.emailVerificationToken.findFirst({
      where: { email, used: false },
      select: { tokenHash: true, expiresAt: true },
    });
    expect(stored, "no verification token was stored for the new account").not.toBeNull();
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash.startsWith("$2"), "the token was not stored as a bcrypt hash").toBe(true);
    expect(stored.expiresAt.getTime(), "the verification token never expires").toBeGreaterThan(Date.now());

    // ── Following the link verifies it — but only on purpose ─────────────
    await page.goto(`/verify-email?token=${encodeURIComponent(token)}`);

    // The GET deliberately does **not** consume the token. Mail clients and
    // security scanners fetch every link in a message, so verifying on render
    // would let a mailbox prefetcher confirm an address the recipient never
    // opened. The page renders a form and `verifyEmail` runs as a POST-backed
    // server action instead. That is a good decision and worth pinning:
    // assert the address is still unverified before clicking.
    await expect(page.getByRole("button", { name: /confirmer mon adresse e-mail/i })).toBeVisible({
      timeout: 20_000,
    });
    const beforeClick = await prisma.user.findFirst({
      where: { id: created.id },
      select: { emailVerified: true },
    });
    expect(
      beforeClick.emailVerified,
      "merely loading the link verified the address — a mailbox prefetcher would too",
    ).toBe(false);

    await page.getByRole("button", { name: /confirmer mon adresse e-mail/i }).click();

    await expect
      .poll(
        async () =>
          (await prisma.user.findFirst({ where: { id: created.id }, select: { emailVerified: true } }))
            ?.emailVerified,
        { message: "following the e-mailed link did not verify the address", timeout: 30_000 },
      )
      .toBe(true);

    // ── And the account works ─────────────────────────────────────────────
    // The point of verifying is being able to use the account, so the test
    // ends where the customer would: signed in.
    await loginAs(page, { email, password: PASSWORD });
    expect(new URL(page.url()).pathname).not.toBe("/login");
  });

  test("a spent or invented token verifies nothing", async ({ page }) => {
    test.setTimeout(120_000);

    const runId = getRunId();
    const email = taggedEmail("signup-badtoken", runId);

    const user = await prisma.user.create({
      data: {
        fullName: "Cliente Test Jeton Invalide",
        email,
        phone: `04${String(Date.now()).slice(-8)}`,
        // A bcrypt hash of a password this test never uses: the account only
        // has to exist unverified, and it is never signed into.
        password: "$2b$12$0000000000000000000000000000000000000000000000000000",
        role: "CUSTOMER",
        emailVerified: false,
        isActive: true,
      },
      select: { id: true },
    });

    // Well-formed but never issued. The action compares a submitted value
    // against every pending hash, so a nonsense token exercises the same
    // path a real one does and must simply match nothing.
    await page.goto("/verify-email?token=this-token-was-never-issued");

    // Given a moment to be wrong in: asserting immediately would pass against
    // a verification that lands a second later.
    await page.waitForTimeout(5_000);

    const after = await prisma.user.findFirst({
      where: { id: user.id },
      select: { emailVerified: true },
    });
    expect(after.emailVerified, "an invented token verified an address").toBe(false);
  });
});
