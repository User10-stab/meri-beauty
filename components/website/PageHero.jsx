"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";

export default function PageHero({
  title = "Prenez rendez-vous",
  description = "Choisissez votre prestation, votre experte et l'horaire qui vous convient. Réservez votre rendez-vous en moins d'une minute.",
  buttonText = "Commencer la réservation",
  buttonLink = "#booking",
  backgroundImage = "/images/heroImage.webp",
  label = "Réservez votre moment",
}) {
  return (
    <section
      className="relative overflow-hidden h-[700px] bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url('${backgroundImage}')` }}
    >
      <div className=" mx-auto grid h-full w-full items-center lg:grid-cols-2">
        {/* LEFT CONTENT */}
        <div className="relative h-full w-full z-10 flex flex-col items-center px-6 py-24 bg-[#2F3A2E]/90">
          <div className="mx-auto w-3/4 text-center lg:text-left">
            <span className="mb-5 inline-block text-sm font-semibold uppercase tracking-[0.32em] text-[#C8A46A]">
              {label}
            </span>

            <h1 className="max-w-xl text-5xl font-bold leading-tight text-[#F8F6F2] lg:text-[4.3rem]">
              {title}
            </h1>

            <div className="mt-8 h-[3px] w-20 rounded-full bg-[#C8A46A]" />

            <p className="mt-8 max-w-lg text-[17px] leading-9 text-gray-300">
              {description}
            </p>

            <div className="mt-12 flex flex-wrap gap-5">
              <Link
                href={buttonLink}
                className="inline-flex items-center gap-3 rounded-xl bg-[#C8A46A] px-4 py-4 font-medium text-white transition hover:-translate-y-1 hover:bg-[#243022]"
              >
                <CalendarDays size={20} />
                {buttonText}
              </Link>
            </div>

            {/* Stats */}
            <div className="mt-16 grid max-w-md grid-cols-3 gap-8">
              <div>
                <h3 className="text-3xl font-bold text-[#F8F6F2]">500+</h3>
                <p className="mt-2 text-sm uppercase tracking-widest text-gray-300">Clientes</p>
              </div>
              <div>
                <h3 className="text-3xl font-bold text-[#F8F6F2]">12</h3>
                <p className="mt-2 text-sm uppercase tracking-widest text-gray-300">Expertes</p>
              </div>
              <div>
                <h3 className="text-3xl font-bold text-[#F8F6F2]">4.9★</h3>
                <p className="mt-2 text-sm uppercase tracking-widest text-gray-300">Avis</p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT IMAGE */}
        <div className="relative h-full w-full">
          <div className="absolute inset-y-0 left-0 w-52 bg-gradient-to-r from-[#2F3A2E]/90 via-[#2F3A2E]/80 to-transparent" />
        </div>
      </div>
    </section>
  );
}