import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Normalized to LF — core.autocrlf=true with no .gitattributes flips files to
// CRLF in the working tree whenever git touches them, silently breaking the
// multi-line matches below.
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// A withdrawal leaving the drawer and that cash actually reaching the bank
// are two different facts separated by a trip someone has to make. Without
// a record of the second fact, "the till lost 850 €" and "850 € is sitting
// safely in the bank" were indistinguishable from "850 € went missing on
// the way" — nothing tied a withdrawal to proof it arrived anywhere.
describe("bank-deposit schema", () => {
  const schema = source("prisma/schema.prisma");

  test("BankDeposit carries the same expected/declared/variance shape as CashSession", () => {
    expect(schema).toContain("model BankDeposit");
    expect(schema).toContain("amount Decimal @db.Decimal(10, 2)");
    expect(schema).toContain("declaredAmount Decimal @db.Decimal(10, 2)");
    expect(schema).toContain("variance Decimal @db.Decimal(10, 2)");
  });

  test("the bank reference is unique — two deposits can never claim the same bank movement", () => {
    expect(schema).toContain("reference String @unique");
  });

  test("a deposit starts DECLARED and only becomes CONFIRMED once matched to a statement", () => {
    expect(schema).toContain("enum BankDepositStatus");
    expect(schema).toContain("DECLARED");
    expect(schema).toContain("CONFIRMED");
    expect(schema).toContain('status BankDepositStatus @default(DECLARED)');
  });

  test("CashMovement links to at most one deposit, nulled rather than orphaned if the deposit disappears", () => {
    expect(schema).toContain("bankDepositId String?");
    expect(schema).toContain(
      'bankDeposit   BankDeposit? @relation(fields: [bankDepositId], references: [id], onDelete: SetNull)'
    );
  });
});

describe("declareBankDeposit", () => {
  const actions = source("actions/dashboard/bank-deposits.js");

  test("the deposit amount is computed from linked movements, never accepted as input", () => {
    // The whole point: a typed amount could be made to match the receipt by
    // typing a bigger number. Summing the actual withdrawals removes that
    // possibility structurally instead of just validating against it.
    expect(actions).not.toMatch(/declareBankDeposit\([^)]*\bamount\b/);
    expect(actions).toContain("movements.reduce((sum, m) => sum + Number(m.amount), 0)");
  });

  test("only WITHDRAWAL movements can be bundled into a deposit", () => {
    expect(actions).toContain('movements.some((m) => m.type !== "WITHDRAWAL")');
  });

  test("a movement already claimed by another deposit cannot be reused", () => {
    expect(actions).toContain("movements.some((m) => m.bankDepositId)");
  });

  test("a duplicate bank reference is rejected instead of silently overwriting the first deposit", () => {
    expect(actions).toContain('error?.code === "P2002"');
  });

  test("linking the movements happens in the same transaction as creating the deposit", () => {
    expect(actions).toContain("$transaction(async (tx)");
    expect(actions).toContain("tx.cashMovement.updateMany");
  });
});

describe("confirmBankDeposit", () => {
  const actions = source("actions/dashboard/bank-deposits.js");

  test("confirming is an atomic claim gated on still being DECLARED", () => {
    // Same shape as closeCashSession's claim — a double-click or two staff
    // acting on the same deposit must not confirm it twice.
    expect(actions).toContain('where: { id: depositId, status: "DECLARED" }');
    expect(actions).toContain("if (claim.count === 0)");
  });

  test("confirmedById is always recorded, even though same-person confirmation is allowed", () => {
    expect(actions).toContain("confirmedById: guard.session.user.id");
  });
});

describe("getCashInTransit", () => {
  const actions = source("actions/dashboard/bank-deposits.js");

  test("counts both unbundled withdrawals and declared-but-unconfirmed deposits", () => {
    // These are the two states where cash has left the drawer but nothing
    // has yet verified it reached the bank.
    expect(actions).toContain('where: { type: "WITHDRAWAL", bankDepositId: null }');
    expect(actions).toContain('where: { status: "DECLARED" }');
  });

  test("a healthy books reads zero, not an absence of the figure", () => {
    expect(actions).toContain("undepositedAmount + unconfirmedAmount");
  });
});

describe("bank-deposit access control", () => {
  test("every export requires the same permission as the till itself", () => {
    const actions = source("actions/dashboard/bank-deposits.js");
    expect(actions).toContain("STAFF_PERMISSIONS.CASH_REGISTER");
    // Guards every exported entry point, not just the write paths — the
    // undeposited-withdrawals list and the transit figure are as sensitive
    // as the deposits themselves.
    for (const fn of [
      "declareBankDeposit",
      "confirmBankDeposit",
      "listBankDeposits",
      "listUndepositedWithdrawals",
      "getCashInTransit",
    ]) {
      const start = actions.indexOf(`export async function ${fn}`);
      expect(start, `${fn} should exist`).toBeGreaterThan(-1);
      const body = actions.slice(start, start + 300);
      expect(body).toContain("requireBankDepositAccess()");
    }
  });
});

describe("bank-deposit UI wiring", () => {
  const client = source("components/dashboard/boutique/BankDepositClient.jsx");
  const page = source("app/(dashboard)/dashboard/boutique/caisse/depots/page.jsx");

  test("the amount typed in is the declared figure, never sent as the computed amount", () => {
    // declareBankDeposit deliberately has no `amount` parameter (see the
    // declareBankDeposit describe block above) — the screen must not work
    // around that by inventing one.
    expect(client).toContain("declaredAmount: amount");
    expect(client).not.toMatch(/declareBankDeposit\([^)]*\bamount:\s*selectedTotal/);
  });

  test("a refused declaration surfaces its reason instead of silently succeeding", () => {
    expect(client).toContain("if (!result.success) return toast.error(result.message)");
  });

  test("confirming is only offered on a still-DECLARED deposit", () => {
    expect(client).toContain('d.status === "DECLARED"');
  });

  test("the page surfaces the cash-in-transit figure and the undeposited withdrawals to bundle", () => {
    expect(page).toContain("getCashInTransit()");
    expect(page).toContain("listUndepositedWithdrawals()");
  });
});
