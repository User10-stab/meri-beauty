import Image from "next/image";
import { ArrowIcon, StarIcon, ClockIcon, MapPinIcon } from "./icons";
import { getSalon } from "@/actions/salon/get-salon";
import { groupWorkingDays } from "@/lib/groupWorkingDays";
import WorkshopBanner from "./WorkshopBanner";

const SERVICES = [
  "Coiffure",
  "Soins visage",
  "Manucure",
  "Massage bien-être",
  "Maquillage",
  "Rituels corps",
];

export default async function Hero() {
   const salon = await getSalon();
   
  const workingDays = groupWorkingDays(salon?.data?.workingDays || []);
  
  
  return (
    /* Outer wrapper: relative so the card can be absolutely positioned.
       Right padding reserves space so the card doesn't overlap the text. */
    <div className="relative w-full">

      {/* ══════════════════════════════════════
          HERO SECTION
      ══════════════════════════════════════ */}
      <section
        id="accueil"
        className="relative flex w-full flex-col"
        style={{ minHeight: "92vh" }}
      >
        {/* Full-bleed background */}
        <div className="absolute inset-0 -z-10">
          <Image
            src="/Images/hero.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/40 to-black/65" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-primary/25 to-transparent" />
        </div>

        {/* Hero content — flex-1 so marquee is pushed to the bottom */}
        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col items-start justify-center px-6 py-28 pr-6 md:px-10 lg:px-14 lg:py-36 lg:pr-[380px]">

          {/* Eyebrow */}
          <div className="mb-7 inline-flex items-center gap-3">
            <span className="h-px w-12 bg-gold" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-gold">
              Salon de beauté &amp; bien-être
            </span>
          </div>

          {/* Headline */}
          <h1 className="w-full text-[3.4rem] font-bold leading-[1.05] tracking-tight text-white sm:text-[4.2rem] lg:text-[5.5rem]">
            Votre Beauté,{" "}
            <em className="block font-light text-gold/90 not-italic">
              Révélée Avec Justesse.
            </em>
          </h1>

          {/* Sub-copy */}
          <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-white/70 sm:text-[18px] lg:text-[19px]">
            Chez Mery Beauty, chaque rituel est pensé sur-mesure — des mains
            expertes, des produits nobles et un cadre conçu pour ralentir le temps.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="/reservation"
              className="group inline-flex items-center gap-3 rounded-full bg-gold px-9 py-4 text-[15px] font-semibold text-white shadow-lg transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20"
            >
              Réserver un rendez-vous
              <ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <a
              href="#concept"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 px-9 py-4 text-[15px] font-semibold text-white backdrop-blur-sm transition-all duration-300 hover:border-white/60 hover:bg-white/10"
            >
              Découvrir le concept
            </a>
          </div>

          {/* Trust row */}
          <div className="mt-14 flex items-center gap-5">
            <div>
              <div className="flex items-center gap-1 text-gold">
                {Array.from({ length: 5 }).map((_, i) => (
                  <StarIcon key={i} className="h-4 w-4" />
                ))}
              </div>
              <p className="mt-1 text-[13px] text-white/55">
                4.9 / 5 — plus de 2 000 clientes conquises
              </p>
            </div>
          </div>
        </div>

        {/* ── Marquee strip — last child, sits on the hero background ── */}
        <div className="w-full overflow-hidden border-t border-white/10 bg-black/40 py-5 backdrop-blur-sm">
          <div className="flex w-max animate-marquee">
            <MarqueeGroup />
            <MarqueeGroup aria-hidden="true" />
          </div>
        </div>
      </section>

      {/* Event/workshop promo card — floats over the hero's top-right on
          desktop, plain strip under the hero on mobile (see WorkshopBanner). */}
      <WorkshopBanner />

      {/* ══════════════════════════════════════
          OPENING HOURS FLOATING CARD
          Vertically centered on the right side
          of the hero section.
      ══════════════════════════════════════ */}
     <aside
  aria-label="Opening hours"
  className="absolute right-6 z-20 hidden w-[330px] overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/25 sm:right-10 lg:right-14 lg:block xl:right-20"
  style={{
    transform: "translateY(-50%)",
  }}
>
  {/* Address */}
  <div className="bg-gold px-6 py-5">
    <div className="flex items-start gap-2.5">
      <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-white/80" />

      <p className="whitespace-pre-line text-[14px] font-semibold leading-snug text-white">
        {salon?.data?.address || "Address not available"}
      </p>
    </div>
  </div>

  {/* Card Body */}
  <div className="px-6 py-6">
    <div className="mb-6 flex items-center gap-4 justify-between">
      <h2 className="text-[1.3rem] font-bold uppercase leading-[1.1] tracking-tight text-ink">
        Heures d'ouverture
      </h2>

      <ClockIcon className="mt-0.5 h-9 w-9 text-gold" />
    </div>

    <ul className="flex flex-col gap-4">
      {workingDays.length > 0 ? (
        workingDays.map((item) => (
          <li
            key={item.label}
            className="border-b border-black/8 pb-4 last:border-0 last:pb-0"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/40">
              {item.label}
            </p>

            <p className="mt-1 text-[1.15rem] font-light text-gold">
              {item.hours}
            </p>
          </li>
        ))
      ) : (
        <li>
          <p className="text-sm text-gray-500">
            Opening hours not available.
          </p>
        </li>
      )}
    </ul>
  </div>
</aside>
    </div>
  );
}

function MarqueeGroup(props) {
  return (
    <div className="flex shrink-0 items-center gap-12 pr-12" {...props}>
      {SERVICES.map((service) => (
        <span
          key={service}
          className="flex items-center gap-12 text-[13px] font-medium uppercase tracking-[0.18em] text-white/60"
        >
          {service}
          <span className="h-1.5 w-1.5 rounded-full bg-gold/70" />
        </span>
      ))}
    </div>
  );
}
