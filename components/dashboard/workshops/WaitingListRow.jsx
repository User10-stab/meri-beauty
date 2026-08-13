"use client";

import { useTranslations } from "next-intl";

const STATUS_STYLES = {
  WAITING: "bg-gray-100 text-gray-600 border-gray-200",
  NOTIFIED: "bg-amber-50 text-amber-700 border-amber-200",
  EXPIRED: "bg-gray-100 text-gray-400 border-gray-200",
  CONVERTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REMOVED: "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABELS = {
  WAITING: "En attente",
  NOTIFIED: "Notifié(e)",
  EXPIRED: "Expiré",
  CONVERTED: "Converti en réservation",
  REMOVED: "Retiré",
};

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

export function WaitingListRow({ row }) {
  const t = useTranslations("dashboardWorkshops.waitingList");
  return (
    <tr className="border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      <td className="px-4 py-4 pl-5 align-middle">
        <span className="block font-medium text-gray-800">{row.session?.workshop?.title}</span>
        <span className="text-xs text-gray-400">{formatSessionDate(row.session?.startDate)}</span>
      </td>

      <td className="px-4 py-4 align-middle">
        <span className="block text-sm font-medium text-gray-700">{row.customer?.fullName}</span>
        <span className="text-xs text-gray-400">{row.customer?.email}</span>
      </td>

      <td className="px-4 py-4 align-middle text-gray-600">#{row.position}</td>
      <td className="px-4 py-4 align-middle text-gray-600">{row.seatsRequested} pers.</td>

      <td className="px-4 py-4 align-middle">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
            STATUS_STYLES[row.status] ?? STATUS_STYLES.WAITING
          }`}
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </span>
      </td>

      {/* No actions — waiting list is read-only for both Admin and Staff */}
      <td className="px-4 py-4 pr-5 align-middle" />
    </tr>
  );
}
