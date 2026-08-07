"use client";

import { AlertCircle, LogIn } from "lucide-react";

/**
 * Nudges a guest whose typed email already matches a verified account
 * toward logging in instead of silently creating a duplicate/guest
 * booking under the same address. `callbackUrl` should point back at the
 * exact page (with query params) the person was on, so /login can return
 * them to where they left off.
 */
export function ExistingAccountBanner({ email, callbackUrl, onDismiss }) {
  const loginHref = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}&email=${encodeURIComponent(email)}`;

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-amber-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Un compte existe déjà pour cette adresse email.
          </p>
          <p className="mt-1 text-sm text-amber-700">
            Connectez-vous pour associer cette réservation à votre compte
            existant, ou continuez en tant qu'invité si vous souhaitez créer un
            nouveau compte.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={loginHref}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d4e3b]"
            >
              <LogIn size={15} />
              Se connecter
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
