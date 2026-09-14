"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  Loader2,
  RefreshCw,
  Zap,
} from "lucide-react";
import { getStripeAccountDetails } from "@/actions/stripe/get-stripe-account-details";
import { requestCardPayments } from "@/actions/stripe/request-card-payments";
import { StripeAccountDetailsModal } from "./StripeAccountDetailsModal";

/**
 * Shared "Paiements par carte" live section.
 *
 * Rendered on the staff Payments page (self mode) AND on the admin view-as
 * Payments page (`/dashboard/payments?staffId=…`). The live Stripe read
 * happens AUTOMATICALLY on mount (getStripeAccountDetails →
 * accounts.retrieve + retrieveCapability) — no click needed. Stripe stays
 * the source of truth — nothing here writes the DB except the request
 * action's standard cache resync.
 *
 * The section itself stays compact (account + card pills, "Voir les détails",
 * and the important "Activer" action); the full live detail (raw
 * card_payments, requirements, remaining actions) lives in the details popup.
 *
 * @param {{ staffId: string, isAdmin?: boolean, allowAdminAccess?: boolean,
 *   onLiveChange?: (live: object|null) => void }} props
 */
export function StripeCardStatusSection({
  staffId,
  isAdmin = false,
  allowAdminAccess = true,
  onLiveChange = null,
}) {
  const t = useTranslations("dashboard.payments");
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState({ checking: false, requesting: false, configuring: false });

  const canAct = !isAdmin || allowAdminAccess;

  const labels = useMemo(
    () => ({
      accountLabel: t("cardPayments.accountLabel"),
      cardLabel: t("cardPayments.cardLabel"),
      enabled: t("cardPayments.enabled"),
      pending: t("cardPayments.pending"),
      notEnabled: t("cardPayments.notEnabled"),
      actionRequired: t("cardPayments.actionRequired"),
      connectedButCardInactive: t("cardPayments.connectedButCardInactive"),
      requirementsTitle: t("cardPayments.requirementsTitle"),
      pastDueBadge: t("cardPayments.pastDueBadge"),
      errorBadge: t("cardPayments.errorBadge"),
      pendingVerificationBadge: t("cardPayments.pendingVerificationBadge"),
      genericError: t("cardPayments.genericError"),
      refresh: t("cardPayments.refresh"),
      requestActivation: t("cardPayments.requestActivation"),
      configureAccount: t("cardPayments.configureAccount"),
      noAccessHint: t("cardPayments.noAccessHint"),
      canReceive: t("cardPayments.canReceive"),
      close: t("cardPayments.close"),
    }),
    [t]
  );

  const requestedAtText = live?.cardRequestedAt
    ? t("cardPayments.requestedAt", {
        date: new Date(live.cardRequestedAt * 1000).toLocaleDateString(),
      })
    : null;

  // Latest-callback mirror: the mount effect below must fire only on
  // staffId change, never because a caller passed a new closure identity.
  // Without this, an inline onLiveChange prop would make `load` change on
  // every parent render and re-trigger the Stripe fetch in a render →
  // fetch → setState loop (continuous background Stripe polling).
  const onLiveChangeRef = useRef(onLiveChange);
  useEffect(() => {
    onLiveChangeRef.current = onLiveChange;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getStripeAccountDetails(staffId);
      if (!result.success) {
        // "Not connected" is a normal state, not a failure.
        if (result.connected === false) {
          setLive({ connected: false });
        } else {
          setError(result.message);
          setLive(null);
        }
        return;
      }
      setLive(result.data);
      onLiveChangeRef.current?.(result.data);
    } catch {
      setError(t("cardPayments.loadError"));
      setLive(null);
    } finally {
      setLoading(false);
    }
  }, [staffId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setBusy((b) => ({ ...b, checking: true }));
    setError(null);
    try {
      const result = await getStripeAccountDetails(staffId);
      if (!result.success) {
        if (result.connected === false) setLive({ connected: false });
        else setError(result.message);
        return;
      }
      setLive(result.data);
      onLiveChange?.(result.data);
    } catch {
      setError(t("cardPayments.loadError"));
    } finally {
      setBusy((b) => ({ ...b, checking: false }));
    }
  }

  async function handleRequest() {
    setBusy((b) => ({ ...b, requesting: true }));
    setNotice(null);
    setError(null);
    try {
      const result = await requestCardPayments(isAdmin ? staffId : undefined);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setLive(result.data);
      onLiveChange?.(result.data);
      setNotice(result.message);
    } catch {
      setError(t("cardPayments.loadError"));
    } finally {
      setBusy((b) => ({ ...b, requesting: false }));
    }
  }

  async function handleOnboarding() {
    setBusy((b) => ({ ...b, configuring: true }));
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/stripe/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isAdmin ? { staffId } : {}),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
        return;
      }
      window.open(json.data?.url, "_blank");
    } catch {
      setError(t("cardPayments.loadError"));
    } finally {
      setBusy((b) => ({ ...b, configuring: false }));
    }
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
        <CreditCard size={13} className="text-gray-400" />
        {t("cardPayments.title")}
      </h3>

      {loading && !live ? (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={13} className="animate-spin" />
          {t("cardPayments.checking")}
        </p>
      ) : error && !live ? (
        <div className="space-y-2">
          <p className="text-xs text-red-600">{error}</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
          >
            <RefreshCw size={11} />
            {t("cardPayments.retry")}
          </button>
        </div>
      ) : live && live.connected === false ? (
        <p className="text-xs text-gray-500">
          ⚪ {t("cardPayments.accountNotConnected")}
        </p>
      ) : live ? (
        <div className="space-y-3">
          {/* ── Compact statuses — details live in the popup ──── */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-gray-600 dark:text-gray-400">
              {t("cardPayments.accountLabel")}
            </span>
            <AccountPill level={live.accountLevel} label={live.accountLabel} />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-gray-600 dark:text-gray-400">
              {t("cardPayments.cardLabel")}
            </span>
            <CardPill level={live.level} label={live.label} cardPayments={live.cardPayments} t={t} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setError(null);
                setDetailsOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              <Eye size={13} />
              {t("cardPayments.viewDetails")}
            </button>
            {/* Only show "Activer" when no request exists at Stripe. */}
            {live.actionNeeded && live.canRequest && canAct && (
              <button
                type="button"
                onClick={handleRequest}
                disabled={busy.requesting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy.requesting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Zap size={13} />
                )}
                {t("cardPayments.requestActivation")}
              </button>
            )}
          </div>
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
        </div>
      ) : null}

      <StripeAccountDetailsModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={t("cardPayments.detailsTitle")}
        subtitle={live?.stripeAccountId ?? null}
        live={live && live.connected !== false ? live : null}
        notice={notice}
        error={error}
        requestedAtText={requestedAtText}
        busy={busy}
        canAct={canAct}
        labels={labels}
        onRefresh={handleRefresh}
        onRequest={handleRequest}
        onConfigure={handleOnboarding}
      />
    </div>
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

function CardPill({ level, label, cardPayments, t }) {
  if (level === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
        <CheckCircle2 size={10} />🟢 {t("cardPayments.enabled")}
      </span>
    );
  }
  if (level === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
        <Clock size={10} />🟠 {t("cardPayments.pending")}
      </span>
    );
  }
  const notEnabled =
    cardPayments === "inactive" ||
    cardPayments === "unrequested" ||
    cardPayments === "unknown";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
      <AlertTriangle size={10} />🔴 {notEnabled ? t("cardPayments.notEnabled") : label}
    </span>
  );
}
