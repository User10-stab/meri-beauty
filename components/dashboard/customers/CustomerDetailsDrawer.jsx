"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, ShoppingBag } from "lucide-react";
import { getCustomerDetail } from "@/actions/customers/get-customer-detail";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Brussels" });
}

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
 * @param {{ customerId: string|null, onClose: () => void }} props
 */
export function CustomerDetailsDrawer({ customerId, onClose }) {
  const closeBtnRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!customerId) {
      setDetail(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    getCustomerDetail(customerId).then((result) => {
      if (result.success) setDetail(result.data);
      else setError(result.message);
      setIsLoading(false);
    });
  }, [customerId]);

  useEffect(() => {
    if (customerId) {
      const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [customerId]);

  useEffect(() => {
    if (!customerId) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [customerId, onClose]);

  useEffect(() => {
    if (customerId) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [customerId]);

  if (!customerId) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 uppercase select-none">
              {detail?.fullName?.slice(0, 2) ?? "?"}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 leading-tight truncate">
                {detail?.fullName ?? "Chargement..."}
              </h2>
              {detail?.email && <span className="text-xs text-gray-400">{detail.email}</span>}
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

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isLoading && <p className="text-sm text-gray-500">Chargement...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {detail && (
            <>
              <div>
                <SectionTitle>Résumé</SectionTitle>
                <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 rounded-lg border border-gray-100 bg-gray-50 sm:grid-cols-4 sm:divide-y-0">
                  <div className="px-5 py-3 text-center">
                    <p className="text-xs text-gray-400 mb-0.5">Téléphone</p>
                    <p className="text-sm font-semibold text-gray-800">{detail.phone || "—"}</p>
                  </div>
                  <div className="px-5 py-3 text-center">
                    <p className="text-xs text-gray-400 mb-0.5">Rendez-vous</p>
                    <p className="text-sm font-semibold text-gray-800">{detail.appointmentsCount}</p>
                  </div>
                  <div className="px-5 py-3 text-center">
                    <p className="text-xs text-gray-400 mb-0.5">Formations</p>
                    <p className="text-sm font-semibold text-gray-800">{detail.formationsCount ?? 0}</p>
                  </div>
                  <div className="px-5 py-3 text-center">
                    <p className="text-xs text-gray-400 mb-0.5">Inscrit le</p>
                    <p className="text-sm font-semibold text-gray-800">{formatDate(detail.joinedAt)}</p>
                  </div>
                </div>
              </div>

              {detail.recentFormations?.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Calendar size={14} className="text-gray-400" />
                    <h4 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Dernières formations
                    </h4>
                    <div className="flex-1 border-t border-gray-100" />
                  </div>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {detail.recentFormations.map((formation) => (
                      <li key={formation.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-700">{formation.title}</span>
                        <span className="text-gray-400">{formatDate(formation.date)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Calendar size={14} className="text-gray-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    Derniers rendez-vous
                  </h4>
                  <div className="flex-1 border-t border-gray-100" />
                </div>
                {detail.recentAppointments.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucun rendez-vous.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {detail.recentAppointments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-700">{a.serviceName}</span>
                        <span className="text-gray-400">{formatDate(a.date)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {detail.recentOrders.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <ShoppingBag size={14} className="text-gray-400" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Dernières commandes
                    </h4>
                    <div className="flex-1 border-t border-gray-100" />
                  </div>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {detail.recentOrders.map((o) => (
                      <li key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="text-gray-700">Commande n°{o.orderNumber}</span>
                        <span className="text-gray-500">€{o.totalAmount.toFixed(2)}</span>
                        <span className="text-gray-400">{formatDate(o.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

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
