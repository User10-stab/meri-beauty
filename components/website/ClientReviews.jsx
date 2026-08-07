"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { StarIcon } from "./icons";

const REVIEWS = [
  {
    id: 1,
    name: "Camille Renard",
    service: "Coloration & Soin",
    review:
      "Une expérience inégalée ! Le soin est au-dessus et le personnel est très à l'écoute de tous les détails de la beauté.",
    image: "/Images/clients/client-1.webp",
    rating: 5,
  },
  {
    id: 2,
    name: "Emma S.",
    service: "Bon Voyage",
    review:
      "Le meilleur salon que j'ai trouvé. Au-dessus et les professionnels talentueuses à vous mettre..",
    image: "/Images/clients/client-2.webp",
    rating: 5,
  },
  {
    id: 3,
    name: "Mejrem A.",
    service: "Coiffure & Brushing",
    review:
      "La raison de revenir à 100% ! Accueil chaleureux et prestations de très haute qualité. Je recommande vraiment.",
    image: "/Images/clients/client-3.webp",
    rating: 5,
  },
  {
    id: 4,
    name: "Sophie Laurent",
    service: "Soin du Visage",
    review:
      "Un havre de paix en plein centre-ville. Le soin du visage m'a laissée rayonnante pendant des jours entiers.",
    image: "/Images/clients/client-4.webp",
    rating: 5,
  },
  {
    id: 5,
    name: "Isabelle Moreau",
    service: "Massage Bien-être",
    review:
      "Ambiance feutrée et personnel aux petits soins. Je repars à chaque fois ressourcée et détendue. Un vrai luxe.",
    image: "/Images/clients/client-5.webp",
    rating: 5,
  },
  {
    id: 6,
    name: "Nadia Osman",
    service: "Manucure Premium",
    review:
      "Résultat parfait et tenu impeccable. Chaque détail est soigné avec soin — on se sent vraiment choyée.",
    image: "/Images/clients/client-6.webp",
    rating: 5,
  },
];

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

export default function ClientReviews() {
  const [headerRef, headerInView] = useInView();
  const [carouselRef, carouselInView] = useInView();
  const [currentIndex, setCurrentIndex] = useState(0);
  const totalSlides = Math.ceil(REVIEWS.length / 3);
  const intervalRef = useRef(null);

  const goTo = (index) => {
    setCurrentIndex(index);
  };

  // Auto-slide
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % totalSlides);
    }, 4500);
    return () => clearInterval(intervalRef.current);
  }, [totalSlides]);

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
                  {REVIEWS.slice(slideIndex * 3, slideIndex * 3 + 3).map(
                    (review) => (
                      <ReviewCard key={review.id} review={review} />
                    )
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Dots */}
          <div className="mt-10 flex justify-center gap-2.5">
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

      {/* Stars */}
      <div className="flex gap-1">
        {Array.from({ length: review.rating }).map((_, i) => (
          <StarIcon key={i} className="h-3.5 w-3.5 text-gold" />
        ))}
      </div>

      {/* Author */}
      <div className="flex items-center gap-3 border-t border-black/5 pt-4">
        {/* Avatar */}
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-cream">
          <Image
            src={review.image}
            alt={review.name}
            fill
            className="object-cover object-top"
          />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-ink">{review.name}</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.10em] text-gold">
            {review.service}
          </p>
        </div>
      </div>

      {/* Hover bottom accent */}
      <div className="absolute inset-x-6 bottom-0 h-[2px] origin-center scale-x-0 rounded-full bg-gradient-to-r from-gold/40 via-gold to-gold/40 transition-transform duration-300 group-hover:scale-x-100" />
    </article>
  );
}
