import { redirect } from "next/navigation";
import { MousePointerClick, Eye, Percent, ListOrdered, Search, FileText } from "lucide-react";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { getGoogleConnectionStatus } from "@/actions/seo/google-connection";
import {
  getSearchConsoleOverview,
  getTopPages,
  getTopQueries,
  listSearchConsoleSites,
} from "@/actions/seo/search-console";
import { resolveDateRange } from "@/lib/seo/search-console";
import { OAUTH_REDIRECT_MESSAGES, SEO_ERROR_CODES } from "@/lib/seo/errors";
import {
  formatCtr,
  formatDateLabel,
  formatInteger,
  formatPagePath,
  formatPosition,
} from "@/lib/seo/format";
import { SeoConnectionBar } from "@/components/dashboard/seo/SeoConnectionBar";
import { SeoDateRangeBar } from "@/components/dashboard/seo/SeoDateRangeBar";

export const metadata = {
  title: "Référencement Google — Dashboard",
  description: "Clics, impressions, CTR et position moyenne du site dans la recherche Google.",
};

export const dynamic = "force-dynamic";

export default async function SeoPage({ searchParams }) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) redirect("/dashboard");

  const params = await searchParams;
  const from = typeof params?.du === "string" ? params.du : undefined;
  const to = typeof params?.au === "string" ? params.au : undefined;
  const oauthError = typeof params?.erreur === "string" ? params.erreur : null;
  const justConnected = params?.connecte === "1";

  const status = await getGoogleConnectionStatus();
  const connection = status.data;

  // La plage est résolue ici, une fois, et passée telle quelle aux trois
  // requêtes : sans cela, trois appels à resolveDateRange de part et
  // d'autre de minuit pourraient porter sur des fenêtres différentes.
  const { startDate, endDate } = resolveDateRange({ from, to });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Référencement Google</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Ce que Google Search Console sait du site : combien de personnes voient les pages du salon dans
          les résultats de recherche, combien cliquent, et sur quels mots.
        </p>
      </div>

      {oauthError && (
        <Alert tone="error">
          {OAUTH_REDIRECT_MESSAGES[oauthError] ?? OAUTH_REDIRECT_MESSAGES.inattendue}
        </Alert>
      )}

      {justConnected && !oauthError && (
        <Alert tone="success">
          Compte Google connecté. Les premières données peuvent mettre quelques minutes à apparaître.
        </Alert>
      )}

      {!status.success ? (
        <Alert tone="error">{status.message}</Alert>
      ) : !connection.configured ? (
        <NotConfiguredCard missingEnv={connection.missingEnv} />
      ) : !connection.connected ? (
        <ConnectCard />
      ) : (
        <ConnectedView connection={connection} startDate={startDate} endDate={endDate} />
      )}
    </div>
  );
}

/**
 * L'écran complet une fois le compte Google connecté.
 *
 * Les quatre requêtes partent en parallèle : elles sont indépendantes, et le
 * cache de lib/seo/cache.js fait que la plupart des rendus n'atteignent
 * même pas le réseau.
 */
async function ConnectedView({ connection, startDate, endDate }) {
  const [overview, queries, pages, sites] = await Promise.all([
    getSearchConsoleOverview({ from: startDate, to: endDate }),
    getTopQueries({ from: startDate, to: endDate }),
    getTopPages({ from: startDate, to: endDate }),
    listSearchConsoleSites(),
  ]);

  const needsReconnect = overview.code === SEO_ERROR_CODES.RECONNEXION_REQUISE;

  return (
    <>
      <SeoConnectionBar
        googleEmail={connection.googleEmail}
        siteUrl={connection.siteUrl}
        sites={sites.success ? sites.data : []}
      />

      <SeoDateRangeBar startDate={startDate} endDate={endDate} />

      {!overview.success ? (
        <div className="space-y-4">
          <Alert tone="error">{overview.message}</Alert>
          {needsReconnect && <ConnectCard label="Reconnecter Google Search Console" />}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-dark-6">
            Période affichée : du {formatDateLabel(overview.data.startDate)} au{" "}
            {formatDateLabel(overview.data.endDate)}. Google consolide ses données avec deux à trois jours
            de retard : les journées les plus récentes n'y figurent pas encore.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<MousePointerClick size={20} />}
              label="Clics"
              value={formatInteger(overview.data.clicks)}
            />
            <StatCard
              icon={<Eye size={20} />}
              label="Impressions"
              value={formatInteger(overview.data.impressions)}
            />
            <StatCard icon={<Percent size={20} />} label="CTR" value={formatCtr(overview.data.ctr)} />
            <StatCard
              icon={<ListOrdered size={20} />}
              label="Position moyenne"
              value={formatPosition(overview.data.position)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DimensionTable
              title="Requêtes les plus performantes"
              subtitle="Ce que les gens tapent dans Google avant d'arriver sur le site."
              icon={<Search size={16} />}
              columnLabel="Requête"
              result={queries}
              emptyLabel="Aucune requête sur cette période."
            />
            <DimensionTable
              title="Pages les plus performantes"
              subtitle="Les pages du site qui apparaissent dans les résultats."
              icon={<FileText size={16} />}
              columnLabel="Page"
              result={pages}
              formatKey={formatPagePath}
              emptyLabel="Aucune page sur cette période."
            />
          </div>
        </>
      )}
    </>
  );
}

/** Tableau d'une dimension (requête ou page). */
function DimensionTable({ title, subtitle, icon, columnLabel, result, formatKey, emptyLabel }) {
  const rows = result.success ? result.data : [];

  return (
    <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[#2f3a2e] dark:text-white">{icon}</span>
        <h2 className="text-lg font-bold text-dark dark:text-white">{title}</h2>
      </div>
      <p className="mb-5 text-xs text-gray-500 dark:text-dark-6">{subtitle}</p>

      {!result.success ? (
        <Alert tone="error">{result.message}</Alert>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-dark-6">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-stroke text-xs uppercase text-gray-500 dark:border-dark-3 dark:text-dark-6">
              <tr>
                <th className="px-2 py-3 font-semibold">{columnLabel}</th>
                <th className="px-2 py-3 text-right font-semibold">Clics</th>
                <th className="px-2 py-3 text-right font-semibold">Impr.</th>
                <th className="px-2 py-3 text-right font-semibold">CTR</th>
                <th className="px-2 py-3 text-right font-semibold">Pos.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke dark:divide-dark-3">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td
                    className="max-w-[240px] truncate px-2 py-3 text-dark dark:text-white"
                    title={row.key}
                  >
                    {formatKey ? formatKey(row.key) : row.key}
                  </td>
                  <td className="px-2 py-3 text-right font-semibold text-dark dark:text-white">
                    {formatInteger(row.clicks)}
                  </td>
                  <td className="px-2 py-3 text-right text-gray-500 dark:text-dark-6">
                    {formatInteger(row.impressions)}
                  </td>
                  <td className="px-2 py-3 text-right text-gray-500 dark:text-dark-6">
                    {formatCtr(row.ctr)}
                  </td>
                  <td className="px-2 py-3 text-right text-gray-500 dark:text-dark-6">
                    {formatPosition(row.position)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** L'appel à l'action de départ, aussi réutilisé pour une reconnexion. */
function ConnectCard({ label = "Connecter Google Search Console" }) {
  return (
    <div className="rounded-[10px] border border-stroke bg-white p-8 text-center shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <h2 className="text-lg font-bold text-dark dark:text-white">
        Aucun compte Google Search Console connecté
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-dark-6">
        Autorisez l'application à lire — et uniquement à lire — les statistiques de recherche du site.
        Aucune modification n'est jamais envoyée à Google.
      </p>
      {/* Un lien, pas un bouton avec du JavaScript : la route répond par une
          redirection vers Google, que le navigateur suit naturellement. */}
      <a
        href="/api/seo/google/connect"
        className="mt-6 inline-flex items-center gap-2 rounded-[7px] bg-[#2f3a2e] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3d4a3b]"
      >
        {label}
      </a>
    </div>
  );
}

/** Ce qu'il manque dans l'environnement, dit explicitement. */
function NotConfiguredCard({ missingEnv }) {
  return (
    <div className="rounded-[10px] border border-stroke bg-white p-8 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <h2 className="text-lg font-bold text-dark dark:text-white">Intégration non configurée</h2>
      <p className="mt-2 text-sm text-gray-500 dark:text-dark-6">
        La connexion à Google Search Console n'est pas encore paramétrée sur ce serveur. Les variables
        d'environnement suivantes doivent être renseignées, puis l'application redémarrée :
      </p>
      <ul className="mt-4 space-y-1.5">
        {missingEnv.map((name) => (
          <li
            key={name}
            className="inline-flex rounded-[7px] bg-gray-100 px-3 py-1.5 font-mono text-xs text-dark dark:bg-dark-3 dark:text-white"
          >
            {name}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-gray-500 dark:text-dark-6">
        Il faut au préalable créer un projet Google Cloud, y activer l'API Search Console et générer un
        identifiant client OAuth — voir la documentation d'installation du projet.
      </p>
    </div>
  );
}

/** Bandeau d'information ou d'erreur, au format des autres écrans. */
function Alert({ tone = "error", children }) {
  const isError = tone === "error";
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-green-200 bg-green-50 text-green-700"
      }`}
    >
      <span className="mt-0.5 flex-shrink-0 text-lg leading-none">{isError ? "⚠" : "✓"}</span>
      {children}
    </div>
  );
}

/** Même carte d'indicateur que l'écran Rapports. */
function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}
