import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 31 Aug 2026: a signed-in customer reported that pressing "Payer l'acompte"
// did nothing at all — no redirect, no spinner, no message. Reproduced by
// calling the action as that account: it returned
//   { success: false, field: "fullName",
//     message: "Le nom contient des caractères non autorisés." }
// because the stored name was "User122" and the booking validator rejects
// digits. The pages only did setFieldErrors({ [result.field]: ... }), but a
// signed-in customer has no name/email INPUT on these pages (both are taken
// from the account and shown as read-only text), so the message rendered
// nowhere. 13 of 42 active dev accounts had such a name — every one of them
// was permanently stuck with zero feedback.
describe("a booking field error is always visible, even with no matching input", () => {
  for (const [label, path] of [
    ["atelier", "app/(public)/reservation-atelier/page.js"],
    ["formation", "app/(public)/reservation-formation/page.js"],
  ]) {
    describe(label, () => {
      const page = source(path);

      test("names the fields that come from the account, not the form", () => {
        expect(page).toContain('const ACCOUNT_OWNED_FIELDS = ["fullName", "email"]');
      });

      test("setError runs on the failure branch regardless of result.field", () => {
        // The old shape put setError in an `else` of `if (result.field)`, so a
        // field error silently replaced the only visible message.
        expect(page).not.toMatch(
          /if \(result\.field\) \{\s*setFieldErrors\(\{ \[result\.field\]: result\.message \}\);\s*\} else \{\s*setError\(result\.message \|\| "Erreur lors de la réservation\."\);\s*\}/
        );
        expect(page).toContain("ACCOUNT_OWNED_FIELDS.includes(result.field)");
      });

      test("an account-owned field error tells the customer where to fix it", () => {
        expect(page).toContain("corrigez-le dans votre profil");
      });
    });
  }
});

// The same click could also be swallowed by a disabled submit button, which
// gives no reaction and states no reason.
describe("a disabled booking button explains itself", () => {
  const page = source("app/(public)/reservation-atelier/page.js");

  test("a reason is derived for every blocking condition", () => {
    expect(page).toContain("submitBlockedReason");
    expect(page).toContain("Cochez l'acceptation des CGV");
    expect(page).toContain("Cette séance est complète");
  });

  test("a failed availability lookup no longer leaves available silently at 0", () => {
    // available starts at 0 and only moves on success; without this branch a
    // failed check disabled the button with no explanation at all.
    expect(page).toContain("Impossible de vérifier les places disponibles");
  });
});
