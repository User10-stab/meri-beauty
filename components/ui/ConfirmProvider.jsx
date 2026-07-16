"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

const ConfirmContext = createContext(undefined);

/**
 * @typedef {Object} ConfirmOptions
 * @property {string} title
 * @property {string} message
 * @property {boolean} [danger]
 * @property {string} [confirmLabel]
 * @property {string} [cancelLabel]
 */

/**
 * Provider that enables using `useConfirm()` anywhere in the tree
 * to show a styled confirmation dialog instead of `window.confirm()`.
 *
 * @example
 * ```tsx
 * const confirm = useConfirm();
 * const ok = await confirm({
 *   title: "Supprimer ?",
 *   message: "Cette action est irréversible.",
 *   danger: true,
 * });
 * if (ok) { … }
 * ```
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState({
    open: false,
    title: "",
    message: "",
    danger: false,
    confirmLabel: "Confirmer",
    cancelLabel: "Annuler",
    loading: false,
  });

  // We keep the resolve fn in a ref so it survives re-renders
  const resolveRef = useRef(/** @type {((value: boolean) => void) | null} */ (null));

  const confirm = useCallback(
    /**
     * @param {ConfirmOptions} options
     * @returns {Promise<boolean>} resolves to `true` if confirmed, `false` otherwise
     */
    (options) => {
      // If a dialog is already open, resolve previous one immediately
      if (resolveRef.current) {
        resolveRef.current(false);
        resolveRef.current = null;
      }

      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setState({
          open: true,
          title: options.title,
          message: options.message,
          danger: options.danger ?? false,
          confirmLabel: options.confirmLabel ?? "Confirmer",
          cancelLabel: options.cancelLabel ?? "Annuler",
          loading: false,
        });
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
    setState((prev) => ({ ...prev, open: false, loading: false }));
  }, []);

  const handleCancel = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setState((prev) => ({ ...prev, open: false, loading: false }));
  }, []);

  /**
   * Expose a way to update the loading state from outside
   * (e.g. while an async action is in progress).
   */
  const setLoading = useCallback((loading) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm, setLoading }}>
      {children}
      <ConfirmDialog
        open={state.open}
        title={state.title}
        message={state.message}
        danger={state.danger}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        loading={state.loading}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Hook to get the confirm function.
 * Must be used inside a `<ConfirmProvider>`.
 *
 * @returns {{
 *   confirm: (options: ConfirmOptions) => Promise<boolean>;
 *   setLoading: (loading: boolean) => void;
 * }}
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a <ConfirmProvider>");
  }
  return ctx;
}