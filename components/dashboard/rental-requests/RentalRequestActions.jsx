"use client";

import { useState, useRef, useCallback } from "react";
import { Eye, Check, X, Trash2 } from "lucide-react";
import { ActionMenu, ActionMenuItem, ActionMenuTrigger } from "@/components/dashboard/Tables/ActionMenu";

const MENU_ITEMS = [
  { label: "View", icon: Eye, display: "Voir" },
  { label: "Approve", icon: Check, display: "Approuver" },
  { label: "Reject", icon: X, display: "Refuser" },
  { label: "Delete", icon: Trash2, display: "Supprimer", danger: true },
];

/**
 * Portal row-action menu (see Tables/ActionMenu): never clipped by the
 * table's scroll container — flips upward for the last rows.
 *
 * @param {object} props
 * @param {object} props.row - the row data passed to action handlers
 * @param {(row: object) => void} [props.onView]
 * @param {(row: object) => void} [props.onApprove]
 * @param {(row: object) => void} [props.onReject]
 * @param {(row: object) => void} [props.onDelete]
 */
export function RentalRequestActions({ row, onView, onApprove, onReject, onDelete }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  const handlers = {
    View: onView,
    Approve: onApprove,
    Reject: onReject,
    Delete: onDelete,
  };

  function handleAction(label) {
    handlers[label]?.(row);
    setOpen(false);
  }

  return (
    <div className="flex justify-end">
      <ActionMenuTrigger
        triggerRef={triggerRef}
        open={open}
        onToggle={() => setOpen((prev) => !prev)}
      />
      <ActionMenu
        triggerRef={triggerRef}
        open={open}
        onClose={close}
        width={144}
      >
        {MENU_ITEMS.map(({ label, display, icon: Icon, danger }) => (
          <ActionMenuItem
            key={label}
            icon={Icon}
            label={display ?? label}
            danger={danger}
            onSelect={() => handleAction(label)}
          />
        ))}
      </ActionMenu>
    </div>
  );
}
