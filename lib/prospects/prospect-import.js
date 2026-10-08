/**
 * Import prospects depuis Excel — parsing + mapping de colonnes.
 *
 * Module PUR (aucun accès DB) : la route /api/prospects/import s'occupe
 * de la persistance via createProspect (idempotent, sans écrasement).
 *
 * Format accepté : .xlsx (Excel) et .csv. Les en-têtes sont reconnus en
 * français ET en anglais, avec ou sans accents (ex. "E-mail", "Nom
 * complet", "Téléphone", "Région", "Pays"...). Seul l'e-mail est requis.
 */

import ExcelJS from "exceljs";

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_SIZE = 5 * 1024 * 1024;

// Colonnes du modèle d'import (ordre d'affichage du template).
export const IMPORT_COLUMNS = Object.freeze([
  { key: "email", label: "E-mail *", width: 30 },
  { key: "fullName", label: "Nom complet", width: 26 },
  { key: "firstName", label: "Prénom", width: 18 },
  { key: "lastName", label: "Nom", width: 18 },
  { key: "phone", label: "Téléphone", width: 18 },
  { key: "company", label: "Société", width: 22 },
  { key: "city", label: "Ville", width: 18 },
  { key: "region", label: "Région", width: 18 },
  { key: "country", label: "Pays", width: 12 },
  { key: "website", label: "Site web", width: 26 },
  { key: "source", label: "Source", width: 18 },
  { key: "notes", label: "Notes", width: 30 },
]);

function stripAccents(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeader(header) {
  return stripAccents(header).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Toutes les variantes d'en-têtes reconnues par champ.
const HEADER_ALIASES = {
  email: ["email", "emails", "mail", "e-mail", "courriel", "adresseemail", "adresse-mail"],
  fullName: ["nomcomplet", "fullname", "fullnames", "nomprenom", "nom&prenom", "nometprenom", "name", "nomcompletnomprenom"],
  firstName: ["prenom", "prenoms", "firstname", "firstnames", "givenname"],
  lastName: ["nom", "noms", "nomdefamille", "lastname", "lastnames", "familyname", "surname"],
  phone: ["telephone", "telephones", "phone", "tel", "gsm", "portable", "phonenumber", "numero", "numerodetelephone", "telphone"],
  company: ["societe", "societes", "company", "entreprise", "entreprises", "societeentreprise", "raison", "raisonsociale"],
  city: ["ville", "villes", "city", "localite", "localites", "commune", "communes"],
  region: ["region", "regions", "province", "provinces", "etat", "etats", "state", "departement", "canton"],
  country: ["pays", "country", "payscountry"],
  website: ["siteweb", "siteinternet", "website", "web", "site", "url"],
  source: ["source", "sources", "origine", "canal"],
  notes: ["notes", "note", "commentaire", "commentaires", "comment", "remarque", "remarques", "message"],
};

export function mapHeaderToKey(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return key;
  }
  return null;
}

function cleanCell(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    // ExcelJS peut renvoyer { text } (hyperlien) ou { richText }.
    if (typeof value.text === "string") return value.text.trim() || null;
    if (Array.isArray(value.richText)) {
      const text = value.richText.map((r) => r?.text ?? "").join("").trim();
      return text || null;
    }
    return null;
  }
  const str = String(value).trim();
  return str || null;
}

function normalizeCountry(value) {
  const str = cleanCell(value);
  if (!str) return null;
  // Code ISO sur 2 lettres -> majuscules (be -> BE). Sinon valeur brute.
  if (/^[a-zA-Z]{2}$/.test(str)) return str.toUpperCase();
  return str;
}

/**
 * Lit un buffer .xlsx / .csv et retourne les lignes brutes
 * [{ rowNumber, values: { key: value } }].
 */
export async function parseImportBuffer(buffer, filename = "") {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".csv")) return parseCsvBuffer(buffer);
  return parseXlsxBuffer(buffer);
}

async function parseXlsxBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Le classeur ne contient aucune feuille.");
  return extractRows(
    sheetRowValues(sheet),
    sheet.rowCount
  );
}

function sheetRowValues(sheet) {
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values est indexé à partir de 1 ; on garde les cellules.
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cell.value;
    });
    rows.push({ rowNumber: row.number, values });
  });
  return rows;
}

function parseCsvBuffer(buffer) {
  const text = Buffer.from(buffer).toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const delimiter = detectCsvDelimiter(lines[0] ?? "");
  const rows = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    rows.push({ rowNumber: index + 1, values: splitCsvLine(line, delimiter) });
  });
  return extractRows(rows, rows.length);
}

function detectCsvDelimiter(firstLine) {
  const candidates = [";", ",", "\t"];
  let best = ";";
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function splitCsvLine(line, delimiter) {
  // Découpe CSV avec gestion des guillemets.
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((v) => v.trim().replace(/^"|"$/g, ""));
}

function extractRows(rawRows, rowCount) {
  if (rawRows.length === 0) throw new Error("Le fichier ne contient aucune ligne.");
  if (rowCount > IMPORT_MAX_ROWS + 1) {
    throw new Error(`Le fichier contient trop de lignes (max ${IMPORT_MAX_ROWS} prospects).`);
  }
  const [headerRow, ...dataRows] = rawRows;
  const headerCells = headerRow.values.map((v) => cleanCell(v) ?? "");
  const keyByIndex = headerCells.map((h) => mapHeaderToKey(h));
  if (!keyByIndex.includes("email")) {
    throw new Error(
      "Colonne e-mail introuvable. Vérifiez que la première ligne contient « E-mail » (téléchargez le modèle)."
    );
  }
  return dataRows
    .map(({ rowNumber, values }) => {
      const mapped = {};
      values.forEach((cell, index) => {
        const key = keyByIndex[index];
        if (!key) return;
        const cleaned = key === "country" ? normalizeCountry(cell) : cleanCell(cell);
        if (cleaned) mapped[key] = cleaned;
      });
      return { rowNumber, values: mapped };
    })
    .filter(({ values }) => Object.keys(values).length > 0);
}

/**
 * Valide les lignes : e-mail requis + valide. Retourne
 * { valid: [{ rowNumber, data }], errors: [{ row, email, message }] }.
 * Les doublons d'e-mail DANS le fichier sont signalés (on garde le 1er).
 */
export function validateImportRows(rows) {
  const valid = [];
  const errors = [];
  const seen = new Set();
  for (const { rowNumber, values } of rows) {
    const email = String(values.email ?? "").trim().toLowerCase();
    if (!email) {
      errors.push({ row: rowNumber, email: null, message: "E-mail manquant." });
      continue;
    }
    if (!email.includes("@") || email.length > 254) {
      errors.push({ row: rowNumber, email, message: "E-mail invalide." });
      continue;
    }
    if (seen.has(email)) {
      errors.push({ row: rowNumber, email, message: "Doublon dans le fichier (e-mail déjà présent plus haut)." });
      continue;
    }
    seen.add(email);
    valid.push({ rowNumber, data: { ...values, email } });
  }
  return { valid, errors };
}

/** Construit le classeur modèle .xlsx (en-têtes + 1 ligne d'exemple). */
export async function buildProspectImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Meri Beauty";
  const sheet = workbook.addWorksheet("Prospects");
  sheet.columns = IMPORT_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "2F3A2E" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  headerRow.height = 24;
  sheet.addRow({
    email: "exemple@client.be",
    fullName: "Marie Dupont",
    firstName: "",
    lastName: "",
    phone: "+32 470 12 34 56",
    company: "",
    city: "Bruxelles",
    region: "Bruxelles-Capitale",
    country: "BE",
    website: "",
    source: "salon_evenement",
    notes: "",
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
