import Link from "next/link";

export const metadata = { title: "Page introuvable" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-cream px-6 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Erreur 404</span>
      <h1 className="mt-4 text-[2.4rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[3rem]">
        Cette page n&apos;existe pas
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink/55">
        Le lien que vous avez suivi est peut-être incorrect, ou la page a été déplacée.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold px-8 py-3.5 text-[15px] font-semibold text-white shadow-lg transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20"
      >
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
