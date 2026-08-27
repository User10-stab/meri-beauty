import Image from "next/image";
import AccessForm from "./access-form";
import FloatingDecor from "./decor";

export const metadata = {
  title: "Accès réservé",
  description: "Cette plateforme est en cours de développement.",
};

const SERVICES = [
  "Dépose de gel",
  "Soins visage",
  "Manucure",
  "Massage bien-être",
  "Nail art",
  "Rituels corps",
];

const CAUTION_STRIPE = {
  backgroundImage:
    "repeating-linear-gradient(45deg, #b89664 0 16px, #212a20 16px 32px)",
};

export default function AccessPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-primary">
      {/* ═══ Immersive background ═══ */}
      <div className="absolute inset-0 -z-10">
        <Image
          src="/Images/hero.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="animate-slow-zoom object-cover object-center opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-primary via-primary/75 to-primary" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(184,150,100,0.18),transparent_55%)]" />
      </div>

      {/* Top caution stripe */}
      <div className="h-2 w-full shrink-0" style={CAUTION_STRIPE} />

      {/* ═══ Content ═══ */}
      <section className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 items-center px-6 py-16 md:px-10">
        <div className="w-full text-center">
          <div className="animate-fade-up">
            <Image
              src="/Images/image.webp"
              alt="Meri Beauty Studio"
              width={180}
              height={110}
              priority
              className="mx-auto h-16 w-auto object-contain"
            />
          </div>

          <div
            className="animate-fade-up mt-8 flex justify-center"
            style={{ animationDelay: "0.12s" }}
          >
            <span className="inline-flex items-center gap-2.5 rounded-full border border-gold/40 bg-black/25 px-4 py-2 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
                🚧 En cours de développement
              </span>
            </span>
          </div>

          <h1
            className="animate-fade-up mt-6 font-display text-6xl font-medium leading-[1.05] tracking-tight text-cream sm:text-7xl lg:text-8xl"
            style={{ animationDelay: "0.22s" }}
          >
            Meri Beauty{" "}
            <em className="block bg-gradient-to-r from-gold via-[#d9c9a8] to-gold bg-clip-text font-light not-italic text-transparent">
              Studio
            </em>
          </h1>

          <p
            className="animate-fade-up mx-auto mt-7 max-w-xl text-lg leading-relaxed text-white/70"
            style={{ animationDelay: "0.32s" }}
          >
            Notre plateforme est actuellement en cours de développement.
            Nous préparons quelque chose d&rsquo;exceptionnel pour votre
            expérience beauté.
          </p>

          <p
            className="animate-fade-up mt-3 text-sm text-white/50"
            style={{ animationDelay: "0.4s" }}
          >
            Si vous êtes un membre autorisé, cliquez sur «&nbsp;Accéder&nbsp;».
          </p>

          <div
            className="animate-fade-up flex justify-center"
            style={{ animationDelay: "0.5s" }}
          >
            <AccessForm />
          </div>
        </div>
      </section>

      {/* ═══ Services marquee ═══ */}
      <div className="relative z-10 w-full overflow-hidden border-y border-white/10 bg-black/40 py-4 backdrop-blur-sm">
        <div className="flex w-max animate-marquee">
          <MarqueeGroup />
          <MarqueeGroup aria-hidden="true" />
        </div>
      </div>

      {/* Bottom caution stripe */}
      <div className="h-2 w-full shrink-0" style={CAUTION_STRIPE} />

      {/* Floating decorative elements */}
      <FloatingDecor />
    </main>
  );
}

function MarqueeGroup(props) {
  return (
    <div className="flex shrink-0 items-center gap-10 pr-10" {...props}>
      {SERVICES.map((service) => (
        <span
          key={service}
          className="flex items-center gap-10 text-[12px] font-medium uppercase tracking-[0.2em] text-white/55"
        >
          {service}
          <span className="h-1.5 w-1.5 rotate-45 bg-gold/70" />
        </span>
      ))}
    </div>
  );
}
