"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link2Off, Globe, Check } from "lucide-react";
import {
  disconnectGoogleSearchConsole,
  setSearchConsoleSite,
} from "@/actions/seo/google-connection";

/**
 * Bandeau du compte Google connecté : quel compte, quelle propriété, et de
 * quoi se déconnecter.
 *
 * Le sélecteur de propriété n'apparaît que si Google a renvoyé plusieurs
 * propriétés. Avec une seule, un menu déroulant à un choix n'apprendrait
 * rien — le nom de la propriété est déjà affiché à côté du compte.
 */
export function SeoConnectionBar({ googleEmail, siteUrl, sites }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(null);
  const availableSites = Array.isArray(sites) ? sites : [];

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectGoogleSearchConsole();
      setMessage(result.message);
      router.refresh();
    });
  }

  function handleSiteChange(nextSiteUrl) {
    if (!nextSiteUrl || nextSiteUrl === siteUrl) return;
    startTransition(async () => {
      const result = await setSearchConsoleSite(nextSiteUrl);
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
          <Check className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-dark dark:text-white">
            Connecté · {googleEmail}
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-gray-500 dark:text-dark-6">
            <Globe className="h-3 w-3 shrink-0" strokeWidth={2} />
            {siteUrl ?? "Aucune propriété sélectionnée"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {availableSites.length > 1 && (
          <select
            aria-label="Propriété Search Console"
            value={siteUrl ?? ""}
            onChange={(event) => handleSiteChange(event.target.value)}
            disabled={pending}
            className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="" disabled>
              Choisir une propriété
            </option>
            {availableSites.map((site) => (
              <option key={site.siteUrl} value={site.siteUrl}>
                {site.siteUrl}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={handleDisconnect}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-stroke px-3 py-2 text-sm font-semibold text-gray-500 transition-colors hover:border-red-400 hover:text-red-500 disabled:cursor-not-allowed dark:border-dark-3 dark:text-dark-6"
        >
          <Link2Off className="h-3.5 w-3.5" strokeWidth={2} />
          Déconnecter
        </button>
      </div>

      {message && (
        <p role="status" className="w-full text-xs text-gray-500 dark:text-dark-6">
          {message}
        </p>
      )}
    </div>
  );
}
