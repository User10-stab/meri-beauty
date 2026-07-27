"use client";

import { RowActions } from "../Tables/RowActions";
import { checkCategoryReservationReadiness } from "@/lib/reservation-compliance";
import { WarningTooltip } from "../shared/WarningTooltip";

export function CategoryRow({ row, onView, onEdit, onDelete }) {
  const readiness = checkCategoryReservationReadiness(row);
  return (
    <>
    <tr className={`group border-b border-gray-100 transition-colors hover:bg-gray-50/70 ${!readiness.ready ? "bg-red-50/40" : ""}`}>
      {/* Name */}
      <td className="px-4 py-4 pl-5 align-middle">
        <div className="flex items-center gap-3">
          {/* Fixed-width warning slot — always present to keep name aligned */}
          <div className="w-4 flex-shrink-0 flex items-center justify-center">
            {!readiness.ready && (
              <WarningTooltip
                title="Problème de réservation"
                warnings={readiness.warnings}
                footer="Cette catégorie n'apparaîtra pas sur la page de réservation."
              />
            )}
          </div>

          {/* Name */}
          <span className="font-medium text-gray-800">{row.name}</span>
        </div>
      </td>

      {/* Description */}
      <td className="px-4 py-4 align-middle">
        <span className="text-gray-600">{row.description || "—"}</span>
      </td>

      {/* Associated Services */}
      <td className="px-4 py-4 align-middle">
        {row.services && row.services.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.services.slice(0, 3).map((service) => (
              <span
                key={service.id}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-100"
              >
                {service.name}
              </span>
            ))}
            {row.services.length > 3 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                +{row.services.length - 3}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400">Aucun service</span>
        )}
      </td>

      {/* Services Count */}
      <td className="px-4 py-4 align-middle">
        <span className="inline-flex items-center justify-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 border border-indigo-100">
          {row.servicesCount}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-4 pr-5 align-middle">
        <RowActions
          row={row}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </td>
    </tr>
    </>
  );
}