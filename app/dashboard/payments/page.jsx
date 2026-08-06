import { Suspense } from "react";
import { getStripeStatus } from "@/actions/stripe/get-stripe-status";
import { PaymentsSettingsClient } from "@/components/dashboard/payments/PaymentsSettingsClient";

export const metadata = {
  title: "Paiements — Dashboard",
  description: "Gérez votre connexion Stripe et vos paramètres de paiement.",
};

export const dynamic = "force-dynamic";

/**
 * Maps the OAuth callback error keys (see /api/stripe/oauth/callback) to
 * user-facing French messages.
 */
const OAUTH_ERROR_MESSAGES = {
  declined:
    "Vous avez annulé la connexion de votre compte Stripe existant.",
  invalid_state:
    "La demande de connexion est invalide ou a expiré. Veuillez réessayer.",
  no_code:
    "Stripe n'a pas renvoyé de code d'autorisation. Veuillez réessayer.",
  staff_not_found:
    "Votre profil staff est introuvable. Veuillez contacter le support.",
  staff_inactive:
    "Votre compte n'est pas actif. Veuillez contacter le support.",
  already_connected:
    "Vous disposez déjà d'un compte Stripe connecté. Pour en connecter un autre, déconnectez d'abord le compte actuel.",
  duplicate_account:
    "Ce compte Stripe est déjà associé à un autre membre du staff et ne peut pas être connecté.",
  foreign_express:
    "Ce compte Stripe Express a été créé par une autre plateforme et ne peut pas être connecté à Meri Beauty. Créez un nouveau compte Stripe ou connectez un compte Standard.",
  unsupported_type:
    "Ce type de compte Stripe n'est pas pris en charge par la plateforme.",
  exchange_failed:
    "Impossible de confirmer l'autorisation Stripe. Veuillez réessayer.",
  unexpected:
    "Une erreur inattendue s'est produite lors de la connexion Stripe. Veuillez réessayer.",
};

export default async function PaymentsPage({ searchParams }) {
  const params = await searchParams;
  const oauthError = params?.stripeOAuthError;
  const oauthSuccess = params?.success === "true";

  const result = await getStripeStatus();

  const settings = result.success ? result.data : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">
          Paiements
        </h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          Gérez votre connexion Stripe pour recevoir des paiements en ligne.
        </p>
      </div>

      {result.message && !result.success && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {result.message}
        </div>
      )}

      {oauthError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {OAUTH_ERROR_MESSAGES[oauthError] ?? OAUTH_ERROR_MESSAGES.unexpected}
        </div>
      )}

      {oauthSuccess && !oauthError && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">✓</span>
          Votre compte Stripe a été connecté avec succès.
        </div>
      )}

      <Suspense fallback={<SettingsSkeleton />}>
        <PaymentsSettingsClient initialData={settings} />
      </Suspense>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
          <div className="h-5 w-48 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
        </div>
        <div className="space-y-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="h-24 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
            <div className="h-24 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
          </div>
          <div className="h-10 w-40 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
        </div>
      </div>
      <div className="rounded-xl border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
          <div className="h-5 w-48 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
        </div>
        <div className="space-y-4 p-6">
          <div className="h-10 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-dark-2" />
        </div>
      </div>
    </div>
  );
}