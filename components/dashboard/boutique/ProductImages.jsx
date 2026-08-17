"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { X, Loader2, ImagePlus, Star, GripHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Multi-image grid for a product — drag/click to add, click the star to set
 * the primary image (shown first everywhere: listings, boutique, cart).
 *
 * @param {{ value: {path: string, alt?: string, isPrimary?: boolean}[], onChange: (images) => void }} props
 */
export function ProductImages({ value = [], onChange }) {
  const t = useTranslations("dashboardBoutique.productImages");
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  async function handleFiles(files) {
    const list = Array.from(files ?? []).filter((f) => {
      if (!ALLOWED.includes(f.type)) {
        toast.error(t("formatError", { name: f.name }));
        return false;
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error(t("sizeError", { name: f.name }));
        return false;
      }
      return true;
    });
    if (!list.length) return;

    setUploading(true);
    try {
      const uploaded = [];
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "products");
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (data.success) {
          uploaded.push({ path: data.url, isPrimary: false });
        } else {
          toast.error(data.message ?? t("uploadError", { name: file.name }));
        }
      }
      if (uploaded.length) {
        const next = [...value, ...uploaded];
        if (!next.some((img) => img.isPrimary)) next[0].isPrimary = true;
        onChange(next);
      }
    } catch {
      toast.error(t("networkError"));
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
      <div className="flex flex-wrap gap-3">
        {value.map((img, i) => (
          <div
            key={img.path + i}
            draggable={value.length > 1}
            onDragStart={(e) => handleDragStart(e, i)}
            onDragEnter={() => handleDragEnter(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            className={`group relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border transition-all ${
              value.length > 1 ? "cursor-grab active:cursor-grabbing" : ""
            } ${
              dragIndex === i
                ? "scale-95 border-gray-200 opacity-40"
                : overIndex === i
                ? "scale-105 border-[#2f3a2e] shadow-lg"
                : "border-gray-200"
            }`}
          >
            <img src={img.path} alt="" draggable={false} className="h-full w-full select-none object-cover" />

            {value.length > 1 && (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-black/50 to-transparent pb-3 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
                <GripHorizontal size={14} className="text-white" />
              </div>
            )}

            <button
              type="button"
              onClick={() => setPrimary(i)}
              title={img.isPrimary ? t("isPrimary") : t("setPrimaryTitle")}
              className={`absolute left-1 top-1 flex h-7 w-7 items-center justify-center rounded-full shadow sm:h-5 sm:w-5 ${
                img.isPrimary ? "bg-amber-400 text-white" : "bg-white/90 text-gray-400 sm:opacity-0 sm:group-hover:opacity-100"
              } transition-opacity`}
            >
              <Star size={11} fill={img.isPrimary ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={t("removeLabel")}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow transition-opacity sm:h-5 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-24 w-24 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-[#2f3a2e] hover:text-[#2f3a2e] disabled:opacity-60"
        >
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
          <span className="text-[10px]">{t("addImages")}</span>
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

      {value.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          {t("noImages")}
        </p>
      ) : value.length > 1 ? (
        <p className="mt-2 text-xs text-gray-400">{t("dragToReorder")}</p>
      ) : null}
    </div>
  );
}
