"use client";

import { useState, useRef, useCallback } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { ActionMenu, ActionMenuItem, ActionMenuTrigger } from "./ActionMenu";

const MENU_ITEMS = [
  { label: "View", icon: Eye, display: "Voir plus" },
  { label: "Edit", icon: Pencil, display: "Modifier" },
  { label: "Delete", icon: Trash2, display: "Supprimer", danger: true },
];

/**
 * Shared row-action menu. Renders through the portal ActionMenu so it is
 * never clipped by table overflow containers and flips upward when there
 * isn't enough space below (e.g. last rows).
 *
 * @param {object} props
 * @param {object} props.row - the row data passed to action handlers
 * @param {(row: object) => void} [props.onView]
 * @param {(row: object) => void} [props.onEdit]
 * @param {(row: object) => void} [props.onDelete]
 */
export function RowActions({ row, onView, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  const handlers = {
    View: onView,
    Edit: onEdit,
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
        {MENU_ITEMS.filter(({ label }) => handlers[label]).map(
          ({ label, display, icon: Icon, danger }) => (
            <ActionMenuItem
              key={label}
              icon={Icon}
              label={display ?? label}
              danger={danger}
              onSelect={() => handleAction(label)}
            />
          ),
        )}
      </ActionMenu>
    </div>
  );
}
