"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Users } from "lucide-react";
import { formatAvailableDays } from "@/lib/week-days";

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatPrice(val) {
  if (val == null) return "—";
  return `€${Number(val).toFixed(2)}`;
}

function formatDuration(val) {
  if (val == null) return "—";
  const n = Number(val);
  if (n >= 60) {
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  return `${n} min`;
}

function formatMargin(val) {
  if (val == null) return "—";
  return `${Number(val)} min`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
        {children}
      </h4>
      <div className="flex-1 border-t border-gray-100" />
    </div>
  );
}

/**
 * Renders the per-staff table.
 */
function StaffTable({ staffServices }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-100">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
              Professionnel
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
              Prix
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
              Durée
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
              Marge
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
              Jours
            </th>
          </tr>
        </thead>
        <tbody>
          {staffServices.map((ss, i) => {
            const name = ss.staff?.user?.fullName ?? "—";
            const initials = name !== "—" ? name.slice(0, 2).toUpperCase() : "?";
            const photoUrl = ss.photo ?? null;
            const isLast = i === staffServices.length - 1;

            return (
              <tr
                key={ss.id}
                className={`transition-colors hover:bg-gray-50/70 ${!isLast ? "border-b border-gray-100" : ""}`}
              >
                {/* Staff identity */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={name}
                        className="h-7 w-7 flex-shrink-0 rounded-full object-cover border border-gray-200"
                      />
                    ) : (
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 uppercase select-none">
                        {initials}
                      </div>
                    )}
                    <span className="font-medium text-gray-800 leading-tight">{name}</span>
                  </div>
                </td>

                {/* Price */}
                <td className="px-4 py-3 text-right font-medium text-gray-800">
                  {formatPrice(ss.price)}
                </td>

                {/* Duration */}
                <td className="px-4 py-3 text-right text-gray-600">
                  {formatDuration(ss.duration)}
                </td>

                {/* Margin */}
                <td className="px-4 py-3 text-right text-gray-600">
                  {formatMargin(ss.margin)}
                </td>

                {/* Available days — empty means no restriction */}
                <td className="px-4 py-3 text-right text-gray-500 text-xs">
                  {formatAvailableDays(ss.availableDays)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

/**
 * @param {{ service: object|null, onClose: () => void }} props
 */
export function ServiceDetailsDrawer({ service, onClose }) {
  const closeBtnRef = useRef(null);

  // Auto-focus close button
  useEffect(() => {
    if (service) {
      const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [service]);

  // Close on Escape
  useEffect(() => {
    if (!service) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [service, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (service) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [service]);

  if (!service) return null;

  const staffServices = service.staffServices ?? [];
  const hasStaff = staffServices.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar */}
            {staffServices[0]?.photo ? (
              <img
                src={staffServices[0].photo}
                alt={service.name}
                className="h-9 w-9 flex-shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-700 uppercase select-none">
                {service.name.slice(0, 2)}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 leading-tight truncate">
                {service.name}
              </h2>
              {service.category?.name && (
                <span className="text-xs text-gray-400">{service.category.name}</span>
              )}
            </div>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Description */}
          {service.description && (
            <div>
              <SectionTitle>Description</SectionTitle>
              <p className="text-sm text-gray-600 leading-relaxed">{service.description}</p>
            </div>
          )}

          {/* Overall summary row */}
          <div>
            <SectionTitle>Résumé</SectionTitle>
            <div className="grid grid-cols-3 divide-x divide-gray-100 rounded-lg border border-gray-100 bg-gray-50">
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400 mb-0.5">Prix</p>
                <p className="text-sm font-semibold text-gray-800">{service.priceRange ?? "—"}</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400 mb-0.5">Durée</p>
                <p className="text-sm font-semibold text-gray-800">{service.durationRange ?? "—"}</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400 mb-0.5">Marge</p>
                <p className="text-sm font-semibold text-gray-800">{service.marginRange ?? "—"}</p>
              </div>
            </div>
          </div>

          {/* Per-staff breakdown */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                Professionnels assignés
              </h4>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                {staffServices.length}
              </span>
              <div className="flex-1 border-t border-gray-100" />
            </div>

            {hasStaff ? (
              <StaffTable staffServices={staffServices} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-200 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                  <Users size={18} className="text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Aucun professionnel assigné</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Modifiez le service pour ajouter des professionnels.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center justify-end border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
