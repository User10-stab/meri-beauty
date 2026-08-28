"use client";

// Single source of truth for client-side image optimization.
// Reused by every dashboard upload widget so the behavior stays consistent.

export const MAX_INPUT_BYTES = 25 * 1024 * 1024; // accept up to 25 MB before optimization
export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // safety cap after optimization
export const MAX_LONGEST_SIDE = 2500;
export const WEBP_QUALITY = 0.88; // 88% = inside the required 85-90% band
export const SMALL_FILE_THRESHOLD = 1.2 * 1024 * 1024; // don't recompress already-small images

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileNameWithoutExt(name) {
  if (!name || typeof name !== "string") return "image";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Modern browsers decode EXIF orientation automatically for <img> when
    // image-orientation: from-image is applied. createImageBitmap with
    // { imageOrientation: 'from-image' } is the primary path — this fallback
    // only runs on very old browsers anyway.
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Wrap in a minimal bitmap-like object so callers can use .width/.height
      // and ctx.drawImage(img, ...) interchangeably.
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        _img: img,
        close() {},
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de lire l'image. Vérifiez que le fichier est une image valide."));
    };
    img.src = url;
  });
}

async function getBitmap(file) {
  // Preferred: createImageBitmap honours EXIF orientation when asked
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return bmp;
    } catch {
      // Fall through to <img> fallback (e.g. file is not decodeable as image bitmap)
    }
  }
  return loadViaImageElement(file);
}

function canvasToWebPBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("Votre navigateur ne supporte pas la compression d'images."));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Échec de la compression de l'image."));
      },
      "image/webp",
      quality
    );
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Optimize an image File:
 *  - keeps aspect ratio, caps longest side at 2500 px
 *  - converts to WebP at ~88 % quality (falls back to 82/80 % if >5 MB)
 *  - preserves orientation via createImageBitmap({ imageOrientation:'from-image' })
 *  - skips already-small / already-optimized images to avoid quality loss
 *  - skips animated GIFs (canvas would strip animation)
 *
 * @param {File} file
 * @returns {Promise<File>} optimized File (or the original File when optimization is unnecessary)
 * @throws {Error} with a French message when the image cannot be processed
 */
export async function optimizeImage(file) {
  if (!file || typeof file.size !== "number") {
    throw new Error("Fichier invalide.");
  }

  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("Le fichier ne doit pas dépasser 25 Mo.");
  }

  // GIF: never re-encode (would lose animation). Return as-is; the backend
  // will still reject if >10 MB, which is the correct behaviour for huge GIFs.
  if (file.type === "image/gif") {
    return file;
  }

  let bitmap;
  try {
    bitmap = await getBitmap(file);
  } catch (e) {
    const msg = e instanceof Error && e.message ? e.message : "Impossible de traiter l'image. Vérifiez que le fichier est une image valide.";
    throw new Error(msg);
  }

  const width = bitmap.width;
  const height = bitmap.height;

  if (!width || !height) {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new Error("Impossible de lire les dimensions de l'image.");
  }

  const longest = Math.max(width, height);
  const needsResize = longest > MAX_LONGEST_SIDE;

  // Don't blindly recompress already-small / already-optimized images.
  // Heuristic:
  //  - < 1.2 MB and already within bounds  -> keep original
  //  - already WebP < 2 MB and within bounds -> keep original (already modern)
  //  - already WebP < 4 MB and within bounds -> keep original
  const alreadyWithinBounds = longest <= MAX_LONGEST_SIDE;
  if (file.size < SMALL_FILE_THRESHOLD && alreadyWithinBounds) {
    if (typeof bitmap.close === "function") bitmap.close();
    return file;
  }
  if (file.type === "image/webp" && file.size < 2 * 1024 * 1024 && alreadyWithinBounds) {
    if (typeof bitmap.close === "function") bitmap.close();
    return file;
  }
  if (file.type === "image/webp" && file.size < 4 * 1024 * 1024 && alreadyWithinBounds) {
    // WebP inside budget without resize -> assume already optimized enough
    if (typeof bitmap.close === "function") bitmap.close();
    return file;
  }

  let targetW = width;
  let targetH = height;
  if (needsResize) {
    const scale = MAX_LONGEST_SIDE / longest;
    targetW = Math.max(1, Math.round(width * scale));
    targetH = Math.max(1, Math.round(height * scale));
  }

  // If no resize is needed and the file is already a reasonably compressed
  // JPEG/WebP under 4 MB, skip recompression to avoid generation loss.
  // This keeps phone thumbnails and small uploads untouched.
  if (!needsResize && file.size < 4 * 1024 * 1024 && (file.type === "image/jpeg" || file.type === "image/webp")) {
    if (typeof bitmap.close === "function") bitmap.close();
    return file;
  }

  // Create canvas at target size
  let canvas;
  try {
    canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
  } catch {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new Error("Image trop grande pour être traitée sur cet appareil.");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new Error("Impossible de traiter l'image sur ce navigateur.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  try {
    // drawImage works with both ImageBitmap and HTMLImageElement
    const source = bitmap._img ?? bitmap;
    ctx.drawImage(source, 0, 0, targetW, targetH);
  } catch {
    if (typeof bitmap.close === "function") bitmap.close();
    throw new Error("Impossible de redimensionner l'image.");
  } finally {
    if (typeof bitmap.close === "function") {
      try {
        bitmap.close();
      } catch {}
    }
  }

  // First pass at 88 %
  let blob;
  try {
    blob = await canvasToWebPBlob(canvas, WEBP_QUALITY);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Échec de la compression de l'image.";
    throw new Error(msg);
  }

  // If we didn't resize and the WebP is actually larger than the original,
  // return the original to avoid inflating the file.
  if (!needsResize && blob.size > file.size * 1.05) {
    return file;
  }

  // Progressive fallback: if still >5 MB try slightly lower qualities
  // (stay inside 80-88 % so quality remains high).
  if (blob.size > 5 * 1024 * 1024) {
    const steps = [0.82, 0.80];
    for (const q of steps) {
      try {
        const next = await canvasToWebPBlob(canvas, q);
        if (next.size < blob.size) blob = next;
        if (blob.size <= 5 * 1024 * 1024) break;
      } catch {
        break;
      }
    }
  }

  // Last resort if still >10 MB (extremely detailed 2500px image)
  if (blob.size > MAX_OUTPUT_BYTES) {
    try {
      const fallback = await canvasToWebPBlob(canvas, 0.75);
      if (fallback.size < blob.size) blob = fallback;
    } catch {}
  }

  // Don't throw here — let the caller handle the >10 MB UI message
  // consistently for all upload widgets. We just return the best we could do.
  // The caller will show "L'image reste trop volumineuse après optimisation..."
  const base = fileNameWithoutExt(file.name);
  const optimizedFile = new File([blob], `${base}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });

  return optimizedFile;
}
