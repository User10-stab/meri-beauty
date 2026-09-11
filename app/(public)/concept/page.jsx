"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// ─── Metadata is handled via a separate metadata export pattern.
// Since this is a client component (for scroll/intersection animations),
// metadata is defined in a sibling layout or via generateMetadata in a wrapper.
// The page exports default only.

// ─────────────────────────────────────────────────────────────
// Utility: intersection-observer fade-in hook
// ─────────────────────────────────────────────────────────────
function useInView(options = {}) {
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
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px", ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

// ─────────────────────────────────────────────────────────────
// Decorative SVGs
// ─────────────────────────────────────────────────────────────

/** Thin botanical branch — used as a light cream/gold accent */
function BotanicalBranch({ className = "" }) {
  return (
    <svg
      viewBox="0 0 120 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      className={className}
      aria-hidden="true"
    >
      <path d="M60 195 C60 195 58 160 60 120 C62 80 60 40 60 10" strokeLinecap="round" />
      <path d="M60 150 C60 150 40 138 28 125" strokeLinecap="round" />
      <path d="M60 130 C60 130 80 118 92 105" strokeLinecap="round" />
      <path d="M60 108 C60 108 42 96 32 82" strokeLinecap="round" />
      <path d="M60 85 C60 85 76 74 86 60" strokeLinecap="round" />
      <path d="M60 62 C60 62 45 52 36 40" strokeLinecap="round" />
      {/* small leaves */}
      <path d="M28 125 C24 118 20 112 26 108 C32 104 34 114 28 125Z" fill="currentColor" opacity="0.4" />
      <path d="M92 105 C96 98 100 92 94 88 C88 84 86 94 92 105Z" fill="currentColor" opacity="0.4" />
      <path d="M32 82 C28 75 24 69 30 65 C36 61 38 71 32 82Z" fill="currentColor" opacity="0.4" />
      <path d="M86 60 C90 53 94 47 88 43 C82 39 80 49 86 60Z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

/** Tiny sprig / dried flower cluster */
function BotanicalSprig({ className = "" }) {
  return (
    <svg
      viewBox="0 0 80 130"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      className={className}
      aria-hidden="true"
    >
      <path d="M40 125 C40 125 39 90 40 60 C41 30 40 10 40 5" strokeLinecap="round" />
      <path d="M40 90 C35 84 28 78 20 72" strokeLinecap="round" />
      <path d="M40 72 C45 66 52 60 60 54" strokeLinecap="round" />
      <path d="M40 54 C35 48 28 42 22 36" strokeLinecap="round" />
      <path d="M20 72 C16 67 15 62 19 59 C23 56 25 63 20 72Z" fill="currentColor" opacity="0.5" />
      <path d="M60 54 C64 49 65 44 61 41 C57 38 55 45 60 54Z" fill="currentColor" opacity="0.5" />
      <path d="M22 36 C18 31 17 26 21 23 C25 20 27 27 22 36Z" fill="currentColor" opacity="0.5" />
      {/* tiny top bud */}
      <ellipse cx="40" cy="8" rx="3" ry="5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
function Botanical({ className = "" }) {
  return (
    <svg
      viewBox="0 0 220 560"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* =====================================================
            MAIN STEM
        ====================================================== */}

        <path
          d="
            M 218 548
            C 193 520, 174 488, 158 451
            C 142 414, 128 376, 119 337
            C 110 297, 105 258, 108 220
            C 111 181, 122 143, 139 108
            C 146 93, 153 79, 159 63
          "
        />

        {/* =====================================================
            SECONDARY STEMS
        ====================================================== */}

        {/* Upper left */}
        <path d="M 117 300 C 94 286, 76 265, 66 238" />

        {/* Upper right */}
        <path d="M 109 256 C 132 240, 149 219, 158 193" />

        {/* Middle left */}
        <path d="M 112 223 C 88 210, 70 190, 60 165" />

        {/* Middle right */}
        <path d="M 116 195 C 138 179, 153 158, 159 134" />

        {/* Lower left */}
        <path d="M 128 374 C 101 365, 76 353, 52 335" />

        {/* Lower right */}
        <path d="M 143 416 C 163 401, 181 383, 193 361" />

        {/* Bottom left */}
        <path d="M 160 452 C 136 449, 112 450, 88 459" />

        {/* =====================================================
            LEAF 01 — TOP
        ====================================================== */}

        <path
          d="
            M 159 64
            C 146 52, 143 36, 150 20
            C 165 29, 169 45, 159 64 Z
          "
        />

        <path d="M 158 61 C 156 46, 154 32, 151 21" />

        {/* =====================================================
            LEAF 02 — UPPER LEFT
        ====================================================== */}

        <path
          d="
            M 140 106
            C 123 99, 112 85, 112 69
            C 128 74, 139 88, 140 106 Z
          "
        />

        <path d="M 114 72 C 124 82, 132 94, 140 106" />

        {/* =====================================================
            LEAF 03 — UPPER RIGHT
        ====================================================== */}

        <path
          d="
            M 144 116
            C 151 98, 165 87, 181 85
            C 178 101, 164 113, 144 116 Z
          "
        />

        <path d="M 179 87 C 166 97, 155 107, 144 116" />

        {/* =====================================================
            LEAF 04 — LEFT UPPER / LARGE
        ====================================================== */}

        <path
          d="
            M 119 180
            C 99 169, 84 151, 80 130
            C 101 135, 116 152, 119 180 Z
          "
        />

        <path d="M 82 133 C 95 146, 107 162, 119 180" />

        {/* =====================================================
            LEAF 05 — RIGHT UPPER / LARGE
        ====================================================== */}

        <path
          d="
            M 151 196
            C 163 177, 178 163, 196 160
            C 193 180, 176 194, 151 196 Z
          "
        />

        <path d="M 193 163 C 178 174, 164 185, 151 196" />

        {/* =====================================================
            LEAF 06 — LEFT MIDDLE
        ====================================================== */}

        <path
          d="
            M 109 258
            C 88 250, 72 234, 66 214
            C 87 217, 103 233, 109 258 Z
          "
        />

        <path d="M 68 216 C 82 229, 96 243, 109 258" />

        {/* =====================================================
            LEAF 07 — RIGHT MIDDLE
        ====================================================== */}

        <path
          d="
            M 110 268
            C 126 250, 143 238, 162 235
            C 157 254, 139 267, 110 268 Z
          "
        />

        <path d="M 159 238 C 143 248, 127 258, 110 268" />

        {/* =====================================================
            LEAF 08 — LEFT LOWER
        ====================================================== */}

        <path
          d="
            M 76 353
            C 56 348, 41 336, 32 318
            C 52 318, 69 331, 76 353 Z
          "
        />

        <path d="M 35 321 C 49 331, 62 343, 76 353" />

        {/* =====================================================
            LEAF 09 — LEFT LOWER-MIDDLE
        ====================================================== */}

        <path
          d="
            M 96 371
            C 76 368, 61 358, 52 342
            C 72 342, 89 352, 96 371 Z
          "
        />

        <path d="M 55 345 C 69 354, 83 363, 96 371" />

        {/* =====================================================
            LEAF 10 — RIGHT LOWER
        ====================================================== */}

        <path
          d="
            M 145 415
            C 158 395, 174 383, 192 381
            C 188 400, 171 413, 145 415 Z
          "
        />

        <path d="M 189 384 C 174 394, 158 405, 145 415" />

        {/* =====================================================
            LEAF 11 — FAR RIGHT LOWER
        ====================================================== */}

        <path
          d="
            M 169 452
            C 180 433, 195 421, 213 419
            C 210 438, 194 451, 169 452 Z
          "
        />

        <path d="M 210 422 C 196 432, 182 443, 169 452" />

        {/* =====================================================
            LEAF 12 — BOTTOM LEFT
        ====================================================== */}

        <path
          d="
            M 89 459
            C 77 443, 77 427, 86 413
            C 98 425, 100 442, 89 459 Z
          "
        />

        <path d="M 88 456 C 88 442, 87 427, 86 414" />

        {/* =====================================================
            SMALL FLOWER / BUD CLUSTERS
            Kept subtle so leaves remain the dominant element.
        ====================================================== */}

        <path d="M 68 335 C 65 319, 67 307, 76 296" />

        <path
          d="
            M 76 300
            C 69 298, 66 293, 69 288
            C 74 289, 78 294, 76 300 Z
          "
        />

        <path
          d="
            M 77 301
            C 79 294, 84 291, 88 294
            C 88 299, 83 302, 77 301 Z
          "
        />

        <path
          d="
            M 75 310
            C 68 308, 65 303, 68 299
            C 73 300, 76 305, 75 310 Z
          "
        />

        {/* Second subtle flower cluster */}

        <path d="M 158 383 C 159 369, 165 358, 174 350" />

        <path
          d="
            M 173 354
            C 167 351, 165 346, 168 342
            C 173 343, 176 348, 173 354 Z
          "
        />

        <path
          d="
            M 174 354
            C 177 348, 182 346, 185 350
            C 184 355, 180 357, 174 354 Z
          "
        />

      </g>
    </svg>
  );
}

/**
 * Elegant botanical illustration — tall stem with delicate outlined leaves
 * matching the reference image: light beige/cream tone, visible leaf veins,
 * graceful organic curve. No fills, just fine strokes for an airy feel.
 */
function LeftBotanical({ className = "" }) {
  return (
    <svg
      viewBox="0 0 80 400"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* ── Main curved stem ── */}
      <path 
        d="M42 395 Q38 340 35 280 Q32 220 30 160 Q28 100 32 50 Q34 20 38 5" 
        strokeWidth="0.8" 
        opacity="0.85"
      />

      {/* ── Large leaves with internal vein details ── */}
      
      {/* Leaf 1 — bottom left, large */}
      <g opacity="0.75">
        <path d="M35 340 Q15 320 8 290 Q2 270 5 250 Q8 240 18 248 Q28 260 32 280 Q35 300 35 320 Z" strokeWidth="0.7" />
        {/* internal veins */}
        <path d="M25 320 Q18 295 12 270" strokeWidth="0.4" opacity="0.5" />
        <path d="M18 310 Q14 290 11 275" strokeWidth="0.35" opacity="0.4" />
        <path d="M22 295 Q17 280 14 268" strokeWidth="0.35" opacity="0.4" />
      </g>

      {/* Leaf 2 — bottom right, medium */}
      <g opacity="0.7">
        <path d="M35 315 Q50 300 58 280 Q62 265 60 250 Q58 242 50 248 Q42 258 38 275 Q35 290 35 305 Z" strokeWidth="0.7" />
        <path d="M45 295 Q50 280 54 265" strokeWidth="0.4" opacity="0.5" />
        <path d="M48 285 Q52 273 55 262" strokeWidth="0.35" opacity="0.4" />
      </g>

      {/* Leaf 3 — mid-low left, elongated */}
      <g opacity="0.72">
        <path d="M32 270 Q18 255 10 230 Q5 210 8 190 Q10 182 18 188 Q26 200 29 220 Q32 240 32 260 Z" strokeWidth="0.7" />
        <path d="M22 250 Q16 230 12 210" strokeWidth="0.4" opacity="0.5" />
        <path d="M19 240 Q15 222 12 206" strokeWidth="0.35" opacity="0.4" />
        <path d="M25 235 Q20 218 16 202" strokeWidth="0.35" opacity="0.4" />
      </g>

      {/* Leaf 4 — mid right, smaller */}
      <g opacity="0.68">
        <path d="M32 245 Q45 232 52 215 Q56 202 54 188 Q52 182 45 186 Q38 195 34 210 Q32 225 32 238 Z" strokeWidth="0.65" />
        <path d="M42 225 Q47 212 50 200" strokeWidth="0.35" opacity="0.5" />
        <path d="M45 218 Q48 207 51 196" strokeWidth="0.3" opacity="0.4" />
      </g>

      {/* Leaf 5 — mid-upper left, graceful curve */}
      <g opacity="0.75">
        <path d="M30 200 Q16 185 8 160 Q3 140 6 120 Q8 112 16 118 Q24 130 27 150 Q30 170 30 188 Z" strokeWidth="0.7" />
        <path d="M20 180 Q14 160 10 140" strokeWidth="0.4" opacity="0.5" />
        <path d="M17 170 Q13 152 10 136" strokeWidth="0.35" opacity="0.4" />
        <path d="M23 165 Q18 148 14 132" strokeWidth="0.35" opacity="0.4" />
      </g>

      {/* Leaf 6 — mid-upper right */}
      <g opacity="0.7">
        <path d="M30 175 Q42 162 48 142 Q52 128 50 112 Q48 106 42 110 Q36 120 32 138 Q30 152 30 168 Z" strokeWidth="0.65" />
        <path d="M39 155 Q44 140 47 125" strokeWidth="0.35" opacity="0.5" />
        <path d="M42 148 Q45 135 48 122" strokeWidth="0.3" opacity="0.4" />
      </g>

      {/* Leaf 7 — upper left, delicate */}
      <g opacity="0.68">
        <path d="M30 135 Q20 122 14 102 Q10 88 12 72 Q14 66 20 70 Q26 80 28 96 Q30 112 30 125 Z" strokeWidth="0.65" />
        <path d="M22 115 Q18 100 15 85" strokeWidth="0.35" opacity="0.5" />
        <path d="M20 108 Q17 94 15 82" strokeWidth="0.3" opacity="0.4" />
      </g>

      {/* Leaf 8 — upper right, small */}
      <g opacity="0.65">
        <path d="M30 110 Q38 100 42 85 Q45 74 43 62 Q42 58 38 60 Q34 68 32 80 Q30 92 30 103 Z" strokeWidth="0.6" />
        <path d="M37 95 Q40 84 42 73" strokeWidth="0.3" opacity="0.5" />
        <path d="M39 90 Q41 80 43 71" strokeWidth="0.25" opacity="0.4" />
      </g>

      {/* Leaf 9 — near top left, thin */}
      <g opacity="0.6">
        <path d="M32 70 Q25 60 20 45 Q17 35 19 24 Q20 20 24 22 Q28 30 30 42 Q32 54 32 64 Z" strokeWidth="0.55" />
        <path d="M26 56 Q23 45 21 34" strokeWidth="0.3" opacity="0.4" />
      </g>

      {/* Leaf 10 — near top right, tiny accent */}
      <g opacity="0.58">
        <path d="M32 48 Q37 40 40 28 Q42 20 40 12 Q39 10 37 11 Q34 18 33 26 Q32 35 32 43 Z" strokeWidth="0.5" />
        <path d="M37 35 Q39 27 40 20" strokeWidth="0.25" opacity="0.4" />
      </g>

      {/* ── Top bud cluster ── */}
      <g opacity="0.5">
        <ellipse cx="36" cy="8" rx="2" ry="4" strokeWidth="0.5" />
        <ellipse cx="38" cy="10" rx="1.5" ry="3" strokeWidth="0.4" />
        <ellipse cx="34" cy="11" rx="1.5" ry="3" strokeWidth="0.4" />
      </g>
    </svg>
  );
}

/** A thin horizontal divider line with a centred diamond */
function GoldDivider({ className = "" }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden="true">
      <span className="h-px flex-1 bg-gold/30" />
      <svg viewBox="0 0 10 10" className="h-2 w-2 text-gold/60 fill-current">
        <polygon points="5,0 10,5 5,10 0,5" />
      </svg>
      <span className="h-px flex-1 bg-gold/30" />
    </div>
  );
}

/** Wax-seal style circle stamp */
function WaxSeal({ className = "" }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-gold/90 text-white ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" fill="none" stroke="white" strokeWidth="1" className="h-full w-full p-3">
        {/* outer ring */}
        <circle cx="24" cy="24" r="20" opacity="0.4" />
        {/* inner motif — a simple botanical leaf */}
        <path d="M24 34 C24 34 17 28 17 21 C17 15 20 11 24 10 C28 11 31 15 31 21 C31 28 24 34 24 34Z" strokeLinejoin="round" />
        <path d="M24 34 L24 10" strokeLinecap="round" />
        <path d="M20 20 C20 20 22 18 24 20" strokeLinecap="round" />
        <path d="M28 24 C28 24 26 22 24 24" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Arrow right — CTA icon */
function ArrowRight({ className = "w-4 h-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Parallax hero hook
// ─────────────────────────────────────────────────────────────
function useParallax(speed = 0.25) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onScroll() {
      const scrollY = window.scrollY;
      el.style.transform = `translateY(${scrollY * speed}px)`;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [speed]);
  return ref;
}

// ─────────────────────────────────────────────────────────────
// Animated wrapper (fade + slide)
// ─────────────────────────────────────────────────────────────
function Reveal({ children, className = "", delay = 0, direction = "up" }) {
  const [ref, inView] = useInView();
  const translate =
    direction === "up"
      ? "translate-y-8"
      : direction === "down"
      ? "-translate-y-8"
      : direction === "left"
      ? "translate-x-8"
      : direction === "right"
      ? "-translate-x-8"
      : "translate-y-8";

  return (
    <div
      ref={ref}
      className={`transition-all ease-out ${className}`}
      style={{
        transitionDuration: "800ms",
        transitionDelay: `${delay}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? "none" : undefined,
      }}
    >
      {/* We apply the class only when not-inView via a wrapper trick */}
      <div className={inView ? "" : translate}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ── SECTION 1 · HERO ─────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
function HeroSection() {
  const t = useTranslations("concept.hero");
  return (
    <section className="relative h-[700px] overflow-hidden bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url('/Images/heroImage.webp')` }}>
      <div className="mx-auto grid h-full w-full items-center lg:grid-cols-2">
        <div className="relative z-10 flex h-full w-full flex-col items-center bg-[#2F3A2E]/90 px-6 py-24">
          <div className=" w-full max-w-2xl px-2 text-center sm:w-3/4 sm:px-0 lg:text-left">
            <span className="mb-5 inline-block text-sm font-semibold uppercase tracking-[0.32em] text-[#C8A46A]">
              {t("eyebrow")}
            </span>
            <h1 className="w-full text-[2.2rem] font-bold leading-tight text-[#F8F6F2] xs:text-[2.6rem] sm:text-5xl lg:text-[3.6rem] xl:text-[4rem]">
              {t("titleLine1")}
              <br />
              <em className="font-light italic text-[#C8A46A]/90">{t("titleAccent")}</em>
            </h1>
            <div className="mx-auto mt-8 h-[3px] w-20 rounded-full bg-[#C8A46A] lg:mx-0" />
            <p className="mx-auto mt-8 max-w-lg text-[15px] leading-7 text-gray-300 sm:text-[17px] sm:leading-9 lg:mx-0">
              {t("description1")} {t("description2")}
              <br />
              <em className="text-gray-200/70">{t("welcome")}</em>
            </p>
            <Botanical className="h-45 w-40 rotate-[90deg] text-gold" />
          </div>
        </div>
        <div className="relative hidden h-full w-full bg-black/20 lg:block lg:col-span-1">
          <div className="absolute inset-y-0 left-0 w-52 bg-gradient-to-r from-[#2F3A2E]/90 via-[#2F3A2E]/80 to-transparent" />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// ── SECTION 2 · CREAM — L'HISTOIRE ───────────────────────────
// ─────────────────────────────────────────────────────────────
function StorySection() {
  const t = useTranslations("concept.story");
  const [textRef, textInView] = useInView();
  const [imgRef, imgInView] = useInView();

  return (
  <section id="histoire" className="relative w-full overflow-hidden bg-[#fdf8f0] " aria-label={t("eyebrow")}>
      {/* Faint grid texture */}
      {/* <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 72px),repeating-linear-gradient(90deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 72px)",
        }}
      /> */}

      {/* Top botanical flourish — centred */}
      <div
        aria-hidden="true"
        className="mx-auto flex justify-center pt-16 text-gold"
        style={{ height: 80 }}
      >
        <BotanicalSprig className="h-full" />
      </div>

      <div className="mx-auto max-w-[1400px] px-6 pb-20 pt-8 sm:px-10 lg:px-16 lg:pb-28 lg:pt-10 xl:px-24">  

        {/* Two-column layout: image left, text right */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16 xl:gap-24">

          {/* ── Image column ── */}
          <div
            ref={imgRef}
            className={`relative transition-all duration-1000 ease-out ${
              imgInView ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
            }`}
          >
            {/* ── Botanical decoration — left of portrait ── */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-8 top-0 z-0 hidden h-full w-20 text-gold sm:-left-10 sm:w-24 lg:block xl:-left-12 xl:w-28"
            >
              <Botanical
                  className="
                    absolute
                    -left-35
                    top-1/2
                    -translate-y-1/2
                    h-[520px]
                    w-[202px]
                    text-[#c9bca8]
                    opacity-60
                  "
                />
              {/* <LeftBotanical className="h-full w-full text-gold pr-10" /> */}
            </div>

            {/* Main portrait image */}
            <div className="relative aspect-[3/4] w-full max-w-[480px] overflow-hidden">
              <Image
                src="/Images/histoire.webp"
                alt={t("imageAlt")}
                fill
                className="object-cover object-top"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
              {/* Warm amber overlay for atmospheric feel */}
              <div className="absolute inset-0 bg-gradient-to-t from-primary/30 via-transparent to-transparent" />
            </div>

            {/* Floating wax-seal detail — bottom-right of image */}
            {/* <div className="absolute -bottom-6 -right-4 sm:right-8">
              <WaxSeal className="h-16 w-16 shadow-lg shadow-gold/20" />
            </div> */}

          </div>

          {/* ── Text column ── */}
          <div
            ref={textRef}
            className={`flex flex-col justify-center pt-4 transition-all duration-1000 ease-out delay-200 lg:pt-0 ${
              textInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
          >
             {/* Eyebrow */}
        <div className="mb-4 flex items-center gap-3 lg:mb-3">
          {/* <span className="h-px w-8 bg-gold/50" /> */}
             <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold/90">
            {t("eyebrow")}
          </span>
        </div>
            <h2 className="mb-6 text-[1.7rem] font-semibold leading-[1.15] tracking-tight text-ink xs:text-[2rem] sm:mb-8 sm:text-[2.4rem] lg:text-[2.8rem]">
              {t("title1")}
              <br />
              {t("title2a")}{" "}
              <span className="font-light text-gold/90 font-semibold">
                {t("title2b")}
                <br />
                {t("title2c")}
              </span>
            </h2>

            <div className="space-y-3 text-[14px] leading-[1.9] text-ink/65 sm:text-[15px]">
              <p>{t("p1")}</p>
              <p>{t("p2")}</p>
              <p>{t("p3")}</p>
              <p>{t("p4")}</p>
              <p>{t("p5")}</p>
            </div>

            {/* Signature */}
            <div className="mt-8 flex justify-between gap-4 xs:flex-row sm:mt-10 items-center">
              <div>
               <p
                  style={{ fontFamily: "var(--font-betania-patmos)" }}
                  className="text-[1.5rem] text-primary/60 italic sm:text-[1.6rem]"
                >
                  {t("signatureName")}
                </p>
                <p className="mt-1 text-[13px] font-semibold sm:text-[14px]">
                  {t("signatureRole")}
                </p>
              </div>
              <div className="w-[150px] h-[150px] relative  ">
                <Image src="/Images/signature.png"
                alt=""
                 fill
                className=""
                 sizes="width:100px " />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-right botanical accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 text-gold/80"
        
        style={{ width: 100, height: 370 }}
      >
        <LeftBotanical className="h-full w-full" />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// ── SECTION 3 · DARK GREEN — L'ÂME DU LIEU ──────────────────
// ─────────────────────────────────────────────────────────────
function AtmosphereSection() {
  const t = useTranslations("concept.atmosphere");
  const [leftRef, leftInView] = useInView();
  const [rightRef, rightInView] = useInView();

  return (
    <section
      className="relative w-full overflow-hidden bg-primary"
      aria-label="L'atmosphère du lieu"
    >
      {/* Subtle grain overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 80px)",
        }}
      />

      {/* Top botanical flourish — centred */}
      <div
        aria-hidden="true"
        className="mx-auto flex justify-center pt-12 text-gold/40"
        style={{ height: 70 }}
      >
        <BotanicalSprig className="h-full" />
      </div>

      {/* Left botanical decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 hidden lg:block"
        style={{ width: 220, height: 560 }}
      >
        <Botanical
          className="h-full w-full text-gold/50 opacity-70"
        />
      </div>

      <div className="mx-auto max-w-[1530px] px-6 py-20 sm:px-10 lg:px-16 lg:py-28 xl:px-16">
        <div className="flex flex-col gap-14 lg:flex-row lg:gap-16 xl:gap-20">

          {/* ── Left: Editorial text ── */}
          <div
            ref={leftRef}
            className={`flex w-full flex-col justify-center transition-all duration-1000 ease-out lg:w-2/5 ${
              leftInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            {/* Eyebrow */}
            <div className="mb-6 flex items-center gap-3 sm:mb-8">
              <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-gold/60 sm:text-[12px]">
                {t("eyebrow")}
              </span>
            </div>

            <h2 className="mb-6 text-[1.8rem] font-bold leading-[1.1] tracking-tight text-cream xs:text-[2rem] sm:mb-8 sm:text-[2.4rem] lg:text-[2.9rem]">
              {t("title1")}
              <br />
              <em className="font-light no-italic ">
                {t("title2")} <span className="text-gold">{t("titleAccent")}</span> 
              </em>
            </h2>

            <div className="space-y-3 text-[14px] leading-[1.9] text-cream/55 sm:text-[15px]">
              <p>{t("p1")}</p>
              <p>{t("p2")}</p>
              <p>{t("p3")}</p>
              <p>{t("p4")}</p>
              <p>{t("p5")}</p>
              <p>{t("p6")}</p>
            </div>

            {/* Italic pull-quote */}
            <blockquote
              className="mt-8 border-l-2 border-gold/40 pl-5 sm:mt-10 sm:pl-6"
            >
              <p
                className="whitespace-pre-line text-[1.15rem] italic leading-[1.7] text-gold/50 sm:text-[1.3rem]"
                style={{ fontFamily: "var(--font-betania-patmos)" }}
              >
                {t("quote")}
              </p>
            </blockquote>
          </div>

          {/* ── Right: Photo composition ── */}
          <div className="flex w-full flex-col gap-3 sm:gap-4 lg:w-3/5 lg:flex-row lg:gap-4 ">
            <div className="flex flex-col gap-4">
               <Image
                  src="/Images/studio-1.webp"
                  alt="Intérieur chaleureux, lumière tamisée"
                  width={380}
                  height={390}
                  className=""
                  
                />
                 <Image
                  src="/Images/galery-2.webp"
                  alt="Intérieur chaleureux, lumière tamisée"
                  width={380}
                  height={390}
                  className=""
                  
                />
            </div>

            <div className="flex flex-col gap-4">
               <Image
                  src="/Images/studio-3.webp"
                  alt="Intérieur chaleureux, lumière tamisée"
                  width={380}
                  height={300}
                  className=""
                  
                />
                 <Image
                  src="/Images/studio-4.webp"
                  alt="Intérieur chaleureux, lumière tamisée"
                  width={380}
                  height={390}
                  className=""
                  
                />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-right botanical accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 text-gold/60"
        style={{ width: 100, height: 370 }}
      >
        <LeftBotanical className="h-full w-full" />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// ── SECTION 4 · CREAM — LES UNIVERS ──────────────────────────
// ─────────────────────────────────────────────────────────────

const UNIVERSE_IMAGES = {
  studio: { image: "/Images/LE STUDIO.webp", imageAltKey: "studio", href: "/reservation#booking"},
  boutique: { image: "/Images/LA BOUTIQUE.webp", imageAltKey: "boutique", href: "/boutique" },
  formations: { image: "/Images/LES FORMATIONS.webp", imageAltKey: "formations", href: "/formations" },
  ateliers: { image: "/Images/LES ATELIERS ET EVENEMENTS.webp", imageAltKey: "ateliers", href: "/evenements" },
};
const UNIVERSE_KEYS = ["studio", "boutique", "formations", "ateliers"];

/** Small wax-seal badge icon — matches reference white disc with delicate gold botanical */
function UniverseBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-[#b89664]" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      {/* tiny gift / botanical — thin line, premium */}
      <path d="M12 15.5V8" strokeLinecap="round" />
      <path d="M12 8 C11.1 6.2 9.4 5.3 8 6.2 C6.6 7.1 6.8 9.2 8.6 10.2 L12 12 L15.4 10.2 C17.2 9.2 17.4 7.1 16 6.2 C14.6 5.3 12.9 6.2 12 8Z" strokeLinejoin="round" />
      <path d="M7.2 11.5 H16.8 C17.6 11.5 18.2 12.1 18.2 13 C18.2 14.8 17.3 17.2 12 17.2 C6.7 17.2 5.8 14.8 5.8 13 C5.8 12.1 6.4 11.5 7.2 11.5Z" strokeLinejoin="round" />
      <path d="M9.5 14.2 C9.8 15 10.7 15.8 12 15.8 C13.3 15.8 14.2 15 14.5 14.2" strokeLinecap="round" />
    </svg>
  );
}

function UniverseCard({ item, index }) {
  const [ref, inView] = useInView();
  return (
    <article
      ref={ref}
      className={`flex h-full flex-col transition-all duration-700 ease-out ${
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="group relative mx-auto flex h-full w-full max-w-[255px] flex-col overflow-hidden rounded-[12px] border border-[#ece6d8] bg-white shadow-[0_2px_16px_rgba(47,58,46,0.06)]">
        {/* Image — 255 × 255 */}
        <div className="relative h-[255px] w-[255px] shrink-0 overflow-hidden bg-[#f3eee5] self-center">
          <Image
            src={item.image}
            alt={item.imageAlt}
            fill
            className="object-cover object-center transition-transform duration-[700ms] ease-out group-hover:scale-[1.03]"
            sizes="255px"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent opacity-60" />
          <div className="absolute inset-0 ring-1 ring-inset ring-black/5" />
        </div>

        {/* Overlapping badge — anchored to image bottom, centered */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 flex justify-center">
          <div className="relative h-[255px] w-[255px]">
            <div className="absolute bottom-0 left-1/2 flex h-10 w-10 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border border-[#ece6d8] bg-white shadow-[0_4px_14px_rgba(47,58,46,0.12)]">
              <UniverseBadgeIcon />
            </div>
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-1 flex-col px-6 pb-8 pt-12">
          <p className="mb-2  text-[12px] font-semibold uppercase tracking-[0.18em] text-[#2f3a2e]">
            {item.eyebrow.split("\n").map((l, i) => (
              <span key={i} className={i > 0 ? "block" : ""}>{l}</span>
            ))}
          </p>
          {/* keep heading hidden per reference — eyebrow is the card title; preserving for a11y/SEO but visually merged */}
          <h3 className="sr-only">{item.heading.replace("\n", " ")}</h3>
          <p className="min-h-[66px] text-[14px] font-normal leading-[1.7] text-[#6b6f64]">
            {item.body}
          </p>
          <Link
            href={item.href}
            scroll={false}
            className="group/link mt-5 inline-flex items-center gap-1.5 text-[12px] font-medium tracking-[0.02em] text-[#3e4a3b] underline decoration-[#d8cfba] underline-offset-[4px] transition-colors hover:text-ink hover:decoration-gold"
          >
            {item.cta}
            <span aria-hidden="true" className="transition-transform duration-200 group-hover/link:translate-x-0.5">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

function UniversesSection() {
  const t = useTranslations("concept.universes");
  const [headRef, headInView] = useInView();
  const universes = UNIVERSE_KEYS.map((key, idx) => ({
    key,
    ...UNIVERSE_IMAGES[key],
    eyebrow: t(`items.${idx}.eyebrow`),
    body: t(`items.${idx}.body`),
    cta: t(`items.${idx}.cta`),
    imageAlt: t(`imageAlts.${key}`),
    heading: t(`items.${idx}.eyebrow`),
  }));
  return (
    <section className="relative w-full overflow-hidden bg-[#fdf8f0] py-16" aria-label={t("eyebrow")}>
      {/* Subtle warm texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage: "radial-gradient(ellipse at 30% 20%, rgba(184,150,100,0.07) 0%, transparent 60%), radial-gradient(ellipse at 80% 90%, rgba(184,150,100,0.05) 0%, transparent 55%)",
        }}
      />

      <div className="relative mx-auto max-w-[1530px] px-6 py-16 sm:px-8 lg:px-10 lg:py-20 xl:px-12 xl:py-24">
        {/* Desktop: intro left (280-320) + 4 cards | Tablet/Mobile: stacked */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-8 xl:gap-10">
          {/* Intro */}
          <div
            ref={headRef}
            className={`relative flex w-full shrink-0 flex-col lg:w-[270px] xl:w-[300px] transition-all duration-700 ease-out ${
              headInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#b89664]">{t("eyebrow")}</p>
            <h2 className="mt-4 font-display text-[1.9rem] font-normal leading-[1.08] tracking-[-0.02em] text-ink xs:text-[2.05rem] sm:text-[2.35rem] lg:text-[2.55rem]">
              <span className="block font-semibold tracking-tight text-[#1f2a1e]">{t("title1")}</span>
              <span className="block font-light italic text-[#b89664]">{t("title2")}</span>
            </h2>

            {/* Botanical decoration — integrated, bottom-left of intro, premium scale */}
            <div
              aria-hidden="true"
              className="pointer-events-none mt-6 hidden select-none text-[#c8b9a0] lg:block"
            >
              <div className="relative h-[380px] w-[160px] -ml-2 overflow-visible  rotate-[-18deg]">
                {/* Use the existing detailed Botanical Illustration scaled to reference: pale, thin, organic */}
                <Botanical className=" w-full h-full" />
               
                {/* soft wash to integrate */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#fdf8f0] via-transparent to-transparent" />
              </div>
            </div>
            {/* Mobile: much smaller sprig below heading */}
            <div aria-hidden="true" className="pointer-events-none mt-4 flex justify-start text-[#d6cbb6] opacity-60 lg:hidden">
              <BotanicalBranch className="h-20 w-14 rotate-[18deg]" />
            </div>
          </div>

          {/* Cards — responsive: 1 col xs, 2 cols sm, 4 cols lg, gap scales */}
          <div className="grid flex-1 grid-cols-1 gap-6 xs:gap-5 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-5 xl:gap-6 justify-items-center sm:justify-items-stretch">
            {universes.map((item, i) => (
              <UniverseCard key={item.key} item={item} index={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// ── SECTION 5 · HUMAN / WARMTH ───────────────────────────────
// ─────────────────────────────────────────────────────────────
function HumanSection() {
  const t = useTranslations("concept.human");
  const [contentRef, contentInView] = useInView();

  return (
    <section
      className="relative w-full overflow-hidden bg-[#fdf8f0] "
      aria-label={t("eyebrow")}
    >
      {/* Split composition: image left, cream content right */}
      <div className="flex min-h-[480px] flex-col sm:min-h-[560px] lg:min-h-[640px] lg:flex-row">
        {/* Image — immersive, edge-to-edge, responsive */}
        <div className="relative w-full shrink-0 overflow-hidden bg-[#2f3a2e] lg:w-[50%] xl:w-[48%]">
          <div className="relative aspect-[4/3] w-full sm:aspect-[16/10] lg:aspect-auto lg:h-full lg:min-h-[640px]">
            <Image
              src="/Images/hero.png"
              alt={t("imageAlt")}
              fill
              className="object-cover object-center"
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority={false}
            />
            {/* Soft warm cinematic veil — dark, légèrement doré comme référence */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent" />
            <div className="absolute inset-0 bg-[#2f3a2e]/10 mix-blend-multiply" />
          </div>
        </div>

        {/* Content — warm cream, editorial whitespace */}
        <div className="relative flex w-full flex-1 items-center bg-[#fdf8f0] lg:w-[50%] xl:w-[52%]">
          {/* Decorative botanical — right side, thin elegant, consistent with other sections */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-1/2 hidden -translate-y-1/2 lg:block"
            style={{ width: 140, height: 380 }}
          >
            <div className="relative h-full w-full overflow-visible">
              <LeftBotanical className="absolute right-[-8px] top-1/2 h-[360px] w-[120px] -translate-y-1/2 text-[#d6cbb6] " />
            </div>
          </div>
          {/* Mobile botanical — small, behind content */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2 right-2 opacity-[0.22] lg:hidden"
            style={{ width: 90, height: 160 }}
          >
            <BotanicalBranch className="h-full w-full -rotate-12 text-[#d6cbb6]" />
          </div>

          <div
            ref={contentRef}
            className={`relative mx-auto w-full max-w-[700px] px-6 py-12 sm:px-10 sm:py-14 lg:px-12 lg:py-10 xl:px-16 xl:py-12 2xl:px-2 transition-all duration-700 ease-out ${
              contentInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#b89664] sm:text-[11px]">{t("eyebrow")}</p>

            <h2 className="mt-3 font-display text-[1.7rem] font-normal leading-[1.12] tracking-[-0.02em] text-[#1f2a1e] xs:text-[1.9rem] sm:mt-4 sm:text-[2.2rem] lg:text-[2.8rem]">
              <span className="block font-medium">{t("title1")}</span>
              <span className="block font-light italic text-[#b89664]">{t("title2")}</span>
            </h2>

            <div className="mt-5 space-y-3 text-[14px] leading-[1.8] text-[#5c635c] sm:mt-6 sm:space-y-4 sm:text-[15px] sm:leading-[1.85]">
              <p>{t("p1")}</p>
              <p>{t("p2")}</p>
              <p>{t("p3")}</p>
            </div>

            <Link
              href="/#equipe"
              scroll={false}
              className="group mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium tracking-[0.03em] text-[#b89664] underline decoration-[#e9ddd0] underline-offset-[5px] transition-all hover:text-[#9a8054] hover:decoration-[#b89664] sm:mt-8 sm:text-[15px]"
            >
              {t("cta")}
              <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// ── SECTION 6 · FINAL CTA ─────────────────────────────────────
// ─────────────────────────────────────────────────────────────
function FinalCtaSection() {
  const t = useTranslations("concept.finalCta");
  const imgRef = useParallax(0.18);
  const [contentRef, contentInView] = useInView();

  return (
    <section
      className="relative min-h-[620px] overflow-hidden bg-cover bg-center bg-no-repeat sm:min-h-[700px] lg:h-[75vh] z-0" style={{ backgroundImage: `url('/Images/FINAL CTA.webp')` }}
      aria-label="Prêt à pousser la porte"
    >
      {/* Parallax background */}
      <div className="absolute inset-0 will-change-transform bg-black/60 z-1" >
        {/* <Image
          src="/Images/FINAL CTA.webp"
          alt="Invitation à entrer chez MeriBeauty"
          fill
          className="object-cover object-center"
          sizes="100vw"
        /> */}
      </div>

      {/* Dark overlay — heavier than hero for legibility */}
      {/* <div className="absolute inset-0 bg-primary/80" />
      <div className="absolute inset-0 " /> */}

      {/* Subtle botanical corners */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 text-cream/[0.05] rotate-180"
        style={{ width: 180, height: 260 }}
      >
        <BotanicalBranch className="h-full w-full" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 text-cream/[0.05]"
        style={{ width: 180, height: 260 }}
      >
        <BotanicalBranch className="h-full w-full" />
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        className={`relative z-10 flex min-h-[85vh] flex-col items-center justify-center px-6 py-20 text-center transition-all duration-1000 ease-out ${
          contentInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
        }`}
      >
        {/* Headline */}
        <h2 className="mb-5 max-w-2xl text-[2rem] font-bold leading-[1.08] tracking-tight text-cream xs:text-[2.4rem] sm:mb-6 sm:text-[3rem] lg:text-[4rem]">
          {t("title1")}
          <br />
          <em className="font-light italic text-gold">
            {t("title2")}
          </em>
        </h2>

        {/* Sub-copy */}
        <p className="mx-auto mb-2 max-w-lg px-2 text-[15px] leading-[1.85] text-white sm:mb-3 sm:px-0 sm:text-[17px]">
          {t("description1")}
          <br className="hidden sm:block" />
          {t("description2")}
        </p>
        <p className="mb-2 font-display text-[14px] italic text-cream/70 sm:text-[15px]">« {t("quote")} »</p>

        <GoldDivider className="my-6 w-32 mx-auto sm:my-8" />

        {/* CTA buttons — stack on xs */}
        <div className="flex w-full max-w-md flex-col items-stretch justify-center gap-3 px-4 sm:w-auto sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:px-0 sm:gap-4">
          <Link
            href="/reservation#booking"
            scroll={false}
            className="group inline-flex items-center justify-center gap-3 bg-gold px-6 py-3.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-primary shadow-lg shadow-gold/20 transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/30 sm:px-8 sm:py-4 sm:text-[13px]"
          >
            {t("ctaBooking")}
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>

          <Link
            href="/boutique"
            className="group inline-flex items-center justify-center gap-3 border border-cream/30 px-6 py-3.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-cream/80 transition-all duration-300 hover:border-gold/50 hover:text-gold sm:px-8 sm:py-4 sm:text-[13px]"
          >
            {t("ctaShop")}
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// ── PAGE ROOT ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
export default function ConceptPage() {
  return (
    <>
      <HeroSection />
      <StorySection />
      <AtmosphereSection />
      <UniversesSection />
      <HumanSection />
      <FinalCtaSection />
    </>
  );
}
