"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

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
      { threshold: 0.2, ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

function SparkleIcon({ className = "w-6 h-6" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2l2.4 6.3 6.6 1-4.8 4.3 1.4 6.4-5.6-3.3L6.4 20l1.4-6.4L3 9.3l6.6-1L12 2z" />
    </svg>
  );
}

export default function FinalCTA() {
  const [ctaRef, ctaInView] = useInView();

  return (
    <section className="relative w-full overflow-hidden bg-white">
      {/* Background image with overlay */}
      <div className="absolute inset-0">
        <Image
          src="/Images/cta-background.webp"
          alt=""
          fill
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/85 via-primary/80 to-primary/90" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
      </div>

      {/* Decorative sparkles */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[10%] top-[20%] animate-pulse text-gold/20"
      >
        <SparkleIcon className="h-8 w-8" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[15%] top-[30%] animate-pulse text-gold/15"
        style={{ animationDelay: "1s" }}
      >
        <SparkleIcon className="h-6 w-6" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[25%] left-[20%] animate-pulse text-gold/10"
        style={{ animationDelay: "2s" }}
      >
        <SparkleIcon className="h-7 w-7" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[35%] right-[12%] animate-pulse text-gold/20"
        style={{ animationDelay: "1.5s" }}
      >
        <SparkleIcon className="h-9 w-9" />
      </div>

      {/* Content */}
      <div
        ref={ctaRef}
        className={`relative z-10 mx-auto flex min-h-[480px] max-w-[900px] flex-col items-center justify-center px-6 py-24 text-center transition-all duration-900 ease-out lg:py-32 ${
          ctaInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
        }`}
      >
        {/* Eyebrow */}
        <div
          className={`mb-6 inline-flex items-center gap-3 transition-all duration-700 ease-out delay-200 ${
            ctaInView ? "opacity-100 scale-100" : "opacity-0 scale-95"
          }`}
        >
          <span className="h-px w-10 bg-gold/60" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
            Offrez-vous l'excellence
          </span>
          <span className="h-px w-10 bg-gold/60" />
        </div>

        {/* Headline */}
        <h2
          className={`mb-5 text-[2.2rem] font-bold leading-[1.05] tracking-tight text-white transition-all duration-700 ease-out delay-300 sm:text-[2.8rem] lg:text-[3.4rem] ${
            ctaInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          Prête à vivre un moment{" "}
          <em className="relative font-light text-gold/95 not-italic">
            rien qu'à vous ?
            {/* Subtle underline accent */}
            <span className="absolute inset-x-0 -bottom-1 h-[2px] bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
          </em>
        </h2>

        {/* Subtitle */}
        <p
          className={`mx-auto mb-10 max-w-[500px] text-[15px] leading-[1.75] text-white/70 transition-all duration-700 ease-out delay-400 sm:text-[16px] ${
            ctaInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          Réservez votre rendez-vous en quelques clics et découvrez une expérience
          beauté sur-mesure.
        </p>

        {/* CTA Button */}
        <div
          className={`transition-all duration-700 ease-out delay-500 ${
            ctaInView
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-8"
          }`}
        >
          <a
            href="#reservation"
            className="group inline-flex items-center gap-3 rounded-full bg-gold px-10 py-5 text-[16px] font-semibold text-white shadow-2xl shadow-gold/40 transition-all duration-300 hover:scale-105 hover:bg-gold/95 hover:shadow-[0_0_40px_rgba(184,150,100,0.5)]"
          >
            Réserver maintenant
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1"
              aria-hidden="true"
            >
              <path
                d="M5 12h14M13 6l6 6-6 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>

        {/* Trust badge */}
        <div
          className={`mt-10 flex items-center gap-3 text-white/50 transition-all duration-700 ease-out delay-600 ${
            ctaInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div className="flex -space-x-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-8 w-8 rounded-full border-2 border-primary bg-cream"
              />
            ))}
          </div>
          <p className="text-[12px] font-medium">
            <span className="text-gold">+2000 clientes</span> nous font confiance
          </p>
        </div>
      </div>
    </section>
  );
}
