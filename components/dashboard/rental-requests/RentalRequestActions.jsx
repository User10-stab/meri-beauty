"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Eye, Check, X, Trash2 } from "lucide-react";

const MENU_ITEMS = [
  { label: "View", icon: Eye },
  { label: "Approve", icon: Check },
  { label: "Reject", icon: X },
  { label: "Delete", icon: Trash2, danger: true },
];

/**
 * @param {object} props
 * @param {object} props.row - the row data passed to action handlers
 * @param {(row: object) => void} [props.onView]
 * @param {(row: object) => void} [props.onApprove]
 * @param {(row: object) => void} [props.onReject]
 * @param {(row: object) => void} [props.onDelete]
 */
export function RentalRequestActions({ row, onView, onApprove, onReject, onDelete }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

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
    <div ref={containerRef} className="relative flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Row actions"
        className="
          flex h-7 w-7 items-center justify-center rounded-md text-gray-400
          transition-colors hover:bg-gray-100 hover:text-gray-700
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500
        "
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Row action menu"
          className="
            absolute right-0 top-full z-40 mt-1 w-36 origin-top-right
            rounded-lg border border-gray-100 bg-white py-1
            shadow-lg shadow-gray-200/60
            animate-in fade-in-0 zoom-in-95
          "
        >
          {MENU_ITEMS.map(({ label, icon: Icon, danger }) => (
            <button
              key={label}
              role="menuitem"
              type="button"
              onClick={() => handleAction(label)}
              className={`
                flex w-full items-center gap-2.5 px-3 py-2 text-sm
                transition-colors focus-visible:bg-gray-50
                focus-visible:outline-none
                ${
                  danger
                    ? "text-red-500 hover:bg-red-50"
                    : "text-gray-700 hover:bg-gray-50"
                }
              `}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
