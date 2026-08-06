import { Suspense } from "react";
import { requireAdmin } from "@/lib/route-protection";
import { getIndependentStaff } from "@/actions/staff/get-independent-staff";
import { getServices } from "@/actions/services/get-services";
import { StaffPageClient } from "@/components/dashboard/staff/StaffPageClient";

export const metadata = {
  title: "Auto-Entrepreneurs — Dashboard",
  description: "Gérez les professionnels indépendants de votre salon.",
};

export const dynamic = "force-dynamic";

export default async function AutoEntrepreneurPage() {
  await requireAdmin();

  const [staffResult, servicesResult] = await Promise.all([
    getIndependentStaff(),
    getServices(),
  ]);

  const staffList = staffResult.data ?? [];
  const services  = servicesResult.data ?? [];

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark dark:text-white">
            Auto-Entrepreneurs
          </h1>
          <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
            Gérez les professionnels indépendants rattachés à votre salon.
          </p>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-3">
          <StatBadge
            label="Total"
            value={staffList.length}
            color="bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white"
          />
          <StatBadge
            label="Actifs"
            value={staffList.filter((s) => s.isActive).length}
            color="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
          />
          <StatBadge
            label="Stripe non connecté"
            value={staffList.filter((s) => !s.stripeChargesEnabled || !s.stripePayoutsEnabled).length}
            color="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
          />
          <StatBadge
            label="Inactifs"
            value={staffList.filter((s) => !s.isActive).length}
            color="bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-dark-6"
          />
        </div>
      </div>

      {/* ── Error banners ──────────────────────────────────────────────── */}
      {staffResult.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {staffResult.message}
        </div>
      )}

      {servicesResult.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {servicesResult.message} Les services ne seront pas disponibles dans le formulaire.
        </div>
      )}

      {/* ── Client shell ───────────────────────────────────────────────── */}
      <Suspense fallback={<StaffTableSkeleton />}>
        <StaffPageClient initialData={staffList} services={services} />
      </Suspense>
    </div>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2 ${color}`}>
      <span className="text-xl font-bold leading-none">{value}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function StaffTableSkeleton() {
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
            <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-full bg-gray-100 dark:bg-dark-2" />
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
