"use client";

import { RowActions } from "../Tables/RowActions";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

export function CustomerRow({ row, onView, onEdit, onDelete }) {
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Full Name */}
      <td className="px-4 py-4 pl-5 align-middle">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-gray-200">
            {row.avatar ? (
              <img
                src={row.avatar}
                alt={row.fullName}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm font-medium text-gray-500">
                {row.fullName
                  ?.split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-800">{row.fullName}</span>
            {row.nickName && (
              <span className="ml-1.5 text-xs text-gray-400">
                ({row.nickName})
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Email */}
      <td className="px-4 py-4 align-middle">
        <span className="text-indigo-600">{row.email}</span>
      </td>

      {/* Phone */}
      <td className="px-4 py-4 align-middle">
        <span className="text-gray-700">{row.phone || "—"}</span>
      </td>

      {/* Appointments */}
      <td className="px-4 py-4 align-middle">
        <span className="inline-flex items-center justify-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 border border-indigo-100">
          {row.appointmentsCount}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-4 align-middle">
        <span className="inline-flex items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          {row.formationsCount ?? 0}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-4 align-middle">
        <ActiveBadge active={row.isActive} />
      </td>

      {/* Joined At */}
      <td className="px-4 py-4 align-middle">
        <span className="whitespace-nowrap text-gray-600">
          {formatDate(row.joinedAt)}
        </span>
      </td>

      {/* Last Login */}
      <td className="px-4 py-4 align-middle">
        <span className="whitespace-nowrap text-gray-500">
          {formatDate(row.lastLogin)}
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

function ActiveBadge({ active }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
        active
          ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
          : "bg-red-50 text-red-700 border border-red-100"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          active ? "bg-emerald-500" : "bg-red-500"
        }`}
      />
      {active ? "Actif" : "Inactif"}
    </span>
  );
}
