"use client";

import { useState, useRef, useCallback } from "react";
import { X, Plus } from "lucide-react";

// Suggested languages shown as quick-add pills
const SUGGESTIONS = [
  "Français",
  "Arabe",
  "Anglais",
  "Espagnol",
  "Portugais",
  "Italien",
  "Allemand",
  "Russe",
  "Mandarin",
  "Japonais",
];

/**
 * Tag-input for free-text language entry.
 *
 * Controlled via value / onChange (array of strings).
 *
 * @param {{
 *   value: string[],
 *   onChange: (langs: string[]) => void,
 *   error?: string,
 *   id?: string,
 * }} props
 */
export function LanguageTagInput({ value = [], onChange, error, id = "languages" }) {
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef(null);

  const addLanguage = useCallback(
    (lang) => {
      const trimmed = lang.trim();
      if (!trimmed) return;
      // Case-insensitive dedupe
      const already = value.some(
        (l) => l.toLowerCase() === trimmed.toLowerCase()
      );
      if (already) {
        setInputVal("");
        return;
      }
      onChange([...value, trimmed]);
      setInputVal("");
    },
    [value, onChange]
  );

  const removeLanguage = useCallback(
    (lang) => {
      onChange(value.filter((l) => l !== lang));
    },
    [value, onChange]
  );

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addLanguage(inputVal);
    } else if (e.key === "Backspace" && !inputVal && value.length > 0) {
      removeLanguage(value[value.length - 1]);
    }
  }

  // Suggestions not yet selected
  const filteredSuggestions = SUGGESTIONS.filter(
    (s) => !value.some((l) => l.toLowerCase() === s.toLowerCase())
  );

  return (
    <div>
      {/* Tag container + input */}
      <div
        className={`flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors focus-within:ring-2 ${
          error
            ? "border-red-300 focus-within:border-red-400 focus-within:ring-red-100"
            : "border-gray-200 focus-within:border-indigo-400 focus-within:ring-indigo-100"
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((lang) => (
          <span
            key={lang}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
          >
            {lang}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeLanguage(lang);
              }}
              aria-label={`Supprimer ${lang}`}
              className="ml-0.5 rounded-full text-indigo-400 hover:text-indigo-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-500"
            >
              <X size={11} />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? "Tapez une langue et appuyez sur Entrée…" : ""}
          aria-label="Ajouter une langue"
          className="min-w-[140px] flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
        />

        {inputVal.trim() && (
          <button
            type="button"
            onClick={() => addLanguage(inputVal)}
            aria-label="Ajouter cette langue"
            className="flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Plus size={11} />
            Ajouter
          </button>
        )}
      </div>

      {/* Quick-add suggestions */}
      {filteredSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addLanguage(s)}
              className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
