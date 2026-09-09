import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * "Réalisé par" — which staff/admin account this revenue belongs to, shown
 * on Opérations rows and the transaction drawer. Three sources have a real
 * link to a staff/admin account (Order.createdByStaff, Appointment via
 * StaffService.staff, Formation via the Animator/staff e-mail bridge
 * resolveFormationAnimatorId already maintains); Workshops deliberately
 * don't, since nothing bridges their Animator back to a real account —
 * same reasoning getStaffPerformance() already documents for commission.
 */
describe("operations attribution: who on staff/admin side this revenue belongs to", () => {
  const actions = source("actions/dashboard/admin-operations.js");
  const filters = source("lib/dashboard/operation-filters.js");
  const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
  const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");

  test("the label helper is shared, not a private copy per screen", () => {
    expect(filters).toContain("export const ROLE_LABELS");
    expect(filters).toContain("export function performedByLabel(performedBy)");
    expect(client).toContain("  performedByLabel,\n");
    expect(client).toContain('} from "@/lib/dashboard/operation-filters"');
    expect(drawer).toContain('import { performedByLabel } from "@/lib/dashboard/operation-filters"');
  });

  test("hydrateOrders selects the real POS-cashier link and treats null as a genuine self-service sale", () => {
    const fnIdx = actions.indexOf("async function hydrateOrders");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain("createdByStaff: { select: { fullName: true, role: true } }");
    expect(fn).toContain("row.createdByStaff ? { name: row.createdByStaff.fullName, role: row.createdByStaff.role } : null");
  });

  test("hydrateAppointmentTransactions selects the assigned StaffService.staff, not a new field", () => {
    const fnIdx = actions.indexOf("async function hydrateAppointmentTransactions");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain("staffService: { select: { staff: { select: { user: { select: { fullName: true, role: true } } } } } }");
    expect(fn).toContain("row.payment?.appointment?.staffService?.staff?.user");
  });

  test("hydrateFormations resolves the Animator e-mail against real staff accounts, batched", () => {
    const fnIdx = actions.indexOf("async function hydrateFormations");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain("animator: { select: { name: true, email: true } }");
    expect(fn).toContain("resolveStaffByEmails(rows.map((row) => row.session?.animator?.email))");
  });

  test("resolveStaffByEmails only matches STAFF-role accounts, batched into one query", () => {
    const fnIdx = actions.indexOf("async function resolveStaffByEmails");
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain('role: "STAFF"');
    expect(fn).toContain("prisma.user.findMany");
  });

  test("getTransactionDetail attaches the same attribution the list rows carry", () => {
    const fnIdx = actions.indexOf("export async function getTransactionDetail");
    const fn = actions.slice(fnIdx);
    expect(fn).toContain("createdByStaff: { select: { fullName: true, role: true } }");
    expect(fn).toContain("staffService: { select: { staff: { select: { user: { select: { fullName: true, role: true } } } } } }");
    expect(fn).toContain("animator: { select: { name: true, email: true } }");
    expect(fn).toContain("resolveStaffByEmails([animator.email])");
  });

  test("Workshops carry no performedBy anywhere — the deliberate exclusion", () => {
    const fnIdx = actions.indexOf("async function hydrateWorkshops");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).not.toContain("performedBy");
    expect(fn).not.toContain("animator");
    expect(drawer).toContain("Deliberately no performedByText");
  });

  test("AdminOperationsClient renders it inline on Order/Formation/Appointment rows, not a new column", () => {
    expect(client).toContain('performedByLabel(row.performedBy) ?? "Achat en ligne (client)"');
    expect(client).toContain("performedByLabel(row.performedBy)");
    expect(client).not.toContain('<TableHead>Réalisé par</TableHead>');
  });

  test("TransactionDetailDrawer shows a Réalisé par row fed by the same helper", () => {
    expect(drawer).toContain('<Row label="Réalisé par" value={source.performedByText} />');
    expect(drawer).toContain("performedByLabel(payment.order.performedBy) ?? \"Achat en ligne (client)\"");
  });
});
