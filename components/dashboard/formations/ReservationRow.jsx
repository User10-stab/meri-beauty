"use client";

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
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReservationRow({ row }) {
  const priceFormatted = (value) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Formation */}
      <td className="px-4 py-4 pl-5 align-middle">
        <span className="block font-medium text-gray-800">{row.session?.formation?.title}</span>
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

      {/* No row actions for formation reservations — no change/cancel flow exists yet */}
      <td className="px-4 py-4 pr-5 align-middle" />
    </tr>
  );
}
