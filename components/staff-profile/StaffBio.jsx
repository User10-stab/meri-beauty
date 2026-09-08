"use client";

import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";

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

export default function StaffBio({ bio, firstName }) {
  const [sectionRef, sectionInView] = useInView();

  if (!bio || bio.length < 80) {
    return null;
  }

  return (
    <section className="relative w-full overflow-hidden bg-[#fdf8f0] py-16 sm:py-20 md:py-24">
      {/* Decorative circles */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-60px] top-20 hidden h-40 w-40 rounded-full border border-[#b89664]/20 md:block"
      >
        <div className="absolute inset-6 rounded-full border border-[#b89664]/15" />
      </div>

      <div className="relative mx-auto max-w-[900px] px-4 sm:px-6 md:px-10 lg:px-14">
        <div
          ref={sectionRef}
          className={`transition-all duration-700 ease-out ${
            sectionInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Decorative icon */}
          <div className="mb-6 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#b89664] to-[#d9c9a8] text-white shadow-lg">
              <Heart size={24} fill="currentColor" />
            </div>
          </div>

          {/* Header */}
          <div className="mb-8 text-center">
            <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2.5rem] md:text-[3rem]">
              Quelques mots sur {firstName}
            </h2>
          </div>

          {/* Bio content */}
          <div className="rounded-2xl border border-[#ede5d8] bg-white p-8 shadow-[0_4px_24px_rgba(47,58,46,0.08)] sm:p-10 md:p-12">
            <p className="text-center text-base leading-relaxed text-[#6f6a64] sm:text-lg md:text-xl md:leading-relaxed">
              &ldquo;{bio}&rdquo;
            </p>
          </div>

          {/* Decorative divider */}
          <div
            aria-hidden="true"
            className="mt-10 flex items-center justify-center gap-3 text-[#b89664]/40"
          >
            <span className="h-px w-12 bg-current" />
            <span className="h-2 w-2 rotate-45 border border-current" />
            <span className="h-px w-12 bg-current" />
          </div>
        </div>
      </div>
    </section>
  );
}
