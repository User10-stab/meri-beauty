"use client";

import { useEffect, useRef, useState } from "react";
import { StarIcon } from "./icons";

/**
 * Testimonials come from lib/reviews/get-public-reviews.js — real Review rows
 * written by customers after a COMPLETED appointment. They used to be a
 * hardcoded array of six invented 5-star quotes with stock portraits, which is
 * a misleading commercial practice under Book VI of the Belgian Code de droit
 * économique. Nothing renders until real reviews exist.
 */

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
  const totalSlides = Math.max(1, Math.ceil(reviews.length / 3));
  const intervalRef = useRef(null);

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
            Tous les avis ci-dessous ont été rédigés depuis leur espace client par des
            personnes ayant réellement effectué un rendez-vous au salon. Ils sont affichés
            du plus récent au plus ancien, sans sélection sur la note.
          </p>
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
                  {reviews.slice(slideIndex * 3, slideIndex * 3 + 3).map(
                    (review) => (
                      <ReviewCard key={review.id} review={review} />
                    )
                  )}
                </div>
              ))}
            </div>
          </div>

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

      {/* Review text */}
      <p className="flex-1 text-[14px] leading-[1.8] text-ink/60">
        "{review.review}"
      </p>

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
