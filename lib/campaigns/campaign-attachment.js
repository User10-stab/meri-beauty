/**
 * Pièces jointes des campagnes.
 *
 * Campaign.attachmentUrl pointe normalement vers /uploads/campaigns/…
 * (déposé via POST /api/campaigns/attachments). Par tolérance, une URL
 * http(s) externe est aussi acceptée (téléchargée à l'envoi).
 *
 * Garde-fous :
 * - chemin local strictement confiné à public/uploads/campaigns (+
 *   basename, pas de traversal) ;
 * - taille plafonnée à 10 Mo (limite d'envoi + délivrabilité) ;
 * - types MIME autorisés : PDF + images (jamais de HTML/SVG/exécutable) ;
 * - en cas d'échec, retourne null (l'envoi continue SANS pièce jointe et
 *   le signale) plutôt que de faire échouer toute la campagne.
 */

import { readFile, stat } from "fs/promises";
import path from "path";

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const LOCAL_PREFIX = "/uploads/campaigns/";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const EXTENSION_BY_TYPE = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function slugFilename(value, fallback = "document") {
  const base = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || fallback;
}

function isAllowedType(mime) {
  return ALLOWED_TYPES.has(String(mime || "").split(";")[0].trim().toLowerCase());
}

async function resolveLocalAttachment(attachmentUrl, { uploadsRoot, filenameHint }) {
  // Confinement : préfixe exact + basename (toute tentative de traversal
  // comme /uploads/campaigns/../../x est neutralisée par basename, puis
  // re-vérifiée via le chemin résolu).
  if (!attachmentUrl.startsWith(LOCAL_PREFIX)) return null;
  const fileName = path.basename(attachmentUrl.split("?")[0]);
  if (!fileName || fileName === "/" || fileName.includes("..")) return null;

  const root = uploadsRoot ?? path.join(process.cwd(), "public", "uploads", "campaigns");
  const resolved = path.resolve(root, fileName);
  if (path.relative(path.resolve(root), resolved).startsWith("..") || path.basename(resolved) !== fileName) {
    return null;
  }

  const info = await stat(resolved);
  if (!info.isFile() || info.size === 0 || info.size > ATTACHMENT_MAX_BYTES) return null;

  const content = await readFile(resolved);
  const ext = path.extname(fileName).toLowerCase();
  const knownExt = Object.values(EXTENSION_BY_TYPE).includes(ext) ? ext : ".pdf";
  return { filename: `${slugFilename(filenameHint, "meri-beauty-campagne")}${knownExt}`, content };
}

async function resolveRemoteAttachment(attachmentUrl, { filenameHint, fetchImpl, timeoutMs = 15000 }) {
  let parsed;
  try {
    parsed = new URL(attachmentUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(attachmentUrl, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;
    if (!isAllowedType(response.headers?.get?.("content-type"))) return null;

    const length = Number(response.headers?.get?.("content-length") ?? 0);
    if (length > ATTACHMENT_MAX_BYTES) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > ATTACHMENT_MAX_BYTES) return null;

    const contentType = String(response.headers.get("content-type")).split(";")[0].trim().toLowerCase();
    const ext = EXTENSION_BY_TYPE[contentType] ?? ".pdf";
    const remoteName = path.basename(parsed.pathname).split(".")[0];
    return {
      filename: `${slugFilename(remoteName || filenameHint, "meri-beauty-campagne")}${ext}`,
      content: buffer,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string|null} attachmentUrl
 * @param {{ filenameHint?: string, uploadsRoot?: string, fetchImpl?: Function }} [options]
 * @returns {Promise<{ filename: string, content: Buffer }|null>}
 */
export async function resolveCampaignAttachment(attachmentUrl, options = {}) {
  const url = String(attachmentUrl ?? "").trim();
  if (!url) return null;
  try {
    if (url.startsWith(LOCAL_PREFIX)) {
      return await resolveLocalAttachment(url, options);
    }
    if (/^https?:\/\//i.test(url)) {
      return await resolveRemoteAttachment(url, options);
    }
    return null;
  } catch (error) {
    console.error("[resolveCampaignAttachment]", error?.message ?? error);
    return null;
  }
}
