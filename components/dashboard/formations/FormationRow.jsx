"use client";

import { RowActions } from "../Tables/RowActions";

export function FormationRow({ row, onView, onEdit, onDelete }) {
  const priceFormatted = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(row.price);

  const statusColors = {
    DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
    PUBLISHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    CANCELLED: "bg-red-50 text-red-700 border-red-200",
    ARCHIVED: "bg-amber-50 text-amber-700 border-amber-200",
  };

  const statusLabels = {
    DRAFT: "Brouillon",
    PUBLISHED: "Publié",
    CANCELLED: "Annulé",
    ARCHIVED: "Archivé",
  };

  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Title & Cover */}
      <td className="px-4 py-4 pl-5 align-middle">
        <div className="flex items-center gap-3">
          {row.cover ? (
            <img
              src={row.cover}
              alt={row.title}
              className="h-10 w-16 flex-shrink-0 rounded-lg object-cover border border-gray-100"
            />
          ) : (
            <div className="flex h-10 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-gray-500 uppercase select-none border border-gray-200">
              {row.title.slice(0, 2)}
            </div>
          )}

          <div>
            <span className="block font-medium text-gray-800">{row.title}</span>
            {row.description && (
              <span className="text-xs text-gray-400 block max-w-xs truncate">
                {row.description}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Type */}
      <td className="px-4 py-4 align-middle">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
            row.type === "PRIVATE"
              ? "bg-violet-50 text-violet-800 border-violet-200"
              : "bg-teal-50 text-teal-800 border-teal-200"
          }`}
        >
          {row.type === "PRIVATE" ? "Privée" : "Groupe"}
        </span>
      </td>

      {/* Price */}
      <td className="px-4 py-4 align-middle font-semibold text-gray-800">
        {priceFormatted}
      </td>

      {/* Duration */}
      <td className="px-4 py-4 align-middle text-gray-600">
        {row.duration} min
      </td>

      {/* Capacity */}
      <td className="px-4 py-4 align-middle text-gray-600">
        {row.type === "PRIVATE" ? "1 pers." : `${row.capacity} pers.`}
      </td>

      {/* Animator */}
      <td className="px-4 py-4 align-middle">
        {row.animator ? (
          <div className="flex items-center gap-2">
            {row.animator.avatar ? (
              <img
                src={row.animator.avatar}
                alt={row.animator.name}
                className="h-6 w-6 rounded-full object-cover border border-gray-100"
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600 border border-indigo-200 uppercase">
                {row.animator.name.slice(0, 2)}
              </div>
            )}
            <span className="text-sm font-medium text-gray-700">{row.animator.name}</span>
          </div>
        ) : (
          <span className="text-xs text-gray-400 italic">Aucun formateur</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-4 align-middle">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
            statusColors[row.status]
          }`}
        >
          {statusLabels[row.status]}
        </span>
      </td>

      {/* Actions — staff only manage formations they created; admin manages all */}
      <td className="px-4 py-4 pr-5 align-middle">
        <RowActions
          row={row}
          onView={onView}
          onEdit={row.canManage ? onEdit : undefined}
          onDelete={row.canManage ? onDelete : undefined}
        />
      </td>
    </tr>
  );
}
