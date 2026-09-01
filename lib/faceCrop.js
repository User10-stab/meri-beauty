"use client";

// ---------------------------------------------------------------------------
// Canvas-based crop utility for staff profile photos.
//
// Crops an image to a target aspect ratio centred on a configurable focus
// point.  No face-detection library required — the admin can adjust the
// focus point via a drag-to-reposition UI in the upload widget.
//
// Default focus: centre-top (50 %, 30 %) — works well for most portrait
// photos where the face sits in the upper third.
// ---------------------------------------------------------------------------

/** Target aspect ratio for the homepage staff cards (matches aspect-[1.45/1]) */
export const TARGET_RATIO = 1.45;

/**
 * Crop an image File to the target aspect ratio, centred on a focus point.
 *
 * @param {File}   file               Source image (already optimised)
 * @param {object} [opts]
 * @param {number} [opts.focusX=50]   Horizontal focus 0-100 (% from left)
 * @param {number} [opts.focusY=30]   Vertical focus   0-100 (% from top)
 * @param {number} [opts.targetRatio] Width / height  (default 1.45)
 * @returns {Promise<File>}           Cropped image as WebP File
 */
export async function faceCrop(file, opts = {}) {
  if (!file || typeof file.size !== "number") {
    throw new Error("Fichier invalide.");
  }
  if (file.type === "image/gif") return file;

  const focusX = (opts.focusX ?? 50) / 100;   // 0-1
  const focusY = (opts.focusY ?? 30) / 100;   // 0-1
  const targetRatio = opts.targetRatio ?? TARGET_RATIO;

  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error("Impossible de lire les dimensions de l'image.");

  // Draw source onto canvas
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.drawImage(img, 0, 0, srcW, srcH);

  // Compute crop box centred on focus point
  const focusCX = srcW * focusX;
  const focusCY = srcH * focusY;

  let cropW = srcW;
  let cropH = cropW / targetRatio;
  if (cropH > srcH) {
    cropH = srcH;
    cropW = cropH * targetRatio;
  }

  let cropX = focusCX - cropW / 2;
  let cropY = focusCY - cropH / 2;
  cropX = Math.max(0, Math.min(cropX, srcW - cropW));
  cropY = Math.max(0, Math.min(cropY, srcH - cropH));

  const outCanvas = document.createElement("canvas");
  outCanvas.width = Math.round(cropW);
  outCanvas.height = Math.round(cropH);
  const outCtx = outCanvas.getContext("2d");
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(
    srcCanvas,
    Math.round(cropX), Math.round(cropY), Math.round(cropW), Math.round(cropH),
    0, 0, outCanvas.width, outCanvas.height,
  );

  return canvasToFile(outCanvas, file.name);
}

/**
 * Generate a cropped data-URL preview (for the drag-to-reposition UI).
 * Does NOT create a File — purely for display.
 */
export async function getCroppedPreview(file, focusX = 50, focusY = 30, targetRatio = TARGET_RATIO) {
  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.drawImage(img, 0, 0, srcW, srcH);

  const fx = (focusX / 100) * srcW;
  const fy = (focusY / 100) * srcH;

  let cropW = srcW;
  let cropH = cropW / targetRatio;
  if (cropH > srcH) { cropH = srcH; cropW = cropH * targetRatio; }

  let cropX = Math.max(0, Math.min(fx - cropW / 2, srcW - cropW));
  let cropY = Math.max(0, Math.min(fy - cropH / 2, srcH - cropH));

  const out = document.createElement("canvas");
  out.width = Math.round(cropW);
  out.height = Math.round(cropH);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, Math.round(cropX), Math.round(cropY), Math.round(cropW), Math.round(cropH), 0, 0, out.width, out.height);

  return out.toDataURL("image/webp", 0.92);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire l'image.")); };
    img.src = url;
  });
}

function canvasToFile(canvas, originalName) {
  return new Promise((resolve, reject) => {
    const base = originalName.replace(/\.[^.]+$/, "");
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error("Échec du recadrage de l'image.")); return; }
        resolve(new File([blob], `${base}.webp`, { type: "image/webp", lastModified: Date.now() }));
      },
      "image/webp",
      0.92,
    );
  });
}
