import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

// Force Node.js runtime — required for fs/promises and large body reads
export const runtime = "nodejs";

// Disable Next.js body size limit for this route segment
export const maxDuration = 30;

// Max raw file size: 20 MB (consistent with frontend)
const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_FOLDERS = ["staff", "services"];
const BASE_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const folder = formData.get("folder") ?? "staff";

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { success: false, message: "Aucun fichier reçu." },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Format non accepté. Utilisez JPEG, PNG, WebP ou GIF.",
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, message: "Le fichier ne doit pas dépasser 20 Mo." },
        { status: 400 }
      );
    }

    // Validate folder name to prevent directory traversal
    const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : "staff";
    const uploadDir = path.join(BASE_UPLOAD_DIR, safeFolder);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Unique filename: timestamp + random hex + original extension
    const ext = path.extname(file.name) || ".jpg";
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;

    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, uniqueName), buffer);

    const url = `/uploads/${safeFolder}/${uniqueName}`;

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error("[upload/route]", error);
    return NextResponse.json(
      { success: false, message: "Erreur lors du téléversement." },
      { status: 500 }
    );
  }
}