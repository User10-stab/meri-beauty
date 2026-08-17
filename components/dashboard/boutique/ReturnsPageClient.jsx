"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, X, Loader2, PackageSearch } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Button from "@/components/ui/Button";
import { approveReturnRequest, rejectReturnRequest, completeReturnRequest, listReturnRequests } from "@/actions/boutique/returns";
import { Pagination } from "@/components/dashboard/Tables/Pagination";
import { useTranslations } from "next-intl";

const PAGE_SIZE = 20;

const STATUS_STYLE = {
  REQUESTED: "bg-amber-50 text-amber-700 border-amber-100",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-100",
  REJECTED: "bg-red-50 text-red-600 border-red-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
};

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}
function formatDate(d) {
  return d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" }) : "—";
}

export function ReturnsPageClient({ initialRequests, initialTotalCount }) {
  const t = useTranslations("dashboardBoutique.returns");
  const [requests, setRequests] = useState(initialRequests);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(null);
  const [isPending, startTransition] = useTransition();

  const STATUS_LABEL = {
    REQUESTED: t("status.REQUESTED"),
    APPROVED: t("status.APPROVED"),
    REJECTED: t("status.REJECTED"),
    COMPLETED: t("status.COMPLETED"),
  };

  function refetch(next) {
    const params = {
      status: next.status !== undefined ? next.status : statusFilter,
      search: next.search !== undefined ? next.search : search,
      page: next.page !== undefined ? next.page : 1,
    };
    startTransition(async () => {
      const result = await listReturnRequests({
        status: params.status || undefined,
        search: params.search || undefined,
        page: params.page,
        pageSize: PAGE_SIZE,
      });
      if (result.success) {
        setRequests(result.data);
        setTotalCount(result.totalCount);
        setPage(params.page);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    refetch({ search });
  }

  function handleReload() {
    // Re-fetch the current page instead of a full window reload, now that
    // pagination means "reload" must preserve page/filter state.
    refetch({ page });
  }

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            refetch({ status: e.target.value });
          }}
          className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        >
          <option value="">{t("allStatuses")}</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {isPending && <Loader2 size={16} className="animate-spin text-gray-400" />}
      </form>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
            <PackageSearch size={22} className="text-gray-300" />
          </div>
          <p className="font-medium text-gray-700">
            {totalCount > 0 ? t("noMatch") : t("noRequests")}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{t("tableHeaders.order")}</TableHead>
              <TableHead>{t("tableHeaders.customer")}</TableHead>
              <TableHead>{t("tableHeaders.items")}</TableHead>
              <TableHead>{t("tableHeaders.status")}</TableHead>
              <TableHead className="pr-6">{t("tableHeaders.requestedOn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((rr) => (
              <TableRow key={rr.id} className="cursor-pointer" onClick={() => setActive(rr)}>
                <TableCell className="pl-6">
                  <span className="font-medium text-gray-800 dark:text-white">n°{rr.order?.orderNumber}</span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-700 dark:text-dark-6">{rr.order?.user?.fullName ?? "—"}</span>
                  <span className="block text-xs text-gray-400">{rr.order?.user?.email}</span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-600 dark:text-dark-6">
                    {t("itemCount", { count: rr.items.reduce((sum, i) => sum + i.quantity, 0) })}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[rr.status]}`}>
                    {STATUS_LABEL[rr.status]}
                  </span>
                </TableCell>
                <TableCell className="pr-6">
                  <span className="text-gray-500 dark:text-dark-6">{formatDate(rr.requestedAt)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-stroke px-6 py-4 dark:border-dark-3">
          <span className="text-xs text-gray-500 dark:text-dark-6">
            {t("totalCount", { count: totalCount })}
          </span>
          <Pagination
            currentPage={page}
            totalPages={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
            onPageChange={(p) => refetch({ page: p })}
          />
        </div>
      )}

      <ReturnDetailDialog
        key={active?.id ?? "empty"}
        returnRequest={active}
        onClose={() => setActive(null)}
        onCompleted={handleReload}
      />
    </div>
  );
}

const CONDITION_OPTIONS = [
  { value: "SEALED_RESELLABLE", label: "Scellé, revendable" },
  { value: "OPENED_HYGIENE", label: "Descellé (exception hygiène)" },
  { value: "DAMAGED", label: "Endommagé" },
  { value: "DEFECTIVE", label: "Défectueux" },
  { value: "WRONG_ITEM", label: "Mauvais article envoyé" },
];

function ReturnDetailDialog({ returnRequest, onClose, onCompleted }) {
  const t = useTranslations("dashboardBoutique.returns.detailDialog");
  const [isPending, startTransition] = useTransition();
  const [staffNote, setStaffNote] = useState("");
  const [manualRefundConfirmed, setManualRefundConfirmed] = useState(false);
  const [manualRefundReference, setManualRefundReference] = useState("");
  const [itemConditions, setItemConditions] = useState({}); // returnRequestItemId -> condition

  if (!returnRequest) return null;
  const rr = returnRequest;
  const allConditionsSet = rr.items.every((item) => Boolean(itemConditions[item.id]));

  function run(action, extra) {
    startTransition(async () => {
      const result = await action({
        returnRequestId: rr.id,
        staffNote: staffNote || undefined,
        manualRefundConfirmed,
        manualRefundReference: manualRefundReference || undefined,
        ...extra,
      });
      if (result.success) {
        toast.success(result.message);
        onClose();
        // Re-fetch the current page rather than patch client state —
        // completion changes stock, credit notes, and the order's own
        // record, not just this row.
        onCompleted();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-dark">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t("title")} — {t("order")} n°{rr.order?.orderNumber}
            </h2>
            <p className="text-sm text-gray-500">{rr.order?.user?.fullName} — {rr.order?.user?.email}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 space-y-2">
          {rr.items.map((item) => (
            <div key={item.id} className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-700 dark:text-dark-6">
                  {item.productName} ({item.variantName}) × {item.quantity}
                </span>
                <span className="text-gray-500">{item.unitPrice != null ? formatPrice(item.unitPrice * item.quantity) : ""}</span>
              </div>
              {rr.status === "APPROVED" && (
                <select
                  value={itemConditions[item.id] ?? ""}
                  onChange={(e) => setItemConditions((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                >
                  <option value="" disabled>État de l&apos;article reçu — à sélectionner</option>
                  {CONDITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {item.conditionLabel && rr.status !== "APPROVED" && (
                <span className="inline-block rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500 dark:border-dark-3">
                  État constaté : {item.conditionLabel}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-dark-2 dark:text-dark-6">
          <span className="font-medium text-gray-700 dark:text-white">{t("reason")} : </span>
          {rr.reasonCategoryLabel ?? rr.reasonCategory}
          {rr.reason && <span className="text-gray-500"> — {rr.reason}</span>}
        </div>

        {rr.status === "APPROVED" && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p><span className="font-semibold">Paiement d'origine : </span>{rr.order?.paymentMethodLabel ?? "Non renseigné"}</p>
            {rr.order?.requiresManualRefund ? (
              <>
                <p className="mt-1">{rr.order?.refundInstruction}</p>
                <label className="mt-3 flex items-start gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={manualRefundConfirmed}
                    onChange={(event) => setManualRefundConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-amber-400"
                  />
                  Je confirme que le remboursement a déjà été effectué au client.
                </label>
                {rr.order?.paymentMethod === "CARD" && (
                  <input
                    value={manualRefundReference}
                    onChange={(event) => setManualRefundReference(event.target.value)}
                    maxLength={100}
                    placeholder="Référence du ticket terminal (obligatoire)"
                    className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f3a2e]"
                  />
                )}
              </>
            ) : (
              <p className="mt-1">Le remboursement sera envoyé automatiquement via Stripe après confirmation de réception.</p>
            )}
          </div>
        )}

        {["REQUESTED", "APPROVED"].includes(rr.status) && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t("staffNote")}
            </label>
            <textarea
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
        )}

        {rr.staffNote && !["REQUESTED", "APPROVED"].includes(rr.status) && (
          <p className="mb-4 text-xs text-gray-400">{t("staffNote")} : {rr.staffNote}</p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          {rr.status === "REQUESTED" && (
            <>
              <button
                type="button"
                onClick={() => run(rejectReturnRequest)}
                disabled={isPending || !staffNote.trim()}
                title={!staffNote.trim() ? "Indiquez un motif — il sera envoyé au client" : undefined}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                {t("reject")}
              </button>
              <Button onClick={() => run(approveReturnRequest)} disabled={isPending}>
                {isPending && <Loader2 size={14} className="animate-spin" />}
                {t("approve")}
              </Button>
            </>
          )}
          {rr.status === "APPROVED" && (
            <>
              <button
                type="button"
                onClick={() => run(rejectReturnRequest)}
                disabled={isPending || !staffNote.trim()}
                title={!staffNote.trim() ? "Indiquez un motif — il sera envoyé au client" : undefined}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                {t("reject")}
              </button>
              <Button
                onClick={() =>
                  run(completeReturnRequest, {
                    itemConditions: rr.items.map((item) => ({ returnRequestItemId: item.id, condition: itemConditions[item.id] })),
                  })
                }
                disabled={
                  isPending ||
                  !allConditionsSet ||
                  (rr.order?.requiresManualRefund && (!manualRefundConfirmed || (rr.order?.paymentMethod === "CARD" && !manualRefundReference.trim())))
                }
              >
                {isPending && <Loader2 size={14} className="animate-spin" />}
                {t("complete")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
