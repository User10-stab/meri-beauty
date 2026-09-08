"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock, Euro, ArrowRight } from "lucide-react";
import { BotanicalBranch, BotanicalSprig, LeftBotanical } from "@/components/botanical-decorations";

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

export default function StaffServices({ services, staffId, firstName, categories }) {
  const [sectionRef, sectionInView] = useInView();
  const [activeCategory, setActiveCategory] = useState(null);

  if (!services || services.length === 0) {
    return null;
  }

  const allCategories = categories && categories.length > 0 ? categories : [];
  const filteredServices = activeCategory
    ? services.filter((ss) => ss.service.category?.name === activeCategory)
    : services;

  return (
    <section className="relative w-full overflow-hidden bg-gradient-to-b from-white to-[#fdf8f0] py-16 sm:py-20 md:py-24">
      {/* Decorative background elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Subtle diagonal lines pattern */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: "repeating-linear-gradient(45deg, #b89664 0px, #b89664 1px, transparent 1px, transparent 80px)",
          }}
        />
        
        {/* Top right botanical branch */}
        <BotanicalBranch className="absolute -top-12 -right-16 w-48 h-64 text-[#b89664]/10 transform rotate-12" />
        
        {/* Bottom left botanical sprig */}
        <BotanicalSprig className="absolute -bottom-20 -left-12 w-32 h-48 text-[#b89664]/8 transform -rotate-12" />
        
        {/* Left side botanical accent */}
        <LeftBotanical className="absolute top-1/3 -left-8 w-20 h-48 text-[#b89664]/8" />
        
        {/* Floating decorative circles */}
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full border border-[#b89664]/10" />
        <div className="absolute top-40 -left-16 h-48 w-48 rounded-full border border-[#b89664]/8" />
        <div className="absolute bottom-20 right-1/4 h-32 w-32 rounded-full bg-gradient-to-br from-[#b89664]/5 to-transparent blur-2xl" />
      </div>

      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 md:px-10 lg:px-14">
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
                  Prestations
                </span>
                <span className="h-px w-8 bg-[#b89664]" />
              </div>
              <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2.5rem]">
                Ses prestations
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#6f6a64] sm:text-base">
                D&eacute;couvrez ses services et r&eacute;servez votre moment beaut&eacute;
              </p>
            </div>
            <Link
              href="/nos-services"
              className="group inline-flex items-center gap-1.5 text-sm font-medium text-[#2F3A2E] transition-colors hover:text-[#b89664]"
            >
              Toutes les prestations
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </Link>
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
                Tous
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredServices.map((staffService) => {
              const service = staffService.service;
              const price = Number(staffService.price || 0);
              const duration = staffService.duration || 0;

              return (
                <article
                  key={staffService.id}
                  className="group flex flex-col rounded-2xl border border-[#ede5d8] bg-white p-6 transition-all duration-300 hover:shadow-[0_8px_28px_rgba(47,58,46,0.1)] hover:-translate-y-1 hover:border-[#b89664]/30"
                >
                  {/* Category badge */}
                  {service.category?.name && (
                    <span className="mb-3 self-start rounded-full bg-[#fdf8f0] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#b89664]">
                      {service.category.name}
                    </span>
                  )}

                  {/* Service name */}
                  <h3 className="font-display text-xl font-bold leading-tight tracking-tight text-[#2F3A2E] group-hover:text-[#b89664] transition-colors duration-300">
                    {service.name}
                  </h3>

                  {/* Description */}
                  {service.description && (
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-[#6f6a64] line-clamp-3">
                      {service.description}
                    </p>
                  )}

                  {/* Duration & Price */}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-sm text-[#6f6a64]">
                      <Clock size={16} className="text-[#b89664]" />
                      {formatDuration(duration)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-lg font-bold text-[#2F3A2E]">
                      <Euro size={16} className="text-[#b89664]" />
                      {formatPrice(price)}
                    </span>
                  </div>

                  {/* CTA */}
                  <div className="mt-6">
                    <Link
                      href={`/reservation?staff=${staffId}&service=${service.id}`}
                      className="group/btn flex w-full items-center justify-between gap-2 rounded-full bg-gradient-to-r from-[#2F3A2E] to-[#1a2419] px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-lg hover:from-[#212a20] hover:to-[#151c14] hover:-translate-y-0.5"
                    >
                      Réserver
                      <ArrowRight size={16} className="transition-transform group-hover/btn:translate-x-1" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
