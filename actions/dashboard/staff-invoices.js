"use server";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { resendMonthlyInvoiceEmail } from "@/lib/staff-monthly-billing";

// ─── Authorization ────────────────────────────────────────────────────────────

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdminRole(session.user.role)) redirect("/dashboard");
  return session.user;
}

// ─── Staff list for filter dropdown ──────────────────────────────────────────

/**
 * Returns a minimal list of all staff members that have at least one
 * StaffMonthlyInvoice row — used to populate the staff filter dropdown.
 */
export async function getStaffListForFilter() {
  await requireAdmin();

  // Only return staff that actually appear in billing history
  const rows = await prisma.staffMonthlyInvoice.findMany({
    distinct: ["staffId"],
    select: {
      staffId: true,
      staff: {
        select: {
          id: true,
          user: { select: { fullName: true, email: true } },
        },
      },
    },
    orderBy: { generatedAt: "desc" },
  });

  return rows
    .filter((r) => r.staff)
    .map((r) => ({
      id: r.staff.id,
      fullName: r.staff.user?.fullName ?? "—",
      email: r.staff.user?.email ?? "",
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "fr"));
}

// ─── List invoices ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   page?: number,
 *   pageSize?: number,
 *   status?: string,
 *   year?: number,
 *   month?: number,
 *   staffId?: string,
 * }} opts
 */
export async function listStaffMonthlyInvoices({
  page = 1,
  pageSize = 50,
  status,
  year,
  month,
  staffId,
} = {}) {
  await requireAdmin();

  const where = {};
  if (status && status !== "ALL") where.status = status;
  if (year)    where.billingYear  = Number(year);
  if (month)   where.billingMonth = Number(month);
  if (staffId) where.staffId      = staffId;

  const [rows, total] = await Promise.all([
    prisma.staffMonthlyInvoice.findMany({
      where,
      orderBy: [
        { billingYear:  "desc" },
        { billingMonth: "desc" },
        { generatedAt:  "desc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            totalInclVat: true,
            issuedAt: true,
            emailSentAt: true,
            dueDate: true,
            source: true,
          },
        },
        staff: {
          select: {
            id: true,
            user: {
              select: { fullName: true, email: true, avatar: true },
            },
          },
        },
      },
    }),
    prisma.staffMonthlyInvoice.count({ where }),
  ]);

  return {
    rows: rows.map(serializeRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ─── Single row detail ────────────────────────────────────────────────────────

export async function getStaffMonthlyInvoiceDetail(id) {
  await requireAdmin();

  const row = await prisma.staffMonthlyInvoice.findUnique({
    where: { id },
    include: {
      invoice: { include: { lines: true } },
      staff: {
        select: {
          id: true,
          user: { select: { fullName: true, email: true } },
        },
      },
    },
  });

  if (!row) return { success: false, error: "Introuvable" };
  return { success: true, data: serializeRow(row) };
}

// ─── Resend ───────────────────────────────────────────────────────────────────

export async function resendStaffMonthlyInvoice(id) {
  await requireAdmin();
  if (!id || typeof id !== "string")
    return { success: false, error: "Identifiant invalide" };
  return resendMonthlyInvoiceEmail(id);
}

// ─── Stats cards ──────────────────────────────────────────────────────────────

export async function getMonthlyBillingStats() {
  await requireAdmin();

  const now = new Date();
  const year = Number(
    new Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels", year: "numeric" }).format(now)
  );
  const month = Number(
    new Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels", month: "numeric" }).format(now)
  );

  const counts = await prisma.staffMonthlyInvoice.groupBy({
    by: ["status"],
    where: { billingYear: year, billingMonth: month },
    _count: { status: true },
  });

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count.status]));

  return {
    year,
    month,
    sent:        byStatus.SENT         ?? 0,
    emailFailed: byStatus.EMAIL_FAILED ?? 0,
    skipped:     byStatus.SKIPPED      ?? 0,
    errors:      byStatus.ERROR        ?? 0,
    generated:   byStatus.GENERATED    ?? 0,
    total: counts.reduce((s, c) => s + c._count.status, 0),
  };
}

// ─── Serialization ────────────────────────────────────────────────────────────

function serializeRow(row) {
  return {
    id:           row.id,
    staffId:      row.staffId,
    billingYear:  row.billingYear,
    billingMonth: row.billingMonth,
    contractId:   row.contractId ?? null,
    status:       row.status,
    emailSentAt:  row.emailSentAt?.toISOString()  ?? null,
    emailError:   row.emailError  ?? null,
    generatedAt:  row.generatedAt?.toISOString()  ?? null,
    updatedAt:    row.updatedAt?.toISOString()     ?? null,
    staff: row.staff
      ? {
          id:       row.staff.id,
          fullName: row.staff.user?.fullName ?? null,
          email:    row.staff.user?.email    ?? null,
          avatar:   row.staff.user?.avatar   ?? null,
        }
      : null,
    invoice: row.invoice
      ? {
          id:           row.invoice.id,
          number:       row.invoice.number,
          totalInclVat: row.invoice.totalInclVat != null
            ? Number(row.invoice.totalInclVat)
            : null,
          issuedAt:    row.invoice.issuedAt?.toISOString()    ?? null,
          emailSentAt: row.invoice.emailSentAt?.toISOString() ?? null,
          dueDate:     row.invoice.dueDate?.toISOString()     ?? null,
          source:      row.invoice.source,
          lines: row.invoice.lines?.map((l) => ({
            id:          l.id,
            description: l.description,
            quantity:    l.quantity,
            unitPrice:   Number(l.unitPrice),
            lineTotal:   Number(l.lineTotal),
          })) ?? undefined,
        }
      : null,
  };
}
