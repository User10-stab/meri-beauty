"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowIcon } from "./icons";

/** Fires once when the element enters the viewport */
function useInView(options = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { threshold: 0.18, ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

export default function AboutUs() {
  const [textRef, textInView]   = useInView();
  const [imgRef,  imgInView]    = useInView();

  return (
    <section
      id="concept"
      className="relative w-full overflow-hidden bg-cream"
    >
      {/* Subtle horizontal hairlines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 64px)",
        }}
      />

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-2">

        {/* ══════════════════════════
            LEFT — text
        ══════════════════════════ */}
       <div
          ref={imgRef}
          className="relative flex items-center justify-center px-6 py-14 lg:px-10 lg:py-16"
        >
          {/* Soft glow blob — floats independently */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute h-[360px] w-[360px] rounded-full 
              transition-all duration-1000 ease-out
              ${imgInView ? "opacity-100 scale-100" : "opacity-0 scale-75"}`}
          />

          {/* Frame + image wrapper */}
          <div
            className={`relative w-full max-w-[500px] transition-all duration-700 ease-out
              ${imgInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-10"}`}
          >
            {/* Corner brackets */}
            {/* <span
              aria-hidden="true"
              className={`absolute -left-2.5 -top-2.5 h-8 w-8 border-l-[1.5px] border-t-[1.5px] border-gold/50
                transition-all duration-500 delay-300
                ${imgInView ? "opacity-100 scale-100" : "opacity-0 scale-50"}`}
            />
            <span
              aria-hidden="true"
              className={`absolute -bottom-2.5 -right-2.5 h-8 w-8 border-b-[1.5px] border-r-[1.5px] border-gold/50
                transition-all duration-500 delay-500
                ${imgInView ? "opacity-100 scale-100" : "opacity-0 scale-50"}`}
            /> */}

            {/* Illustration — gentle float loop via CSS */}
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

          {/* Floating pill */}
          <div
            className={`absolute bottom-24 flex items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-md shadow-black/8
              transition-all duration-500 delay-700
              ${imgInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              Soin sur-mesure
            </span>
          </div>
        </div>

        {/* ══════════════════════════
            RIGHT — illustration
        ══════════════════════════ */}
        

         <div
          ref={textRef}
          className={`flex flex-col justify-center px-8 py-16 transition-all duration-700 ease-out
            md:px-12 lg:px-16 lg:py-24 xl:px-20
            ${textInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          {/* Eyebrow */}
          <div className="mb-5 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
              Notre philosophie
            </span>
          </div>

          {/* Headline */}
          <h2 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[2.4rem] lg:text-[2.6rem]">
            La beauté{" "}
            <em className="font-light text-gold/80 not-italic"> autrement.</em>
          </h2>

          {/* Thin rule */}
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-gold/20" />
            <span className="h-1 w-1 rounded-full bg-gold/50" />
            <span className="h-px w-6 bg-gold/20" />
          </div>

          {/* Body */}
          <p className="max-w-[420px] text-[14.5px] leading-[1.8] text-ink/55">
            <span className="font-semibold text-ink/75">MeriBeauty Studio &amp; Shop</span> est
            un salon de beauté et un espace bien-être situé à{" "}
            <span className="font-semibold text-ink/75">Jette</span>. Inspiré des cottages
            écossais et des paysages des Highlands, notre studio a été conçu pour offrir une
            ambiance chaleureuse et apaisante, idéale pour échapper au quotidien.
          </p>

          <p className="mt-4 max-w-[420px] text-[14.5px] leading-[1.8] text-ink/55">
            Nous vous invitons à découvrir notre univers de soins et de beauté.
          </p>

          {/* CTA */}
          <div className="mt-8">
            <a
              href="/reservation"
              className="group inline-flex items-center gap-2.5 rounded-full border border-gold/40 px-6 py-3 text-[13px] font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-white hover:shadow-lg hover:shadow-gold/20"
            >
              Réserver une séance
              <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </div>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-2 gap-4 border-t border-gold/15 pt-8">
            {[
              { value: "10+", label: "Années d'expérience" },
              { value: "2k+", label: "Clientes fidèles"    },
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

      {/* Float keyframe injected inline — no extra CSS file needed */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px);   }
          50%       { transform: translateY(-8px);  }
        }
        .animate-float {
          animation: float 5s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
}
