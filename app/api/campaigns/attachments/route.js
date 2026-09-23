import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";

// Force Node.js runtime — fs/promises requis.
export const runtime = "nodejs";
export const maxDuration = 30;

// 10 Mo max : au-delà, les e-mails avec pièce jointe se font rejeter ou
// spammer. Même plafond que /api/upload.
const MAX_SIZE = 10 * 1024 * 1024;

// PDF + images courantes. Jamais de SVG/HTML (XSS stocké) ni d'exécutables.
// L'extension sur disque est forcée depuis le type MIME validé, jamais
// depuis le nom fourni par le client (même pattern que /api/upload).
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const EXTENSION_BY_TYPE = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "campaigns");

// ─── POST /api/campaigns/attachments — OWNER/ADMIN uniquement ────────────────
// Body : FormData { file }. Retour : { success, url } (/uploads/campaigns/…).
export async function POST(request) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ success: false, message: "Aucun fichier reçu." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, message: "Format non accepté. Utilisez PDF, JPEG, PNG, WebP ou GIF." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, message: "Le fichier ne doit pas dépasser 10 Mo." },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, message: "Le fichier est vide." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = EXTENSION_BY_TYPE[file.type];
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;

    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, uniqueName), buffer);

    return NextResponse.json({ success: true, url: `/uploads/campaigns/${uniqueName}` });
  } catch (error) {
    console.error("[POST /api/campaigns/attachments]", error);
    return NextResponse.json({ success: false, message: "Erreur lors du téléversement." }, { status: 500 });
  }
}
