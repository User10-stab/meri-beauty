"use client";

import { RowActions } from "../Tables/RowActions";

export function CategoryRow({ row, onView, onEdit, onDelete }) {
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Name */}
      <td className="px-4 py-4 pl-5 align-middle">
        <span className="font-medium text-gray-800">{row.name}</span>
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
  );
}
