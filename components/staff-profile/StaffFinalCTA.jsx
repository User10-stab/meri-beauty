"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Calendar, Sparkles } from "lucide-react";

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

export default function StaffFinalCTA({ firstName, staffId }) {
  const [sectionRef, sectionInView] = useInView();

  return (
    <section className="relative w-full overflow-hidden bg-gradient-to-b from-white to-[#fdf8f0] py-16 sm:py-20 md:py-24">
      {/* Decorative elements */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-8 top-16 hidden h-24 w-24 rotate-45 border border-[#b89664]/20 lg:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-60px] bottom-20 hidden h-48 w-48 rounded-full border border-[#b89664]/20 lg:block"
      >
        <div className="absolute inset-8 rounded-full border border-[#b89664]/15" />
      </div>

      <div className="relative mx-auto max-w-[900px] px-4 sm:px-6 md:px-10 lg:px-14">
        <div
          ref={sectionRef}
          className={`transition-all duration-700 ease-out ${
            sectionInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="overflow-hidden rounded-[2rem] border border-[#ede5d8] bg-gradient-to-br from-[#2F3A2E] to-[#212a20] px-8 py-12 text-center shadow-[0_12px_40px_rgba(47,58,46,0.2)] sm:px-12 sm:py-16">
            {/* Icon */}
            <div className="mb-6 flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm">
                <Sparkles size={28} className="text-[#b89664]" />
              </div>
            </div>

            {/* Heading */}
            <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.5rem] md:text-[3rem]">
              Prête à prendre soin de vous ?
            </h2>

            {/* Text */}
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
              Réservez votre prochain rendez-vous avec {firstName} et offrez-vous un moment de détente et de beauté personnalisé.
            </p>

            {/* CTA Button */}
            <div className="mt-10">
              <Link
                href={`/reservation?staff=${staffId}`}
                className="inline-flex items-center gap-2 rounded-full bg-white px-10 py-4 text-base font-semibold text-[#2F3A2E] shadow-lg transition-all duration-200 hover:bg-[#fdf8f0] hover:shadow-xl sm:text-lg"
              >
                <Calendar size={20} />
                Prendre rendez-vous
              </Link>
              <p className="mt-4 text-sm text-white/60">
                Réservation en ligne • Confirmation immédiate
              </p>
            </div>

            {/* Decorative line */}
            <div
              aria-hidden="true"
              className="mt-10 flex items-center justify-center gap-3 text-white/20"
            >
              <span className="h-px w-16 bg-current" />
              <span className="h-2 w-2 rotate-45 border border-current" />
              <span className="h-px w-16 bg-current" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
