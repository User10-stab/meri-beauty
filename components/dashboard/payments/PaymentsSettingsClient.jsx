"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Shield,
  Banknote,
  Clock,
  ArrowRight,
  CircleDot,
  HelpCircle,
  FileText,
  UserCheck,
  Building2,
  Globe,
  Landmark,
  ChevronRight,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { refreshStripeStatus } from "@/actions/stripe/refresh-stripe-status";

// ─── State Constants ─────────────────────────────────────────────────────────

const STATE = {
  NOT_CONNECTED: "NOT_CONNECTED",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  VERIFICATION_IN_PROGRESS: "VERIFICATION_IN_PROGRESS",
  CONNECTED: "CONNECTED",
};

// ─── Requirement Translation Map ────────────────────────────────────────────

const REQUIREMENT_LABELS = {
  "individual.first_name": "Prénom",
  "individual.last_name": "Nom",
  "individual.dob.day": "Date de naissance (jour)",
  "individual.dob.month": "Date de naissance (mois)",
  "individual.dob.year": "Date de naissance (année)",
  "individual.address.city": "Adresse (ville)",
  "individual.address.line1": "Adresse (rue)",
  "individual.address.postal_code": "Adresse (code postal)",
  "individual.address.state": "Adresse (région)",
  "individual.phone": "Numéro de téléphone",
  "individual.email": "Adresse e-mail",
  "individual.id_number": "Pièce d'identité",
  "individual.ssn_last_4": "Numéro de sécurité sociale",
  "business_profile.url": "Site web professionnel",
  "business_profile.mcc": "Catégorie d'activité",
  "business_profile.name": "Nom de l'entreprise",
  "business_profile.product_description": "Description des services",
  "external_account": "Compte bancaire",
  "tos_acceptance.ip": "Acceptation des conditions générales",
  "tos_acceptance.date": "Acceptation des conditions générales",
  "company.name": "Nom de l'entreprise",
  "company.phone": "Téléphone de l'entreprise",
  "company.tax_id": "Numéro de TVA / SIRET",
  "company.address.city": "Adresse de l'entreprise (ville)",
  "company.address.line1": "Adresse de l'entreprise (rue)",
  "company.address.postal_code": "Adresse de l'entreprise (code postal)",
  "individual.verification.document": "Document d'identité",
  "individual.verification.additional_document": "Document justificatif supplémentaire",
};

function translateRequirement(key) {
  return REQUIREMENT_LABELS[key] || key;
}

function groupRequirements(requirements) {
  const groups = {
    identity: [],
    business: [],
    bank: [],
    other: [],
  };

  requirements.forEach((req) => {
    if (req.includes("individual.") || req.includes("tos_acceptance")) {
      groups.identity.push(req);
    } else if (req.includes("company.") || req.includes("business_profile.")) {
      groups.business.push(req);
    } else if (req.includes("external_account")) {
      groups.bank.push(req);
    } else {
      groups.other.push(req);
    }
  });

  return groups;
}

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
  
  const detailsSubmitted = data.detailsSubmitted ?? false;
  const currentlyDue = data.currentlyDue ?? [];
  const chargesEnabled = data.stripeChargesEnabled ?? false;
  const payoutsEnabled = data.stripePayoutsEnabled ?? false;
  
  // Onboarding is complete when details are submitted and no requirements are due
  const onboardingComplete = detailsSubmitted && currentlyDue.length === 0;
  
  // If onboarding is not complete, show action required
  if (!onboardingComplete) {
    return STATE.ACTION_REQUIRED;
  }
  
  // If onboarding is complete but charges/payouts not enabled, it's verification in progress
  if (!chargesEnabled || !payoutsEnabled) {
    return STATE.VERIFICATION_IN_PROGRESS;
  }
  
  // Fully connected
  return STATE.CONNECTED;
}

// ─── Main Export ───────────────────────────────────────────────────────────

export function PaymentsSettingsClient({ initialData }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [stripeData, setStripeData] = useState(null);
  const [isConnecting, startConnecting] = useTransition();
  const [isOnboarding, startOnboarding] = useTransition();
  const [isRefreshing, startRefreshing] = useTransition();

  // Merge DB data with Stripe API data (from refresh)
  const mergedData = {
    ...data,
    ...(stripeData || {}),
  };

  const connectionState = getConnectionState(mergedData);
  const isConnected = connectionState === STATE.CONNECTED;
  const hasDetails = stripeData?.detailsSubmitted ?? false;
  const currentlyDue = stripeData?.currentlyDue ?? [];
  const hasRequirements = currentlyDue.length > 0;

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

  // ── Refresh Status from Stripe ──────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    startRefreshing(async () => {
      try {
        const result = await refreshStripeStatus();

        if (!result.success) {
          toast.error(result.message);
          return;
        }

        setStripeData({
          chargesEnabled: result.data.chargesEnabled,
          payoutsEnabled: result.data.payoutsEnabled,
          detailsSubmitted: result.data.detailsSubmitted,
          currentlyDue: result.data.currentlyDue,
        });

        // Also sync the DB-backed fields
        setData((prev) => ({
          ...prev,
          stripeChargesEnabled: result.data.chargesEnabled,
          stripePayoutsEnabled: result.data.payoutsEnabled,
        }));

        toast.success("Statut Stripe mis à jour.");
      } catch {
        toast.error("Erreur lors de la mise à jour du statut.");
      }
    });
  }, []);

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
            hasDetails={hasDetails}
            hasRequirements={hasRequirements}
          />

          {/* Verification Progress Timeline */}
          {(connectionState !== STATE.NOT_CONNECTED) && (
            <ProgressTimeline
              isConnected={isConnected}
              hasDetails={hasDetails}
              hasRequirements={hasRequirements}
              connectionState={connectionState}
            />
          )}

          {/* Missing Requirements */}
          {hasRequirements && (
            <RequirementsCard requirements={currentlyDue} />
          )}

          {/* Capabilities */}
          <CapabilitiesCard
            chargesEnabled={mergedData.stripeChargesEnabled}
            payoutsEnabled={mergedData.stripePayoutsEnabled}
            hasDetails={hasDetails}
          />

          {/* Action Buttons */}
          <ActionArea
            state={connectionState}
            isConnecting={isConnecting}
            isOnboarding={isOnboarding}
            isRefreshing={isRefreshing}
            onConnect={handleConnect}
            onOnboarding={handleOnboarding}
            onRefresh={handleRefresh}
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
              Créez votre compte Stripe Connect Express en un clic.
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/30">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm dark:bg-gray-800">
              <UserCheck size={18} className="text-gray-600 dark:text-gray-400" />
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

function StatusBanner({ state, isConnected, hasDetails, hasRequirements }) {
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
      iconColor: "text-red-500 dark:text-red-400",
      bgColor: "bg-red-50 dark:bg-red-900/10",
      borderColor: "border-red-200 dark:border-red-900/30",
      dot: "🔴",
      title: "Action requise",
      description: "Des informations sont nécessaires pour finaliser votre compte Stripe.",
    };
  } else if (state === STATE.VERIFICATION_IN_PROGRESS) {
    config = {
      icon: Clock,
      iconColor: "text-amber-500 dark:text-amber-400",
      bgColor: "bg-amber-50 dark:bg-amber-900/10",
      borderColor: "border-amber-200 dark:border-amber-900/30",
      dot: "🟡",
      title: "Configuration Stripe terminée",
      description: "Votre compte Stripe est configuré. Stripe vérifie actuellement vos informations.",
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

function ProgressTimeline({ isConnected, hasDetails, hasRequirements, connectionState }) {
  const steps = [
    {
      label: "Compte Stripe connecté",
      done: true,
      icon: CheckCircle2,
      color: "text-green-500 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-900/20",
    },
    {
      label: "Informations d'identité soumises",
      done: hasDetails,
      icon: hasDetails ? CheckCircle2 : Clock,
      color: hasDetails
        ? "text-green-500 dark:text-green-400"
        : "text-amber-500 dark:text-amber-400",
      bgColor: hasDetails
        ? "bg-green-50 dark:bg-green-900/20"
        : "bg-amber-50 dark:bg-amber-900/20",
    },
    {
      label: hasRequirements
        ? "Informations supplémentaires requises"
        : "Vérification Stripe en cours",
      done: false,
      icon: hasRequirements ? AlertTriangle : Clock,
      color: hasRequirements
        ? "text-red-500 dark:text-red-400"
        : "text-amber-500 dark:text-amber-400",
      bgColor: hasRequirements
        ? "bg-red-50 dark:bg-red-900/20"
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

// ─── Requirements Card ──────────────────────────────────────────────────────

function RequirementsCard({ requirements }) {
  const groups = groupRequirements(requirements);
  const hasAny = Object.values(groups).some((g) => g.length > 0);

  if (!hasAny) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900/30 dark:bg-red-900/10">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-red-800 dark:text-red-300">
            Informations requises
          </h3>
          <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">
            Complétez les informations suivantes pour finaliser votre compte Stripe :
          </p>
          <div className="mt-3 space-y-3">
            {groups.identity.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300">Identité</h4>
                <ul className="space-y-1">
                  {groups.identity.map((req) => (
                    <li key={req} className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                      <span className="h-1 w-1 rounded-full bg-red-400 dark:bg-red-500" />
                      {translateRequirement(req)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {groups.business.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300">Entreprise</h4>
                <ul className="space-y-1">
                  {groups.business.map((req) => (
                    <li key={req} className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                      <span className="h-1 w-1 rounded-full bg-red-400 dark:bg-red-500" />
                      {translateRequirement(req)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {groups.bank.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300">Compte bancaire</h4>
                <ul className="space-y-1">
                  {groups.bank.map((req) => (
                    <li key={req} className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                      <span className="h-1 w-1 rounded-full bg-red-400 dark:bg-red-500" />
                      {translateRequirement(req)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {groups.other.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300">Autres</h4>
                <ul className="space-y-1">
                  {groups.other.map((req) => (
                    <li key={req} className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                      <span className="h-1 w-1 rounded-full bg-red-400 dark:bg-red-500" />
                      {translateRequirement(req)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Capabilities Card ──────────────────────────────────────────────────────

function CapabilitiesCard({ chargesEnabled, payoutsEnabled, hasDetails }) {
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
          hasDetails={hasDetails}
        />
        <CapabilityItem
          icon={Landmark}
          label="Virements bancaires"
          enabled={payoutsEnabled}
          hasDetails={hasDetails}
        />
      </div>
    </div>
  );
}

function CapabilityItem({ icon: Icon, label, enabled, hasDetails }) {
  let badge;

  if (enabled) {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
        <CheckCircle2 size={10} />
        Activé
      </span>
    );
  } else if (hasDetails) {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        <Clock size={10} />
        En attente
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

function ActionArea({ state, isConnecting, isOnboarding, isRefreshing, onConnect, onOnboarding, onRefresh }) {
  return (
    <div className="space-y-3">
      {/* Primary Action */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          {state === STATE.NOT_CONNECTED && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Créez un compte Stripe pour commencer à accepter les paiements en ligne.
            </p>
          )}
          {state === STATE.ACTION_REQUIRED && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Ouvrez le dashboard Stripe pour compléter les informations manquantes.
            </p>
          )}
          {state === STATE.VERIFICATION_IN_PROGRESS && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Votre compte Stripe est configuré. Stripe vérifie actuellement vos informations. Utilisez le bouton de synchronisation pour mettre à jour le statut.
            </p>
          )}
          {state === STATE.CONNECTED && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Tout est configuré. Vous pouvez gérer votre compte depuis le dashboard Stripe.
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {state === STATE.NOT_CONNECTED && (
            <Button onClick={onConnect} disabled={isConnecting}>
              {isConnecting ? (
                <><Loader2 size={16} className="animate-spin" /> Connexion…</>
              ) : (
                <><CreditCard size={16} /> Connecter Stripe</>
              )}
            </Button>
          )}

          {state === STATE.ACTION_REQUIRED && (
            <>
              <Button onClick={onOnboarding} disabled={isOnboarding} variant="primary">
                {isOnboarding ? (
                  <><Loader2 size={16} className="animate-spin" /> Génération…</>
                ) : (
                  <><ExternalLink size={16} /> Continue Stripe Setup</>
                )}
              </Button>
              <Button onClick={onOnboarding} disabled={isOnboarding} variant="secondary">
                {isOnboarding ? (
                  <><Loader2 size={16} className="animate-spin" /> Génération…</>
                ) : (
                  <><ExternalLink size={16} /> Dashboard Stripe</>
                )}
              </Button>
            </>
          )}

          {state === STATE.VERIFICATION_IN_PROGRESS && (
            <Button onClick={onOnboarding} disabled={isOnboarding} variant="secondary">
              {isOnboarding ? (
                <><Loader2 size={16} className="animate-spin" /> Génération…</>
              ) : (
                <><ExternalLink size={16} /> Dashboard Stripe</>
              )}
            </Button>
          )}

          {state === STATE.CONNECTED && (
            <Button onClick={onOnboarding} disabled={isOnboarding}>
              {isOnboarding ? (
                <><Loader2 size={16} className="animate-spin" /> Génération…</>
              ) : (
                <><ExternalLink size={16} /> Dashboard Stripe</>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Refresh Button */}
      {state !== STATE.NOT_CONNECTED && (
        <div className="flex justify-end border-t border-gray-100 pt-3 dark:border-gray-800">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            {isRefreshing ? (
              <><Loader2 size={12} className="animate-spin" /> Synchronisation…</>
            ) : (
              <><RefreshCw size={12} /> Synchroniser avec Stripe</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}