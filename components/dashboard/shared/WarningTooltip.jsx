"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

/**
 * A warning icon that shows a tooltip rendered via a portal at the viewport
 * level, so it is never clipped by overflow:hidden/auto table containers.
 *
 * Props:
 *   title    – bold heading line inside the tooltip
 *   warnings – string[]
 *   footer   – small italic line at the bottom
 */
export function WarningTooltip({ title, warnings = [], footer }) {
  const [pos, setPos] = useState(null); // { top, left } in viewport px
  const iconRef = useRef(null);
  const hideTimer = useRef(null);

  const show = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({
      // Centre horizontally on the icon, sit above it with a small gap
      top: rect.top + window.scrollY - 8, // 8px gap + tooltip will be translated up
      left: rect.left + window.scrollX + rect.width / 2,
    });
  }, []);

  const hide = useCallback(() => {
    // Small delay so the cursor can move onto the tooltip itself
    hideTimer.current = setTimeout(() => setPos(null), 80);
  }, []);

  // Clean up timer on unmount
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <>
      {/* Trigger icon */}
      <button
        ref={iconRef}
        type="button"
        aria-label="Avertissement de réservation"
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={hide}
        onBlur={hide}
        className="flex items-center justify-center focus:outline-none"
      >
        <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
      </button>

      {/* Portal tooltip — renders outside any overflow container */}
      {pos &&
        createPortal(
          <div
            onMouseEnter={() => clearTimeout(hideTimer.current)}
            onMouseLeave={hide}
            style={{
              position: "absolute",
              top: pos.top,
              left: pos.left,
              transform: "translate(-50%, -100%)",
              zIndex: 9999,
            }}
            className="w-64 rounded-lg border border-red-200 bg-white px-3 py-2.5 shadow-lg"
          >
            {title && (
              <p className="mb-1.5 text-xs font-semibold text-red-800">{title}</p>
            )}
            {warnings.length > 0 && (
              <ul className="space-y-0.5 text-xs text-red-700">
                {warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-0.5 flex-shrink-0 text-red-400">•</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            {footer && (
              <p className="mt-2 text-xs text-red-500">{footer}</p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
