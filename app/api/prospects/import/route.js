import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import {
  createProspect,
  normalizeSource,
  isValidSource,
} from "@/lib/prospects/prospect-service";
import {
  IMPORT_MAX_SIZE,
  buildProspectImportTemplate,
  parseImportBuffer,
  validateImportRows,
} from "@/lib/prospects/prospect-import";

// Force Node.js runtime — ExcelJS requis.
export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

// ─── GET /api/prospects/import — télécharge le modèle Excel ─────────────────
export async function GET() {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const buffer = await buildProspectImportTemplate();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="modele-import-prospects.xlsx"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/prospects/import]", error);
    return serverError();
  }
}

// ─── POST /api/prospects/import — import Excel/CSV ───────────────────────────
// Body : FormData { file, source? }. Seul l'e-mail est requis par ligne.
// `source` = source par défaut choisie dans la modale (ex. Anciens clients) :
// elle s'applique aux lignes SANS colonne Source ; une colonne Source
// explicite et valide dans le fichier reste prioritaire.
// Idempotent : un e-mail déjà connu n'est JAMAIS écrasé — seuls les champs
// encore vides sont complétés (même règle que la création manuelle).
export async function POST(request) {
  const { error: authError, session } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return badRequest("Aucun fichier reçu. Choisissez un fichier Excel (.xlsx) ou CSV.");
    }
    const filename = file.name || "import";
    const lowerName = filename.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      return badRequest("Format non accepté. Utilisez un fichier Excel (.xlsx) ou CSV.", {
        file: "Extension acceptée : .xlsx, .csv.",
      });
    }
    if (file.size > IMPORT_MAX_SIZE) {
      return badRequest("Le fichier ne doit pas dépasser 5 Mo.", {
        file: "Fichier trop volumineux.",
      });
    }
    if (file.size === 0) {
      return badRequest("Le fichier est vide.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Source par défaut (modale) — repli `import_excel` si absente/inconnue.
    const requestedDefault = formData.get("source");
    const defaultSource = requestedDefault
      ? isValidSource(String(requestedDefault).trim())
        ? String(requestedDefault).trim()
        : normalizeSource(requestedDefault)
      : "import_excel";

    let rows;
    try {
      rows = await parseImportBuffer(buffer, filename);
    } catch (parseError) {
      return badRequest(
        parseError?.message || "Fichier illisible. Enregistrez-le en .xlsx et réessayez."
      );
    }

    const { valid, errors } = validateImportRows(rows);
    if (valid.length === 0) {
      return badRequest("Aucune ligne importable (e-mail valide requis).", { errors: errors.slice(0, 50) });
    }

    // Distingue créations vs mises à jour (backfill) en une seule requête.
    const emails = valid.map((r) => r.data.email);
    const known = await prisma.prospect.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    const knownSet = new Set(known.map((p) => p.email));

    let created = 0;
    let updated = 0;
    const rowErrors = [...errors];

    for (const { rowNumber, data } of valid) {
      try {
        // Colonne Source du fichier prioritaire, sinon la source par défaut
        // choisie dans la modale (ex. Anciens clients).
        const source = data.source
          ? isValidSource(String(data.source).trim())
            ? String(data.source).trim()
            : normalizeSource(data.source)
          : defaultSource;
        const isKnown = knownSet.has(data.email);
        const before = isKnown
          ? await prisma.prospect.findUnique({ where: { email: data.email } })
          : null;
        const prospect = await createProspect({
          email: data.email,
          fullName: data.fullName,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          company: data.company,
          city: data.city,
          region: data.region,
          website: data.website,
          country: data.country,
          source,
          sourceRefType: "import_excel",
          sourceRefId: filename,
          createdBy: session.user.id,
        });
        // Colonne "Notes" : complète la fiche si vide, sinon journalise
        // en activité (le champ notes existant n'est jamais écrasé).
        if (data.notes && prospect) {
          if (!before?.notes && !prospect.notes) {
            await prisma.prospect.update({
              where: { id: prospect.id },
              data: { notes: String(data.notes).slice(0, 5000) },
            });
          } else if (before?.notes) {
            const { addActivity } = await import("@/lib/prospects/prospect-service");
            await addActivity(prospect, {
              type: "note_added",
              refModel: "import_excel",
              refId: filename,
              description: `Import Excel : ${String(data.notes).slice(0, 1000)}`,
              createdBy: session.user.id,
            });
          }
        }
        if (!isKnown) {
          created += 1;
          knownSet.add(data.email);
        } else {
          // createProspect ne touche que les champs vides : on compte une
          // "mise à jour" seulement si au moins un champ a été complété.
          const after = await prisma.prospect.findUnique({ where: { email: data.email } });
          const filled = after && before
            ? ["fullName", "firstName", "lastName", "phone", "company", "city", "region", "website", "country"].some(
                (field) => !before[field] && after[field]
              )
            : false;
          if (filled) updated += 1;
        }
      } catch (rowError) {
        rowErrors.push({
          row: rowNumber,
          email: data.email,
          message: rowError?.message || "Échec de l'import de cette ligne.",
        });
      }
    }

    // Les notes éventuelles sont journalisées comme activité (sans écraser
    // le champ notes existant de la fiche).
    return ok(
      {
        total: rows.length,
        created,
        updated,
        skipped: rowErrors.length,
        errors: rowErrors.slice(0, 50),
      },
      `Import terminé : ${created} créé(s), ${updated} complété(s), ${rowErrors.length} ignoré(s).`
    );
  } catch (error) {
    console.error("[POST /api/prospects/import]", error);
    return serverError();
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
