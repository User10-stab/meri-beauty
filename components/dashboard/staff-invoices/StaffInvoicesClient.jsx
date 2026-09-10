"use client";

import { Fragment, useEffect, useState, useTransition, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { listStaffMonthlyInvoices, resendStaffMonthlyInvoice } from "@/actions/dashboard/staff-invoices";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  SENT:         { label: "Envoyée",     cls: "bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400"  },
  GENERATED:    { label: "Générée",     cls: "bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400"   },
  EMAIL_FAILED: { label: "Échec e-mail",cls: "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400"    },
  SKIPPED:      { label: "Ignorée",     cls: "bg-gray-100   text-gray-500   dark:bg-dark-2        dark:text-dark-6"     },
  ERROR:        { label: "Erreur",      cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  PENDING:      { label: "En cours",    cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
};

const MONTHS_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_LABELS[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function formatPeriod(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long", year: "numeric", timeZone: "Europe/Brussels",
  });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-BE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels",
  });
}

function formatEuro(amount) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(amount);
}

// ─── Stats card ───────────────────────────────────────────────────────────────

function StatsCard({ label, value, color }) {
  return (
    <div className="rounded-xl border border-stroke bg-white p-5 dark:border-dark-3 dark:bg-gray-dark">
      <p className="text-sm text-gray-500 dark:text-dark-6">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

// ─── Alert banner ─────────────────────────────────────────────────────────────

function AlertBanner({ result, onClose }) {
  if (!result) return null;
  const ok = result.success;
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        ok
          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-400"
          : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
      }`}
    >
      <span className="mt-0.5 flex-shrink-0 leading-none">{ok ? "✓" : "⚠"}</span>
      <span>
        {ok
          ? "La facture a été renvoyée avec succès."
          : `Échec de l'envoi : ${result.error}`}
      </span>
      <button
        type="button"
        className="ml-auto text-gray-400 hover:text-gray-600"
        onClick={onClose}
        aria-label="Fermer"
      >
        ×
      </button>
    </div>
  );
}

// ─── Select helper ────────────────────────────────────────────────────────────

function FilterSelect({ id, label, value, onChange, children }) {
  return (
    <div>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark shadow-sm dark:border-dark-3 dark:bg-gray-dark dark:text-white"
        value={value}
        onChange={onChange}
      >
        {children}
      </select>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StaffInvoicesClient({
  initialRows,
  initialTotal,
  initialPage,
  totalPages,
  stats,
  staffList,
  currentStatus,
  currentYear,
  currentMonth,
  currentStaffId,
}) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // ── Extract current params from URL ────────────────────────────────────────
  const pageParam    = Number(searchParams.get("page")  || 1);
  const statusParam  = searchParams.get("status")  || "ALL";
  const yearParam    = searchParams.get("year")    ? Number(searchParams.get("year"))   : undefined;
  const monthParam   = searchParams.get("month")   ? Number(searchParams.get("month"))  : undefined;
  const staffIdParam = searchParams.get("staffId") || undefined;

  // ── State for reactive data ────────────────────────────────────────────────
  const [rows,        setRows]        = useState(initialRows);
  const [page,        setPage]        = useState(initialPage);
  const [total,       setTotal]       = useState(initialTotal);
  const [pages,       setPages]       = useState(totalPages);
  const [loading,     setLoading]     = useState(false);
  const [resendingId, setResendingId] = useState(null);
  const [resendResult,setResendResult]= useState(null);
  const [expandedId,  setExpandedId]  = useState(null);

  // ── Refetch data when URL params change ────────────────────────────────────
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const result = await listStaffMonthlyInvoices({
          page: pageParam,
          pageSize: 50,
          status: statusParam === "ALL" ? undefined : statusParam,
          year: yearParam,
          month: monthParam,
          staffId: staffIdParam,
        });
        setRows(result.rows);
        setPage(result.page);
        setTotal(result.total);
        setPages(result.totalPages);
      } catch (err) {
        console.error("Failed to fetch invoices:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [pageParam, statusParam, yearParam, monthParam, staffIdParam]);

  // ── URL-driven navigation ─────────────────────────────────────────────────
  const navigate = useCallback(
    (updates) => {
      const p = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v == null || v === "" || v === "ALL") p.delete(k);
        else p.set(k, String(v));
      });
      startTransition(() => router.push(`${pathname}?${p.toString()}`));
    },
    [pathname, router, searchParams]
  );

  // Whenever a filter changes, reset to page 1
  const setFilter = useCallback(
    (key, value) => navigate({ [key]: value, page: 1 }),
    [navigate]
  );

  // ── Resend ────────────────────────────────────────────────────────────────
  async function handleResend(id) {
    setResendingId(id);
    setResendResult(null);
    try {
      const result = await resendStaffMonthlyInvoice(id);
      setResendResult(result);
      if (result.success) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status: "SENT", emailSentAt: new Date().toISOString(), emailError: null }
              : r
          )
        );
      }
    } catch (err) {
      setResendResult({ success: false, error: err?.message ?? "Erreur inattendue" });
    } finally {
      setResendingId(null);
    }
  }

  // ── Year options ──────────────────────────────────────────────────────────
  const currentBrusselsYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentBrusselsYear - 2 + i);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Stats cards (current month) ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatsCard
          label={`${formatPeriod(stats.year, stats.month)} — Total`}
          value={stats.total}
          color="text-dark dark:text-white"
        />
        <StatsCard label="Envoyées"    value={stats.sent}        color="text-green-600  dark:text-green-400"  />
        <StatsCard label="Générées"    value={stats.generated}   color="text-blue-600   dark:text-blue-400"   />
        <StatsCard label="Échec e-mail"value={stats.emailFailed} color="text-red-600    dark:text-red-400"    />
        <StatsCard label="Ignorées"    value={stats.skipped}     color="text-gray-500   dark:text-dark-6"     />
        <StatsCard label="Erreurs"     value={stats.errors}      color="text-orange-600 dark:text-orange-400" />
      </div>

      {/* ── Resend feedback ── */}
      <AlertBanner result={resendResult} onClose={() => setResendResult(null)} />

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Status */}
        <FilterSelect
          id="status-filter"
          label="Statut"
          value={statusParam ?? "ALL"}
          onChange={(e) => setFilter("status", e.target.value)}
        >
          <option value="ALL">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([v, { label }]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </FilterSelect>

        {/* Year */}
        <FilterSelect
          id="year-filter"
          label="Année"
          value={yearParam ?? ""}
          onChange={(e) => setFilter("year", e.target.value || null)}
        >
          <option value="">Toutes les années</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </FilterSelect>

        {/* Month */}
        <FilterSelect
          id="month-filter"
          label="Mois"
          value={monthParam ?? ""}
          onChange={(e) => setFilter("month", e.target.value || null)}
        >
          <option value="">Tous les mois</option>
          {MONTHS_FR.map((name, i) => (
            <option key={i + 1} value={i + 1}>{name}</option>
          ))}
        </FilterSelect>

        {/* Staff */}
        {staffList?.length > 0 && (
          <FilterSelect
            id="staff-filter"
            label="Staff"
            value={staffIdParam ?? ""}
            onChange={(e) => setFilter("staffId", e.target.value || null)}
          >
            <option value="">Tout le staff</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName}</option>
            ))}
          </FilterSelect>
        )}

        <span className="ml-auto text-sm text-gray-500 dark:text-dark-6">
          {loading ? "Chargement..." : `${total} facture${total !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-dark-3 dark:bg-gray-dark">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stroke text-xs uppercase tracking-wide text-gray-500 dark:border-dark-3">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">Staff</th>
              <th className="px-4 py-3 whitespace-nowrap">Période</th>
              <th className="px-4 py-3 whitespace-nowrap">N° facture</th>
              <th className="px-4 py-3 whitespace-nowrap">Montant</th>
              <th className="px-4 py-3 whitespace-nowrap">Générée le</th>
              <th className="px-4 py-3 whitespace-nowrap">E-mail envoyé</th>
              <th className="px-4 py-3 whitespace-nowrap">Statut</th>
              <th className="px-4 py-3 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stroke dark:divide-dark-3">

            {/* Empty state */}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-dark-6">
                  Aucune facture trouvée pour les filtres sélectionnés.
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <Fragment key={row.id}>
                {/* ── Main row ── */}
                <tr className="align-top transition-colors hover:bg-gray-50 dark:hover:bg-dark-2">

                  {/* Staff */}
                  <td className="px-4 py-3">
                    <span className="font-medium text-dark dark:text-white">
                      {row.staff?.fullName ?? "—"}
                    </span>
                    {row.staff?.email && (
                      <div className="text-xs text-gray-400">{row.staff.email}</div>
                    )}
                  </td>

                  {/* Period */}
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-dark dark:text-white">
                    {formatPeriod(row.billingYear, row.billingMonth)}
                  </td>

                  {/* Invoice number */}
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    {row.invoice?.number ?? <span className="text-gray-400">—</span>}
                  </td>

                  {/* Amount */}
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    {row.invoice ? formatEuro(row.invoice.totalInclVat) : "—"}
                  </td>

                  {/* Generated at */}
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-dark-6">
                    {formatDateTime(row.invoice?.issuedAt ?? row.generatedAt)}
                  </td>

                  {/* Email sent at */}
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-dark-6">
                    {formatDateTime(row.emailSentAt)}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={row.status} />
                      <span className="inline-flex items-center rounded-full border border-stroke px-2 py-0.5 text-xs text-gray-400 dark:border-dark-3">
                        Auto
                      </span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">

                      {/* Détail — show when there is an error/skip reason */}
                      {(row.emailError || row.status === "ERROR" || row.status === "SKIPPED") && (
                        <button
                          type="button"
                          onClick={() => setExpandedId((p) => (p === row.id ? null : row.id))}
                          className="rounded-lg border border-stroke px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
                          aria-expanded={expandedId === row.id}
                          aria-label="Voir le détail"
                        >
                          {expandedId === row.id ? "Fermer" : "Détail"}
                        </button>
                      )}

                      {/* PDF — only when an invoice exists */}
                      {row.invoice?.id && (
                        <a
                          href={`/api/staff-invoices/${row.invoice.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-stroke px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
                          aria-label="Télécharger la facture PDF"
                        >
                          PDF
                        </a>
                      )}

                      {/* Renvoyer — only for failed/generated rows that have an invoice */}
                      {row.invoice && (row.status === "EMAIL_FAILED" || row.status === "GENERATED") && (
                        <button
                          type="button"
                          disabled={resendingId === row.id}
                          onClick={() => handleResend(row.id)}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                          style={{ backgroundColor: "#C8A46A" }}
                          aria-label="Renvoyer la facture par e-mail"
                        >
                          {resendingId === row.id ? "Envoi…" : "Renvoyer"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {/* ── Expanded detail row ── */}
                {expandedId === row.id && (
                  <tr className="bg-gray-50 dark:bg-dark-2">
                    <td colSpan={8} className="px-6 py-3">
                      {row.emailError ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400">
                          <span className="font-semibold">
                            {row.status === "SKIPPED" ? "Raison : " : "Erreur e-mail : "}
                          </span>
                          {row.emailError}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 dark:text-dark-6">
                          Statut : <strong>{STATUS_LABELS[row.status]?.label ?? row.status}</strong>
                          {row.status === "ERROR" && " — aucun détail disponible."}
                          {row.status === "SKIPPED" && " — ce membre n'était pas éligible ce mois."}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => navigate({ page: page - 1 })}
            className="rounded-lg border border-stroke px-4 py-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
          >
            ← Précédent
          </button>

          {/* Page number pills */}
          <div className="flex items-center gap-1">
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 2)
              .reduce((acc, p, i, arr) => {
                if (i > 0 && p - arr[i - 1] > 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((item, i) =>
                item === "…" ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-gray-400">…</span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    disabled={loading}
                    onClick={() => navigate({ page: item })}
                    className={`min-w-[32px] rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                      item === page
                        ? "border-transparent text-white"
                        : "border-stroke text-gray-600 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
                    }`}
                    style={item === page ? { backgroundColor: "#C8A46A", borderColor: "#C8A46A" } : {}}
                    aria-current={item === page ? "page" : undefined}
                  >
                    {item}
                  </button>
                )
              )}
          </div>

          <button
            type="button"
            disabled={page >= pages || loading}
            onClick={() => navigate({ page: page + 1 })}
            className="rounded-lg border border-stroke px-4 py-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
          >
            Suivant →
          </button>
        </div>
      )}

      {/* Row count below pagination */}
      {pages > 1 && (
        <p className="text-center text-xs text-gray-400 dark:text-dark-6">
          {loading ? "Chargement..." : `Page ${page} sur ${pages} — ${total} facture${total !== 1 ? "s" : ""}`}
        </p>
      )}
    </div>
  );
}
