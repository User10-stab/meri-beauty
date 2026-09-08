"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

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

export default function StaffSpecialties({ categories, firstName }) {
  const [sectionRef, sectionInView] = useInView();

  if (!categories || categories.length === 0) {
    return null;
  }

  return (
    <section className="relative w-full overflow-hidden bg-[#fdf8f0] py-16 sm:py-20 md:py-24">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 md:px-10 lg:px-14">
        <div
          ref={sectionRef}
          className={`transition-all duration-700 ease-out ${
            sectionInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Header */}
          <div className="mb-10 text-center sm:mb-12">
            <div className="mb-3 inline-flex items-center gap-2">
              <span className="h-px w-8 bg-[#b89664]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b89664]">
                Expertise
              </span>
              <span className="h-px w-8 bg-[#b89664]" />
            </div>
            <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2.5rem] md:text-[3rem]">
              Son univers
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[#6f6a64] sm:text-base">
              Découvrez les domaines d'expertise de {firstName}
            </p>
          </div>

          {/* Specialties Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6">
            {categories.map((category, index) => (
              <div
                key={category}
                className="group relative overflow-hidden rounded-2xl border border-[#ede5d8] bg-white p-6 shadow-[0_2px_18px_rgba(47,58,46,0.06)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(47,58,46,0.12)] hover:-translate-y-1"
                style={{
                  animationDelay: `${index * 100}ms`,
                }}
              >
                {/* Decorative gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#fdf8f0] via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                <div className="relative">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#b89664] to-[#d9c9a8] text-white shadow-sm">
                    <Sparkles size={20} />
                  </div>
                  <h3 className="font-display text-lg font-semibold tracking-tight text-[#2F3A2E]">
                    {category}
                  </h3>
                  <div className="mt-3 h-px w-12 bg-[#b89664]/30 transition-all duration-300 group-hover:w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
