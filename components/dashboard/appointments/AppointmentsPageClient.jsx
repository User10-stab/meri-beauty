"use client";

import { useMemo, useState, useTransition, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Search, Loader2, CalendarX, Check, X, MoreHorizontal, UserX, CheckCircle2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getAllAppointments } from "@/actions/appointment/list-appointments";
import { acceptAppointment, rejectAppointment, completeAppointment, markAppointmentNoShow } from "@/actions/appointment/manage-appointment";

const STATUS_LABEL = {
  PENDING: "En attente",
  ACCEPTED: "Accepté",
  CONFIRMED: "Confirmé",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  REJECTED: "Refusé",
  NO_SHOW: "Absence",
};

const STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  ACCEPTED: "bg-blue-50 text-blue-700 border-blue-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  COMPLETED: "bg-gray-50 text-gray-600 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-200",
  REJECTED: "bg-red-50 text-red-600 border-red-200",
  NO_SHOW: "bg-red-50 text-red-600 border-red-200",
};

const PAYMENT_STATUS_LABEL = {
  PENDING: "Paiement en attente",
  PAID: "Payé",
  PARTIALLY_PAID: "Acompte payé",
  REFUNDED: "Remboursé",
  PARTIALLY_REFUNDED: "Partiellement remboursé",
  REFUND_PENDING: "Remboursement en cours",
  FAILED: "Paiement échoué",
};

const PAYMENT_STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PARTIALLY_PAID: "bg-blue-50 text-blue-700 border-blue-200",
  REFUNDED: "bg-gray-50 text-gray-600 border-gray-200",
  PARTIALLY_REFUNDED: "bg-gray-50 text-gray-600 border-gray-200",
  REFUND_PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  FAILED: "bg-red-50 text-red-600 border-red-200",
};

function formatDateTime(date, startTime) {
  const d = new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Brussels" });
  const t = new Date(startTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return `${d} · ${t}`;
}

// ─── Actions — pattern unique kebab du dashboard (RowActions) ─────────────────────
// Une seule ancre par ligne, menu minimaliste, aligné, tooltips natifs, pas de
// boutons multiples côte à côte. Réutilise le même shell que
// components/dashboard/Tables/RowActions.jsx et AppointmentRow.jsx.
function getAppointmentMenuItems(row, handlers) {
  const { onConfirm, onCancel, onComplete, onNoShow, onOpenCompleteDialog } = handlers;
  switch (row.status) {
    case "PENDING":
      return [
        { key: "accept", label: "Accepter", icon: Check, variant: "success", onClick: () => onConfirm(row.id) },
        { key: "divider-1", divider: true },
        { key: "refuse", label: "Refuser", icon: X, variant: "danger", onClick: () => onCancel(row) },
      ];
    case "ACCEPTED":
      return [
        { key: "cancel", label: "Annuler", icon: X, variant: "danger", onClick: () => onCancel(row) },
      ];
    case "CONFIRMED": {
      const handleComplete = () => {
        if (row.payment?.status === "PARTIALLY_PAID" || (row.payment?.status === "PENDING" && row.payment?.paymentType === "ON_SITE")) {
          onOpenCompleteDialog(row);
        } else {
          onComplete(row.id);
        }
      };
      return [
        { key: "complete", label: "Terminer", icon: CheckCircle2, variant: "success", onClick: handleComplete },
        { key: "divider-1", divider: true },
        { key: "noshow", label: "Marquer absente", icon: UserX, variant: "warning", onClick: () => onNoShow(row.id) },
        { key: "cancel", label: "Annuler", icon: X, variant: "danger", onClick: () => onCancel(row) },
      ];
    }
    default:
      return [];
  }
}

const MENU_VARIANT_CLASSES = {
  default: "text-gray-700 hover:bg-gray-50",
  success: "text-emerald-700 hover:bg-emerald-50",
  warning: "text-amber-700 hover:bg-amber-50",
  danger: "text-red-600 hover:bg-red-50",
};

function AppointmentActionsCell({ row, rowLoadingId, onConfirm, onCancel, onComplete, onNoShow, onOpenCompleteDialog }) {
  const [open, setOpen] = useState(false);
  const [loadingKey, setLoadingKey] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const items = getAppointmentMenuItems(row, { onConfirm, onCancel, onComplete, onNoShow, onOpenCompleteDialog });

  if (items.length === 0) {
    return <span className="flex justify-end text-gray-300" aria-hidden="true">—</span>;
  }

  async function handleItemClick(item) {
    if (!item.onClick || loadingKey || rowLoadingId === row.id) return;
    setLoadingKey(item.key);
    try {
      await item.onClick();
    } finally {
      setLoadingKey(null);
      setOpen(false);
    }
  }

  const isBusy = loadingKey !== null || rowLoadingId === row.id;

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isBusy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Actions du rendez-vous"
        title="Actions du rendez-vous"
        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-60"
      >
        {isBusy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Actions du rendez-vous"
          className="absolute right-0 top-full z-40 mt-1 w-48 origin-top-right rounded-lg border border-gray-100 bg-white py-1 shadow-lg shadow-gray-200/60 animate-in fade-in-0 zoom-in-95"
        >
          {items.map((item) => {
            if (item.divider) return <div key={item.key} className="my-1 border-t border-gray-100" role="separator" />;
            const Icon = item.icon;
            const cls = MENU_VARIANT_CLASSES[item.variant] ?? MENU_VARIANT_CLASSES.default;
            return (
              <button
                key={item.key}
                role="menuitem"
                type="button"
                onClick={() => handleItemClick(item)}
                disabled={!!loadingKey}
                title={item.label}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors focus-visible:bg-gray-50 focus-visible:outline-none disabled:opacity-40 ${cls}`}
              >
                <Icon size={14} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppointmentsPageClient({ initialAppointments, staffOptions, showStaffFilter }) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [toReject, setToReject] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [toComplete, setToComplete] = useState(null);
  const [completeMethod, setCompleteMethod] = useState("CASH");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [rowLoadingId, setRowLoadingId] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = appointments.filter((a) => {
      if (q) {
        const hay = `${a.customer?.fullName ?? a.customerName ?? ""} ${a.customer?.email ?? a.customerEmail ?? ""} ${a.serviceName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter && a.status !== statusFilter) return false;
      if (staffFilter && a.staffId !== staffFilter) return false;
      if (dateFilter) {
        const d = new Date(dateFilter);
        const start = new Date(d); start.setHours(0, 0, 0, 0);
        const end = new Date(d); end.setHours(23, 59, 59, 999);
        const apptTime = new Date(a.startTime || a.date || 0).getTime();
        if (apptTime < start.getTime() || apptTime > end.getTime()) return false;
      }
      return true;
    });

    // Tri par date/heure du rendez-vous — DESC (plus récent en premier), inclut heure
    return result.sort((a, b) => {
      const dateA = new Date(a.startTime || a.date || 0).getTime();
      const dateB = new Date(b.startTime || b.date || 0).getTime();
      return dateB - dateA;
    });
  }, [appointments, search, statusFilter, staffFilter, dateFilter]);

  function refetch(next) {
    const params = {
      search: next.search ?? search,
      status: next.status !== undefined ? next.status : statusFilter,
      staffId: next.staffId !== undefined ? next.staffId : staffFilter,
      date: next.date !== undefined ? next.date : dateFilter,
    };
    startTransition(async () => {
      const result = await getAllAppointments({
        search: params.search || undefined,
        status: params.status || undefined,
        staffId: params.staffId || undefined,
        date: params.date || undefined,
      });
      if (result.success) setAppointments(result.data);
      else toast.error(result.message);
    });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    refetch({});
  }

  async function handleConfirm(appointmentId) {
    setRowLoadingId(appointmentId);
    const result = await acceptAppointment(appointmentId);
    setRowLoadingId(null);
    if (result.success) {
      toast.success(result.message);
      refetch({});
    } else {
      toast.error(result.message);
    }
  }

  async function handleCompleteDirect(appointmentId) {
    setRowLoadingId(appointmentId);
    const result = await completeAppointment(appointmentId);
    setRowLoadingId(null);
    if (result.success) {
      toast.success(result.message);
      refetch({});
    } else {
      toast.error(result.message);
    }
  }

  async function handleNoShow(appointmentId) {
    if (!window.confirm("Marquer ce rendez-vous comme absence ? Aucun remboursement ne sera émis.")) return;
    setRowLoadingId(appointmentId);
    const result = await markAppointmentNoShow(appointmentId);
    setRowLoadingId(null);
    if (result.success) {
      toast.success(result.message);
      refetch({});
    } else {
      toast.error(result.message);
    }
  }

  function handleCompleteWithPayment() {
    if (!toComplete || !paymentConfirmed) return;
    setRowLoadingId(toComplete.id);
    startTransition(async () => {
      const result = await completeAppointment(toComplete.id, { method: completeMethod, paymentConfirmed });
      setRowLoadingId(null);
      setToComplete(null);
      if (result.success) {
        toast.success(result.message);
        refetch({});
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleReject() {
    if (!toReject) return;
    setRowLoadingId(toReject.id);
    startTransition(async () => {
      const result = await rejectAppointment(toReject.id, rejectionReason);
      setRowLoadingId(null);
      setToReject(null);
      setRejectionReason("");
      if (result.success) {
        toast.success(result.message);
        refetch({});
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      {/* Filtres — wrap sur mobile, évite d'élargir la table, long noms tronqués */}
      <div className="flex flex-col gap-3 border-b border-stroke px-4 py-4 dark:border-dark-3 sm:px-6 lg:flex-row lg:flex-wrap lg:items-center">
        <form onSubmit={handleSearchSubmit} className="relative w-full max-w-xs shrink-0">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un client…"
            className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </form>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            refetch({ status: e.target.value });
          }}
          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white sm:w-auto"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {showStaffFilter && (
          <select
            value={staffFilter}
            onChange={(e) => {
              setStaffFilter(e.target.value);
              refetch({ staffId: e.target.value });
            }}
            className="h-9 w-full max-w-[220px] truncate rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white sm:w-auto"
            title={staffFilter ? staffOptions?.find((s) => s.id === staffFilter)?.fullName ?? "" : "Toute l'équipe"}
          >
            <option value="">Tous les prestataires</option>
            {staffOptions?.map((s) => (
              <option key={s.id} value={s.id} title={s.fullName}>{s.fullName}</option>
            ))}
          </select>
        )}

        <input
          type="date"
          value={dateFilter}
          onChange={(e) => {
            setDateFilter(e.target.value);
            refetch({ date: e.target.value });
          }}
          aria-label="Filtrer par date du rendez-vous"
          title="Filtrer par date du rendez-vous"
          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white sm:w-auto"
        />
        {dateFilter && (
          <button
            type="button"
            onClick={() => {
              setDateFilter("");
              refetch({ date: "" });
            }}
            className="h-9 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6"
            title="Réinitialiser la date"
          >
            Toutes les dates
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
            <CalendarX size={22} className="text-gray-300" />
          </div>
          <p className="font-medium text-gray-700">Aucun rendez-vous ne correspond à votre recherche</p>
        </div>
      ) : (
        <div className={isPending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap pl-6">Client</TableHead>
                  <TableHead className="whitespace-nowrap">Service</TableHead>
                  <TableHead className="whitespace-nowrap">Experte</TableHead>
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="whitespace-nowrap">Montant payé</TableHead>
                  <TableHead className="whitespace-nowrap">Statut du paiement</TableHead>
                  <TableHead className="whitespace-nowrap">Statut</TableHead>
                  <TableHead className="w-[112px] whitespace-nowrap pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-6">
                      {a.customerName || a.customer?.fullName ? (
                        <>
                          <div className="max-w-[180px] truncate font-medium text-gray-800 dark:text-white" title={a.customerName ?? a.customer?.fullName}>{a.customerName ?? a.customer?.fullName}</div>
                          <div className="max-w-[180px] truncate text-xs text-gray-400" title={a.customerEmail ?? a.customer?.email}>{a.customerEmail ?? a.customer?.email}</div>
                        </>
                      ) : (
                        <div className="text-sm italic text-gray-400">Client non disponible</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[160px] truncate text-gray-600 dark:text-dark-6" title={a.serviceName}>{a.serviceName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[140px] truncate text-gray-600 dark:text-dark-6" title={a.staffName}>{a.staffName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap text-gray-600 dark:text-dark-6">{formatDateTime(a.date, a.startTime)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap font-medium text-gray-700">
                        {a.payment != null || a.paidAmount != null
                          ? `${Number(a.paidAmount ?? a.payment?.paidAmount ?? 0).toFixed(2)} €`
                          : "0.00 €"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {a.payment != null || a.paymentStatus != null ? (
                        a.paymentStatus || a.payment?.status ? (
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PAYMENT_STATUS_STYLE[a.paymentStatus ?? a.payment.status] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                            {PAYMENT_STATUS_LABEL[a.paymentStatus ?? a.payment.status] ?? a.paymentStatus ?? a.payment.status}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">Aucun paiement</span>
                        )
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">Aucun paiement</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                      {a.status === "CANCELLED" || a.status === "REJECTED" ? (
                        <div className="mt-1 max-w-48 text-xs text-gray-400">
                          <div className="truncate" title={a.cancelledBy?.fullName ?? a.cancellationSource ?? "Système"}>{a.cancelledBy?.fullName ?? a.cancellationSource ?? "Système"}</div>
                          {a.cancellationReason && <div className="truncate" title={a.cancellationReason}>{a.cancellationReason}</div>}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="pr-6">
                      <AppointmentActionsCell
                        row={a}
                        rowLoadingId={rowLoadingId}
                        onConfirm={handleConfirm}
                        onCancel={(row) => { setRejectionReason(""); setToReject(row); }}
                        onComplete={handleCompleteDirect}
                        onNoShow={handleNoShow}
                        onOpenCompleteDialog={(row) => { setPaymentConfirmed(false); setToComplete(row); }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toReject}
        title="Refuser ce rendez-vous ?"
        message={toReject ? `Le rendez-vous de ${toReject.customer?.fullName ?? toReject.customerName} sera ${toReject.status === "PENDING" ? "refusé" : "annulé"}.` : ""}
        confirmLabel="Refuser"
        danger
        loading={isPending}
        onConfirm={handleReject}
        onCancel={() => {
          setToReject(null);
          setRejectionReason("");
        }}
      >
        <label htmlFor="appointment-cancellation-reason" className="mb-1 block text-sm font-medium text-gray-700">
          Motif de l&apos;annulation
        </label>
        <textarea
          id="appointment-cancellation-reason"
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value.slice(0, 1000))}
          rows={3}
          placeholder="Expliquez pourquoi ce rendez-vous est annulé…"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
        />
      </ConfirmDialog>

      {toComplete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setToComplete(null); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-800">Encaisser le solde restant</h3>
            <p className="mt-1.5 text-sm text-gray-500">
              {toComplete.customer?.fullName ?? toComplete.customerName} doit encore régler{" "}
              <span className="font-medium text-gray-700">
                €{(Number(toComplete.payment?.totalAmount ?? toComplete.totalAmount ?? 0) - Number(toComplete.payment?.paidAmount ?? toComplete.paidAmount ?? 0)).toFixed(2)}
              </span>{" "}
              sur place. Une facture sera émise pour le montant total dès l'encaissement.
            </p>

            <label className="mt-4 block text-xs font-medium text-gray-500">Mode de paiement</label>
            <select
              value={completeMethod}
              onChange={(e) => setCompleteMethod(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e]"
            >
              <option value="CASH">Espèces</option>
              <option value="CARD">Carte</option>
            </select>

            <label className="mt-4 flex items-start gap-2 text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                checked={paymentConfirmed}
                onChange={(e) => setPaymentConfirmed(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
              />
              Je confirme avoir bien reçu ce paiement (espèces en main, ou carte APPROUVÉE sur le terminal).
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToComplete(null)}
                disabled={isPending}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCompleteWithPayment}
                disabled={isPending || !paymentConfirmed}
                className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-medium text-white hover:bg-[#2f3a2e]/90 disabled:opacity-50"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : "Encaisser et terminer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
