"use client";

import { Users } from "lucide-react";
import { RowActions } from "../Tables/RowActions";

export function ServiceRow({ row, onView, onEdit, onDelete }) {
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Service Name */}
      <td className="px-4 py-4 pl-5 align-middle">
        <div className="flex items-center gap-3">
          {row.staffServices?.[0]?.photo ? (
            <img
              src={row.staffServices[0].photo}
              alt={row.name}
              className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-700 uppercase select-none">
              {row.name.slice(0, 2)}
            </div>
          )}
          <div>
            <span className="block font-medium text-gray-800">{row.name}</span>
            {row.description && (
              <span className="text-xs text-gray-400 block max-w-xs truncate">{row.description}</span>
            )}
          </div>
        </div>
      </td>

      {/* Staff Name(s) */}
      <td className="px-4 py-4 align-middle">
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {row.staffServices && row.staffServices.length > 0 ? (
            row.staffServices.map((ss) => (
              <span
                key={ss.id}
                className="inline-flex items-center rounded bg-gray-150 px-2 py-0.5 text-xs font-medium text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-200"
              >
                {ss.staff?.user?.fullName || "—"}
              </span>
            ))
          ) : (
            <span className="text-xs text-gray-400 italic">Aucun professionnel</span>
          )}
        </div>
      </td>

      {/* Category */}
      <td className="px-4 py-4 align-middle">
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
          {row.category?.name || "—"}
        </span>
      </td>

      {/* Price */}
      <td className="px-4 py-4 align-middle font-medium text-gray-800">
        {row.priceRange}
      </td>

      {/* Duration */}
      <td className="px-4 py-4 align-middle text-gray-600">
        {row.durationRange}
      </td>

      {/* margin */}
      <td className="px-4 py-4 align-middle text-gray-600">
        {row.marginRange}
      </td>

      {/* Actions */}
      <td className="px-4 py-4 pr-5 align-middle">
        <div className="flex items-center justify-end gap-2">
          <RowActions
            row={row}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </td>
    </tr>
  );
}