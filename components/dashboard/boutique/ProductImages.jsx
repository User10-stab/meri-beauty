"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { X, Loader2, ImagePlus, Star, GripHorizontal } from "lucide-react";
import { optimizeImage, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from "@/lib/imageOptimization";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Multi-image grid for a product — drag/click to add, click the star to set
 * the primary image (shown first everywhere: listings, boutique, cart).
 *
 * @param {{ value: {path: string, alt?: string, isPrimary?: boolean}[], onChange: (images) => void }} props
 */
export function ProductImages({ value = [], onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  async function handleFiles(files) {
    const typeFiltered = Array.from(files ?? []).filter((f) => {
      if (!ALLOWED.includes(f.type)) {
        toast.error(`${f.name} : format non accepté (JPEG, PNG, WebP ou GIF).`);
        return false;
      }
      if (f.size > MAX_INPUT_BYTES) {
        toast.error(`${f.name} : dépasse 25 Mo.`);
        return false;
      }
      return true;
    });
    if (!typeFiltered.length) return;

    // Optimize each file (resize to 2500 px, WebP ~88 %, skip small/GIF)
    const optimizedList = [];
    for (const f of typeFiltered) {
      try {
        const optimized = await optimizeImage(f);
        if (optimized.size > MAX_OUTPUT_BYTES) {
          toast.error(`${f.name} : reste trop volumineuse après optimisation (>10 Mo).`);
          continue;
        }
        optimizedList.push(optimized);
      } catch (err) {
        toast.error(`${f.name} : ${err?.message ?? "Impossible de traiter l'image."}`);
      }
    }
    if (!optimizedList.length) return;

    setUploading(true);
    try {
      const uploaded = [];
      for (const file of optimizedList) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "products");
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.success) {
          uploaded.push({ path: data.url, isPrimary: false });
        } else {
          toast.error(data.message ?? `Échec du téléversement de ${file.name}.`);
        }
      }
      if (uploaded.length) {
        const next = [...value, ...uploaded];
        if (!next.some((img) => img.isPrimary)) next[0].isPrimary = true;
        onChange(next);
      }
    } catch {
      toast.error("Erreur réseau lors du téléversement.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(index) {
    const next = value.filter((_, i) => i !== index);
    if (next.length && !next.some((img) => img.isPrimary)) next[0].isPrimary = true;
    onChange(next);
  }

  function setPrimary(index) {
    onChange(value.map((img, i) => ({ ...img, isPrimary: i === index })));
  }

  function reorder(from, to) {
    if (from === null || to === null || from === to) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function handleDragStart(e, index) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index)); // required by Firefox for drag to start
  }

  function handleDragEnter(index) {
    if (index !== dragIndex) setOverIndex(index);
  }

  function handleDrop(e, index) {
    e.preventDefault();
    reorder(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3 sm:flex sm:flex-wrap">
        {value.map((img, i) => (
          <div
            key={img.path + i}
            draggable={value.length > 1}
            onDragStart={(e) => handleDragStart(e, i)}
            onDragEnter={() => handleDragEnter(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            className={`group relative aspect-square w-full overflow-hidden rounded-lg border transition-all sm:h-24 sm:w-24 sm:flex-shrink-0 ${
              value.length > 1 ? "cursor-grab active:cursor-grabbing" : ""
            } ${
              dragIndex === i
                ? "scale-95 border-gray-200 opacity-40"
                : overIndex === i
                ? "scale-105 border-[#2f3a2e] shadow-lg"
                : "border-gray-200"
            }`}
          >
            <Image
              src={img.path}
              alt=""
              fill
              sizes="(max-width: 640px) 50vw, 96px"
              unoptimized
              draggable={false}
              className="select-none object-cover"
            />

            {value.length > 1 && (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-black/50 to-transparent pb-3 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
                <GripHorizontal size={14} className="text-white" />
              </div>
            )}

            <button
              type="button"
              onClick={() => setPrimary(i)}
              title={img.isPrimary ? "Image principale" : "Définir comme image principale"}
              className={`absolute left-1 top-1 flex h-7 w-7 items-center justify-center rounded-full shadow sm:h-5 sm:w-5 ${
                img.isPrimary ? "bg-amber-400 text-white" : "bg-white/90 text-gray-400 sm:opacity-0 sm:group-hover:opacity-100"
              } transition-opacity`}
            >
              <Star size={11} fill={img.isPrimary ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label="Supprimer l'image"
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow transition-opacity sm:h-5 sm:w-5 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-[#2f3a2e] hover:text-[#2f3a2e] disabled:opacity-60 sm:h-24 sm:w-24 sm:flex-shrink-0"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
          <span className="text-[10px]">Ajouter</span>
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(",")}
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <p className="mt-2 text-xs text-gray-400">Pour une qualité optimale, utilisez une image de moins de 10&nbsp;Mo.</p>
      {value.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          Aucune image. La première image ajoutée devient l'image principale — cliquez sur l'étoile pour en choisir une autre.
        </p>
      ) : value.length > 1 ? (
        <p className="mt-2 text-xs text-gray-400">Glissez une image pour changer son ordre.</p>
      ) : null}
    </div>
  );
}
