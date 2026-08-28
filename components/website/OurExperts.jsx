"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { StarIcon, ArrowIcon } from "./icons";

const FALLBACK_STYLISTS = [
  {
    id: 1,
    name: "Sofia Bellamy",
    specialityKey: "expertSpecialtyHair",
    experience: 8,
    image: "/Images/expert.jpg",
  },
  {
    id: 2,
    name: "Yasmine El Amine",
    specialityKey: "expertSpecialtyFacial",
    experience: 6,
    image: "/Images/expert.jpg",
  },
  {
    id: 3,
    name: "Lisa Hadden",
    specialityKey: "expertSpecialtyNails",
    experience: 5,
    image: "/Images/expert.jpg",
  },
  {
    id: 4,
    name: "Maya Ertas",
    specialityKey: "expertSpecialtyMassage",
    experience: 7,
    image: "/Images/expert.jpg",
  },
  {
    id: 5,
    name: "Nour El Jane",
    specialityKey: "expertSpecialtyColor",
    experience: 4,
    image: "/Images/expert.jpg",
  },
];

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

function ChevronIcon({ direction = "right", className = "w-5 h-5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      {direction === "left" ? (
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export default function OurExperts() {
  const t = useTranslations("home");
  const [stylists, setStylists] = useState(FALLBACK_STYLISTS);
  const [isLoading, setIsLoading] = useState(true);
  const [headerRef, headerInView] = useInView();
  const [cardsRef, cardsInView] = useInView();
  const scrollRef = useRef(null);

  useEffect(() => {
    async function loadExperts() {
      try {
        const response = await fetch("/api/staff");
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setStylists(data);
        }
      } catch {
        // Keep the built-in fallback cards when the public API is unavailable.
      } finally {
        setIsLoading(false);
      }
    }
    loadExperts();
  }, []);

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -340, behavior: "smooth" });
  };

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 340, behavior: "smooth" });
  };

  return (
    <section className="relative w-full overflow-hidden bg-cream">
      {/* Subtle background detail */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 80px)",
        }}
      />

      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 sm:py-16 md:px-10 md:py-20 lg:px-14 lg:py-28">
        {/* Header row */}
        <div
          ref={headerRef}
          className={`mb-10 sm:mb-12 md:mb-14 flex flex-col gap-4 sm:gap-5 sm:flex-row sm:items-end sm:justify-between transition-all duration-700 ease-out ${
            headerInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div>
            {/* Eyebrow */}
            <div className="mb-3 sm:mb-5 inline-flex items-center gap-2 sm:gap-3">
              <span className="h-px w-6 sm:w-8 bg-gold" />
              <span className="text-[9px] sm:text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
                {t("expertsEyebrow")}
              </span>
            </div>

            <h2 className="text-[1.5rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[1.8rem] md:text-[2.2rem] lg:text-[2.6rem]">
              {t.rich("expertsTitle", {
                accent: (chunks) => <em className="font-light text-gold/80 not-italic">{chunks}</em>,
              })}
            </h2>

            <p className="mt-3 sm:mt-4 max-w-[420px] text-[13px] sm:text-[14px] md:text-[14.5px] leading-[1.7] sm:leading-[1.8] text-ink/55">
              {t("expertsBody")}
            </p>
          </div>

          {/* Navigation Arrows + View All */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* <a
              href="#experts"
              className="mr-4 hidden text-[13px] font-semibold uppercase tracking-[0.12em] text-gold transition-opacity duration-200 hover:opacity-70 sm:inline"
            >
              Voir l'équipe →
            </a> */}
            <button
              onClick={scrollLeft}
              aria-label={t("expertsLeft")}
              className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-gold/30 text-gold transition-all duration-200 hover:bg-gold hover:text-white hover:shadow-md hover:shadow-gold/20"
            >
              <ChevronIcon direction="left" className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <button
              onClick={scrollRight}
              aria-label={t("expertsRight")}
              className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-gold text-white shadow-md shadow-gold/30 transition-all duration-200 hover:bg-gold/90 hover:shadow-lg"
            >
              <ChevronIcon direction="right" className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>
        </div>

        {/* Cards scroll container */}
        <div
          ref={cardsRef}
          className={`relative transition-all duration-700 ease-out delay-200 ${
            cardsInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div
            ref={scrollRef}
            className="flex gap-3 sm:gap-4 md:gap-5 overflow-x-auto pb-3 sm:pb-4 scrollbar-hide snap-x snap-mandatory"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {(isLoading ? FALLBACK_STYLISTS : stylists).map((stylist, index) => (
              <ExpertCard key={stylist.id} stylist={stylist} delay={index * 80} t={t} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ExpertCard({ stylist, delay, t }) {
  return (
    <article
      className="group relative flex w-[200px] sm:w-[240px] md:w-[260px] shrink-0 snap-start flex-col overflow-hidden rounded-xl sm:rounded-2xl bg-white shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:shadow-gold/10"
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="absolute inset-x-0 bottom-0 h-[2px] sm:h-[3px] origin-left bg-gradient-to-r from-gold to-gold-soft transition-all duration-300 group-hover:h-[3px] sm:group-hover:h-[4px]" />
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-cream">
        <Image
          src={stylist.image}
          alt={stylist.name}
          fill
          sizes="(max-width: 640px) 200px, (max-width: 768px) 240px, 260px"
          unoptimized
          className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
      </div>
      <div className="flex flex-col gap-2 sm:gap-3 p-3 sm:p-5">
        <div>
          <h3 className="text-[14px] sm:text-[16px] font-bold leading-tight text-ink">
            {stylist.name}
          </h3>
          <p className="mt-0.5 sm:mt-1 text-[11px] sm:text-[12px] font-medium uppercase tracking-[0.12em] text-gold">
            {stylist.specialityKey ? t(stylist.specialityKey) : stylist.speciality}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[11px] sm:text-[12px] text-ink/45">
            {stylist.experience} {t("expertsYears")}
          </p>
        </div>
        {/* <button className="group/btn mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full border border-gold/30 py-2.5 text-[12px] font-semibold text-gold transition-all duration-200 hover:bg-gold hover:text-white hover:shadow-md hover:shadow-gold/20">
          {t("expertsProfile")}
          <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover/btn:translate-x-1" />
        </button> */}
      </div>
    </article>
  );
}
