"use client";

import { useEffect, useState } from "react";
import { BarChart3, ExternalLink, CheckCircle2, XCircle, ShieldCheck, MousePointerClick, Users, CalendarClock, Eye } from "lucide-react";
import { fetchJson } from "@/lib/api-client";

const cardClass =
  "rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark";

const GA_ERROR_HELP = {
  GA_ACCESS_DENIED:
    "Accès refusé : ajoute l'e-mail du compte de service dans GA4 (Admin > Gestion des accès à la propriété, rôle Lecteur).",
  GA_AUTH_FAILED: "Authentification Google impossible : vérifie l'e-mail et la clé privée du compte de service.",
  GA_DATA_NOT_CONFIGURED: "Configuration incomplète : il manque l'ID de propriété, l'e-mail ou la clé du compte de service.",
};

function formatDay(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd ?? "")) return yyyymmdd ?? "";
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}`;
}

function StatsSection() {
  const [state, setState] = useState({ loading: true, configured: false, overview: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchJson("/api/marketing/analytics");
        if (!cancelled && json?.success) {
          setState({
            loading: false,
            configured: Boolean(json.data?.configured),
            overview: json.data?.overview ?? null,
            error: json.data?.error ?? null,
          });
        }
      } catch {
        if (!cancelled) setState({ loading: false, configured: true, overview: null, error: "GA_DATA_ERROR" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-gray-500">Chargement des statistiques…</p>
      </div>
    );
  }

  if (!state.configured) {
    return (
      <div className={cardClass}>
        <h2 className="text-base font-bold text-dark dark:text-white">Chiffres en direct — reste une étape</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-gray-600 dark:text-dark-6">
          <li>Crée un compte de service dans Google Cloud et active l&apos;API « Google Analytics Data API ».</li>
          <li>Ajoute son e-mail en Lecteur dans GA4 (Admin &gt; Gestion des accès à la propriété).</li>
          <li>Renseigne <span className="font-mono">GA_PROPERTY_ID</span>, <span className="font-mono">GA_SERVICE_ACCOUNT_EMAIL</span> et <span className="font-mono">GA_SERVICE_ACCOUNT_PRIVATE_KEY</span> dans les variables d&apos;environnement.</li>
        </ol>
        <p className="mt-2 text-sm text-gray-500">
          Envoie-moi l&apos;ID de propriété + le fichier clé JSON et je termine le branchement.
        </p>
      </div>
    );
  }

  if (!state.overview) {
    return (
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-red-600" />
          <h2 className="text-base font-bold text-dark dark:text-white">Statistiques indisponibles</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {GA_ERROR_HELP[state.error] ?? "Lecture des statistiques impossible pour le moment — réessaie plus tard."}
        </p>
      </div>
    );
  }

  const { totals, timeseries, topPages, channels } = state.overview;
  const maxSessions = Math.max(1, ...timeseries.map((d) => d.sessions));

  return (
    <div className="space-y-6">
      {/* Totaux 28 jours */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Users, label: "Utilisateurs (28 j)", value: totals.users },
          { icon: CalendarClock, label: "Sessions (28 j)", value: totals.sessions },
          { icon: Eye, label: "Pages vues (28 j)", value: totals.pageViews },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className={cardClass}>
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-[#2f3a2e] dark:text-white" />
              <h2 className="text-sm font-bold text-dark dark:text-white">{label}</h2>
            </div>
            <p className="mt-2 text-3xl font-bold text-dark dark:text-white">{value.toLocaleString("fr-BE")}</p>
          </div>
        ))}
      </div>

      {/* Courbe sessions */}
      {timeseries.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-base font-bold text-dark dark:text-white">Sessions — 28 derniers jours</h2>
          <div className="mt-3 flex h-32 items-end gap-1">
            {timeseries.map((d) => (
              <div key={d.date} title={`${formatDay(d.date)} : ${d.sessions} session(s)`} className="flex-1">
                <div
                  className="rounded-t bg-[#2f3a2e]"
                  style={{ height: `${Math.max(4, Math.round((d.sessions / maxSessions) * 120))}px` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-gray-500">
            <span>{formatDay(timeseries[0]?.date)}</span>
            <span>{formatDay(timeseries[timeseries.length - 1]?.date)}</span>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Top pages */}
        <div className={cardClass}>
          <h2 className="text-base font-bold text-dark dark:text-white">Pages les plus vues</h2>
          {topPages.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Pas encore de données.</p>
          ) : (
            <ul className="mt-2 divide-y divide-stroke dark:divide-dark-3">
              {topPages.map((p) => (
                <li key={p.path} className="py-2 text-sm">
                  <p className="truncate font-semibold text-dark dark:text-white" title={p.path}>
                    {p.title}
                  </p>
                  <p className="truncate font-mono text-xs text-gray-500">{p.path}</p>
                  <p className="text-xs text-gray-500">
                    {p.views.toLocaleString("fr-BE")} vue(s) · {p.users.toLocaleString("fr-BE")} utilisateur(s)
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Canaux */}
        <div className={cardClass}>
          <h2 className="text-base font-bold text-dark dark:text-white">D&apos;où viennent les visiteurs</h2>
          {channels.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Pas encore de données.</p>
          ) : (
            <ul className="mt-2 divide-y divide-stroke dark:divide-dark-3">
              {channels.map((c) => (
                <li key={c.channel} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-semibold text-dark dark:text-white">{c.channel}</span>
                  <span className="text-xs text-gray-500">
                    {c.sessions.toLocaleString("fr-BE")} session(s)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function TrackingCheck() {
  const [result, setResult] = useState(null);

  function check() {
    const hasGtag = typeof window.gtag === "function";
    const dataLayerSize = Array.isArray(window.dataLayer) ? window.dataLayer.length : 0;
    setResult({ ok: hasGtag && dataLayerSize > 0, hasGtag, dataLayerSize });
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2">
        <MousePointerClick className="h-5 w-5 text-[#2f3a2e] dark:text-white" />
        <h2 className="text-base font-bold text-dark dark:text-white">Tracking de ce navigateur</h2>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Vérifie que ton navigateur charge bien gtag.js (sans bloqueur pub, après avoir cliqué
        « J&apos;accepte » sur le bandeau du site).
      </p>
      <button
        type="button"
        onClick={check}
        className="mt-3 h-10 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white hover:bg-[#3d4d3c]"
      >
        Vérifier le tracking
      </button>
      {result && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium">
          {result.ok ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-emerald-700">
                Tracking actif (dataLayer : {result.dataLayerSize} événement(s)).
              </span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-700">
                {result.hasGtag
                  ? "gtag chargé mais aucun événement — navigue sur le site puis re-teste."
                  : "gtag non détecté — vérifie NEXT_PUBLIC_GA_MEASUREMENT_ID sur Vercel et recharge sans bloqueur."}
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function AnalyticsClient({ data }) {
  const { measurementId, streamId } = data;
  const ready = Boolean(measurementId);

  return (
    <div className="space-y-6">
      {/* Identifiants */}
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[#2f3a2e] dark:text-white" />
          <h2 className="text-base font-bold text-dark dark:text-white">Flux Google Analytics 4</h2>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">ID de mesure</dt>
            <dd className="font-mono font-semibold text-dark dark:text-white">
              {measurementId ?? "non configuré"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">ID du flux</dt>
            <dd className="font-mono font-semibold text-dark dark:text-white">{streamId}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Statut</dt>
            <dd className={`font-semibold ${ready ? "text-emerald-700" : "text-red-700"}`}>
              {ready ? "Configuré" : "À configurer"}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="https://analytics.google.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white hover:bg-[#3d4d3c]"
          >
            Ouvrir Google Analytics <ExternalLink className="h-4 w-4" />
          </a>
          <a
            href="https://analytics.google.com/analytics/web/#/realtime"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-stroke px-4 text-sm font-semibold text-dark dark:border-dark-3 dark:text-white"
          >
            Temps réel <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Chiffres en direct */}
      <StatsSection />

      {/* Événements suivis */}
      <div className={cardClass}>
        <h2 className="text-base font-bold text-dark dark:text-white">Événements envoyés</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-gray-600 dark:text-dark-6">
          <li><span className="font-mono font-semibold text-dark dark:text-white">page_view</span> — automatique à chaque navigation (avec UTM).</li>
          <li><span className="font-mono font-semibold text-dark dark:text-white">campaign_click</span> — clic sur un lien de campagne e-mail.</li>
          <li>Événements libres via <span className="font-mono">lib/analytics.js → trackEvent()</span> (CTA, newsletter, réservation…).</li>
        </ul>
      </div>

      {/* Consentement */}
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#2f3a2e] dark:text-white" />
          <h2 className="text-base font-bold text-dark dark:text-white">Consentement (RGPD)</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Le tracking est refusé par défaut. Il ne s&apos;active que quand le visiteur clique
          « J&apos;accepte » sur le bandeau du site — aucun cookie analytics avant ce clic.
        </p>
      </div>

      <TrackingCheck />
    </div>
  );
}
