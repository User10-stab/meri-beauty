"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowIcon } from "./icons";

const FALLBACK_STYLISTS = [
  {
    id: 1,
    name: "Lyly",
    speciality: "Prothésiste ongulaire",
    specialityKey: null,
    experience: 5,
    image: "/Images/expert.jpg",
  },
  {
    id: 2,
    name: "Aurélie",
    speciality: "Experte en soins naturels",
    specialityKey: null,
    experience: 6,
    image: "/Images/expert.jpg",
  },
  {
    id: 3,
    name: "Marie",
    speciality: "Fondatrice & coordination",
    specialityKey: null,
    experience: 8,
    image: "/Images/expert.jpg",
  },
  {
    id: 4,
    name: "Sofia Bellamy",
    specialityKey: "expertSpecialtyHair",
    experience: 8,
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      {direction === "left" ? (
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/* ── Botanical sprigs for card bottom-right (thin gold line art) ── */
function SprigOne({ className = "w-14 h-20" }) {
  return (
    <svg viewBox="0 0 60 80" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M30 76 C 30 60, 31 44, 34 28 C 36 18, 38 10, 40 4" />
        <path d="M34 28 C 30 24, 26 20, 22 14 C 26 12, 30 16, 34 28" />
        <path d="M33 36 C 29 32, 25 28, 21 22 C 25 20, 29 24, 33 36" />
        <path d="M32 44 C 28 40, 24 36, 20 30 C 24 28, 28 32, 32 44" />
        <path d="M31 52 C 27 48, 23 44, 19 38 C 23 36, 27 40, 31 52" />
        <path d="M30 60 C 26 56, 22 52, 18 46 C 22 44, 26 48, 30 60" />
        <path d="M35 30 C 39 26, 43 22, 47 16 C 43 14, 39 18, 35 30" />
        <path d="M34 38 C 38 34, 42 30, 46 24 C 42 22, 38 26, 34 38" />
        <path d="M33 46 C 37 42, 41 38, 45 32 C 41 30, 37 34, 33 46" />
        <path d="M40 4 C 38 1, 35 0, 32 0 C 34 3, 37 4, 40 4" />
        <path d="M40 4 C 43 1, 46 0, 49 0 C 47 3, 43 4, 40 4" />
      </g>
    </svg>
  );
}
function SprigTwo({ className = "w-14 h-20" }) {
  return (
    <svg viewBox="0 0 60 80" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M28 76 C 29 60, 30 44, 32 28 C 33 18, 34 10, 35 4" />
        {/* small flower clusters */}
        <circle cx="22" cy="18" r="1.6" strokeWidth="0.7" />
        <circle cx="18" cy="22" r="1.3" strokeWidth="0.7" />
        <circle cx="26" cy="22" r="1.3" strokeWidth="0.7" />
        <circle cx="20" cy="30" r="1.5" strokeWidth="0.7" />
        <circle cx="26" cy="32" r="1.2" strokeWidth="0.7" />
        <path d="M32 28 C 28 24, 24 20, 20 14 C 24 12, 28 16, 32 28" />
        <path d="M31 36 C 27 32, 23 28, 18 22 C 22 20, 26 24, 31 36" />
        <path d="M30 44 C 26 40, 22 36, 17 30 C 21 28, 25 32, 30 44" />
        <path d="M29 54 C 25 50, 21 46, 16 40 C 20 38, 24 42, 29 54" />
        <path d="M32 30 C 36 26, 40 22, 44 16 C 40 14, 36 18, 32 30" />
        <path d="M31 38 C 35 34, 39 30, 43 24 C 39 22, 35 26, 31 38" />
      </g>
    </svg>
  );
}
function SprigThree({ className = "w-14 h-20" }) {
  return (
    <svg viewBox="0 0 60 80" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M32 76 C 31 60, 30 44, 29 28 C 28 18, 27 10, 26 4" />
        <path d="M29 28 C 33 24, 37 20, 41 14 C 37 12, 33 16, 29 28" />
        <path d="M30 36 C 34 32, 38 28, 42 22 C 38 20, 34 24, 30 36" />
        <path d="M30 44 C 34 40, 38 36, 42 30 C 38 28, 34 32, 30 44" />
        <path d="M31 52 C 35 48, 39 44, 43 38 C 39 36, 35 40, 31 52" />
        <path d="M32 60 C 36 56, 40 52, 44 46 C 40 44, 36 48, 32 60" />
        <path d="M28 30 C 24 26, 20 22, 16 16 C 20 14, 24 18, 28 30" />
        <path d="M29 38 C 25 34, 21 30, 17 24 C 21 22, 25 26, 29 38" />
        <path d="M26 4 C 28 1, 31 0, 34 0 C 32 3, 29 4, 26 4" />
        <path d="M26 4 C 23 1, 20 0, 17 0 C 19 3, 22 4, 26 4" />
      </g>
    </svg>
  );
}
const SPRIGS = [SprigOne, SprigTwo, SprigThree];

export default function OurExperts() {
  const t = useTranslations("home");
  const [stylists, setStylists] = useState(FALLBACK_STYLISTS);
  const [isLoading, setIsLoading] = useState(true);
  const [headerRef, headerInView] = useInView();
  const [cardsRef, cardsInView] = useInView();
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

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
        // Keep fallback
      } finally {
        setIsLoading(false);
      }
    }
    loadExperts();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const cardWidth = el.firstElementChild ? el.firstElementChild.getBoundingClientRect().width + 20 : 340;
      const idx = Math.round(el.scrollLeft / cardWidth);
      const max = Math.max(0, stylists.length - 3);
      setActiveIndex(Math.min(Math.max(idx, 0), max));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [stylists.length]);

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -360, behavior: "smooth" });
  };
  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 360, behavior: "smooth" });
  };

  const list = isLoading ? FALLBACK_STYLISTS : stylists;
  const dotCount = Math.max(1, Math.min(list.length, 4));

  return (
    <section id="equipe" className="relative w-full overflow-hidden bg-[#fdf8f0]">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-16 md:px-10 md:py-20 lg:px-14 lg:py-24">
        {/* Header row */}
        <div
          ref={headerRef}
          className={`mb-8 sm:mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between transition-all duration-700 ease-out ${headerInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          <div>
            <div className="mb-3 inline-flex items-center gap-2 sm:gap-3">
              <span className="h-px w-6 sm:w-8 bg-gold" />
              <span className="text-[9px] sm:text-[10.5px] font-semibold uppercase tracking-[0.2em] text-gold">
                {t("expertsSubtitle")}
              </span>
            </div>
            <h2 className="font-display text-[1.7rem] font-semibold leading-[1.1] tracking-tight text-primary sm:text-[2rem] md:text-[2.4rem]">
              {t("expertsTitle")}
            </h2>
            <p className="mt-3 max-w-[520px] text-[13px] leading-[1.7] text-primary/55 sm:text-[14px]">
              {t("expertsBody")}
            </p>
          </div>

          <div className="hidden items-center gap-3 sm:flex">
            <button
              onClick={scrollLeft}
              aria-label={t("expertsLeft")}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/30 text-gold transition-all duration-200 hover:bg-gold hover:text-white"
            >
              <ChevronIcon direction="left" className="h-4 w-4" />
            </button>
            <button
              onClick={scrollRight}
              aria-label={t("expertsRight")}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gold text-white shadow-sm transition-all duration-200 hover:bg-gold/90"
            >
              <ChevronIcon direction="right" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Cards */}
        <div
          ref={cardsRef}
          className={`relative transition-all duration-700 ease-out delay-150 ${cardsInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          <div
            ref={scrollRef}
            className="flex gap-5 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {list.map((stylist, index) => (
              <ExpertCard key={stylist.id ?? index} stylist={stylist} index={index} t={t} />
            ))}
          </div>

          {/* Dots */}
          <div className="mt-6 flex items-center justify-center gap-2">
            {Array.from({ length: dotCount }).map((_, i) => (
              <button
                key={i}
                aria-label={`${t("reviewsSlide")} ${i + 1}`}
                onClick={() => {
                  const el = scrollRef.current;
                  if (!el || !el.firstElementChild) return;
                  const w = el.firstElementChild.getBoundingClientRect().width + 20;
                  el.scrollTo({ left: i * w, behavior: "smooth" });
                }}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === activeIndex ? "w-2 bg-[#b89664]" : "w-1.5 bg-[#e8ddd0]"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ExpertCard({ stylist, index, t }) {
  const firstName = stylist.name.split(" ")[0];
  const role = stylist.specialityKey ? t(stylist.specialityKey) : stylist.speciality || "";
  const Sprig = SPRIGS[index % SPRIGS.length];
  // Decor images for first & third fallback to match screenshot vibe when portrait missing
  const isDecorCard = index === 0 || index === 2;
  // Use a warm decor fallback for those two if image is generic expert.jpg
  const imageSrc = stylist.image || "/Images/expert.jpg";

  return (
    <article className="group relative flex w-[88%] sm:w-[340px] md:w-[360px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-[#ede5d8] bg-white shadow-[0_2px_18px_rgba(47,58,46,0.07)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(47,58,46,0.12)]">
      <div className="relative aspect-[1.45/1] w-full overflow-hidden bg-[#f5ece0]">
        <Image
          src={imageSrc}
          alt={stylist.name}
          fill
          sizes="(max-width: 640px) 88vw, 360px"
          unoptimized
          className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] ${isDecorCard ? "object-center" : "object-top"}`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent opacity-60" />
      </div>

      <div className="relative flex flex-1 flex-col px-6 pb-5 pt-5">
        {/* botanical sprig on the right */}
        <div className="pointer-events-none absolute bottom-2 right-3 text-[#c9b99a]/70">
          <Sprig className="h-[76px] w-[52px]" />
        </div>

        <h3 className="font-display text-[17px] font-semibold leading-none tracking-tight text-primary">
          {stylist.name}
        </h3>
        <p className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#b89664]">
          {role}
        </p>

        <div className="mt-4">
          <Link
            href="#"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#d9c9a8] px-4 py-[7px] text-[11.5px] font-medium text-[#8c6f3a] transition-all duration-200 hover:border-[#b89664] hover:bg-[#b89664] hover:text-white"
          >
            {t("expertsDiscover", { name: firstName })}
            <ArrowIcon className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </article>
  );
}
