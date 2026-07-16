"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const ConfirmContext = createContext(null);

/**
 * Imperative confirm() function that opens the ConfirmDialog.
 * @param {string} message
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @param {boolean} [options.danger]
 * @returns {Promise<boolean>} resolves to `true` if confirmed, `false` if cancelled
 */
let confirmRef = null;

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

export function ConfirmProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [confirmLabel, setConfirmLabel] = useState("Confirmer");
  const [cancelLabel, setCancelLabel] = useState("Annuler");
  const [danger, setDanger] = useState(false);
  const resolveRef = useRef(null);

  const confirm = useCallback(
    (msg, options = {}) => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setTitle(options.title || "Confirmation");
        setMessage(msg);
        setConfirmLabel(options.confirmLabel || "Confirmer");
        setCancelLabel(options.cancelLabel || "Annuler");
        setDanger(!!options.danger);
        setOpen(true);
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(true);
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(false);
  }, []);

  // Expose confirm globally for non-React contexts (optional but handy)
  confirmRef = confirm;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={open}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        danger={danger}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}