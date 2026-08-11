"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    // Server-side logging only — never show error internals to the visitor.
    console.error("[unhandled error boundary]", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-cream px-6 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Une erreur est survenue</span>
      <h1 className="mt-4 text-[2.4rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[3rem]">
        Quelque chose s&apos;est mal passé
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink/55">
        Nous n&apos;avons pas pu afficher cette page. Vous pouvez réessayer, ou revenir à l&apos;accueil.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-full bg-gold px-8 py-3.5 text-[15px] font-semibold text-white shadow-lg transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20"
        >
          Réessayer
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-8 py-3.5 text-[15px] font-semibold text-ink/70 transition-all duration-300 hover:border-ink/30 hover:text-ink"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
