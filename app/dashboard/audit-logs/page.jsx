import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { listAuditLogs } from "@/actions/dashboard/audit-logs";

export const metadata = { title: "Journal d'audit — Meri Beauty" };
export const dynamic = "force-dynamic";

function formatSnapshot(snapshot) {
  return snapshot ? JSON.stringify(snapshot) : "—";
}

export default async function AuditLogsPage() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) redirect("/dashboard");
  const result = await listAuditLogs();
  const logs = result.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Journal d&apos;audit</h1>
        <p className="mt-1 text-sm text-gray-500">Les 100 dernières actions sensibles réalisées par l&apos;équipe.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-dark-3 dark:bg-gray-dark">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stroke text-xs uppercase text-gray-500 dark:border-dark-3">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Acteur</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Cible</th><th className="px-4 py-3">Avant → après</th></tr>
          </thead>
          <tbody className="divide-y divide-stroke dark:divide-dark-3">
            {logs.map((log) => (
              <tr key={log.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 text-gray-500">{new Date(log.createdAt).toLocaleString("fr-BE")}</td>
                <td className="px-4 py-3">{log.actor?.fullName ?? "Système"}<br /><span className="text-xs text-gray-400">{log.actorRole ?? "—"}</span></td>
                <td className="px-4 py-3 font-medium">{log.action}</td>
                <td className="px-4 py-3 font-mono text-xs">{log.entityType} / {log.entityId}</td>
                <td className="max-w-md px-4 py-3 text-xs text-gray-500"><div className="break-all">{formatSnapshot(log.before)} → {formatSnapshot(log.after)}</div></td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td className="px-4 py-10 text-center text-gray-500" colSpan={5}>Aucune action enregistrée.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
