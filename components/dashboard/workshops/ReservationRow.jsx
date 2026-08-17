"use client";

import { RowActions } from "../Tables/RowActions";

const STATUS_STYLES = {
  PENDING_DEPOSIT: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
  COMPLETED: "bg-sky-50 text-sky-700 border-sky-200",
  NO_SHOW: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS = {
  PENDING_DEPOSIT: "Acompte en attente",
  CONFIRMED: "Confirmée",
  CANCELLED: "Annulée",
  COMPLETED: "Terminée",
  NO_SHOW: "Absent",
};

function formatSessionDate(date) {
  // Explicit timeZone, not just the server's pinned TZ (instrumentation.js) —
  // without it this renders in Brussels time on the server but the visiting
  // browser's own local time on the client, causing a hydration mismatch
  // (and silently the wrong appointment time for anyone outside Belgium).
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

export function ReservationRow({ row, onEdit, onDelete, onSettle, onNoShow }) {
  const priceFormatted = (value) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Activity */}
      <td className="px-4 py-4 pl-5 align-middle">
        <span className="block font-medium text-gray-800">{row.session?.workshop?.title}</span>
        <span className="text-xs text-gray-400">{formatSessionDate(row.session?.startDate)}</span>
      </td>

      {/* Customer */}
      <td className="px-4 py-4 align-middle">
        <span className="block text-sm font-medium text-gray-700">{row.customer?.fullName}</span>
        <span className="text-xs text-gray-400">{row.customer?.email}</span>
      </td>

      {/* Seats */}
      <td className="px-4 py-4 align-middle text-gray-600">{row.seatsCount} pers.</td>

      {/* Status */}
      <td className="px-4 py-4 align-middle">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
            STATUS_STYLES[row.status] ?? STATUS_STYLES.NO_SHOW
          }`}
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </span>
      </td>

      {/* Payment */}
      <td className="px-4 py-4 align-middle text-sm">
        <span className="block text-gray-700">
          Payé : <span className="font-semibold">{priceFormatted(row.payment?.paidAmount ?? row.depositAmount)}</span>
        </span>
        {Number(row.balanceDue) > 0 && (
          <span className="block text-xs text-amber-600">Solde : {priceFormatted(row.balanceDue)}</span>
        )}
      </td>

      {/* Actions — Admin only (view-only for staff, per the confirmed permissions table) */}
      <td className="px-4 py-4 pr-5 align-middle">
        <div className="flex items-center justify-end gap-2">
          {/* Only a CONFIRMED booking can be settled or marked absent — the
              two ways an atelier actually ends once the session has run. */}
          {row.status === "CONFIRMED" && onSettle && (
            <button
              type="button"
              onClick={() => onSettle(row)}
              className="rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
              title="Encaisser le solde et clôturer"
            >
              Clôturer
            </button>
          )}
          {row.status === "CONFIRMED" && onNoShow && (
            <button
              type="button"
              onClick={() => onNoShow(row)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              title="Le client n'est pas venu — aucun remboursement"
            >
              Absent
            </button>
          )}
          <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </td>
    </tr>
  );
}
