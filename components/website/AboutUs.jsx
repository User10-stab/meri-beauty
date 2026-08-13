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

export default function AboutUs() {
  const t = useTranslations("home");
  const [textRef, textInView] = useInView();
  const [imgRef, imgInView] = useInView();

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
        <div ref={imgRef} className="relative flex items-center justify-center px-6 py-14 lg:px-10 lg:py-16">
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute h-[360px] w-[360px] rounded-full transition-all duration-1000 ease-out ${imgInView ? "opacity-100 scale-100" : "opacity-0 scale-75"}`}
          />

          <div
            className={`relative w-full max-w-[500px] transition-all duration-700 ease-out ${imgInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-10"}`}
          >
            <div className="animate-float">
              <Image
                src="/Images/about.png"
                alt="Illustration au trait d'une cliente recevant un soin"
                width={760}
                height={560}
                className="relative z-10 w-full object-contain drop-shadow-sm"
                priority={false}
              />
            </div>
          </div>

          <div
            className={`absolute bottom-24 flex items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-md shadow-black/8 transition-all duration-500 delay-700 ${imgInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              {t("aboutEyebrow")}
            </span>
          </div>
        </div>

        <div
          ref={textRef}
          className={`flex flex-col justify-center px-8 py-16 transition-all duration-700 ease-out md:px-12 lg:px-16 lg:py-24 xl:px-20 ${textInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          <div className="mb-5 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
              {t("aboutEyebrow")}
            </span>
          </div>

          <h2 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[2.4rem] lg:text-[2.6rem]">
            {t("aboutTitle")}
          </h2>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-gold/20" />
            <span className="h-1 w-1 rounded-full bg-gold/50" />
            <span className="h-px w-6 bg-gold/20" />
          </div>

          <p className="max-w-[420px] text-[14.5px] leading-[1.8] text-ink/55">
            <span className="font-semibold text-ink/75">MeriBeauty Studio &amp; Shop</span> {t("aboutBody1")}
          </p>

          <p className="mt-4 max-w-[420px] text-[14.5px] leading-[1.8] text-ink/55">
            {t("aboutBody2")}
          </p>

          <div className="mt-8">
            <a href="/reservation" className="group inline-flex items-center gap-2.5 rounded-full border border-gold/40 px-6 py-3 text-[13px] font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-white hover:shadow-lg hover:shadow-gold/20">
              {t("aboutBook")}
              <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </div>

          <div className="mt-10 grid grid-cols-2 gap-4 border-t border-gold/15 pt-8">
            {[
              { value: "10+", label: t("aboutYears") },
              { value: "2k+", label: t("aboutClients") },
            ].map(({ value, label }) => (
              <div key={label}>
                <p className="text-[1.6rem] font-bold leading-none text-ink">{value}</p>
                <p className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.13em] text-ink/35">
                  {label}
                </p>
              </div>
            ))}
          </div>
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
