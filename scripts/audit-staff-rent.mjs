/**
 *   node scripts/audit-staff-rent.mjs                      # audit (lecture seule)
 *   node scripts/audit-staff-rent.mjs --all                # inclut les contrats terminés
 *   node scripts/audit-staff-rent.mjs --database-url=<url> # choisir la base
 *
 * La base visée est affichée, avec sa provenance, avant toute lecture.
 *
 * READ-ONLY. 17/09/2026.
 *
 * Le loyer d'atelier est facturé à la date anniversaire du contrat
 * (lib/staff-monthly-billing.js) : un contrat démarré le 07/09 est facturé le
 * 07/10, le 07/11, etc. Ce script dit, pour chaque contrat, quelles périodes
 * sont déjà facturées, laquelle est en cours, et lesquelles auraient dû
 * l'être et ne le sont pas — c'est le préalable à toute régularisation.
 *
 * Il ne dit rien du paiement : aujourd'hui l'application n'enregistre aucun
 * encaissement de loyer (pas de Payment, pas de Transaction), donc le loyer
 * n'apparaît ni dans les Opérations, ni dans le livre de recettes, ni dans le
 * livre de caisse. C'est ce que la colonne « Encaissement » rappelle.
 *
 * N'écrit jamais rien. Sortie 0 toujours, sauf erreur de connexion.
 */

// MUST stay above the @prisma/client import — see resolve-database-url.mjs.
import { resolveDatabaseUrl, describeTarget } from "./resolve-database-url.mjs";
import { PrismaClient } from "@prisma/client";

const INCLUDE_TERMINATED = process.argv.includes("--all");
const eur = (n) => `${Number(n).toFixed(2)} €`;
const iso = (d) => d.toISOString().slice(0, 10);

/**
 * The billing engine's own anniversary rule, mirrored (not imported: that
 * module pulls in the app's prisma singleton, its e-mail stack and its PDF
 * renderer — none of which a read-only audit should load).
 *
 * A contract started on the 31st is billed on the last day of a short month,
 * exactly like calculateNextAnniversaryDate does.
 */
function addMonths(startDate, months) {
  const day = startDate.getUTCDate();
  const target = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Every anniversary from the contract's start up to `today` (inclusive). */
function duePeriods(startDate, endDate, today) {
  const periods = [];
  for (let n = 1; n <= 240; n += 1) {
    const dueOn = addMonths(startDate, n);
    if (dueOn > today) break;
    if (endDate && dueOn > endDate) break;
    const coversFrom = addMonths(startDate, n - 1);
    periods.push({ dueOn, coversFrom, coversTo: new Date(dueOn.getTime() - 86400000) });
  }
  return periods;
}

async function main() {
  const { url, from } = resolveDatabaseUrl();
  console.log(`Base : ${describeTarget(url)}  (${from})\n`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const contracts = await prisma.contract.findMany({
      where: {
        type: "FIXED_RENT",
        ...(INCLUDE_TERMINATED ? {} : { status: "ACTIVE" }),
        staff: { isDeleted: false },
      },
      orderBy: [{ startDate: "asc" }],
      select: {
        id: true,
        fixedRent: true,
        startDate: true,
        endDate: true,
        status: true,
        staff: {
          select: {
            id: true,
            isActive: true,
            vatNumber: true,
            user: { select: { fullName: true, email: true } },
            monthlyInvoices: {
              select: {
                billingYear: true,
                billingMonth: true,
                status: true,
                invoice: { select: { number: true, totalInclVat: true, paymentId: true, issuedAt: true } },
              },
            },
          },
        },
      },
    });

    const today = new Date();
    let missingCount = 0;
    let missingTotal = 0;

    for (const contract of contracts) {
      const who = contract.staff.user?.fullName ?? contract.staff.user?.email ?? "—";
      const rent = Number(contract.fixedRent);
      console.log(
        `${who} — ${eur(rent)}/mois, début ${iso(contract.startDate)}` +
          `${contract.endDate ? `, fin ${iso(contract.endDate)}` : ""} — contrat ${contract.status}` +
          `${contract.staff.vatNumber ? `, TVA ${contract.staff.vatNumber}` : ", SANS numéro de TVA"}`
      );

      const periods = duePeriods(contract.startDate, contract.endDate, today);
      if (periods.length === 0) {
        const next = addMonths(contract.startDate, 1);
        console.log(`   aucune échéance passée — première facture le ${iso(next)}\n`);
        continue;
      }

      for (const period of periods) {
        // The billing engine keys a row by the month it BILLS in.
        const row = contract.staff.monthlyInvoices.find(
          (m) => m.billingYear === period.dueOn.getUTCFullYear() && m.billingMonth === period.dueOn.getUTCMonth() + 1
        );
        const label = `${iso(period.coversFrom)} → ${iso(period.coversTo)}`;
        if (row?.invoice) {
          const paid = row.invoice.paymentId ? "encaissée" : "AUCUN ENCAISSEMENT";
          console.log(`   ${label}  facturée le ${iso(period.dueOn)}  ${row.invoice.number}  ${eur(row.invoice.totalInclVat)}  ${paid}`);
        } else if (row) {
          console.log(`   ${label}  échéance ${iso(period.dueOn)}  ligne ${row.status} SANS facture — à régulariser`);
          missingCount += 1;
          missingTotal += rent;
        } else {
          console.log(`   ${label}  échéance ${iso(period.dueOn)}  AUCUNE FACTURE — à régulariser`);
          missingCount += 1;
          missingTotal += rent;
        }
      }
      console.log("");
    }

    const issued = await prisma.invoice.count({ where: { source: "STAFF_CONTRACT" } });
    console.log("─".repeat(72));
    console.log(`Factures de loyer émises à ce jour : ${issued}`);
    console.log(`Périodes échues sans facture : ${missingCount}${missingCount ? ` (${eur(missingTotal)} HTVA de loyer)` : ""}`);
    console.log(
      `Encaissements de loyer enregistrés : aucun — l'application ne sait pas encore encaisser un loyer,\n` +
        `donc ces montants n'apparaissent ni dans les Opérations, ni dans le livre de recettes, ni dans le livre de caisse.`
    );
    if (!INCLUDE_TERMINATED) console.log(`\n(Contrats terminés non listés — relancer avec --all pour les voir.)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
