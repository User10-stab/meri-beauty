"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { X, Loader2, Check } from "lucide-react";
import { createCategory } from "@/actions/services/create-service";
import { toast } from "sonner";

/**
 * Inline category creation mini-form.
 * Shown directly below a category selector when the user clicks "+".
 * Creates a category and immediately calls `onCreated` with the new category object.
 *
 * @param {{
 *   onCreated: (category: { id: string, name: string }) => void,
 *   onCancel: () => void,
 * }} props
 */
export function InlineCategoryCreate({ onCreated, onCancel }) {
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    startTransition(async () => {
      const res = await createCategory({ name });
      if (res.success) {
        toast.success(res.message);
        onCreated(res.category);
      } else {
        setError(res.errors?.name ?? res.message);
      }
    });
  }

  return (
    <div className="mt-1.5 flex items-start gap-1.5">
      <div className="flex-1">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleSubmit(e); }
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Nom de la catégorie *"
          className={`h-7 w-full rounded-md border px-2.5 text-xs text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-1 ${
            error
              ? "border-red-300 focus:ring-red-100"
              : "border-indigo-300 focus:border-indigo-400 focus:ring-indigo-100"
          }`}
        />
        {error && (
          <p className="mt-0.5 text-[10px] text-red-600">{error}</p>
        )}
      </div>

      {/* Confirm */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending || !name.trim()}
        title="Confirmer"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <Check size={11} />
        )}
      </button>

      {/* Cancel */}
      <button
        type="button"
        onClick={onCancel}
        title="Annuler"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
      >
        <X size={11} />
      </button>
    </div>
  );
}