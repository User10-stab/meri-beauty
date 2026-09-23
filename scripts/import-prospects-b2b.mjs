/**
 * Import manuel B2B — instituts & ongleries de Bruxelles (prospects formations/partenariats).
 *
 * Usage : node scripts/import-prospects-b2b.mjs
 *
 * Idempotent : relançable sans créer de doublons (clé = email lowercase).
 * Les lignes sans email valide sont ignorées (listées dans le rapport).
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Mini chargeur .env (aucune dépendance) — prisma CLI le fait pour `seed`,
// mais pas `node` direct.
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

const prisma = new PrismaClient();

// [société, ville, [emails], téléphone, spécialités, site web]
const ROWS = [
  ["Amira Zen VIP", "Laeken", ["info@amirazen.be"], "+32 2 705 87 85", "Esthétique, semi-permanent", "https://www.amirazenvip.be/"],
  ["Art and Look", "Bruxelles", ["fmsafieddine@gmail.com"], null, "Beauté des mains/pieds", null],
  ["bb beauty bar", "Ixelles", ["bbtassart@gmail.com", "bbbeautybar1000@gmail.com"], null, "Onglerie, BIAB, beauté", null],
  ["Beauté Radiance", "Evere", ["info@beauteradiance.be"], "+32 478 04 09 01", "Beauté des ongles, manucure/pédicure", "https://beauteradiance.be/"],
  ["Beauty by Kroonen", "Bruxelles centre", ["info@beautybykroonen.be"], "+32 2 512 40 05", "Manucure, pédicure, semi-permanent", "https://shops.joyn.eu/fr/shops/747032967/beauty-by-kroonen"],
  ["Beauty Profile", "Etterbeek", ["info@beautyprofile.be"], "+32 2 733 02 77", "Stylisme d'ongles, gel, French, nail art (2e adresse : Berchem-Sainte-Agathe)", "https://beautyprofile.be/"],
  ["Cindy Beauty", "Berchem-Sainte-Agathe", ["cindy.peremans@gmail.com"], null, "Gel, faux ongles, semi-permanent", null],
  ["Cliona Beauty", "Saint-Gilles", ["info@cliona-beauty.com"], "+32 2 538 32 57", "Manucure, pédicure, esthétique", "https://unionafricaine.be/cliona/"],
  ["Didier & Rosalinde", "Ixelles", ["info@didieretrosalinde.be"], "+32 2 647 93 00", "Manucure, pédicure, gel, BIAB, semi-permanent", "https://didieretrosalinde.be/"],
  ["Efi's Nails", "Etterbeek", ["info@efisnails.be"], "+32 2 449 92 91", "Onglerie, manucure, pédicure, épilation", "https://www.efisnails.be/"],
  ["Elise Ferrand", "Bruxelles centre", ["info@eliseferrand.be"], "+32 2 307 02 19", "Ongles gel, acrylique, manucure, semi-permanent", "https://eliseferrand.be/5445-2/"],
  ["Emmanails Pro", "Woluwe-Saint-Lambert", ["info@emmanailspro.be"], "+32 484 62 07 82", "Manucure, pédicure, nail art", "https://emmanailspro.be/"],
  ["Esteclinique", "Bruxelles centre", ["info@esteclinique.be"], "+32 2 513 09 26", "Manucure, semi-permanent, pédicure", "https://www.esteclinique.be/"],
  ["Eyelight", "Ixelles", ["info@eyelight.be"], null, "Beauté + soins des ongles", null],
  ["Isa Make-Up", "Uccle", ["info@isamakeup.eu"], "+32 494 99 96 66", "Centre esthétique ; formations onglerie", "https://www.isamakeup.eu/"],
  ["KL Beauty", "Sablon", ["info@kl-beauty.be", "reservations@kl-beauty.be"], "+32 2 327 02 92", "Onglerie, gel, chablon, semi-permanent", "https://kl-beauty.be/"],
  ["LA SALOON", "Saint-Gilles", ["info@lasaloon.be"], "+32 483 60 83 11", "Manucure, pédicure, ongles en gel", "https://www.lasalonesthetique.com/"],
  ["Les Mains de Gin", "Uccle", ["gin@lesmainsdegin.com"], "+32 484 07 50 60", "Institut de beauté ; soins des mains", "https://lesmainsdegin.com/contact/"],
  ["Leyna Beauty", "Bruxelles centre", ["contact@leynabeauty.be"], "+32 470 03 11 73", "Manucure, pédicure, semi-permanent", "https://leynabeauty.com/"],
  ["Maison Duo", "Sablon", ["maisonduobh@gmail.com"], "+32 498 74 66 99", "Manucure, semi-permanent, gel, nail art", "https://www.maisonduobh.com/bel-fr"],
  ["Maison Semeraro", "Ixelles", ["info@maison-semeraro.com"], "+32 2 514 28 58", "Manucure, vernis, semi-permanent", "https://www.maison-semeraro.com/fr/esthetique.php"],
  ["MS Beauty Center", "Etterbeek", ["info@msbeautycenter.com"], "+32 483 12 04 53", "Onglerie, beauté des mains et pieds", "https://msbeautycenter.com/"],
  ["MV Beauty Art", "Bruxelles", ["info@mvbeautyart.com"], null, "Onglerie professionnelle + esthétique", null],
  ["Nail to Nail", "Saint-Josse-ten-Noode", ["info@nailtonail.be"], "+32 2 523 44 81", "Institut, manucure, pédicure", "https://www.nailtonail.be/"],
  ["Rosa's Beauty", "Jette", ["info@rosasbeauty.be"], "+32 466 46 05 33", "Onglerie, manucure, pédicure", "https://rosasbeauty.be/"],
  ["Royal Beauty Center", "Watermael-Boitsfort", ["info@royalbeautycenter.be"], "+32 2 522 69 86", "BIAB, gel, extensions, semi-permanent, nail art", "https://www.royalbeautycenter.be/"],
  ["SAMIO", "Ixelles", ["info@samio-ws.com"], "+32 489 71 08 66", "Manucure, pédicure, beauté des ongles, gel", "https://www.samio.be/"],
  ["S-Attitude", "Laeken", ["info@sattitude.be"], null, "Studio d'ongles, gel, semi-permanent", "https://sattitude.be/"],
  ["Special Beauty", "Uccle", ["info@specialbeauty.be"], "+32 487 18 60 01", "Manucure, pédicure, esthétique", "https://www.specialbeauty.be/"],
  ["Stockel Nails", "Woluwe-Saint-Pierre", ["phiphitham19891994@gmail.com", "phitham2802@gmail.com"], null, "Onglerie", null],
  ["U Nice Place", "Ixelles", ["info@u-nice-place.be", "infotaseanno@gmail.com"], null, "Institut esthétique (Ixelles / Uccle)", null],
  ["Vina Nails and Well-being", "Laeken", ["vinanails170725@gmail.com"], "+32 471 74 57 32", "Manucure, pédicure, gel, acrylique, nail art", "https://vinanailsandwellbeing.com/"],
  ["infidepilandbeauty", "Chastre", ["infidepilandbeauty@gmail.com"], null, null, null],
  ["HR Studio Brussels", "Schaerbeek", ["hr.studiobrussels@gmail.com"], "+32 497 65 12 50", "Spécialiste BIAB", null],
  ["Ary Beauty Studio", "Ixelles", ["info@arybeautystudio.be"], null, "Manucure/pédicure", null],
  ["Beauty Butterfly", "Etterbeek", ["info@beautybutterfly.be"], null, null, null],
  ["Institut SkinCare Project", "Etterbeek", ["info@iskcare.be"], null, null, null],
  ["Goldeluxe Clinic", "Molenbeek", ["info@goldeluxe.be"], null, null, null],
];

const IMPORT_NOTE = "Import manuel — liste B2B instituts/ongleries Bruxelles";

async function main() {
  let created = 0;
  let skipped = 0;
  const skippedRows = [];

  for (const [company, city, emails, phone, specialty, website] of ROWS) {
    for (const rawEmail of emails) {
      const email = String(rawEmail).trim().toLowerCase();
      if (!email.includes("@")) {
        skipped += 1;
        skippedRows.push(`${company} <${rawEmail}> (email invalide)`);
        continue;
      }
      const existing = await prisma.prospect.findUnique({ where: { email } });
      if (existing) {
        skipped += 1;
        skippedRows.push(`${company} <${email}> (déjà existant)`);
        continue;
      }
      const notes = [specialty, IMPORT_NOTE].filter(Boolean).join(" — ");
      const prospect = await prisma.prospect.create({
        data: {
          email,
          company,
          city,
          phone: phone ? String(phone).replace(/\s+/g, " ").trim() : null,
          website: website || null,
          country: "BE",
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
          metadata: { source: "autre", import: "b2b-manuel" },
          description: IMPORT_NOTE,
        },
      });
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { lastActivityAt: new Date(), lastEventType: "prospect_created" },
      });
      created += 1;
      console.log(` + ${company} <${email}>`);
    }
  }

  console.log(`\nTerminé : ${created} créé(s), ${skipped} ignoré(s).`);
  if (skippedRows.length > 0) {
    console.log("Ignorés :");
    for (const row of skippedRows) console.log(` - ${row}`);
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
