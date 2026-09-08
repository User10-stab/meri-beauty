"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Clock } from "lucide-react";

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

const DAY_NAMES = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

export default function StaffAvailability({ workingHours, rythme, firstName }) {
  const [sectionRef, sectionInView] = useInView();

  if (!workingHours || workingHours.length === 0) {
    return null;
  }

  return (
    <section className="relative w-full overflow-hidden bg-white py-16 sm:py-20 md:py-24">
      <div className="mx-auto max-w-[800px] px-4 sm:px-6 md:px-10 lg:px-14">
        <div
          ref={sectionRef}
          className={`transition-all duration-700 ease-out ${
            sectionInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Header */}
          <div className="mb-10 text-center sm:mb-12">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#2F3A2E] text-white">
              <Calendar size={20} />
            </div>
            <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2.5rem]">
              Disponibilités
            </h2>
            {rythme && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#d9c9a8] bg-[#fdf8f0] px-4 py-2">
                <Clock size={14} className="text-[#b89664]" />
                <span className="text-sm font-medium text-[#6f6a64]">
                  {firstName} travaille{" "}
                  {rythme === "ONE_DAY_PER_WEEK"
                    ? "1 jour par semaine"
                    : rythme === "TWO_DAYS_PER_WEEK"
                      ? "2 jours par semaine"
                      : rythme === "THREE_DAYS_PER_WEEK"
                        ? "3 jours par semaine"
                        : rythme === "FULL_WEEK"
                          ? "toute la semaine"
                          : rythme}
                </span>
              </div>
            )}
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[#6f6a64] sm:text-base">
              Horaires habituels • Sous réserve de disponibilité
            </p>
          </div>

          {/* Schedule */}
          <div className="overflow-hidden rounded-2xl border border-[#ede5d8] bg-[#fdf8f0] shadow-[0_4px_24px_rgba(47,58,46,0.08)]">
            {workingHours.map((hour, index) => (
              <div
                key={hour.day}
                className={`flex items-center justify-between px-6 py-5 sm:px-8 sm:py-6 ${
                  index !== workingHours.length - 1
                    ? "border-b border-[#ede5d8]"
                    : ""
                }`}
              >
                <span className="font-medium text-[#2F3A2E]">
                  {DAY_NAMES[hour.day]}
                </span>
                {hour.isClosed ? (
                  <span className="text-sm font-medium text-[#9a9590]">
                    Fermé
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-[#b89664]">
                    {hour.startTime} → {hour.endTime}
                  </span>
                )}
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-[#9a9590]">
            Ces horaires sont indicatifs. La disponibilité réelle est confirmée lors de la réservation.
          </p>
        </div>
      </div>
    </section>
  );
}
