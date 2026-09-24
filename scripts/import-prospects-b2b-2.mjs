/**
 * Import B2B n°2 — Bruxelles (complément), Wallonie et France.
 *
 * Usage :
 *   Dry-run (aucune écriture) :  node scripts/import-prospects-b2b-2.mjs
 *   Écriture réelle :             node scripts/import-prospects-b2b-2.mjs --apply
 *
 * Base ciblée : DATABASE_URL de l'environnement s'il est défini, sinon
 * celui du .env (dev local). Pour la PROD, lancez avec le DATABASE_URL
 * de production, ex. (PowerShell) :
 *   $env:DATABASE_URL="postgresql://..."; node scripts/import-prospects-b2b-2.mjs --apply
 * Le script affiche toujours l'hôte ciblé (masqué) avant d'écrire.
 *
 * Idempotent : relançable sans doublons (clé = email). Les existants
 * voient leurs champs vides complétés (téléphone, site, ville).
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

function maskHost(url) {
  const m = String(url || "").match(/@([^/:?]+)/);
  if (!m) return "(hôte illisible)";
  const host = m[1];
  return host.length > 12 ? `${host.slice(0, 8)}…${host.slice(-6)}` : host;
}

// [société, ville, [emails], téléphone, spécialités, site web, pays]
const ROWS = [
  // ── Bruxelles (complément) ──
  ["MV BEAUTY ART Nail Salon", "Bruxelles", ["info@mvbeautyart.com"], "+32 2 201 52 99", "Onglerie / Nail salon", null, "BE"],
  ["Hoa Nails & Beauty", "Bruxelles", ["hoa.nailsalon@gmail.com"], "+32 483 38 49 70", "Onglerie / Beauté", null, "BE"],
  ["The Nail CLUB", "Saint-Gilles", ["beatricefarkas@hotmail.com"], "+32 475 22 94 51", "Onglerie", null, "BE"],
  ["L'INSTITUT - Centre de beauté Bruxelles", "Ixelles", ["info@linstitut.brussels"], "+32 2 513 41 13", "Institut de beauté", null, "BE"],
  ["Vina Nails and Well-being - Brussel", "Bruxelles", ["vinanails170725@gmail.com"], "+32 471 74 57 32", "Onglerie / Bien-être", null, "BE"],
  ["Efi's Nails", "Bruxelles", ["info@efisnails.be"], "+32 2 449 92 91 / +32 485 53 96 59", "Onglerie, manucure, pédicure", "efisnails.be", "BE"],
  // ── Wallonie ──
  ["Institut Nealys", "Nivelles", ["institut.nealys@gmail.com"], "+32 491 08 86 68", "Institut, esthétique, prothésie ongulaire", "institutnealys.be", "BE"],
  ["CD Ongles", "Nismes", ["cdonglesindigo@gmail.com"], "+32 492 82 10 32", "Onglerie, formations, distribution produits", null, "BE"],
  ["Dream's Beauty", "Eghezée", ["douceur-d-orient@live.be"], "+32 81 51 30 26 / +32 497 63 98 54", "Onglerie, gel, pédicure, esthétique", null, "BE"],
  ["Beauty Bee", "Estaimpuis", ["beautybee7730@gmail.com"], "+32 491 98 96 00", "Onglerie, formations, esthétique", null, "BE"],
  ["CS'thétic", "Leval-Trahegnies", ["cs.thetic@hotmail.com"], "+32 498 75 00 04", "Onglerie, manucure, pédicure, cils", null, "BE"],
  ["Goldenails", "Liège", ["contact@goldenails.be"], "+32 491 49 32 39", "Onglerie / beauté des mains et pieds", "goldenails.be", "BE"],
  ["Sunnails Liège", "Liège", ["sunnails.liege@gmail.com"], "+32 496 36 66 63", "Manucure, nail art, gel, acrylique", "sunnails.org", "BE"],
  ["Bodyline", "Liège", ["info@bodyline-liege.be"], "+32 4 223 57 71", "Institut, manucure, vernis", "bodyline-liege.be", "BE"],
  ["Aujourd'hui et de Mains", "Liège", ["info@aujourdhuietdemains.be"], "+32 496 64 30 31", "Institut esthétique / bien-être", "aujourdhuietdemains.be", "BE"],
  // ── France ──
  ["EMINAILS", "Marseille", ["emi.nail.onglerie@gmail.com"], "06 64 11 85 60 / 09 71 33 38 89", "Prothésie ongulaire, gel, renfort, semi-permanent, extensions, nail art, formation", "eminails.fr", "FR"],
  ["Les Ongles d'Emma", "Marseille", ["contact@lesonglesdemma.fr"], "04 56 60 00 55", "Onglerie / manucure", "lesonglesdemma.fr", "FR"],
  ["Look & Nails Academy", "Marseille", ["lookandnailsformation@gmail.com"], "06 27 52 78 71 / 06 29 51 79 03", "Prothésie ongulaire, formation", "lookandnailsformation.fr", "FR"],
  ["Ongles d'Amour", "Lyon", ["onglesdamour2022@gmail.com"], "09 78 80 29 93", "Onglerie, extensions, nail art", "onglesdamour.fr", "FR"],
  ["Ikinahime", "Lyon 8e", ["ikinahimenailart@gmail.com"], "07 87 15 45 47", "Prothésie ongulaire, nail art", "ikinahime.fr", "FR"],
  ["Dimple S / Dimple Beauté", "Strasbourg", ["contact@dimplebeaute.fr"], "+33 3 69 82 03 84", "Institut / esthétique", "dimple-beaute.com", "FR"],
  ["Sylvia Esthétique", "Strasbourg", ["sylviasemtob@yahoo.fr"], "+33 6 68 43 56 58", "Institut esthétique / beauté", "sylvia-esthetique.fr", "FR"],
  ["Salon Particulier", "Lyon", ["contact@salonparticulier.com"], "+33 4 78 62 99 68", "Institut / beauté", "salonparticulier.com", "FR"],
  ["Onenail", "Strasbourg", ["contact@onenail.fr"], "07 50 91 94 79", "Onglerie / nail salon", "onenail.fr", "FR"],
  ["Ellessé Institut", "Toulouse", ["ellesse.contact@gmail.com"], "06 38 93 66 48", "Gel, semi-permanent, manucure", null, "FR"],
  ["Le Boudoir de l'Esthétique", "Toulouse", ["leboudoirdelesthetique@orange.fr"], "05 34 40 81 21", "Gel, semi-permanent, acrygel, renforcement", "onglerie-toulouse.fr", "FR"],
  ["Onglissima", "Nantes", ["saadetcamille@hotmail.com"], "02 40 89 60 92", "Gel, résine, remplissage, nail art", null, "FR"],
  ["Le Patio Esthétique", "Nantes", ["contact@lepatioesthetique.fr"], "06 87 32 43 48", "Onglerie, manucure", null, "FR"],
  ["Lashes Nails Formation", "Nantes", ["beaute-forever@outlook.fr"], "07 88 86 04 67", "Formation prothésie ongulaire", null, "FR"],
  ["Inaka Formations", "Nantes", ["contact@inaka.fr"], "02 53 55 31 01", "Onglerie, nail art, prothésie ongulaire", null, "FR"],
  ["ELONAILS", "Bailly-Romainvilliers", ["elo.nails@outlook.com"], "07 45 10 26 44", "Onglerie, formations professionnelles", null, "FR"],
  ["Nails Art", "Paris 15e", ["l.yuegege@gmail.com"], "06 58 47 04 13", "Nail art / onglerie", null, "FR"],
  ["Ly Nails", "Paris 12e", ["contact@lynailsparis.fr"], "01 43 14 21 95", "Onglerie, gel, nail art", null, "FR"],
  ["Formanails Paris", "Paris 19e", ["contact@formanails.fr"], "09 66 98 59 08", "Formation prothésiste ongulaire", null, "FR"],
  ["Formation Prothésiste Ongulaire Lyon", "Lyon 3e", ["contact@formation-prothesiste-ongulaire-lyon.fr"], "04 28 31 66 86", "Formation onglerie", null, "FR"],
  ["Ongles d'Amour", "Lyon", ["onglesdamour2022@gmail.com"], "09 78 80 29 93", "Onglerie, extensions, nail art", "onglesdamour.fr", "FR"],
  ["Ikinahime", "Lyon 8e", ["ikinahimenailart@gmail.com"], "07 87 15 45 47", "Prothésie ongulaire, nail art", "ikinahime.fr", "FR"],
  ["Oana Nails", "Nice", ["oananailsnice@gmail.com"], "07 62 73 68 28", "Onglerie haut de gamme, prothésie ongulaire", null, "FR"],
  ["Formanails Nice", "Nice", ["contact@formanails.fr"], "09 66 98 59 08", "Formation prothésiste ongulaire", null, "FR"],
  ["Aesthetic Expert Formations", "Nice", ["contact@aesthetic-expert.fr"], "06 06 80 94 00", "Gel, semi-permanent, formation onglerie", null, "FR"],
  ["École Mademoiselle Vernis", "Nice", ["contact@ecolemademoisellevernis.fr"], null, "Bars à ongles, formation, nail art", null, "FR"],
  ["Une Heure Pour Soi – Cauffry", "Cauffry", ["contact.accessibilite.uhps@galec.fr"], "03 44 73 89 23", "Institut / manucure", null, "FR"],
  ["Salon ESKAY", "Annecy", ["contact@saloneskay.com"], "04 85 46 49 97", "Salon beauté / onglerie", null, "FR"],
  ["Uña Onglerie Nice", "Nice", ["unacotedazur@gmail.com"], "06 31 85 30 87", "Onglerie", null, "FR"],
  ["Fusion", "Le Mans", ["contact@gangfusion.com"], "07 49 84 83 00", "Beauté / onglerie", null, "FR"],
];

const IMPORT_NOTE = "Import manuel B2B n°2 — instituts/ongleries BE + FR";

function normalizeWebsite(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value || value === "—" || value === "-") return null;
  // Nom commercial sans domaine (ex. "CD Ongles") -> pas un site, on ignore.
  if (!/[\w-]+\.[a-z]{2,}(\/|$)/i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

async function main() {
  console.log(`Base ciblée : ${maskHost(process.env.DATABASE_URL)}`);
  console.log(`Mode : ${APPLY ? "ÉCRITURE RÉELLE" : "DRY-RUN (aucune écriture — relancez avec --apply)"}\n`);

  let created = 0;
  let backfilled = 0;
  let skipped = 0;
  const skippedRows = [];

  for (const [company, city, emails, phone, specialty, websiteRaw, country] of ROWS) {
    for (const rawEmail of emails) {
      const email = String(rawEmail).trim().toLowerCase();
      if (!email.includes("@")) {
        skipped += 1;
        skippedRows.push(`${company} <${rawEmail}> (email invalide)`);
        continue;
      }
      const cleanPhone = phone ? String(phone).replace(/\s+/g, " ").trim() : null;
      const website = normalizeWebsite(websiteRaw);
      const notes = [specialty, IMPORT_NOTE].filter(Boolean).join(" — ");

      const existing = await prisma.prospect.findUnique({ where: { email } });
      if (existing) {
        // Backfill doux : ne complète que les champs vides.
        const patch = {};
        if (!existing.company && company) patch.company = company;
        if (!existing.city && city) patch.city = city;
        if (!existing.phone && cleanPhone) patch.phone = cleanPhone;
        if (!existing.website && website) patch.website = website;
        if (!existing.country && country) patch.country = country;
        if (Object.keys(patch).length > 0) {
          if (APPLY) await prisma.prospect.update({ where: { id: existing.id }, data: patch });
          backfilled += 1;
          console.log(` ~ ${company} <${email}> (complété : ${Object.keys(patch).join(", ")})`);
        } else {
          skipped += 1;
          skippedRows.push(`${company} <${email}> (déjà existant)`);
        }
        continue;
      }

      if (APPLY) {
        const prospect = await prisma.prospect.create({
          data: {
            email,
            company,
            city,
            phone: cleanPhone,
            website,
            country: country || "BE",
            source: "autre",
            status: "nouveau",
            statusHistory: [
              { status: "nouveau", changedAt: new Date().toISOString(), byUserId: null, note: IMPORT_NOTE },
            ],
            notes,
          },
        });
        await prisma.prospectActivity.create({
          data: {
            prospectId: prospect.id,
            type: "prospect_created",
            metadata: { source: "autre", import: "b2b-manuel-2" },
            description: IMPORT_NOTE,
          },
        });
        await prisma.prospect.update({
          where: { id: prospect.id },
          data: { lastActivityAt: new Date(), lastEventType: "prospect_created" },
        });
      }
      created += 1;
      console.log(` + ${company} <${email}>`);
    }
  }

  console.log(`\nTerminé : ${created} à créer, ${backfilled} à compléter, ${skipped} ignoré(s).`);
  if (skippedRows.length > 0) {
    console.log("Ignorés :");
    for (const row of skippedRows) console.log(` - ${row}`);
  }
  if (!APPLY) console.log("\nDRY-RUN : rien n'a été écrit. Relancez avec --apply pour appliquer.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
