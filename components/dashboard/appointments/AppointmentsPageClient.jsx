"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, Loader2, CalendarX } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getAllAppointments } from "@/actions/appointment/list-appointments";
import { confirmAppointment, rejectAppointment } from "@/actions/appointment/manage-appointment";

const STATUS_LABEL = {
  PENDING: "En attente",
  CONFIRMED: "Confirmé",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absence",
};

const STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-100",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-100",
  NO_SHOW: "bg-red-50 text-red-600 border-red-100",
};

function formatDateTime(date, startTime) {
  const d = new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  const t = new Date(startTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${d} · ${t}`;
}

export function AppointmentsPageClient({ initialAppointments, staffOptions, showStaffFilter }) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [toReject, setToReject] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [rowLoadingId, setRowLoadingId] = useState(null);

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

  function handleReject() {
    if (!toReject) return;
    setRowLoadingId(toReject.id);
    startTransition(async () => {
      const result = await rejectAppointment(toReject.id);
      setRowLoadingId(null);
      setToReject(null);
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

      {appointments.length === 0 ? (
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
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((a) => (
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
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {a.status === "PENDING" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirm(a.id)}
                          disabled={rowLoadingId === a.id}
                          className="rounded-lg border border-[#2f3a2e] px-3 py-1.5 text-xs font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e] hover:text-white disabled:opacity-50"
                        >
                          {rowLoadingId === a.id ? <Loader2 size={12} className="animate-spin" /> : "Confirmer"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setToReject(a)}
                          disabled={rowLoadingId === a.id}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                        >
                          Refuser
                        </button>
                      </div>
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
        onCancel={() => setToReject(null)}
      />
    </div>
  );
}
