"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Wrench,
  X,
  Zap,
} from "lucide-react";

/**
 * Shared "Détails du compte Stripe" popup.
 *
 * Keeps pages clean: table cells and the Payments section only show compact
 * status pills, while the full live Stripe detail (raw `card_payments`
 * value, requirements, disabled_reason, request date) plus the action
 * buttons (Actualiser / Activer / Configurer) live here.
 *
 * Fully presentational — all Stripe data and callbacks come from the caller,
 * all strings come through `labels` so both the hardcoded-French admin table
 * and the translated staff section can reuse it without duplicating markup:
 *
 * labels = { accountLabel, cardLabel, enabled, pending, notEnabled,
 *   actionRequired, connectedButCardInactive, requirementsTitle, pastDueBadge,
 *   errorBadge, pendingVerificationBadge, genericError, refresh,
 *   requestActivation, configureAccount, noAccessHint, canReceive, close }
 * (`requestedAtText` is a separate prop, preformatted by the caller.)
 *
 * @param {{ open: boolean, onClose: () => void, title: string, subtitle?: string|null,
 *   live: object|null, notice?: string|null, error?: string|null,
 *   requestedAtText?: string|null,
 *   busy?: { checking?: boolean, requesting?: boolean, configuring?: boolean },
 *   canAct?: boolean, labels: object,
 *   onRefresh: () => void, onRequest: () => void, onConfigure: () => void }} props
 */
export function StripeAccountDetailsModal({
  open,
  onClose,
  title,
  subtitle = null,
  live,
  notice = null,
  error = null,
  requestedAtText = null,
  busy = {},
  canAct = true,
  labels,
  onRefresh,
  onRequest,
  onConfigure,
}) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const { checking = false, requesting = false, configuring = false } = busy;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="stripe-details-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="stripe-details-title" className="text-base font-semibold text-gray-900 dark:text-white">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 break-all font-mono text-xs text-gray-400">{subtitle}</p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>

        {!live ? (
          error ? (
            <p role="alert" className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-red-600 dark:bg-gray-800/50">
              {error}
            </p>
          ) : null
        ) : (
          <div className="mt-4 space-y-3">
            {/* ── Account level ─────────────────────────────────── */}
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-gray-600 dark:text-gray-400">
                {labels.accountLabel}
              </span>
              <AccountPill level={live.accountLevel} label={live.accountLabel} />
            </div>

            {/* ── Card capability ───────────────────────────────── */}
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-gray-600 dark:text-gray-400">
                {labels.cardLabel}
              </span>
              <CardPill live={live} labels={labels} />
            </div>

            <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
              card_payments : <code className="font-mono">{live.cardPayments}</code>
              {live.cardRequested === false && " • non demandée"}
            </p>

            {live.detail && (
              <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">{live.detail}</p>
            )}

            {live.actionNeeded &&
              (live.cardPayments === "inactive" ||
                live.cardPayments === "unrequested" ||
                live.cardPayments === "unknown") && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
                  {labels.connectedButCardInactive}
                </p>
              )}

            <RequirementsBox live={live} labels={labels} />

            {requestedAtText && (
              <p className="text-[11px] text-gray-400">{requestedAtText}</p>
            )}

            {notice && (
              <p
                role="status"
                className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-300"
              >
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            {/* ── Actions ───────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onRefresh}
                disabled={checking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
              >
                {checking ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                {labels.refresh}
              </button>

              {canAct ? (
                <>
                  {live.actionNeeded && live.canRequest && (
                    <button
                      type="button"
                      onClick={onRequest}
                      disabled={requesting}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {requesting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Zap size={12} />
                      )}
                      {labels.requestActivation}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onConfigure}
                    disabled={configuring}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900/40 dark:bg-indigo-900/10 dark:text-indigo-300"
                  >
                    {configuring ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Wrench size={12} />
                    )}
                    {labels.configureAccount}
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-gray-400">{labels.noAccessHint}</span>
              )}
            </div>

            {!live.actionNeeded && (
              <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <CheckCircle2 size={11} className="text-green-500" />
                {labels.canReceive}
              </p>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {labels.close}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}

function AccountPill({ level, label }) {
  if (level === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
        🟢 {label}
      </span>
    );
  }
  if (level === "disabled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
        🔴 {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
      🟠 {label}
    </span>
  );
}

function CardPill({ live, labels }) {
  if (live.level === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
        <CheckCircle2 size={10} />🟢 {labels.enabled}
      </span>
    );
  }
  if (live.level === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
        <Clock size={10} />🟠 {labels.pending}
      </span>
    );
  }
  if (
    live.cardPayments === "inactive" ||
    live.cardPayments === "unrequested" ||
    live.cardPayments === "unknown"
  ) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
        <AlertTriangle size={10} />🔴 {labels.notEnabled}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
      <AlertTriangle size={10} />🔴 {labels.actionRequired}
    </span>
  );
}

function RequirementsBox({ live, labels }) {
  const items = [
    ...(live.pastDue ?? []).map((r) => ({ key: `past-${r}`, text: `${r}`, badge: labels.pastDueBadge })),
    ...(live.currentlyDue ?? [])
      .filter((r) => !(live.pastDue ?? []).includes(r))
      .map((r) => ({ key: `due-${r}`, text: r, badge: null })),
    ...(live.errors ?? []).map((e, i) => ({
      key: `err-${i}`,
      text: `${e?.requirement ?? e?.code ?? labels.genericError}${e?.reason ? ` — ${e.reason}` : ""}`,
      badge: labels.errorBadge,
    })),
    ...(live.pendingVerification ?? []).map((r) => ({
      key: `pv-${r}`,
      text: r,
      badge: labels.pendingVerificationBadge,
    })),
  ];

  if (items.length === 0) return null;

  const requirementCount = items.length;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900/30 dark:bg-amber-900/10">
      <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
        {labels.requirementsTitle} ({requirementCount})
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11px] text-amber-800 dark:text-amber-300">
        {items.map((item) => (
          <li key={item.key}>
            {item.text}
            {item.badge && <span className="font-sans"> ({item.badge})</span>}
          </li>
        ))}
      </ul>
      {live.disabledReason && (
        <p className="mt-1 font-mono text-[11px] text-amber-800 dark:text-amber-300">
          disabled_reason: {live.disabledReason}
        </p>
      )}
    </div>
  );
}
