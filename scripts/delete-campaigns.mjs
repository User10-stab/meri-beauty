/**
 * Purge les campagnes marketing (ex. campagnes de test avant la prod).
 *
 * Usage :
 *   Dry-run (liste sans supprimer) :  node scripts/delete-campaigns.mjs
 *   Tout supprimer :                   node scripts/delete-campaigns.mjs --apply
 *   Garder les SENT (historique) :     node scripts/delete-campaigns.mjs --apply --keep-sent
 *
 * Base ciblée : DATABASE_URL de l'environnement s'il est défini, sinon
 * celui du .env (dev local). Pour la PROD :
 *   $env:DATABASE_URL="postgresql://..."; node scripts/delete-campaigns.mjs --apply
 *
 * Supprime en cascade : destinataires de la file (CampaignRecipient) et
 * clics (CampaignClick). Les ouvertures/activités sont conservées avec
 * campaignId=null (SetNull), les prospects sont intacts. Les fichiers
 * joints locaux (/uploads/campaigns) sont supprimés du disque.
 */
import { readFileSync, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

try {
  const envRaw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of envRaw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
} catch {
  // Pas de .env — on suppose l'environnement déjà configuré.
}

const APPLY = process.argv.includes("--apply");
const KEEP_SENT = process.argv.includes("--keep-sent");
const prisma = new PrismaClient();

function maskHost(url) {
  const m = String(url || "").match(/@([^/:?]+)/);
  if (!m) return "(hôte illisible)";
  const host = m[1];
  return host.length > 12 ? `${host.slice(0, 8)}…${host.slice(-6)}` : host;
}

async function removeAttachmentFile(attachmentUrl) {
  try {
    const url = String(attachmentUrl || "");
    if (!url.startsWith("/uploads/campaigns/")) return false;
    const fileName = path.basename(url.split("?")[0]);
    if (!fileName || fileName.includes("..")) return false;
    const root = path.join(process.cwd(), "public", "uploads", "campaigns");
    const resolved = path.resolve(root, fileName);
    if (path.relative(root, resolved).startsWith("..") || !existsSync(resolved)) return false;
    await unlink(resolved);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`Base ciblée : ${maskHost(process.env.DATABASE_URL)}`);
  console.log(`Mode : ${APPLY ? `ÉCRITURE RÉELLE${KEEP_SENT ? " (SENT conservées)" : ""}` : "DRY-RUN (aucune suppression — relancez avec --apply)"}\n`);

  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      targetSegment: true,
      totalSenders: true,
      sentCount: true,
      openedCount: true,
      clickedCount: true,
      attachmentUrl: true,
      createdAt: true,
    },
  });

  if (campaigns.length === 0) {
    console.log("Aucune campagne en base. Rien à faire.");
    return;
  }

  const targets = KEEP_SENT ? campaigns.filter((c) => c.status !== "SENT") : campaigns;
  console.log(`Campagnes en base : ${campaigns.length} — à supprimer : ${targets.length}\n`);

  let deleted = 0;
  for (const c of targets) {
    const tag = `[${c.status}] "${c.title}" (${c.sentCount || 0}/${c.totalSenders || 0} envoyés, ${c.openedCount || 0} ouv., ${c.clickedCount || 0} clics)`;
    if (!APPLY) {
      console.log(` - ${tag}`);
      continue;
    }
    const fileRemoved = c.attachmentUrl ? await removeAttachmentFile(c.attachmentUrl) : false;
    await prisma.campaign.delete({ where: { id: c.id } });
    deleted += 1;
    console.log(` × ${tag}${fileRemoved ? " + fichier joint supprimé" : ""}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN : rien n'a été supprimé. Relancez avec --apply pour appliquer.");
  } else {
    console.log(`\nTerminé : ${deleted} campagne(s) supprimée(s).`);
    const kept = campaigns.length - targets.length;
    if (kept > 0) console.log(`${kept} campagne(s) SENT conservée(s) (--keep-sent).`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
