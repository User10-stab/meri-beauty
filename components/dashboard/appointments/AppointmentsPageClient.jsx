"use client";

import { useMemo, useState, useTransition, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Search, Loader2, CalendarX, Check, X, MoreHorizontal, UserX, CheckCircle2, RefreshCw, QrCode, Trash2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ActionMenu, ActionMenuDivider, ActionMenuItem, ActionMenuTrigger } from "@/components/dashboard/Tables/ActionMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getAllAppointments } from "@/actions/appointment/list-appointments";
import { acceptAppointment, rejectAppointment, completeAppointment, markAppointmentNoShow, deleteAppointment } from "@/actions/appointment/manage-appointment";
import { resendPaymentEmail } from "@/actions/payment/resend-payment-email";
import { resendCheckInQr } from "@/actions/payments/send-checkin-email";
import { appointmentCollectsAtCounter, appointmentAmountDueAtCounter } from "@/lib/appointments/counter-collection";
import {
  CounterPaymentMethodTiles,
  CounterTerminalReference,
} from "@/components/dashboard/boutique/counter/CounterPaymentMethods";

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
  const { onConfirm, onCancel, onComplete, onNoShow, onOpenCompleteDialog, onResendQr, onDelete } = handlers;
  const hasPayment = Boolean(row.payment);
  switch (row.status) {
    case "PENDING":
      return [
        { key: "accept", label: "Accepter", icon: Check, variant: "success", onClick: () => onConfirm(row.id) },
        { key: "divider-1", divider: true },
        { key: "refuse", label: "Refuser", icon: X, variant: "danger", onClick: () => onCancel(row) },
        ...(!hasPayment ? [{ key: "divider-delete", divider: true }, { key: "delete", label: "Supprimer", icon: Trash2, variant: "danger", onClick: () => onDelete(row) }] : []),
      ];
    case "ACCEPTED":
      return [
        { key: "cancel", label: "Annuler", icon: X, variant: "danger", onClick: () => onCancel(row) },
        ...(!hasPayment ? [{ key: "divider-delete", divider: true }, { key: "delete", label: "Supprimer", icon: Trash2, variant: "danger", onClick: () => onDelete(row) }] : []),
      ];
    case "CONFIRMED": {
      // Also covers an appointment with no Payment row at all — booked
      // "payer au salon" — where money is owed but there was nothing to
      // flag on `row.payment`. Shared with the calendar drawer and mirrors
      // completeAppointment's own server-side rule.
      const handleComplete = () => {
        if (appointmentCollectsAtCounter(row)) {
          onOpenCompleteDialog(row);
        } else {
          onComplete(row.id);
        }
      };
      return [
        { key: "complete", label: "Terminer", icon: CheckCircle2, variant: "success", onClick: handleComplete },
        // A client who paid must always be able to get their entry pass back.
        { key: "resend-qr", label: "Renvoyer le QR code", icon: QrCode, onClick: () => onResendQr(row.id) },
        { key: "divider-1", divider: true },
        { key: "noshow", label: "Marquer absente", icon: UserX, variant: "warning", onClick: () => onNoShow(row.id) },
        { key: "cancel", label: "Annuler", icon: X, variant: "danger", onClick: () => onCancel(row) },
        ...(!hasPayment ? [{ key: "divider-delete", divider: true }, { key: "delete", label: "Supprimer", icon: Trash2, variant: "danger", onClick: () => onDelete(row) }] : []),
      ];
    }
    case "CANCELLED":
      // Cancelled reservations can always be deleted, even if a payment
      // record exists — the delete action will cascade-remove the payment.
      return [
        { key: "delete", label: "Supprimer", icon: Trash2, variant: "danger", onClick: () => onDelete(row) },
      ];
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

function AppointmentActionsCell({ row, rowLoadingId, onConfirm, onCancel, onComplete, onNoShow, onOpenCompleteDialog, onResendQr, onDelete }) {
  const [open, setOpen] = useState(false);
  const [loadingKey, setLoadingKey] = useState(null);
  const triggerRef = useRef(null);

  const items = getAppointmentMenuItems(row, { onConfirm, onCancel, onComplete, onNoShow, onOpenCompleteDialog, onResendQr, onDelete });

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
    <div className="flex justify-end">
      <ActionMenuTrigger
        triggerRef={triggerRef}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        label="Actions du rendez-vous"
        disabled={isBusy}
      >
        {isBusy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
      </ActionMenuTrigger>
      <ActionMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        label="Actions du rendez-vous"
        width={192}
      >
        {items.map((item) => {
          if (item.divider) return <ActionMenuDivider key={item.key} />;
          const Icon = item.icon;
          // Danger keeps the shared red tone; success/warning keep their
          // existing appointment-specific tones.
          const cls =
            item.variant === "success"
              ? MENU_VARIANT_CLASSES.success
              : item.variant === "warning"
                ? MENU_VARIANT_CLASSES.warning
                : "";
          return (
            <ActionMenuItem
              key={item.key}
              icon={Icon}
              label={item.label}
              danger={item.variant === "danger"}
              disabled={!!loadingKey}
              onSelect={() => handleItemClick(item)}
              className={cls}
            />
          );
        })}
      </ActionMenu>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} [props.initialFilters] - Deep-link presets (e.g. from a
 *   dashboard card): { status, staffId, date, month, statuses }. Applied to
 *   the initial state AND every server refetch, so the page shows exactly
 *   the linked data until the user changes a visible control.
 */
export function AppointmentsPageClient({ initialAppointments, staffOptions, showStaffFilter, canCollectCash = false, initialFilters = {} }) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialFilters.status ?? "");
  const [staffFilter, setStaffFilter] = useState(initialFilters.staffId ?? "");
  const [dateFilter, setDateFilter] = useState(initialFilters.date ?? "");
  // Multi-status + month presets have no dedicated visible control — they
  // only ever come from a deep link and are shown in the notice bar below.
  const [statusesFilter, setStatusesFilter] = useState(initialFilters.statuses ?? []);
  const [monthFilter, setMonthFilter] = useState(initialFilters.month ?? "");
  // Notification deep-link: focuses one exact reservation (the server
  // already scoped it to rows the caller may see).
  const [focusedId, setFocusedId] = useState(initialFilters.appointmentId ?? "");
  const focusRowRef = useRef(null);

  useEffect(() => {
    if (focusedId && focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedId, appointments]);
  const [toReject, setToReject] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [toComplete, setToComplete] = useState(null);
  const [completeMethod, setCompleteMethod] = useState("CASH");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  // A card collection is only accepted as EXTERNAL_TERMINAL now, and the
  // terminal's receipt reference is what ties the row to a real charge. The
  // existing "j'ai bien reçu" checkbox already says "ou carte APPROUVÉE sur le
  // terminal", so it doubles as the approval attestation rather than adding a
  // second tick for the same fact.
  const [terminalReference, setTerminalReference] = useState("");
  const [isPending, startTransition] = useTransition();
  const [rowLoadingId, setRowLoadingId] = useState(null);
  const [relancingId, setRelancingId] = useState(null);

  // Keep local list in sync when server revalidates after manual creation
  useEffect(() => {
    setAppointments(initialAppointments);
  }, [initialAppointments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = appointments.filter((a) => {
      if (q) {
        const hay = `${a.customer?.fullName ?? a.customerName ?? ""} ${a.customer?.email ?? a.customerEmail ?? ""} ${a.serviceName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter && a.status !== statusFilter) return false;
      // While a reservation is focused, preset lists are suspended so the
      // linked row can never be hidden by a stale combined URL.
      if (!focusedId) {
        if (statusesFilter.length > 0 && !statusesFilter.includes(a.status)) return false;
      }
      if (staffFilter && a.staffId !== staffFilter) return false;
      if (dateFilter) {
        const d = new Date(dateFilter);
        const start = new Date(d); start.setHours(0, 0, 0, 0);
        const end = new Date(d); end.setHours(23, 59, 59, 999);
        const apptTime = new Date(a.startTime || a.date || 0).getTime();
        if (apptTime < start.getTime() || apptTime > end.getTime()) return false;
      }
      if (!focusedId && monthFilter) {
        const t = new Date(a.startTime || a.date || 0);
        const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
        if (key !== monthFilter) return false;
      }
      return true;
    });

    // Tri par date/heure du rendez-vous — DESC (plus récent en premier), inclut heure
    return result.sort((a, b) => {
      const dateA = new Date(a.startTime || a.date || 0).getTime();
      const dateB = new Date(b.startTime || b.date || 0).getTime();
      return dateB - dateA;
    });
  }, [appointments, search, statusFilter, statusesFilter, staffFilter, dateFilter, monthFilter, focusedId]);

  function refetch(next) {
    const params = {
      search: next.search ?? search,
      status: next.status !== undefined ? next.status : statusFilter,
      statuses: next.statuses !== undefined ? next.statuses : statusesFilter,
      staffId: next.staffId !== undefined ? next.staffId : staffFilter,
      date: next.date !== undefined ? next.date : dateFilter,
      month: next.month !== undefined ? next.month : monthFilter,
      appointmentId: next.appointmentId !== undefined ? next.appointmentId : focusedId,
    };
    startTransition(async () => {
      const result = await getAllAppointments({
        search: params.search || undefined,
        status: params.status || undefined,
        statuses: params.statuses.length > 0 ? params.statuses : undefined,
        staffId: params.staffId || undefined,
        date: params.date || undefined,
        month: params.month || undefined,
        appointmentId: params.appointmentId || undefined,
      });
      if (result.success) setAppointments(result.data);
      else toast.error(result.message);
    });
  }

  // A deep-linked preset (no visible control of its own) is shown in the
  // notice bar below until the user picks a visible control, which takes
  // over: single status replaces the preset list, a picked date replaces
  // the preset month, anything typed/changed drops a focused reservation.
  function clearLinkedFilters() {
    setStatusesFilter([]);
    setMonthFilter("");
    setFocusedId("");
    refetch({ statuses: [], month: "", appointmentId: "" });
  }

  // Leaving focus mode when the user filters explicitly.
  function unfocus(next) {
    if (!focusedId) return next;
    setFocusedId("");
    return { ...next, appointmentId: "" };
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    refetch(unfocus({}));
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

  async function handleResendPayment(appointmentId) {
    setRelancingId(appointmentId);
    const result = await resendPaymentEmail(appointmentId);
    setRelancingId(null);
    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  }

  async function handleResendQr(appointmentId) {
    const result = await resendCheckInQr({ kind: "APPOINTMENT", id: appointmentId });
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
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
      const result = await completeAppointment(toComplete.id, {
        method: completeMethod,
        paymentConfirmed,
        ...(completeMethod === "EXTERNAL_TERMINAL"
          ? { terminalApproved: paymentConfirmed, terminalReference: terminalReference.trim() }
          : {}),
      });
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

  function handleDelete() {
    if (!toDelete) return;
    setRowLoadingId(toDelete.id);
    startTransition(async () => {
      const result = await deleteAppointment(toDelete.id);
      setRowLoadingId(null);
      setToDelete(null);
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
            // The visible control takes over from a deep-linked preset list.
            setStatusesFilter([]);
            refetch(unfocus({ status: e.target.value, statuses: [] }));
          }}
          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white sm:w-auto"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {showStaffFilter && (
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <select
              id="prestataire-filter"
              value={staffFilter}
              onChange={(e) => {
                setStaffFilter(e.target.value);
                refetch(unfocus({ staffId: e.target.value }));
              }}
              className="h-9 w-full max-w-[220px] truncate rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white sm:w-auto"
              title={staffFilter ? staffOptions?.find((s) => s.id === staffFilter)?.fullName ?? "" : "Tous les prestataires"}
              aria-label="Prestataire"
            >
              <option value="">Tous les prestataires</option>
              {staffOptions?.map((s) => (
                <option key={s.id} value={s.id} title={s.fullName}>{s.fullName}</option>
              ))}
            </select>
          </div>
        )}

        <input
          type="date"
          value={dateFilter}
          onChange={(e) => {
            setDateFilter(e.target.value);
            // A picked date takes over from a deep-linked preset month.
            setMonthFilter("");
            refetch(unfocus({ date: e.target.value, month: "" }));
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
              refetch(unfocus({ date: "" }));
            }}
            className="h-9 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6"
            title="Réinitialiser la date"
          >
            Toutes les dates
          </button>
        )}
      </div>

      {/* Deep-linked presets from a dashboard card — no dedicated control,
          so they are shown here until cleared or superseded above. */}
      {(statusesFilter.length > 0 || monthFilter || focusedId) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-stroke bg-indigo-50/50 px-4 py-2.5 text-xs text-indigo-800 dark:border-dark-3 dark:bg-indigo-900/10 dark:text-indigo-300 sm:px-6">
          <span className="font-medium">Filtres liés{focusedId ? " · réservation liée" : ""}{monthFilter ? ` · mois : ${monthFilter}` : ""}{statusesFilter.length > 0 ? ` · statuts : ${statusesFilter.map((s) => STATUS_LABEL[s] ?? s).join(", ")}` : ""}</span>
          <button
            type="button"
            onClick={clearLinkedFilters}
            className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900/40 dark:bg-transparent dark:text-indigo-300"
          >
            Effacer
          </button>
        </div>
      )}

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
                  <TableHead className="whitespace-nowrap">Créé le</TableHead>
                  <TableHead className="whitespace-nowrap">Montant payé</TableHead>
                  <TableHead className="whitespace-nowrap">Statut du paiement</TableHead>
                  <TableHead className="whitespace-nowrap">Statut</TableHead>
                  <TableHead className="w-[112px] whitespace-nowrap pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id} ref={a.id === focusedId ? focusRowRef : undefined} className={a.id === focusedId ? 'bg-indigo-50/60 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-900/20' : undefined}>
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
                      <span className="whitespace-nowrap text-gray-600 dark:text-dark-6" title={a.createdAt ? new Date(a.createdAt).toISOString() : undefined}>
                        {a.createdAt ? formatDateTime(a.createdAt, a.createdAt) : "—"}
                      </span>
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
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PAYMENT_STATUS_STYLE[a.paymentStatus ?? a.payment.status] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                              {PAYMENT_STATUS_LABEL[a.paymentStatus ?? a.payment.status] ?? a.paymentStatus ?? a.payment.status}
                            </span>
                            {(a.paymentStatus ?? a.payment?.status) === "PENDING" && (
                              <button
                                type="button"
                                onClick={() => handleResendPayment(a.id)}
                                disabled={relancingId === a.id}
                                title="Relancer le paiement"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40"
                              >
                                {relancingId === a.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={13} />
                                )}
                              </button>
                            )}
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
                        onResendQr={handleResendQr}
                        onDelete={(row) => setToDelete(row)}
                        onOpenCompleteDialog={(row) =>
                          // Only Marie / an admin takes money at the counter.
                          // For everyone else the balance is recorded off-till
                          // by completeAppointment, so there is no popup — the
                          // "Terminer" click just closes it out.
                          canCollectCash
                            ? (setPaymentConfirmed(false), setToComplete(row))
                            : handleCompleteDirect(row.id)
                        }
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

      <ConfirmDialog
        open={!!toDelete}
        title="Supprimer ce rendez-vous ?"
        message={toDelete ? (() => {
          const base = `Le rendez-vous de ${toDelete.customer?.fullName ?? toDelete.customerName} sera définitivement supprimé.`;
          if (toDelete.status === "CANCELLED" && toDelete.payment) {
            return `${base} Le paiement associé sera également supprimé. Cette action est irréversible.`;
          }
          return `${base} Cette action est irréversible.`;
        })() : ""}
        confirmLabel="Supprimer"
        danger
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />

      {toComplete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setToComplete(null); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-800">
              {toComplete.paymentStatus ? "Encaisser le solde restant" : "Encaisser le paiement"}
            </h3>
            <p className="mt-1.5 text-sm text-gray-500">
              {toComplete.customer?.fullName ?? toComplete.customerName} doit {toComplete.paymentStatus ? "encore " : ""}régler{" "}
              <span className="font-medium text-gray-700">
                €{appointmentAmountDueAtCounter(toComplete).toFixed(2)}
              </span>{" "}
              sur place. Une facture sera émise pour le montant total dès l'encaissement.
            </p>

            {/* Same tiles as the counter (CounterPaymentMethods) — one look
                and one set of labels for every payment on the site. */}
            <div className="mt-4">
              <CounterPaymentMethodTiles methods={["CASH", "EXTERNAL_TERMINAL"]} value={completeMethod} onChange={setCompleteMethod} />
            </div>

            {completeMethod === "EXTERNAL_TERMINAL" && (
              <div className="mt-2">
                <CounterTerminalReference value={terminalReference} onChange={setTerminalReference} />
              </div>
            )}

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
                disabled={
                  isPending ||
                  !paymentConfirmed ||
                  (completeMethod === "EXTERNAL_TERMINAL" && !terminalReference.trim())
                }
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
