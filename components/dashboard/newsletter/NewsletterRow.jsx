"use client";

import { Eye, Pencil, Trash2, Send, Clock, CheckCircle2 } from "lucide-react";

/**
 * Status badge component
 */
function StatusBadge({ status }) {
  const styles = {
    DRAFT: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
    SCHEDULED: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
    SENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  };

  const labels = {
    DRAFT: "Brouillon",
    SCHEDULED: "Programmée",
    SENT: "Envoyée",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[status] || styles.DRAFT
      }`}
    >
      {status === "DRAFT" && <Clock size={12} />}
      {status === "SCHEDULED" && <Clock size={12} />}
      {status === "SENT" && <CheckCircle2 size={12} />}
      {labels[status] || status}
    </span>
  );
}

/**
 * Newsletter row component for the DataTable.
 */
export function NewsletterRow({ row, onView, onEdit, onDelete, onApprove, currentRole, currentStaffId }) {
  const isDraft = row.status === "DRAFT";
  // OWNER/ADMIN act on any newsletter; a STAFF author only acts on their own.
  const canMutate = currentRole !== "STAFF" || row.createdByStaffId === currentStaffId;

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Brussels",
    });
  }

  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Title */}
      <td className="px-4 py-4 pl-5 align-middle">
        <span className="font-medium text-gray-800">{row.title}</span>
      </td>

      {/* Subject */}
      <td className="px-4 py-4 align-middle">
        <span className="max-w-[200px] truncate text-sm text-gray-600">
          {row.subject}
        </span>
      </td>

      {/* Created by */}
      <td className="px-4 py-4 align-middle">
        <span className="text-sm text-gray-600">{row.createdByName ?? "Salon"}</span>
      </td>

      {/* Created date */}
      <td className="px-4 py-4 align-middle">
        <span className="whitespace-nowrap text-sm text-gray-600">
          {formatDate(row.createdAt)}
        </span>
      </td>

      {/* Sent date */}
      <td className="px-4 py-4 align-middle">
        <span className="whitespace-nowrap text-sm text-gray-600">
          {row.sentAt ? formatDate(row.sentAt) : "—"}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-4 align-middle">
        <StatusBadge status={row.status} />
      </td>

      {/* Recipients */}
      <td className="px-4 py-4 align-middle">
        <span className="text-sm font-medium text-gray-700">
          {row.recipientCount ?? 0}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-4 pr-5 align-middle">
        <div className="flex items-center justify-end gap-1">
          {/* View */}
          <button
            type="button"
            onClick={() => onView?.(row)}
            title="Voir"
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <Eye size={16} />
          </button>

          {/* Edit (own drafts only) */}
          {isDraft && canMutate && (
            <button
              type="button"
              onClick={() => onEdit?.(row)}
              title="Modifier"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
            >
              <Pencil size={16} />
            </button>
          )}

          {/* Send (own drafts only) */}
          {isDraft && canMutate && (
            <button
              type="button"
              onClick={() => onApprove?.(row)}
              title="Envoyer"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-emerald-600"
            >
              <Send size={16} />
            </button>
          )}

          {/* Delete (own drafts only) */}
          {isDraft && canMutate && (
            <button
              type="button"
              onClick={() => onDelete?.(row)}
              title="Supprimer"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}