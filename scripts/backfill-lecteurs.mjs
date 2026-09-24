/**
 * Rattrapage `lecteur` — promeut les prospects ayant ouvert une campagne
 * AVANT que la promotion auto à l'ouverture n'existe (ou pendant que le
 * serveur tournait avec un client Prisma antérieur à l'enum `lecteur`).
 *
 * Usage :
 *   Dry-run :  node scripts/backfill-lecteurs.mjs
 *   Appliquer : node scripts/backfill-lecteurs.mjs --apply
 *
 * Ne fait que MONTER (nouveau/contacte -> lecteur) via la même règle
 * que le tracking live. Base : DATABASE_URL d'environnement, sinon .env.
 */
import { readFileSync } from "node:fs";
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
const prisma = new PrismaClient();

const RANK = { nouveau: 0, contacte: 1, lecteur: 2, engage: 3, interesse: 4, demo_essai: 5, client: 6, perdu: -1 };

function maskHost(url) {
  const m = String(url || "").match(/@([^/:?]+)/);
  if (!m) return "(hôte illisible)";
  const host = m[1];
  return host.length > 12 ? `${host.slice(0, 8)}…${host.slice(-6)}` : host;
}

async function main() {
  console.log(`Base ciblée : ${maskHost(process.env.DATABASE_URL)}`);
  console.log(`Mode : ${APPLY ? "ÉCRITURE RÉELLE" : "DRY-RUN (relancez avec --apply)"}\n`);

  const openedEmails = await prisma.mailOpening.findMany({
    where: { email: { not: null } },
    select: { email: true },
    distinct: ["email"],
  });

  let promoted = 0;
  let already = 0;
  let noProspect = 0;

  for (const { email } of openedEmails) {
    const normalized = String(email).trim().toLowerCase();
    const prospect = await prisma.prospect.findUnique({ where: { email: normalized } });
    if (!prospect) {
      noProspect += 1;
      console.log(` ? <${normalized}> a ouvert mais n'a pas de fiche prospect`);
      continue;
    }
    const currentRank = RANK[prospect.status] ?? 0;
    if (prospect.status === "lecteur" || currentRank > RANK.lecteur) {
      already += 1;
      continue;
    }
    if (prospect.status === "perdu" || currentRank < RANK.lecteur) {
      if (APPLY) {
        const history = Array.isArray(prospect.statusHistory) ? prospect.statusHistory : [];
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: {
            status: "lecteur",
            statusHistory: [
              ...history,
              { status: "lecteur", changedAt: new Date().toISOString(), byUserId: null, note: "Rattrapage ouvertures passées" },
            ],
            lastActivityAt: new Date(),
            lastEventType: "email_opened",
          },
        });
        await prisma.prospectActivity.create({
          data: {
            prospectId: prospect.id,
            type: "status_changed",
            metadata: { from: prospect.status, to: "lecteur" },
            description: `Statut : ${prospect.status} → lecteur (rattrapage ouvertures passées)`,
          },
        });
      }
      promoted += 1;
      console.log(` + <${normalized}> : ${prospect.status} -> lecteur`);
    }
  }

  console.log(`\nTerminé : ${promoted} à promouvoir, ${already} déjà à jour, ${noProspect} ouverture(s) sans fiche prospect.`);
  if (!APPLY) console.log("DRY-RUN : rien n'a été écrit.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
