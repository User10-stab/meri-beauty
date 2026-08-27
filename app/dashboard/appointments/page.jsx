import { Suspense } from "react";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getAllAppointments } from "@/actions/appointment/get-all-appointments";
import { AppointmentsPageClient } from "@/components/dashboard/appointments/AppointmentsPageClient";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations();
  return {
    title: `${t("dashboard.appointments.title")} — Dashboard`,
    description: t("dashboard.appointments.subtitle"),
  };
}

export const dynamic = "force-dynamic";

// ─── Status count helper ──────────────────────────────────────────────────────

function countByStatus(appointments, status) {
  return appointments.filter((a) => a.status === status).length;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AppointmentsPage() {
  // Auth guard — accessible to Admin, Owner and Staff
  await requireDashboardPermission(STAFF_PERMISSIONS.APPOINTMENTS);

  const t = await getTranslations();
  const result = await getAllAppointments();
  const appointments = result.data ?? [];

  const pendingCount = countByStatus(appointments, "PENDING");
  const confirmedCount = countByStatus(appointments, "CONFIRMED");

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">
            {t("dashboard.appointments.title")}
          </h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            {t("dashboard.appointments.subtitle")}
          </p>
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap items-center gap-3">
          <StatBadge
            label={t("common.total")}
            value={appointments.length}
            color="bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white"
          />
          {pendingCount > 0 && (
            <StatBadge
              label={t("appointmentStatus.pending")}
              value={pendingCount}
              color="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
            />
          )}
          {confirmedCount > 0 && (
            <StatBadge
              label={t("appointmentStatus.confirmed")}
              value={confirmedCount}
              color="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
            />
          )}
        </div>
      </div>

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {!result.success && result.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <Suspense fallback={<AppointmentsTableSkeleton />}>
        <AppointmentsPageClient initialAppointments={appointments} />
      </Suspense>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBadge({ label, value, color }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2 ${color}`}>
      <span className="text-xl font-bold leading-none">{value}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function AppointmentsTableSkeleton() {
  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
        <div className="h-9 w-32 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
      </div>
      {/* Rows */}
      <div className="divide-y divide-stroke dark:divide-dark-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
            </div>
            <div className="h-6 w-20 animate-pulse rounded-full bg-gray-100 dark:bg-dark-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
