"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { X, Loader2, Camera } from "lucide-react";

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

  async function handleFile(file) {
    if (!file) return;

    // Client-side type/size guard (mirrors server)
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) {
      toast.error("Format non accepté. Utilisez JPEG, PNG, WebP ou GIF.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Le fichier ne doit pas dépasser 20 Mo.");
      return;
    }

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);
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
    <div>
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
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}