"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CreditCard,
  ExternalLink,
  Search,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";

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
 */
export function StripeAccountsClient({ initialData }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

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

  function handleViewAccount(row) {
    router.push(`/dashboard/payments?staffId=${encodeURIComponent(row.id)}`);
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
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
        <p className="text-xs text-gray-400">
          {filtered.length} compte{filtered.length > 1 ? "s" : ""}
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label="Comptes Stripe des professionnels">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-gray-100">
              <Th label="Professionnel" />
              <Th label="Compte Stripe" />
              <Th label="Type" />
              <Th label="Paiements" />
              <Th label="Virements" />
              <Th label="Autorisation admin" />
              <th scope="col" className="h-12 px-4 pr-5 text-right align-middle text-sm font-semibold text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
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
                <tr key={row.id} className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
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

                  {/* Charges */}
                  <td className="px-4 py-4 align-middle">
                    <StatusPill enabled={row.stripeChargesEnabled} />
                  </td>

                  {/* Payouts */}
                  <td className="px-4 py-4 align-middle">
                    <StatusPill enabled={row.stripePayoutsEnabled} />
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
                        onClick={() => handleViewAccount(row)}
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
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
