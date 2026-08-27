import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BANK_METHODS,
  CASH_METHODS,
  DEFAULT_REPORT_MONTHS,
  METHOD_LABELS,
  PERIOD_LABELS,
  REPORT_PERIODS,
  normalizeReportMonths,
} from "@/lib/reports-filters";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("a hand-edited query string cannot widen a report", () => {
  test.each(REPORT_PERIODS)("%i months is accepted as-is", (months) => {
    expect(normalizeReportMonths(months)).toBe(months);
    expect(normalizeReportMonths(String(months))).toBe(months);
  });

  test.each([
    ["999", "an arbitrarily huge window"],
    ["0", "zero"],
    ["-6", "a negative window"],
    ["4", "a plausible but unlisted value"],
    ["", "an empty param"],
    [undefined, "a missing param"],
    ["'; DROP TABLE", "junk"],
  ])("%s falls back to the default (%s)", (input) => {
    expect(normalizeReportMonths(input)).toBe(DEFAULT_REPORT_MONTHS);
  });

  test("the action normalizes rather than trusting its caller", () => {
    // The page validates too, but the action is a public POST endpoint in its
    // own right — every export of a "use server" file is.
    expect(source("actions/dashboard/get-reports-data.js")).toContain("normalizeReportMonths(months)");
  });

  test("an unknown staff id is refused, never silently ignored", () => {
    // Falling back to "everyone" would quietly show a manager the whole
    // salon's figures while the filter still read as one practitioner.
    const action = source("actions/dashboard/get-reports-data.js");
    expect(action).toContain("if (staffId && !selectedStaff)");
    expect(action).toContain('message: "Membre du personnel introuvable."');
  });
});

// Constants shared by the action and the filter bar cannot live in the action:
// Next.js requires every export of a "use server" module to be an async
// function, and a plain export there drops ALL of that module's exports.
describe("the shared filter vocabulary stays out of the server action", () => {
  test("the action file exports only async functions", () => {
    const action = source("actions/dashboard/get-reports-data.js");
    const exports = action.match(/^export .*/gm) ?? [];
    expect(exports.length).toBeGreaterThan(0);
    for (const line of exports) {
      expect(line, `"${line}" is not an async function export`).toMatch(/^export async function /);
    }
  });

  test("both sides import them from the plain module", () => {
    expect(source("actions/dashboard/get-reports-data.js")).toContain('from "@/lib/reports-filters"');
    expect(source("components/dashboard/reports/ReportsFilterBar.jsx")).toContain('from "@/lib/reports-filters"');
    // The directive only counts at the top of the file — the module's own
    // doc comment mentions it by name.
    expect(source("lib/reports-filters.js").trimStart().startsWith('"use server"')).toBe(false);
  });

  test("every selectable period has a label", () => {
    // A missing one would render a bare number in the dropdown.
    for (const months of REPORT_PERIODS) {
      expect(PERIOD_LABELS[months], `no label for ${months} months`).toBeTruthy();
    }
  });
});

describe("cash and bank are told apart", () => {
  test("every method lands on exactly one side of the reconciliation", () => {
    const methods = Object.keys(METHOD_LABELS);
    expect(methods.sort()).toEqual(["CARD", "CASH", "ONLINE"]);
    for (const method of methods) {
      const inCash = CASH_METHODS.includes(method);
      const inBank = BANK_METHODS.includes(method);
      expect(inCash || inBank, `${method} is on neither side`).toBe(true);
      expect(inCash && inBank, `${method} is on both sides`).toBe(false);
    }
  });

  test("a terminal card payment counts as bank, not as drawer cash", () => {
    // It is money that has to turn up on a bank statement, however
    // physically it was taken.
    expect(BANK_METHODS).toContain("CARD");
    expect(BANK_METHODS).toContain("ONLINE");
    expect(CASH_METHODS).toEqual(["CASH"]);
  });

  test("the split is read from the Transaction ledger, not from Payment", () => {
    // Only a Transaction records HOW the money arrived; Payment records how
    // much was earned. Deriving the split from Payment would be a guess.
    const action = source("actions/dashboard/get-reports-data.js");
    expect(action).toContain("prisma.transaction.groupBy(");
    expect(action).toContain('by: ["method", "transactionType"]');
  });

  test("a refund is netted off its own method instead of inflating takings", () => {
    const action = source("actions/dashboard/get-reports-data.js");
    expect(action).toContain('if (row.transactionType === "REFUND")');
    expect(action).toContain("netByMethod[row.method] -= amount;");
    expect(action).toContain("refundByMethod[row.method] += amount;");
  });

  test("the two totals are presented side by side, not one as a subset of the other", () => {
    // They are summed from different ledgers and need not tie out exactly.
    const client = source("components/dashboard/reports/ReportsPageClient.jsx");
    expect(client).toContain("Encaissements par moyen de paiement");
    expect(client).toContain("celui-ci mesure ce qui a");
  });
});

describe("a staff-filtered report never mixes scoped and salon-wide figures", () => {
  const action = source("actions/dashboard/get-reports-data.js");
  const client = source("components/dashboard/reports/ReportsPageClient.jsx");

  test("it filters on both ids, because the two tables key differently", () => {
    // Appointment.staffId points at Staff.id; Order.createdByStaffId points
    // at User.id. Using one for both silently returns nothing.
    expect(action).toContain("{ appointment: { staffId: selectedStaff.id } }");
    expect(action).toContain("{ order: { createdByStaffId: staffUserId } }");
  });

  test("ateliers and formations drop out, having no staff attribution at all", () => {
    expect(action).toContain("staffScoped\n        ? []\n        : prisma.payment.findMany(");
  });

  test("unattributable figures are withheld rather than shown unfiltered", () => {
    expect(action).toContain("staffScoped\n        ? null\n        : prisma.payment.aggregate(");
    expect(action).toContain("staffScoped ? null : prisma.returnRequest.count(");
    expect(client).toContain("{!data.staffScoped && (");
  });

  test("the page says out loud what the filter excludes", () => {
    // Otherwise a smaller number reads as a bad month rather than a narrower
    // question.
    expect(client).toContain("data.staffScoped && (");
    expect(client).toContain("{data.filters.staffName}");
    expect(client).toContain("ils sont donc exclus");
  });

  test("the client tolerates the withheld figures being absent", () => {
    expect(client).toContain("data.promoCode.uses");
    // ...only inside the non-scoped branch, so a null promoCode is never read.
    const scopedBranch = client.slice(client.indexOf("{!data.staffScoped && ("));
    expect(scopedBranch).toContain("data.promoCode.uses");
  });
});

describe("filters live in the URL so a report is shareable", () => {
  test("the bar navigates instead of holding local state", () => {
    const bar = source("components/dashboard/reports/ReportsFilterBar.jsx");
    expect(bar).toContain("new URLSearchParams(searchParams.toString())");
    expect(bar).toContain("router.push(`/dashboard/reports?${params.toString()}`");
  });

  test("the page reads them back and re-queries server-side", () => {
    const page = source("app/dashboard/reports/page.jsx");
    expect(page).toContain("const params = await searchParams;");
    expect(page).toContain("normalizeReportMonths(params?.months)");
    expect(page).toContain("getReportsData({ months, staffId })");
  });
});

describe("the visible filtered report can be exported", () => {
  const client = source("components/dashboard/reports/ReportsPageClient.jsx");

  test("it offers a CSV download button", () => {
    expect(client).toContain("Exporter le rapport CSV");
    expect(client).toContain('text/csv;charset=utf-8');
  });

  test("it exports the currently displayed period, scope, cash and bank split", () => {
    // The export is intentionally built from the data rendered by the
    // server, not from a new unfiltered browser query.
    expect(client).toContain("function downloadReportCsv(data)");
    expect(client).toContain("data.filters.staffName");
    expect(client).toContain("data.cashCollected");
    expect(client).toContain("data.bankCollected");
    expect(client).toContain("data.revenueByMonth.map");
    expect(client).toContain("data.collectionByMethod.map");
  });

  test("the professional Excel download carries the current URL filters", () => {
    expect(client).toContain("Exporter Excel (.xlsx)");
    expect(client).toContain("/api/reports/export?");
    expect(client).toContain('excelParams.set("staffId", data.filters.staffId)');

    const route = source("app/api/reports/export/route.js");
    expect(route).toContain("getReportsData({ months, staffId })");
    expect(route).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });
});

describe("the till history can be windowed and totalled", () => {
  const action = source("actions/dashboard/cash-sessions.js");

  test("the end of the range includes its whole day", () => {
    // "to 31 March" means through the 31st; midnight would drop that day.
    expect(action).toContain("toDate.setHours(23, 59, 59, 999)");
  });

  test("totals cover the filtered range, not the visible page", () => {
    expect(action).toContain("prisma.cashSession.aggregate(");
    const block = action.slice(action.indexOf("prisma.cashSession.aggregate("));
    expect(block).toContain("closedAt: { not: null }");
  });

  test("an open session is excluded from the totals", () => {
    // Its expected/counted/variance are still null and would read as zeros.
    expect(action).toContain("where: { ...where, closedAt: { not: null } }");
  });

  test("an invalid date is ignored rather than crashing the page", () => {
    expect(action).toContain("!Number.isNaN(fromDate.getTime())");
    expect(action).toContain("!Number.isNaN(toDate.getTime())");
  });

  test("refreshing after opening or closing keeps the current filter", () => {
    const client = source("components/dashboard/boutique/CashSessionClient.jsx");
    expect(client).toContain("async function refreshHistory(range = { from, to })");
  });
});

describe("a counter receipt can be reprinted", () => {
  const route = source("app/api/orders/[id]/ticket/route.js");

  test("it re-renders from the order rather than storing a blob", () => {
    // completePointOfSaleSale hands the walk-in ticket back once as base64 and
    // persists nothing, so there was previously no second copy to be had.
    expect(route).toContain("renderTicketPdf({");
    expect(route).toContain("prisma.order.findUnique(");
  });

  test("it is dashboard-only", () => {
    // A ticket names no customer, so there is no ownership to check and
    // nothing a customer could legitimately fetch here.
    expect(route).toContain("if (!canAccessDashboard(session.user.role))");
    expect(route).toContain("{ status: 403 }");
    expect(route).toContain("{ status: 401 }");
  });

  test("it opens inline so the print dialog is one click away", () => {
    expect(route).toContain('"Content-Disposition": `inline; filename="recu-${order.orderNumber}.pdf"`');
  });

  test("a missing order is a 404, not a crash", () => {
    expect(route).toContain("{ status: 404 }");
  });

  test("the order screen offers it even when there is no invoice", () => {
    // A walk-in sale deliberately has no Invoice; the receipt is the only
    // document it will ever have.
    const client = source("components/dashboard/boutique/OrderDetailClient.jsx");
    expect(client).toContain("href={`/api/orders/${order.id}/ticket`}");
    const documents = client.slice(client.indexOf("Documents</h2>"), client.indexOf("{/* Returns */}"));
    expect(documents).toContain("/api/orders/${order.id}/ticket");
    // The invoice link stays conditional; the receipt link must not be.
    expect(documents.indexOf("/api/orders/${order.id}/ticket")).toBeLessThan(
      documents.indexOf("{order.invoice && (")
    );
  });
});
