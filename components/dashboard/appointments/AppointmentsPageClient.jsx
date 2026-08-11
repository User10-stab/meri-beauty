"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, Loader2, CalendarX, Star } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getAllAppointments } from "@/actions/appointment/list-appointments";
import { confirmAppointment, rejectAppointment, completeAppointment } from "@/actions/appointment/manage-appointment";

const STATUS_LABEL = {
  PENDING: "En attente",
  CONFIRMED: "Confirmé",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absence",
};

const STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  COMPLETED: "bg-gray-50 text-gray-600 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-200",
  NO_SHOW: "bg-red-50 text-red-600 border-red-200",
};

function formatDateTime(date, startTime) {
  const d = new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Brussels" });
  const t = new Date(startTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return `${d} · ${t}`;
}

function RatingStars({ rating }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          size={14}
          className={index < rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}
        />
      ))}
    </div>
  );
}

export function AppointmentsPageClient({ initialAppointments, staffOptions, showStaffFilter }) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [toReject, setToReject] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [toComplete, setToComplete] = useState(null);
  const [completeMethod, setCompleteMethod] = useState("CASH");
  const [isPending, startTransition] = useTransition();
  const [rowLoadingId, setRowLoadingId] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appointments.filter((a) => {
      if (q) {
        const hay = `${a.customer?.fullName} ${a.customer?.email} ${a.serviceName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter && a.status !== statusFilter) return false;
      if (staffFilter && a.staffId !== staffFilter) return false;
      return true;
    });
  }, [appointments, search, statusFilter, staffFilter]);

  function refetch(next) {
    const params = {
      search: next.search ?? search,
      status: next.status !== undefined ? next.status : statusFilter,
      staffId: next.staffId !== undefined ? next.staffId : staffFilter,
    };
    startTransition(async () => {
      const result = await getAllAppointments({
        search: params.search || undefined,
        status: params.status || undefined,
        staffId: params.staffId || undefined,
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
    const result = await confirmAppointment(appointmentId);
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

  function handleCompleteWithPayment() {
    if (!toComplete) return;
    setRowLoadingId(toComplete.id);
    startTransition(async () => {
      const result = await completeAppointment(toComplete.id, { method: completeMethod });
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
      <div className="flex flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center">
        <form onSubmit={handleSearchSubmit} className="relative w-full max-w-xs">
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
          className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
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
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="">Toute l'équipe</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName}</option>
            ))}
          </select>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Client</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Experte</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Paiement</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Avis</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-6">
                    <div className="font-medium text-gray-800 dark:text-white">{a.customer?.fullName}</div>
                    <div className="text-xs text-gray-400">{a.customer?.email}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600 dark:text-dark-6">{a.serviceName}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600 dark:text-dark-6">{a.staffName}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600 dark:text-dark-6">{formatDateTime(a.date, a.startTime)}</span>
                  </TableCell>
                  <TableCell>
                    {a.payment ? (
                      <span className="text-gray-500">
                        €{a.payment.paidAmount.toFixed(2)} / €{a.payment.totalAmount.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[a.status]}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                    {a.status === "CANCELLED" && (
                      <div className="mt-1 max-w-48 text-xs text-gray-400">
                        <div>{a.cancelledBy?.fullName ?? a.cancellationSource ?? "Système"}</div>
                        {a.cancellationReason && <div className="truncate" title={a.cancellationReason}>{a.cancellationReason}</div>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.review ? (
                      <div className="space-y-1">
                        <RatingStars rating={a.review.rating} />
                        <p className="text-xs text-gray-400">Avis envoyé</p>
                      </div>
                    ) : a.status === "COMPLETED" ? (
                      <span className="text-xs text-gray-400">En attente d'avis</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {a.status === "PENDING" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirm(a.id)}
                          disabled={rowLoadingId === a.id}
                          className="rounded-lg bg-[#2f3a2e] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2f3a2e]/90 disabled:opacity-50"
                        >
                          {rowLoadingId === a.id ? <Loader2 size={12} className="animate-spin" /> : "Confirmer"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectionReason("");
                            setToReject(a);
                          }}
                          disabled={rowLoadingId === a.id}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                        >
                          Refuser
                        </button>
                      </div>
                    ) : a.status === "CONFIRMED" ? (
                      <button
                        type="button"
                        onClick={() =>
                          a.payment?.status === "PARTIALLY_PAID"
                            ? setToComplete(a)
                            : handleCompleteDirect(a.id)
                        }
                        disabled={rowLoadingId === a.id}
                        className="rounded-lg bg-[#2f3a2e] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#2f3a2e]/90 disabled:opacity-50"
                      >
                        {rowLoadingId === a.id ? <Loader2 size={12} className="animate-spin" /> : "Terminer"}
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!toReject}
        title="Refuser ce rendez-vous ?"
        message={toReject ? `Le rendez-vous de ${toReject.customer?.fullName} sera annulé.` : ""}
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
              {toComplete.customer?.fullName} doit encore régler{" "}
              <span className="font-medium text-gray-700">
                €{(toComplete.payment.totalAmount - toComplete.payment.paidAmount).toFixed(2)}
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
                disabled={isPending}
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
