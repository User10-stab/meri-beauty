"use client";

import { RentalRequestActions } from "./RentalRequestActions";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getStatusColor(status) {
  switch (status) {
    case "PENDING":
      return "bg-yellow-100 text-yellow-800";
    case "APPROVED":
      return "bg-green-100 text-green-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "CANCELLED":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getStatusText(status) {
  switch (status) {
    case "PENDING":
      return "En attente";
    case "APPROVED":
      return "Approuvée";
    case "REJECTED":
      return "Rejetée";
    case "CANCELLED":
      return "Annulée";
    default:
      return status;
  }
}


// ─── Component ───────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {object} props.row - rental request data
 * @param {(row: object) => void} [props.onView]
 * @param {(row: object) => void} [props.onApprove]
 * @param {(row: object) => void} [props.onReject]
 * @param {(row: object) => void} [props.onDelete]
 */
export function RentalRequestRow({ row, onView, onApprove, onReject, onDelete }) {
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Rental Type */}
      <td className="px-4 py-4 pl-5 align-middle">
        <div className="font-medium text-gray-800">{row.rentalType}</div>
      </td>

      {/* User */}
      <td className="px-4 py-4 align-middle">
        {row.user ? (
          <div>
            <div className="font-medium text-gray-800">{row.user.fullName}</div>
            <div className="text-sm text-gray-500">{row.user.email}</div>
          </div>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </td>

      {/* Period */}
      <td className="px-4 py-4 align-middle">
        <div className="text-sm text-gray-900">
          {formatDate(row.startDate)}
        </div>
        <div className="text-sm text-gray-500">
          au {formatDate(row.endDate)}
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-4 align-middle">
        <span
          className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
            row.status
          )}`}
        >
          {getStatusText(row.status)}
        </span>
      </td>

       <td className="px-4 py-4 align-middle w-[200px] max-w-[200px]">
        <div className="font-medium text-gray-800 truncate max-h-[3rem] overflow-hidden leading-5">
          {row.message || "-"}
        </div>
      </td>

      {/* Created At */}
      <td className="px-4 py-4 align-middle">
        <span className="whitespace-nowrap text-gray-600">
          {formatDate(row.createdAt)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-4 pr-5 align-middle">
        <RentalRequestActions
          row={row}
          onView={onView}
          onApprove={onApprove}
          onReject={onReject}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}
