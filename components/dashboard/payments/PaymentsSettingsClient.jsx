"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CircleDot,
  Clock,
  CreditCard,
  ExternalLink,
  Landmark,
  Link2,
  Loader2,
  Shield,
  XCircle,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { createLoginLink } from "@/actions/stripe/create-login-link";

// ─── State Constants ─────────────────────────────────────────────────────────

const STATE = {
  NOT_CONNECTED: "NOT_CONNECTED",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  CONNECTED: "CONNECTED",
};

// Standard accounts have no platform-controlled onboarding (Account Links) nor
// Express login links: the account holder manages everything — setup included —
// in their own Stripe account at dashboard.stripe.com.
const STANDARD_DASHBOARD_URL = "https://dashboard.stripe.com/";

// ─── Reusable UI Primitives ────────────────────────────────────────────────

function SectionCard({ icon: Icon, title, description, children, className = "" }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-50 dark:bg-gray-800">
          <Icon size={14} className="text-gray-500 dark:text-gray-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          {description && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getConnectionState(data) {
  if (!data?.stripeAccountId) return STATE.NOT_CONNECTED;
  
  const chargesEnabled = data.stripeChargesEnabled ?? false;
  const payoutsEnabled = data.stripePayoutsEnabled ?? false;
  
  // If charges or payouts are not enabled, action is required
  if (!chargesEnabled || !payoutsEnabled) {
    return STATE.ACTION_REQUIRED;
  }
  
  // Fully connected
  return STATE.CONNECTED;
}

// ─── Main Export ───────────────────────────────────────────────────────────

export function PaymentsSettingsClient({ initialData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState(initialData);
  const [isConnecting, startConnecting] = useTransition();
  const [isConnectingExisting, startConnectingExisting] = useTransition();
  const [isOnboarding, startOnboarding] = useTransition();
  const [isManagingDashboard, startManagingDashboard] = useTransition();

  const connectionState = getConnectionState(data);
  const isConnected = connectionState === STATE.CONNECTED;

  // ── Connect Stripe ─────────────────────────────────────────────────────
  function handleConnect() {
    startConnecting(async () => {
      try {
        const res = await fetch("/api/stripe/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        const json = await res.json();

        if (!json.success) {
          toast.error(json.message);
          return;
        }

        setData((prev) => ({
          ...prev,
          stripeAccountId: json.data?.stripeAccountId,
        }));

        toast.success("Compte Stripe créé avec succès.");

        // Automatically generate an onboarding link
        handleOnboarding();
      } catch {
        toast.error("Erreur de connexion au serveur.");
      }
    });
  }

  // ── Connect Existing Stripe Account (OAuth) ────────────────────────────
  function handleConnectExisting() {
    startConnectingExisting(async () => {
      try {
        const res = await fetch("/api/stripe/oauth/authorize");

        const json = await res.json();

        if (!json.success) {
          toast.error(json.message);
          return;
        }

        // Navigate to Stripe's OAuth page. After the user authorizes, Stripe
        // redirects back to /api/stripe/oauth/callback, which brings the user
        // back to this page with ?success=true or ?stripeOAuthError=<key>.
        window.location.href = json.data?.url;
      } catch {
        toast.error("Erreur de connexion au serveur.");
      }
    });
  }

  // ── Open Standard Stripe Dashboard ─────────────────────────────────────
  // For Standard accounts there is no Account Link or Express login link to
  // generate — the account holder completes setup and manages their account
  // directly on Stripe's own dashboard.
  function handleStandardDashboard() {
    window.open(STANDARD_DASHBOARD_URL, "_blank");
    toast.success("Dashboard Stripe ouvert dans un nouvel onglet.");
  }

  // ── Generate Onboarding Link ────────────────────────────────────────────
  function handleOnboarding() {
    startOnboarding(async () => {
      try {
        const res = await fetch("/api/stripe/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        const json = await res.json();

        if (!json.success) {
          toast.error(json.message);
          return;
        }

        window.open(json.data?.url, "_blank");
        toast.success("Lien d'onboarding ouvert dans un nouvel onglet.");
      } catch {
        toast.error("Erreur de connexion au serveur.");
      }
    });
  }

  // ── Open Express Dashboard ───────────────────────────────────────────────
  function handleDashboard() {
    startManagingDashboard(async () => {
      try {
        const result = await createLoginLink();

        if (!result.success) {
          toast.error(result.message);
          return;
        }

        window.open(result.data?.url, "_blank");
        toast.success("Dashboard Stripe ouvert dans un nouvel onglet.");
      } catch {
        toast.error("Erreur de connexion au serveur.");
      }
    });
  }

  // ── Auto-refresh on successful onboarding ───────────────────────────────
  useEffect(() => {
    if (searchParams.get("success") === "true") {
      router.refresh();
    }
  }, [searchParams, router]);

  // ── Loading State ───────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
            <CreditCard size={20} className="text-gray-400 dark:text-gray-500" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">
            Informations non disponibles
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Vos paramètres de paiement n'ont pas pu être chargés. Veuillez réessayer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[60vw] space-y-6">
      {/* ── Connection Status ──────────────────────────────────────────── */}
      <SectionCard
        icon={CreditCard}
        title="Connexion Stripe"
        description="Gérez votre compte de paiement en ligne."
      >
        <div className="space-y-5">
          {/* Status Banner */}
          <StatusBanner
            state={connectionState}
            isConnected={isConnected}
          />

          {/* Verification Progress Timeline */}
          {(connectionState !== STATE.NOT_CONNECTED) && (
            <ProgressTimeline
              isConnected={isConnected}
              connectionState={connectionState}
            />
          )}

          {/* Capabilities */}
          <CapabilitiesCard
            chargesEnabled={data.stripeChargesEnabled}
            payoutsEnabled={data.stripePayoutsEnabled}
          />

          {/* Action Buttons */}
          <ActionArea
            state={connectionState}
            accountType={data?.stripeAccountType}
            isConnecting={isConnecting}
            isConnectingExisting={isConnectingExisting}
            isOnboarding={isOnboarding}
            isManagingDashboard={isManagingDashboard}
            onConnect={handleConnect}
            onConnectExisting={handleConnectExisting}
            onOnboarding={handleOnboarding}
            onDashboard={handleDashboard}
            onStandardDashboard={handleStandardDashboard}
          />
        </div>
      </SectionCard>

      {/* ── How It Works ───────────────────────────────────────────────── */}
      <SectionCard
        icon={Shield}
        title="Comment fonctionnent les paiements en ligne"
        description="Trois étapes simples pour commencer à recevoir des paiements."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm dark:bg-gray-800">
              <CreditCard size={18} className="text-gray-600 dark:text-gray-400" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">
              1. Connectez Stripe
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Créez un compte Stripe ou connectez un compte Stripe existant.
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm dark:bg-gray-800">
              <Shield size={18} className="text-gray-600 dark:text-gray-400" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">
              2. Vérification Stripe
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Suivez les étapes pour vérifier votre identité et vos coordonnées bancaires.
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm dark:bg-gray-800">
              <Banknote size={18} className="text-gray-600 dark:text-gray-400" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">
              3. Recevez vos paiements
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Les paiements sont directement versés sur votre compte bancaire.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ─── Status Banner ──────────────────────────────────────────────────────────

function StatusBanner({ state, isConnected }) {
  let config;

  if (state === STATE.NOT_CONNECTED) {
    config = {
      icon: XCircle,
      iconColor: "text-red-500 dark:text-red-400",
      bgColor: "bg-red-50 dark:bg-red-900/10",
      borderColor: "border-red-200 dark:border-red-900/30",
      dot: "🔴",
      title: "Action requise",
      description: "Vous devez connecter votre compte Stripe pour recevoir des paiements en ligne.",
    };
  } else if (state === STATE.ACTION_REQUIRED) {
    config = {
      icon: AlertTriangle,
      iconColor: "text-amber-500 dark:text-amber-400",
      bgColor: "bg-amber-50 dark:bg-amber-900/10",
      borderColor: "border-amber-200 dark:border-amber-900/30",
      dot: "🟡",
      title: "Configuration en cours",
      description: "Finalisez votre configuration Stripe pour activer les paiements en ligne.",
    };
  } else {
    // CONNECTED
    config = {
      icon: CheckCircle2,
      iconColor: "text-green-500 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-900/10",
      borderColor: "border-green-200 dark:border-green-900/30",
      dot: "🟢",
      title: "Connecté",
      description: "Votre compte Stripe est entièrement configuré et vérifié.",
    };
  }

  const Icon = config.icon;

  return (
    <div className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white dark:bg-gray-800">
          <Icon size={18} className={config.iconColor} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">{config.dot}</span>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{config.title}</h3>
          </div>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{config.description}</p>

          {/* Success details */}
          {isConnected && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 size={12} className="text-green-500 dark:text-green-400" />
                <span className="text-green-700 dark:text-green-300">Paiements en ligne activés</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 size={12} className="text-green-500 dark:text-green-400" />
                <span className="text-green-700 dark:text-green-300">Virements bancaires activés</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Progress Timeline ──────────────────────────────────────────────────────

function ProgressTimeline({ isConnected, connectionState }) {
  const steps = [
    {
      label: "Compte Stripe connecté",
      done: true,
      icon: CheckCircle2,
      color: "text-green-500 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-900/20",
    },
    {
      label: "Configuration terminée",
      done: isConnected,
      icon: isConnected ? CheckCircle2 : Clock,
      color: isConnected
        ? "text-green-500 dark:text-green-400"
        : "text-amber-500 dark:text-amber-400",
      bgColor: isConnected
        ? "bg-green-50 dark:bg-green-900/20"
        : "bg-amber-50 dark:bg-amber-900/20",
    },
    {
      label: "Prêt à recevoir des paiements",
      done: isConnected,
      icon: isConnected ? CheckCircle2 : CircleDot,
      color: isConnected
        ? "text-green-500 dark:text-green-400"
        : "text-gray-300 dark:text-gray-600",
      bgColor: isConnected
        ? "bg-green-50 dark:bg-green-900/20"
        : "bg-gray-50 dark:bg-gray-800/50",
    },
  ];

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
      <h3 className="mb-4 text-xs font-semibold text-gray-700 dark:text-gray-300">
        Progression de l'onboarding
      </h3>
      <div className="space-y-0">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isLast = index === steps.length - 1;

          return (
            <div key={index} className="relative flex gap-3 pb-2">
              {/* Connector line */}
              {!isLast && (
                <div className="absolute left-[15px] top-8 h-full w-px bg-gray-200 dark:bg-gray-700" />
              )}

              {/* Icon */}
              <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${step.bgColor}`}>
                <Icon size={14} className={step.color} />
              </div>

              {/* Content */}
              <div className="flex-1 pb-4">
                <p className={`text-xs font-medium ${
                  step.done
                    ? "text-gray-900 dark:text-white"
                    : "text-gray-500 dark:text-gray-400"
                }`}>
                  {step.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Capabilities Card ──────────────────────────────────────────────────────

function CapabilitiesCard({ chargesEnabled, payoutsEnabled }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
      <h3 className="mb-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
        Capacités du compte
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <CapabilityItem
          icon={CreditCard}
          label="Paiements par carte"
          enabled={chargesEnabled}
        />
        <CapabilityItem
          icon={Landmark}
          label="Virements bancaires"
          enabled={payoutsEnabled}
        />
      </div>
    </div>
  );
}

function CapabilityItem({ icon: Icon, label, enabled }) {
  let badge;

  if (enabled) {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
        <CheckCircle2 size={10} />
        Activé
      </span>
    );
  } else {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        <XCircle size={10} />
        Désactivé
      </span>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-900/70">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-gray-400 dark:text-gray-500" />
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
      </div>
      {badge}
    </div>
  );
}

// ─── Action Area ────────────────────────────────────────────────────────────

function ActionArea({ state, accountType, isConnecting, isConnectingExisting, isOnboarding, isManagingDashboard, onConnect, onConnectExisting, onOnboarding, onDashboard, onStandardDashboard }) {
  // Accounts created before the type column existed are Express (the legacy
  // flow only created Express accounts), so a missing type behaves as Express.
  const isStandard = accountType === "standard";

  return (
    <div className="space-y-3">
      {/* Primary Action */}
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          {state === STATE.NOT_CONNECTED && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Créez un nouveau compte Stripe ou connectez un compte Stripe
              existant pour commencer à accepter les paiements en ligne.
            </p>
          )}
          {state === STATE.ACTION_REQUIRED && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Finalisez votre configuration Stripe pour activer les paiements en ligne.
            </p>
          )}
          {state === STATE.CONNECTED && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Tout est configuré. Vous pouvez gérer votre compte depuis le dashboard Stripe.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {state === STATE.NOT_CONNECTED && (
            <>
              <Button onClick={onConnect} disabled={isConnecting}>
                {isConnecting ? (
                  <><Loader2 size={16} className="animate-spin" /> Création…</>
                ) : (
                  <><CreditCard size={16} /> Créer un compte Stripe</>
                )}
              </Button>

              <Button onClick={onConnectExisting} disabled={isConnectingExisting} variant="secondary">
                {isConnectingExisting ? (
                  <><Loader2 size={16} className="animate-spin" /> Redirection…</>
                ) : (
                  <><Link2 size={16} /> Connecter un compte existant</>
                )}
              </Button>
            </>
          )}

          {state === STATE.ACTION_REQUIRED && !isStandard && (
            <>
              <Button onClick={onOnboarding} disabled={isOnboarding} variant="primary">
                {isOnboarding ? (
                  <><Loader2 size={16} className="animate-spin" /> Génération…</>
                ) : (
                  <><ExternalLink size={16} /> Continue Stripe Setup</>
                )}
              </Button>

              <Button onClick={onDashboard} disabled={isManagingDashboard} variant="secondary">
                {isManagingDashboard ? (
                  <><Loader2 size={16} className="animate-spin" /> Ouverture…</>
                ) : (
                  <><ExternalLink size={16} /> Gérer mon compte Stripe</>
                )}
              </Button>
            </>
          )}

          {state === STATE.ACTION_REQUIRED && isStandard && (
            <Button onClick={onStandardDashboard} variant="primary">
              <><ExternalLink size={16} /> Finaliser la configuration sur Stripe</>
            </Button>
          )}

          {state === STATE.CONNECTED && !isStandard && (
            <Button onClick={onDashboard} disabled={isManagingDashboard} variant="secondary">
              {isManagingDashboard ? (
                <><Loader2 size={16} className="animate-spin" /> Ouverture…</>
              ) : (
                <><ExternalLink size={16} /> Gérer mon compte Stripe</>
              )}
            </Button>
          )}

          {state === STATE.CONNECTED && isStandard && (
            <Button onClick={onStandardDashboard} variant="secondary">
              <><ExternalLink size={16} /> Gérer mon compte Stripe</>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}