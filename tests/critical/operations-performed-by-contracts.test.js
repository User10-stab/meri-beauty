import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * "Réalisé par" — which staff/admin account this revenue belongs to, shown
 * on Opérations rows and the transaction drawer. Order uses
 * Order.createdByStaff; Appointment uses StaffService.staff; Workshop and
 * Formation both resolve their session's Animator e-mail against a real
 * staff account via the same resolveStaffByEmails bridge
 * resolveFormationAnimatorId already maintains for formations.
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

  test("hydrateWorkshops resolves the Animator e-mail against real staff accounts, same bridge as formations", () => {
    const fnIdx = actions.indexOf("async function hydrateWorkshops");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain("animator: { select: { name: true, email: true } }");
    expect(fn).toContain("resolveStaffByEmails(rows.map((row) => row.session?.animator?.email))");
    expect(fn).toContain("performedBy");
  });

  test("getTransactionDetail attaches the same attribution the list rows carry, for every source", () => {
    const fnIdx = actions.indexOf("export async function getTransactionDetail");
    const fn = actions.slice(fnIdx);
    expect(fn).toContain("createdByStaff: { select: { fullName: true, role: true } }");
    expect(fn).toContain("staffService: { select: { staff: { select: { user: { select: { fullName: true, role: true } } } } } }");
    // Workshop and Formation both carry this select and both resolve the
    // bridge — the workshop branch was the historical gap (fixed alongside
    // this test), so this must not match only the formation branch.
    expect(fn.match(/animator: \{ select: \{ name: true, email: true \} \}/g)?.length).toBe(2);
    expect(fn.match(/resolveStaffByEmails\(\[animator\.email\]\)/g)?.length).toBe(2);
    expect(fn).toContain("transaction.payment.workshopReservation.performedBy");
    expect(fn).toContain("transaction.payment.formationReservation.performedBy");
  });

  test("AdminOperationsClient renders it inline on every entity-grained row, not a new column", () => {
    expect(client).toContain('performedByLabel(row.performedBy) ?? "Achat en ligne (client)"');
    expect(client).toContain("performedByLabel(row.performedBy)");
    expect(client).not.toContain('<TableHead>Réalisé par</TableHead>');
  });

  test("TransactionDetailDrawer shows a Réalisé par row fed by the same helper, including workshops", () => {
    expect(drawer).toContain('<Row label="Réalisé par" value={source.performedByText} />');
    expect(drawer).toContain("performedByLabel(payment.order.performedBy) ?? \"Achat en ligne (client)\"");
    const workshopIdx = drawer.indexOf("if (payment?.workshopReservation)");
    const workshopBlock = drawer.slice(workshopIdx, drawer.indexOf("if (payment?.formationReservation)", workshopIdx));
    expect(workshopBlock).toContain("performedByText: performedByLabel(r.performedBy)");
  });
});
