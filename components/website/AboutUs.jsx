"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowIcon } from "./icons";

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
      { threshold: 0.18, ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

function LotusIcon({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path d="M12 21c-1-3-4-6-8-7 4 0 7-1 9-3 2 2 5 3 9 3-4 1-7 4-8 7Z" strokeLinejoin="round" />
      <path d="M12 21c0-4 1-8 4-11 0 4-1 8-4 11Z" strokeLinejoin="round" />
      <path d="M12 21c0-4-1-8-4-11 0 4 1 8 4 11Z" strokeLinejoin="round" />
    </svg>
  );
}

function ShoppingBagIcon({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path d="M6.5 8.5h11l.9 11.2a1.5 1.5 0 0 1-1.5 1.6H7.1a1.5 1.5 0 0 1-1.5-1.6l.9-11.2Z" strokeLinejoin="round" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" strokeLinejoin="round" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
      <path d="M12 14c-1.5 0-2.5 1-2.5 2s1 2 2.5 2 2.5-1 2.5-2-1-2-2.5-2Z" fill="currentColor" stroke="none" />
      <path d="M12 16l-0.5 0.5c-0.5 0.5-0.5 1.5 0.5 1.5s1-1 0.5-1.5L12 16Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function AboutUs() {
  const t = useTranslations("home");
  const [textRef, textInView] = useInView();
  const [imgRef, imgInView] = useInView();

  const concepts = [
    {
      icon: <LotusIcon className="w-10 h-10 sm:w-12 sm:h-12 text-gold" />,
      title: t("aboutConceptSalonTitle"),
      desc: t("aboutConceptSalonDesc"),
    },
    {
      icon: <ShoppingBagIcon className="w-10 h-10 sm:w-12 sm:h-12 text-gold" />,
      title: t("aboutConceptBoutiqueTitle"),
      desc: t("aboutConceptBoutiqueDesc"),
    },
    {
      icon: <CalendarIcon className="w-10 h-10 sm:w-12 sm:h-12 text-gold" />,
      title: t("aboutConceptAteliersTitle"),
      desc: t("aboutConceptAteliersDesc"),
    },
  ];

  return (
    <section id="concept" className="relative w-full overflow-hidden bg-cream">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 64px)",
        }}
      />

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-2">
        <div ref={imgRef} className="relative flex items-center justify-center px-4 py-10 sm:px-6 sm:py-12 lg:px-10 lg:py-16">
          <div
            className={`relative w-full max-w-[300px] sm:max-w-[400px] md:max-w-[500px] transition-all duration-700 ease-out ${imgInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-10"}`}
          >
            <div className="">
              <Image
                src="/Images/about.webp"
                alt="Ambiance chaleureuse du studio MeriBeauty"
                width={760}
                height={560}
                className="relative z-10 w-full rounded-2xl object-cover drop-shadow-sm"
                priority={false}
              />
            </div>
          </div>

          {/* <div
            className={`absolute bottom-16 sm:bottom-20 md:bottom-24 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 sm:px-3.5 sm:py-2 shadow-md shadow-black/8 transition-all duration-500 delay-700 ${imgInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span className="text-[9px] sm:text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {t("aboutEyebrow")}
            </span>
          </div> */}
        </div>

        <div
          ref={textRef}
          className={`flex flex-col justify-center px-4 py-10 sm:px-6 sm:py-12 md:px-12 lg:px-16 lg:py-16 xl:px-16 transition-all duration-700 ease-out ${textInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          <div className="mb-4 sm:mb-5 inline-flex items-center gap-2 sm:gap-3">
            <span className="h-px w-6 sm:w-8 bg-gold" />
            <span className="text-[9px] sm:text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
              {t("aboutEyebrow")}
            </span>
          </div>

          <h2 className="text-[1.5rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[1.8rem] md:text-[2.2rem] lg:text-[2.6rem]">
            {t("aboutTitle")}
          </h2>

          <div className="my-4 sm:my-5 md:my-6 flex items-center gap-2 sm:gap-3">
            <span className="h-px flex-1 bg-gold/20" />
            <span className="h-1 w-1 rounded-full bg-gold/50" />
            <span className="h-px w-4 sm:w-6 bg-gold/20" />
          </div>

          <p className="max-w-[420px] text-[13px] sm:text-[14px] md:text-[14.5px] leading-[1.7] sm:leading-[1.8] text-ink/55">
            {t("aboutBody1")}
          </p>

          <p className="mt-3 sm:mt-4 max-w-[420px] text-[13px] sm:text-[14px] md:text-[14.5px] leading-[1.7] sm:leading-[1.8] text-ink/55">
            {t("aboutBody2")}
          </p>

          <p className="mt-3 sm:mt-4 max-w-[420px] text-[13px] sm:text-[14px] md:text-[14.5px] leading-[1.7] sm:leading-[1.8] text-ink/55">
            {t("aboutBody3")}
          </p>

          <div className="mt-6 sm:mt-8">
            <a href="/reservation" className="group inline-flex items-center gap-2.5 rounded-full border border-gold/40 px-5 sm:px-6 py-2.5 sm:py-3 text-[12px] sm:text-[13px] font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-white hover:shadow-lg hover:shadow-gold/20">
              {t("aboutCta")}
              <ArrowIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] border-t border-gold/15 px-4 py-12 sm:px-6 sm:py-16 md:py-20">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8 md:gap-12">
          {concepts.map(({ icon, title, desc }) => (
            <div key={title} className="flex gap-5">
              <div className="mb-2 sm:mb-3">
                {icon}
              </div>
             <div>
               <h3 className="text-[12px] sm:text-[13px] md:text-[14px] font-bold uppercase tracking-[0.2em] text-ink">
                {title}
              </h3>
              <p className="mt-1 sm:mt-2 max-w-[280px] sm:max-w-[300px] text-[13px] sm:text-[13.5px] md:text-[14px] leading-[1.7] text-ink/50">
                {desc}
              </p>
             </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        .animate-float {
          animation: float 5s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
}
