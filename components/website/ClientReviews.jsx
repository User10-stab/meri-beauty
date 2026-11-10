"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StarIcon } from "./icons";

/**
 * Testimonials come from lib/reviews/get-public-reviews.js — real Review rows
 * written by customers after a COMPLETED appointment. They used to be a
 * hardcoded array of six invented 5-star quotes with stock portraits, which is
 * a misleading commercial practice under Book VI of the Belgian Code de droit
 * économique. Nothing renders until real reviews exist.
 *
 * Every review is shown, with or without a written comment. Visitors can
 * narrow the list by type, rating and prestation; the default view is all
 * reviews, newest-first, with no selection on the rating.
 */

const TYPE_LABELS = {
  APPOINTMENT: "Rendez-vous",
  WORKSHOP: "Ateliers & événements",
  FORMATION: "Formations",
};
const TYPE_ORDER = ["APPOINTMENT", "WORKSHOP", "FORMATION"];

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
      { threshold: 0.15, ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

function QuoteIcon({ className = "w-8 h-8" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M11.3 6C9 6.9 7.5 9 7.5 11.2c0 .3 0 .5.1.8.3-.1.7-.2 1.1-.2 1.7 0 3 1.3 3 3s-1.3 3-3 3S5.5 16.5 5.5 15c0-4.4 2.6-8.1 6.6-9.6L11.3 6zm9 0c-2.3.9-3.8 3-3.8 5.2 0 .3 0 .5.1.8.3-.1.7-.2 1.1-.2 1.7 0 3 1.3 3 3s-1.3 3-3 3-3.2-1.3-3.2-2.8c0-4.4 2.6-8.1 6.6-9.6L20.3 6z" />
    </svg>
  );
}

export default function ClientReviews({ reviews = [] }) {
  const [headerRef, headerInView] = useInView();
  const [carouselRef, carouselInView] = useInView();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [ratingFilter, setRatingFilter] = useState("ALL");
  const [serviceFilter, setServiceFilter] = useState("ALL");
  const intervalRef = useRef(null);

  const typeCounts = useMemo(() => {
    const counts = {};
    for (const r of reviews) counts[r.type] = (counts[r.type] ?? 0) + 1;
    return counts;
  }, [reviews]);
  const availableTypes = TYPE_ORDER.filter((t) => typeCounts[t]);

  const byType = useMemo(
    () => (typeFilter === "ALL" ? reviews : reviews.filter((r) => r.type === typeFilter)),
    [reviews, typeFilter]
  );
  const services = useMemo(
    () =>
      [...new Set(byType.map((r) => r.service).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "fr")
      ),
    [byType]
  );
  const filtered = useMemo(
    () =>
      byType.filter(
        (r) =>
          (ratingFilter === "ALL" || r.rating === Number(ratingFilter)) &&
          (serviceFilter === "ALL" || r.service === serviceFilter)
      ),
    [byType, ratingFilter, serviceFilter]
  );
  const average = filtered.length
    ? filtered.reduce((sum, r) => sum + r.rating, 0) / filtered.length
    : 0;

  const totalSlides = Math.max(1, Math.ceil(filtered.length / 3));
  const isFiltered = typeFilter !== "ALL" || ratingFilter !== "ALL" || serviceFilter !== "ALL";

  // Filters always restart from the first slide.
  const chooseType = (type) => {
    setTypeFilter(type);
    setServiceFilter("ALL"); // a prestation belongs to one type
    setCurrentIndex(0);
  };
  const chooseRating = (value) => {
    setRatingFilter(value);
    setCurrentIndex(0);
  };
  const chooseService = (value) => {
    setServiceFilter(value);
    setCurrentIndex(0);
  };
  const resetFilters = () => {
    setTypeFilter("ALL");
    setRatingFilter("ALL");
    setServiceFilter("ALL");
    setCurrentIndex(0);
  };

  const goTo = (index) => {
    setCurrentIndex(index);
  };

  // Auto-slide. Pointless with a single slide, and the modulo would just keep
  // resetting state on a timer for nothing.
  useEffect(() => {
    if (totalSlides <= 1) return;
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % totalSlides);
    }, 4500);
    return () => clearInterval(intervalRef.current);
  }, [totalSlides]);

  // Hooks above run unconditionally; the guard sits below them. An empty
  // section beats an invented one — on opening day there are no reviews yet.
  if (reviews.length === 0) return null;

  return (
    <section className="relative w-full overflow-hidden bg-cream">
      {/* Background decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 60px)",
        }}
      />

      <div className="mx-auto max-w-[1400px] px-6 py-20 md:px-10 lg:px-14 lg:py-28">
        {/* Header */}
        <div
          ref={headerRef}
          className={`mb-16 text-center transition-all duration-700 ease-out ${
            headerInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="mb-5 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
              Avis Clients
            </span>
            <span className="h-px w-8 bg-gold" />
          </div>

          <h2 className="mb-6 text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[2.4rem] lg:text-[2.6rem]">
            Elles nous font{" "}
            <em className="font-light text-gold/80 not-italic">confiance.</em>
          </h2>

          {/* Art. VI.99/2 CDE requires stating how reviews are verified as
              genuine whenever a trader displays them. */}
          <p className="mx-auto max-w-2xl text-[13px] leading-relaxed text-ink/50">
            Tous les avis ci-dessous ont été déposés par des personnes
            ayant réellement effectué un rendez-vous, un atelier ou une formation au salon. Ils sont affichés
            du plus récent au plus ancien, sans sélection sur la note, avec ou sans
            commentaire.
          </p>
        </div>

        {/* Filters — the visitor's choice; the default view is every review. */}
        <div className="mb-10 flex flex-col items-center gap-5">
          <div className="flex items-center gap-2 text-ink">
            <StarIcon aria-hidden="true" className="h-4 w-4 text-gold" />
            <span className="text-[15px] font-semibold">
              {filtered.length ? average.toFixed(1).replace(".", ",") : "–"}
            </span>
            <span className="text-[13px] text-ink/50">
              · {filtered.length} avis{isFiltered ? ` sur ${reviews.length}` : ""}
            </span>
          </div>

          {availableTypes.length > 1 ? (
            <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Type de prestation">
              <FilterPill active={typeFilter === "ALL"} onClick={() => chooseType("ALL")}>
                Tous <span className="opacity-60">{reviews.length}</span>
              </FilterPill>
              {availableTypes.map((type) => (
                <FilterPill key={type} active={typeFilter === type} onClick={() => chooseType(type)}>
                  {TYPE_LABELS[type]} <span className="opacity-60">{typeCounts[type]}</span>
                </FilterPill>
              ))}
            </div>
          ) : null}

          <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
            <FilterSelect
              label="Note"
              value={ratingFilter}
              onChange={chooseRating}
              options={[
                { value: "ALL", label: "Toutes les notes" },
                ...[5, 4, 3, 2, 1].map((n) => ({
                  value: String(n),
                  label: `${n} étoile${n > 1 ? "s" : ""} (${byType.filter((r) => r.rating === n).length})`,
                })),
              ]}
            />
            {services.length > 1 ? (
              <FilterSelect
                label="Prestation"
                value={serviceFilter}
                onChange={chooseService}
                options={[
                  { value: "ALL", label: "Toutes les prestations" },
                  ...services.map((name) => ({ value: name, label: name })),
                ]}
              />
            ) : null}
          </div>
        </div>

        {/* Carousel */}
        <div
          ref={carouselRef}
          className={`transition-all duration-700 ease-out delay-200 ${
            carouselInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Desktop: 3 cards per slide */}
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-700 ease-out"
              style={{ transform: `translateX(-${currentIndex * 100}%)` }}
            >
              {Array.from({ length: totalSlides }).map((_, slideIndex) => (
                <div
                  key={slideIndex}
                  className="grid min-w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {filtered.slice(slideIndex * 3, slideIndex * 3 + 3).map(
                    (review) => (
                      <ReviewCard key={review.id} review={review} />
                    )
                  )}
                </div>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-white p-10 text-center shadow-sm shadow-black/5">
              <p className="text-[14px] text-ink/60">Aucun avis ne correspond à ces filtres.</p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 text-[13px] font-semibold text-gold underline-offset-4 hover:underline"
              >
                Voir tous les avis
              </button>
            </div>
          ) : null}

          {/* Dots — nothing to navigate between with a single slide */}
          <div className={`mt-10 flex justify-center gap-2.5 ${totalSlides <= 1 ? "hidden" : ""}`}>
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Aller au slide ${i + 1}`}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === currentIndex
                    ? "w-8 bg-gold"
                    : "w-2 bg-gold/30 hover:bg-gold/50"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewCard({ review }) {
  return (
    <article className="group relative flex flex-col gap-4 rounded-2xl bg-white p-7 shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-gold/8">
      {/* Quote icon */}
      <div className="text-gold/20">
        <QuoteIcon className="h-7 w-7" />
      </div>

      {/* Review text — a rating left without a comment is still shown */}
      {review.review ? (
        <p className="flex-1 text-[14px] leading-[1.8] text-ink/60">
          "{review.review}"
        </p>
      ) : (
        <p className="flex-1 text-[13px] italic leading-[1.8] text-ink/40">
          Note laissée sans commentaire.
        </p>
      )}

      {/* Stars — always out of 5, so a 3-star review can't read as a 3-star max */}
      <div className="flex gap-1" aria-label={`${review.rating} sur 5`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <StarIcon
            key={i}
            aria-hidden="true"
            className={`h-3.5 w-3.5 ${i < review.rating ? "text-gold" : "text-gold/20"}`}
          />
        ))}
      </div>

      {/* Author. Initials rather than a photo — the previous stock portraits
          depicted people who were never customers here. */}
      <div className="flex items-center gap-3 border-t border-black/5 pt-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream text-[13px] font-semibold text-gold">
          {review.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-[14px] font-semibold text-ink">{review.name}</p>
          {review.service ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.10em] text-gold">
              {review.service}
            </p>
          ) : null}
        </div>
      </div>

      {/* Hover bottom accent */}
      <div className="absolute inset-x-6 bottom-0 h-[2px] origin-center scale-x-0 rounded-full bg-gradient-to-r from-gold/40 via-gold to-gold/40 transition-transform duration-300 group-hover:scale-x-100" />
    </article>
  );
}

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
        active
          ? "bg-ink text-white"
          : "bg-white text-ink/70 shadow-sm shadow-black/5 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-ink/50">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-full border border-black/10 bg-white px-4 py-2 text-[13px] normal-case tracking-normal text-ink focus:border-gold focus:outline-none sm:w-auto"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
