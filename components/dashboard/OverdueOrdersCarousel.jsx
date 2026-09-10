"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

const CARD_WIDTH_PX = 272; // w-64 (256px) + gap-4 (16px)

export function OverdueOrdersCarousel({ orders }) {
  const trackRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const el = trackRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateScrollState();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [orders]);

  function scrollByCards(direction) {
    trackRef.current?.scrollBy({ left: direction * CARD_WIDTH_PX * 2, behavior: "smooth" });
  }

  return (
    <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-dark dark:text-white">Commandes nécessitant une attention</h2>
        {orders.length > 0 && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => scrollByCards(-1)}
              disabled={!canScrollLeft}
              aria-label="Voir les commandes précédentes"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-stroke text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => scrollByCards(1)}
              disabled={!canScrollRight}
              aria-label="Voir les commandes suivantes"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-stroke text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune commande en attente.</p>
      ) : (
        <div
          ref={trackRef}
          className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-1"
        >
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/boutique/orders/${o.id}`}
              className="flex w-64 shrink-0 snap-start flex-col gap-2 rounded-lg border border-stroke p-4 transition-colors hover:border-[#2f3a2e] dark:border-dark-3 dark:hover:border-white"
            >
              <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                <AlertTriangle size={12} />
                {o.reasonLabel}
              </span>
              <p className="truncate text-sm font-medium text-dark dark:text-white">
                Commande n°{o.orderNumber} — {o.customerName}
              </p>
              <p className="text-xs text-gray-400">Depuis le {o.sinceDateLabel}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
