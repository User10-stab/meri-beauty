"use client";

import { useMemo, useState } from "react";
import { Search, Users, CalendarCheck, Wallet, TrendingUp } from "lucide-react";
import { startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PERIODS = [
  { value: "month", label: "Ce mois-ci" },
  { value: "lastMonth", label: "Le mois dernier" },
  { value: "3months", label: "3 derniers mois" },
  { value: "year", label: "Cette année" },
  { value: "all", label: "Depuis le début" },
];

const CONTRACT_LABEL = {
  PERCENTAGE: "Commission",
  FIXED_RENT: "Loyer fixe",
  HYBRID: "Hybride",
};

function periodRange(period) {
  const now = new Date();
  switch (period) {
    case "month":
      return { start: startOfMonth(now), end: now };
    case "lastMonth": {
      const prevMonth = subMonths(now, 1);
      return { start: startOfMonth(prevMonth), end: endOfMonth(prevMonth) };
    }
    case "3months":
      return { start: startOfMonth(subMonths(now, 2)), end: now };
    case "year":
      return { start: startOfYear(now), end: now };
    case "all":
    default:
      return null;
  }
}

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}

function computeMetrics(appointments, range) {
  const inRange = range
    ? appointments.filter((a) => {
        const d = new Date(a.date);
        return d >= range.start && d <= range.end;
      })
    : appointments;

  const completed = inRange.filter((a) => a.status === "COMPLETED");
  const cancelled = inRange.filter((a) => a.status === "CANCELLED");
  const noShow = inRange.filter((a) => a.status === "NO_SHOW");
  const upcoming = inRange.filter((a) => ["PENDING", "ACCEPTED", "CONFIRMED"].includes(a.status));

  const revenue = completed.reduce((sum, a) => sum + a.amountTotal, 0);
  const collected = completed.reduce((sum, a) => sum + a.amountPaid, 0);

  return {
    total: inRange.length,
    completed: completed.length,
    cancelled: cancelled.length,
    noShow: noShow.length,
    upcoming: upcoming.length,
    revenue,
    collected,
  };
}

export function StaffPerformanceClient({ initialStaff }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("month");

  const range = useMemo(() => periodRange(period), [period]);

  const rows = useMemo(() => {
    return initialStaff
      .map((s) => {
        const metrics = computeMetrics(s.appointments, range);
        const pct = s.contract?.commissionPercentage ? Number(s.contract.commissionPercentage) : null;
        const commissionOwed = pct != null ? Math.round(metrics.revenue * (pct / 100) * 100) / 100 : null;
        return { ...s, metrics, commissionOwed };
      })
      .filter((s) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return `${s.name} ${s.email}`.toLowerCase().includes(q);
      })
      .sort((a, b) => b.metrics.revenue - a.metrics.revenue);
  }, [initialStaff, range, search]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, s) => ({
          completed: acc.completed + s.metrics.completed,
          revenue: acc.revenue + s.metrics.revenue,
          commission: acc.commission + (s.commissionOwed ?? 0),
        }),
        { completed: 0, revenue: 0, commission: 0 }
      ),
    [rows]
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard icon={<CalendarCheck size={18} />} label="Rendez-vous effectués" value={totals.completed} />
        <SummaryCard icon={<TrendingUp size={18} />} label="Chiffre d'affaires généré" value={formatPrice(totals.revenue)} />
        <SummaryCard icon={<Wallet size={18} />} label="Commissions dues" value={formatPrice(totals.commission)} />
      </div>

      <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="flex flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-xs">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un membre du staff…"
              className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>

          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
              <Users size={22} className="text-gray-300" />
            </div>
            <p className="font-medium text-gray-700">
              {initialStaff.length > 0 ? "Aucun membre du staff ne correspond à votre recherche" : "Aucun membre du staff actif"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Staff</TableHead>
                <TableHead>Contrat</TableHead>
                <TableHead>RDV effectués</TableHead>
                <TableHead>Annulés / No-show</TableHead>
                <TableHead>À venir</TableHead>
                <TableHead>CA généré</TableHead>
                <TableHead>Encaissé</TableHead>
                <TableHead className="pr-6">À reverser</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.staffId}>
                  <TableCell className="pl-6">
                    <span className="font-medium text-gray-800 dark:text-white">{s.name}</span>
                    <span className="block text-xs text-gray-400">{s.email}</span>
                  </TableCell>
                  <TableCell>
                    {s.contract ? (
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex w-fit items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
                          {CONTRACT_LABEL[s.contract.type] ?? s.contract.type}
                        </span>
                        {s.contract.commissionPercentage != null && (
                          <span className="text-xs text-gray-400">{Number(s.contract.commissionPercentage)}%</span>
                        )}
                        {s.contract.fixedRent != null && (
                          <span className="text-xs text-gray-400">{formatPrice(s.contract.fixedRent)}/mois</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Aucun contrat</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-gray-700 dark:text-dark-6">{s.metrics.completed}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-500 dark:text-dark-6">{s.metrics.cancelled} / {s.metrics.noShow}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-500 dark:text-dark-6">{s.metrics.upcoming}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-gray-700 dark:text-dark-6">{formatPrice(s.metrics.revenue)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-500 dark:text-dark-6">{formatPrice(s.metrics.collected)}</span>
                  </TableCell>
                  <TableCell className="pr-6">
                    {s.commissionOwed != null ? (
                      <span className="font-medium text-emerald-600">{formatPrice(s.commissionOwed)}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white px-5 py-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#2f3a2e]/10 text-[#2f3a2e]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-gray-500 dark:text-dark-6">{label}</p>
        <p className="text-lg font-bold text-gray-800 dark:text-white">{value}</p>
      </div>
    </div>
  );
}
