"use client";

import { Camera, CameraOff, Loader2, Search } from "lucide-react";
import { CounterScanner } from "@/components/dashboard/boutique/counter/CounterScanner";

/**
 * The one field the counter scans or types into. Purely presentational —
 * CounterSurface owns the input value, whether the camera is open, and every
 * lookup call, so the code-lookup / name-search race-guard stays in one
 * place instead of being split across components.
 */
export function CounterOmniBar({ value, onChange, onSubmit, onDecoded, loading, scanning, onToggleScanning }) {
  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  function handleDecoded(decoded) {
    onToggleScanning(false);
    onDecoded(decoded);
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="counter-input" className="mb-2 block text-sm font-medium text-dark dark:text-white">
            Code, client ou service
          </label>
          <input
            id="counter-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="R-XXXXXXXXXX, Nom Prénom ou nom du service"
            autoComplete="off"
            className="w-full rounded-[7px] border border-stroke bg-transparent px-4 py-2.5 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Search className="h-4 w-4" strokeWidth={2} />}
          {loading ? "Recherche…" : "Rechercher"}
        </button>
        <button
          type="button"
          onClick={() => onToggleScanning(!scanning)}
          className="inline-flex items-center gap-2 rounded-[7px] border border-stroke px-5 py-2.5 text-sm font-semibold text-dark hover:border-primary hover:text-primary dark:border-dark-3 dark:text-white"
        >
          {scanning ? <CameraOff className="h-4 w-4" strokeWidth={2} /> : <Camera className="h-4 w-4" strokeWidth={2} />}
          {scanning ? "Arrêter" : "Scanner"}
        </button>
      </form>

      {scanning && <CounterScanner onDecoded={handleDecoded} onClose={() => onToggleScanning(false)} />}
    </>
  );
}
