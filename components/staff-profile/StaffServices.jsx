"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Euro, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import QuickBookingModal from "@/components/reservation/QuickBookingModal";

function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
}

function formatDuration(minutes) {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}` : `${h}h`;
}

function formatPrice(price) {
  if (!price) return "0 \u20ac";
  const num = Number(price);
  return num % 1 === 0 ? `${num} \u20ac` : `${num.toFixed(2)} \u20ac`;
}

export default function StaffServices({ services, staffId, categories, staffName, customerSession = null }) {
  const [sectionRef, sectionInView] = useInView();
  const searchParams = useSearchParams();
  const [quickBooking, setQuickBooking] = useState(null);
  const t = useTranslations("staffProfile");

  // Pre-select the category coming from the ?category= query param (set by
  // the reservation page when the user clicks a staff member from a category).
  // Validate that it actually exists in this staff member's category list so
  // we never show an empty filtered view.
  const allCategories = categories && categories.length > 0 ? categories : [];
  const paramCategory = searchParams.get("category");
  const initialCategory =
    paramCategory && allCategories.includes(paramCategory) ? paramCategory : null;
  const [activeCategory, setActiveCategory] = useState(initialCategory);

  if (!services || services.length === 0) {
    return null;
  }

  const filteredServices = activeCategory
    ? services.filter((ss) => ss.service.category?.name === activeCategory)
    : services;

  return (
    <section className="relative">
      <div>
        <div
          ref={sectionRef}
          className={`transition-all duration-700 ease-out ${
            sectionInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2">
                <span className="h-px w-8 bg-[#b89664]" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b89664]">
                  {t("servicesEyebrow")}
                </span>
                <span className="h-px w-8 bg-[#b89664]" />
              </div>
              <h2 className="font-display text-[1rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2rem]">
                {t("services")}
              </h2>
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-[#6f6a64] sm:text-[14px]">
                {t("servicesSubtitle")}
              </p>
            </div>
            {/* <Link
              href="/nos-services"
              className="group inline-flex items-center gap-1.5 text-sm font-medium text-[#2F3A2E] transition-colors hover:text-[#b89664]"
            >
              Toutes les prestations
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </Link> */}
          </div>

          {/* Category filter pills */}
          {allCategories.length > 0 && (
            <div className="mb-8 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveCategory(null)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition-all duration-200 ${
                  activeCategory === null
                    ? "border-[#2F3A2E] bg-[#2F3A2E] text-white"
                    : "border-[#ede5d8] bg-white text-[#6f6a64] hover:border-[#d9c9a8] hover:text-[#2F3A2E]"
                }`}
              >
                {t("all")}
              </button>
              {allCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition-all duration-200 ${
                    activeCategory === cat
                      ? "border-[#2F3A2E] bg-[#2F3A2E] text-white"
                      : "border-[#ede5d8] bg-white text-[#6f6a64] hover:border-[#d9c9a8] hover:text-[#2F3A2E]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Services Grid */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {filteredServices.map((staffService) => {
              const service = staffService.service;
              const price = Number(staffService.price || 0);
              const duration = staffService.duration || 0;

              return (
                <article
                  key={staffService.id}
                  className="group flex flex-col justify-between rounded-2xl border border-[#ede5d8] bg-white p-6 transition-all duration-300 hover:shadow-[0_8px_28px_rgba(47,58,46,0.1)] hover:-translate-y-1 hover:border-[#b89664]/30"
                >
                 <div>
                   {/* Category badge */}
                  {service.category?.name && (
                    <span className="mb-3 self-start rounded-full bg-[#fdf8f0] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#b89664]">
                      {service.category.name}
                    </span>
                  )}

                  {/* Service name */}
                  <h3 className="font-display mt-3 text-[21px] font-bold leading-tight tracking-tight text-[#2F3A2E] group-hover:text-[#b89664] transition-colors duration-300">
                    {service.name}
                  </h3>

                  {/* Description */}
                  {service.description && (
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-[#6f6a64] line-clamp-3">
                      {service.description}
                    </p>
                  )}
                 </div>

                 <div>
                   {/* Duration & Price */}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-sm text-[#6f6a64] bg-[#fdf8f0] rounded-full px-3 py-2">
                      <Clock size={16} className="text-[#b89664]" />
                      {formatDuration(duration)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[16px] font-bold text-[#2F3A2E] bg-[#fdf8f0] rounded-full px-3 py-2 ">
                      <Euro size={16} className="text-[#b89664]" />
                      {formatPrice(price)}
                    </span>
                  </div>

                  {/* CTA */}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setQuickBooking({ serviceId: service.id, serviceName: service.name })}
                      className="group/btn flex w-full items-center justify-between gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-lg hover:from-[#212a20] hover:to-[#151c14] hover:-translate-y-0.5"
                    >
                      {t("book")}
                      <ArrowRight size={16} className="transition-transform group-hover/btn:translate-x-1" />
                    </button>
                  </div>
                 </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      {quickBooking && (
        <QuickBookingModal
          open={Boolean(quickBooking)}
          onClose={() => setQuickBooking(null)}
          staffId={staffId}
          serviceId={quickBooking.serviceId}
          serviceName={quickBooking.serviceName}
          staffName={staffName}
          customerSession={customerSession}
        />
      )}
    </section>
  );
}
