"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

const MENU_GAP = 4; // px between trigger and menu
const VIEWPORT_MARGIN = 8; // min px between menu and viewport edge

/**
 * Shared trigger button for row action menus — identical look everywhere.
 */
export function ActionMenuTrigger({ triggerRef, open, onToggle, label = "Row actions", disabled = false, children }) {
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label}
      title={label}
      className="
        flex h-7 w-7 items-center justify-center rounded-md text-gray-400
        transition-colors hover:bg-gray-100 hover:text-gray-700
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500
        disabled:opacity-60
      "
    >
      {children ?? <MoreHorizontal size={16} />}
    </button>
  );
}

/**
 * Portal row-action menu shared by every dashboard table.
 *
 * Rendered via `createPortal` into `document.body` with `position: fixed`,
 * so it can never be clipped by a table's `overflow: auto/hidden` container
 * — including for the last rows. It opens downward by default and flips
 * upward when there isn't enough space below the trigger (measured against
 * the real menu height), and clamps horizontally inside the viewport.
 * Closes on outside click, Escape, scroll, and resize.
 *
 * @param {object} props
 * @param {React.RefObject} props.triggerRef - ref of the trigger button (anchor)
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {React.ReactNode} props.children - menuitem buttons / separators
 * @param {string} [props.label] - aria-label
 * @param {number} [props.width] - menu width in px (default 192)
 */
export function ActionMenu({ triggerRef, open, onClose, children, label = "Row action menu", width = 192 }) {
  const menuRef = useRef(null);
  const [style, setStyle] = useState(null); // { top, left } once measured

  // Position after mount: measure the real menu, flip up if needed, clamp.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef?.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    function place() {
      const rect = trigger.getBoundingClientRect();
      const menuHeight = menu.offsetHeight;
      const menuWidth = width;

      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      const openUp =
        menuHeight + MENU_GAP > spaceBelow && spaceAbove > spaceBelow;

      const top = openUp
        ? Math.max(VIEWPORT_MARGIN, rect.top - menuHeight - MENU_GAP)
        : Math.min(
            rect.bottom + MENU_GAP,
            Math.max(VIEWPORT_MARGIN, window.innerHeight - menuHeight - VIEWPORT_MARGIN),
          );

      // Right-align with the trigger, clamped inside the viewport.
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.right - menuWidth),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - menuWidth - VIEWPORT_MARGIN),
      );

      setStyle({ top, left });
    }

    place();
    // Re-place after fonts/layout settle (same frame is usually enough).
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, triggerRef, width, children]);

  // Dismiss: outside click, Escape, any scroll, resize.
  useEffectDismiss(open, triggerRef, menuRef, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="
        rounded-lg border border-gray-100 bg-white py-1
        shadow-lg shadow-gray-200/60
        animate-in fade-in-0 zoom-in-95
      "
      style={{
        position: "fixed",
        zIndex: 100,
        width,
        visibility: style ? "visible" : "hidden",
        ...(style ?? { top: 0, left: 0 }),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function useEffectDismiss(open, triggerRef, menuRef, onClose) {
  useEffect(() => {
    if (!open) return;
    function handlePointer(e) {
      const t = e.target;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef?.current?.contains(t)) return; // let the trigger toggle
      onClose();
    }
    function handleKey(e) {
      if (e.key === "Escape") {
        onClose();
        triggerRef?.current?.focus();
      }
    }
    function handleScroll() {
      onClose();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("scroll", handleScroll, true); // capture: any scrollable ancestor
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open, triggerRef, menuRef, onClose]);
}

/**
 * Shared menuitem button — same look in every table menu.
 */
export function ActionMenuItem({ icon: Icon, label, title, danger = false, disabled = false, onSelect, className = "" }) {
  return (
    <button
      role="menuitem"
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={title ?? (typeof label === "string" ? label : undefined)}
      className={`
        flex w-full items-center gap-2.5 px-3 py-2 text-sm
        transition-colors focus-visible:bg-gray-50
        focus-visible:outline-none disabled:opacity-40
        ${className || (danger ? "text-red-500 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50")}
      `}
    >
      {Icon ? <Icon size={14} /> : null}
      {label}
    </button>
  );
}

/**
 * Shared menu separator.
 */
export function ActionMenuDivider() {
  return <div className="my-1 border-t border-gray-100" role="separator" />;
}
