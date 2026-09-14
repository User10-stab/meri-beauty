"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";
import { getStripeAccountDetails } from "@/actions/stripe/get-stripe-account-details";
import { getStripeAccountsLiveStatus } from "@/actions/stripe/get-stripe-accounts-live-status";
import { requestCardPayments } from "@/actions/stripe/request-card-payments";
import { StripeAccountDetailsModal } from "@/components/dashboard/payments/StripeAccountDetailsModal";

/**
 * Admin table of staff Stripe Connect accounts.
 *
 * "Voir le compte" navigates to the existing /dashboard/payments page with
 * ?staffId= — the admin then sees and manages that staff member's account
 * through the exact same page and logic the staff member uses. The button is
 * rendered ONLY when the staff member granted access
 * (allowAdminStripeAccess); otherwise "Vous n’avez pas accès" is shown.
 * Revocation is enforced server-side on the payments page and in every
 * Stripe action, so a direct URL cannot bypass it either.
 *
 * The "Compte (live)" and "Carte (live)" columns show the REAL Stripe state
 * loaded AUTOMATICALLY when the page opens (one bulk round trip — Stripe is
 * the source of truth, no DB field): account level (Actif / Limité /
 * Désactivé) and the `card_payments` capability (status, requested,
 * requirements). Cells stay compact — clicking a status pill opens the
 * details popup with requirements and actions. The cached
 * "Paiements"/"Virements" columns keep showing the DB snapshot synced by the
 * `account.updated` / `capability.updated` webhook / refreshStripeStatus().
 * "Activer les paiements par carte" sends the real Stripe capability
 * request; "Configurer le compte Stripe" reuses the existing Express
 * onboarding.
 */

const MODAL_LABELS = {
  accountLabel: "Compte Stripe",
  cardLabel: "Paiements par carte",
  enabled: "Paiements par carte activés",
  pending: "Activation en cours",
  notEnabled: "Paiements par carte non activés",
  actionRequired: "Action requise",
  connectedButCardInactive:
    "Votre compte Stripe est connecté, mais les paiements par carte ne sont pas encore activés.",
  requirementsTitle: "Les paiements par carte nécessitent une action sur le compte Stripe.",
  pastDueBadge: "en retard",
  errorBadge: "à corriger",
  pendingVerificationBadge: "vérification en cours",
  genericError: "erreur",
  refresh: "Actualiser",
  requestActivation: "Activer les paiements par carte",
  configureAccount: "Configurer le compte Stripe",
  noAccessHint: "Accès non autorisé — le professionnel doit finaliser lui-même son onboarding.",
  canReceive: "Le staff peut recevoir des paiements par carte.",
  close: "Fermer",
};

export function StripeAccountsClient({ initialData }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [liveById, setLiveById] = useState({});
  const [errorsById, setErrorsById] = useState({});
  const [loadingAll, setLoadingAll] = useState(true);
  const [globalError, setGlobalError] = useState(null);
  const [modalStaffId, setModalStaffId] = useState(null);
  const [modalBusy, setModalBusy] = useState({ checking: false, requesting: false, configuring: false });
  const [modalNotice, setModalNotice] = useState(null);
  const [modalError, setModalError] = useState(null);
  const fetchedRef = useRef(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialData;
    return initialData.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.stripeAccountId ?? "").toLowerCase().includes(q)
    );
  }, [initialData, search]);

  // ── Automatic live verification on page load (no click needed) ──────
  // One bulk round trip; Stripe calls run in parallel server-side and one
  // failing account never blocks the others.
  const loadAll = useCallback(() => {
    const ids = (initialData ?? []).map((r) => r.id).filter(Boolean);
    if (ids.length === 0) {
      setLoadingAll(false);
      return;
    }
    setLoadingAll(true);
    setGlobalError(null);
    getStripeAccountsLiveStatus(ids)
      .then((result) => {
        if (!result.success) {
          setGlobalError(result.message ?? "Vérification impossible.");
          return;
        }
        const live = {};
        const errs = {};
        for (const r of result.results ?? []) {
          if (r.success) live[r.staffId] = r.data;
          else errs[r.staffId] = r.message ?? "Vérification impossible.";
        }
        setLiveById(live);
        setErrorsById(errs);
      })
      .catch(() => {
        setGlobalError("Erreur de connexion au serveur.");
      })
      .finally(() => {
        setLoadingAll(false);
      });
  }, [initialData]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadAll();
  }, [loadAll]);

  function handleViewAccount(row) {
    router.push(`/dashboard/payments?staffId=${encodeURIComponent(row.id)}`);
  }

  function openDetails(row) {
    setModalNotice(null);
    setModalError(null);
    setModalBusy({ checking: false, requesting: false, configuring: false });
    setModalStaffId(row.id);
  }

  function closeDetails() {
    setModalStaffId(null);
    setModalNotice(null);
    setModalError(null);
  }

  // Single-row refresh (cell "Réessayer" + popup "Actualiser").
  async function refreshOne(staffId) {
    const isModal = staffId === modalStaffId;
    if (isModal) {
      setModalBusy((b) => ({ ...b, checking: true }));
      setModalError(null);
    } else {
      setErrorsById((e) => {
        const next = { ...e };
        delete next[staffId];
        return next;
      });
    }
    try {
      const result = await getStripeAccountDetails(staffId);
      if (!result.success) {
        const message = result.message ?? "Vérification impossible.";
        if (isModal) setModalError(message);
        else setErrorsById((e) => ({ ...e, [staffId]: message }));
        return;
      }
      setLiveById((m) => ({ ...m, [staffId]: result.data }));
    } catch {
      const message = "Erreur de connexion au serveur.";
      if (isModal) setModalError(message);
      else setErrorsById((e) => ({ ...e, [staffId]: message }));
    } finally {
      if (isModal) setModalBusy((b) => ({ ...b, checking: false }));
    }
  }

  async function handleModalRequest() {
    if (!modalStaffId) return;
    setModalBusy((b) => ({ ...b, requesting: true }));
    setModalError(null);
    setModalNotice(null);
    try {
      const result = await requestCardPayments(modalStaffId);
      if (!result.success) {
        setModalError(result.message ?? "Demande impossible.");
        return;
      }
      // Reloaded live data from Stripe AFTER the real capability request —
      // the popup (and the row pill underneath) shows the new status.
      setLiveById((m) => ({ ...m, [modalStaffId]: result.data }));
      setModalNotice(result.message);
    } catch {
      setModalError("Erreur de connexion au serveur.");
    } finally {
      setModalBusy((b) => ({ ...b, requesting: false }));
    }
  }

  async function handleModalConfigure() {
    if (!modalStaffId) return;
    setModalBusy((b) => ({ ...b, configuring: true }));
    setModalError(null);
    try {
      const res = await fetch("/api/stripe/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: modalStaffId }),
      });
      const json = await res.json();
      if (!json.success) {
        setModalError(json.message ?? "Lien de configuration impossible.");
        return;
      }
      window.open(json.data?.url, "_blank");
      // Re-check after the admin returns: the account may still be pending
      // until the professional finishes the Express flow.
    } catch {
      setModalError("Erreur de connexion au serveur.");
    } finally {
      setModalBusy((b) => ({ ...b, configuring: false }));
    }
  }

  const modalRow = modalStaffId
    ? (initialData ?? []).find((r) => r.id === modalStaffId) ?? null
    : null;
  const modalLive = modalStaffId ? (liveById[modalStaffId] ?? null) : null;

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Source-of-truth notice */}
      {/* <div
        role="note"
        className="flex items-start gap-2.5 border-b border-indigo-100 bg-indigo-50/60 px-5 py-3 text-xs text-indigo-800"
      >
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-indigo-500" />
        <p>
          <strong>Stripe est la source de vérité.</strong> Les colonnes « Paiements » /
          « Virements » affichent le cache synchronisé par webhook. Les statuts
          « Compte (live) » et « Carte » sont vérifiés automatiquement au chargement —
          cliquez sur un statut pour voir les détails (requirements, actions).
        </p>
      </div> */}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, e-mail ou compte..."
            aria-label="Rechercher un compte Stripe"
            className="h-9 w-64 rounded-md border border-gray-200 bg-white pl-3 pr-10 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-72"
          />
          <span className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-gray-400">
            <Search size={15} strokeWidth={2.5} />
          </span>
        </div>
        <p className="flex items-center gap-2 text-xs text-gray-400">
          {loadingAll && <Loader2 size={12} className="animate-spin" />}
          {loadingAll
            ? "Vérification des statuts…"
            : `${filtered.length} compte${filtered.length > 1 ? "s" : ""}`}
        </p>
      </div>

      {globalError && (
        <div
          role="alert"
          className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
        >
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <p>
            {globalError}{" "}
            <button
              type="button"
              onClick={loadAll}
              className="font-medium text-indigo-600 hover:underline"
            >
              Réessayer
            </button>
          </p>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label="Comptes Stripe des professionnels">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-gray-100">
              <Th label="Professionnel" />
              <Th label="Compte Stripe" />
              <Th label="Type" />
              {/* <Th label="Paiements" /> */}
              {/* <Th label="Virements" /> */}
              <Th label="Compte (live)" />
              <Th label="Carte" />
              <Th label="Autorisation admin" />
              <th scope="col" className="h-12 px-4 pr-5 text-right align-middle text-sm font-semibold text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
                      <Users size={24} className="text-gray-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-700">
                        {search ? "Aucun résultat trouvé" : "Aucun compte Stripe connecté"}
                      </p>
                      <p className="mt-1 text-sm text-gray-400">
                        {search
                          ? "Essayez un autre terme de recherche."
                          : "Les comptes apparaîtront ici une fois connectés par les professionnels."}
                      </p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <StripeAccountRow
                  key={row.id}
                  row={row}
                  live={liveById[row.id] ?? null}
                  loading={loadingAll && !liveById[row.id] && !errorsById[row.id]}
                  error={errorsById[row.id] ?? null}
                  onOpenDetails={() => openDetails(row)}
                  onRetry={() => refreshOne(row.id)}
                  onViewAccount={() => handleViewAccount(row)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Details popup */}
      {modalRow && (
        <StripeAccountDetailsModal
          open={modalStaffId !== null}
          onClose={closeDetails}
          title={modalRow.fullName}
          subtitle={modalRow.stripeAccountId}
          live={modalLive}
          notice={modalNotice}
          error={modalError ?? (modalLive ? null : errorsById[modalStaffId] ?? null)}
          busy={modalBusy}
          canAct={modalRow.allowAdminStripeAccess}
          labels={MODAL_LABELS}
          requestedAtText={
            modalLive?.cardRequestedAt
              ? `Capability demandée le ${new Date(modalLive.cardRequestedAt * 1000).toLocaleDateString("fr-FR")}.`
              : null
          }
          onRefresh={() => refreshOne(modalStaffId)}
          onRequest={handleModalRequest}
          onConfigure={handleModalConfigure}
        />
      )}
    </div>
  );
}

/**
 * One table row: cached DB pills + compact live status pills.
 * Cells stay clean — the full live detail (requirements, actions) lives in
 * the details popup, opened by clicking a status pill.
 */
function StripeAccountRow({ row, live, loading, error, onOpenDetails, onRetry, onViewAccount }) {
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Professional */}
      <td className="px-4 py-4 pl-5 align-middle">
        <p className="font-medium text-gray-800 leading-tight">{row.fullName}</p>
        <p className="text-xs text-indigo-600">{row.email}</p>
        {row.phone && <p className="text-xs text-gray-400">{row.phone}</p>}
      </td>

      {/* Account id */}
      <td className="px-4 py-4 align-middle">
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-gray-600">
          <CreditCard size={12} className="text-gray-400" />
          {row.stripeAccountId}
        </span>
      </td>

      {/* Type */}
      <td className="px-4 py-4 align-middle text-gray-600">
        {row.stripeAccountType ?? "—"}
      </td>

      {/* Charges (DB cache) */}
{/*       
      <td className="px-4 py-4 align-middle">
        <StatusPill enabled={row.stripeChargesEnabled} />
      </td> */}

      {/* Payouts (DB cache) */}
      {/* <td className="px-4 py-4 align-middle">
        <StatusPill enabled={row.stripePayoutsEnabled} />
      </td> */}

      {/* Live account level (§2: Actif / Limité / Désactivé) */}
      <td className="px-4 py-4 align-middle">
        <AccountLevelCell live={live} loading={loading} error={error} onOpen={onOpenDetails} onRetry={onRetry} />
      </td>

      {/* Live card_payments capability */}
      <td className="px-4 py-4 align-middle">
        <CardStatusCell live={live} loading={loading} error={error} onOpen={onOpenDetails} onRetry={onRetry} />
      </td>

      {/* Admin authorization */}
      <td className="px-4 py-4 align-middle">
        {row.allowAdminStripeAccess ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <ShieldCheck size={12} />
            Autorisé
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
            <ShieldOff size={12} />
            Non autorisé
          </span>
        )}
      </td>

      {/* Actions — button ONLY when access was granted */}
      <td className="px-4 py-4 pr-5 align-middle text-right">
        {row.allowAdminStripeAccess ? (
          <button
            type="button"
            onClick={onViewAccount}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
          >
            <ExternalLink size={13} />
            Voir le compte
          </button>
        ) : (
          <span className="text-xs text-gray-400">Vous n’avez pas accès</span>
        )}
      </td>
    </tr>
  );
}

function CellState({ loading, error, onRetry, children }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
        <Loader2 size={12} className="animate-spin" />
        <span className="sr-only">Vérification…</span>
      </span>
    );
  }
  if (error && !children) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
      >
        <RefreshCw size={11} />
        Réessayer
      </button>
    );
  }
  return children;
}

function AccountLevelCell({ live, loading, error, onOpen, onRetry }) {
  return (
    <CellState loading={loading} error={error} onRetry={onRetry}>
      {live ? (
        <StatusButton onOpen={onOpen} title="Voir les détails du compte">
          {live.accountLevel === "active" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              🟢 {live.accountLabel}
            </span>
          ) : live.accountLevel === "disabled" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              🔴 {live.accountLabel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              🟠 {live.accountLabel}
            </span>
          )}
        </StatusButton>
      ) : (
        <span className="text-xs text-gray-300">—</span>
      )}
    </CellState>
  );
}

function CardStatusCell({ live, loading, error, onOpen, onRetry }) {
  return (
    <CellState loading={loading} error={error} onRetry={onRetry}>
      {live ? (
        <StatusButton onOpen={onOpen} title="Voir les détails des paiements par carte">
          {live.level === "ready" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 size={12} />
              🟢 Paiements par carte activés
            </span>
          ) : live.level === "pending" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              <Clock size={12} />
              🟠 Activation en cours
            </span>
          ) : live.cardPayments === "inactive" ||
            live.cardPayments === "unrequested" ||
            live.cardPayments === "unknown" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              <AlertTriangle size={12} />
              🔴 Paiements par carte non activés
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              <AlertTriangle size={12} />
              🔴 Action requise
            </span>
          )}
        </StatusButton>
      ) : (
        <span className="text-xs text-gray-300">—</span>
      )}
    </CellState>
  );
}

function StatusButton({ onOpen, title, children }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${title} — Voir les détails`}
      className="cursor-pointer rounded-full transition-shadow hover:ring-2 hover:ring-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
    >
      {children}
    </button>
  );
}

function Th({ label }) {
  return (
    <th className="h-12 px-4 text-left align-middle text-sm font-semibold text-gray-500 whitespace-nowrap">
      {label}
    </th>
  );
}

function StatusPill({ enabled }) {
  return enabled ? (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      Activé
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
      Désactivé
    </span>
  );
}
