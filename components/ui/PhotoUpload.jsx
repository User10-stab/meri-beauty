"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X, Loader2, Camera } from "lucide-react";
import { optimizeImage, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from "@/lib/imageOptimization";

/**
 * Reusable photo upload widget (drag-and-drop + click-to-upload).
 *
 * @param {{
 *   value: string | null,
 *   onChange: (url: string | null) => void,
 *   uploadFolder?: string,
 *   error?: string,
 * }} props
 */
export function PhotoUpload({ value, onChange, uploadFolder = "staff", error }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(value ?? null);

  // Keep preview in sync when parent value changes (e.g. modal re-open / reset)
  useEffect(() => {
    setPreview(value ?? null);
  }, [value]);

  async function handleFile(file) {
    if (!file) return;

    // Client-side type guard (mirrors server)
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) {
      toast.error("Format non accepté. Utilisez JPEG, PNG, WebP ou GIF.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast.error("Le fichier ne doit pas dépasser 25 Mo.");
      return;
    }

    // Optimize: resize to 2500 px longest side + WebP ~88 % (skips small/optimized images).
    let fileToUpload = file;
    try {
      fileToUpload = await optimizeImage(file);
    } catch (err) {
      toast.error(err?.message ?? "Impossible de traiter l'image. Veuillez réessayer avec une autre image.");
      return;
    }
    if (fileToUpload.size > MAX_OUTPUT_BYTES) {
      toast.error("L'image reste trop volumineuse après optimisation (>10 Mo). Essayez avec une image plus légère.");
      return;
    }

    // Show local preview immediately (use optimized file so preview matches final)
    const objectUrl = URL.createObjectURL(fileToUpload);
    setPreview(objectUrl);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", fileToUpload);
      fd.append("folder", uploadFolder);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();

      if (data.success) {
        onChange(data.url);
      } else {
        toast.error(data.message ?? "Erreur lors du téléversement.");
        setPreview(null);
        onChange(null);
      }
    } catch {
      toast.error("Erreur réseau lors du téléversement.");
      setPreview(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  function handleChange(e) {
    handleFile(e.target.files?.[0] ?? null);
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0] ?? null);
  }

  function clearPhoto(e) {
    e.stopPropagation();
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col items-center">
      <div
        role="button"
        tabIndex={0}
        aria-label="Téléverser une photo"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`relative flex h-24 w-24 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed transition-colors ${
          error
            ? "border-red-300 hover:border-red-400"
            : "border-gray-300 hover:border-indigo-400"
        } ${uploading ? "opacity-60" : ""}`}
      >
        {preview ? (
          <>
            <img
              src={preview}
              alt="Aperçu photo"
              className="h-full w-full object-cover"
            />
            {/* Remove button */}
            <button
              type="button"
              onClick={clearPhoto}
              aria-label="Supprimer la photo"
              className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
            >
              <X size={10} />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400">
            {uploading ? (
              <Loader2 size={20} className="animate-spin text-indigo-500" />
            ) : (
              <>
                <Camera size={20} />
                <span className="text-center text-[10px] leading-tight">
                  Photo
                </span>
              </>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={handleChange}
          aria-hidden="true"
        />
      </div>
      <p className="mt-1.5 max-w-[112px] text-center text-[11px] leading-tight text-gray-400">
        Pour une qualité optimale, utilisez une image de moins de 10&nbsp;Mo.
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}