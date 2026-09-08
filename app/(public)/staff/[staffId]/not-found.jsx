import Link from "next/link";
import { UserX, Home, Users } from "lucide-react";

export default function StaffNotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-white to-[#fdf8f0] px-4">
      <div className="w-full max-w-lg text-center">
        {/* Icon */}
        <div className="mb-6 flex items-center justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#b89664] to-[#d9c9a8] text-white shadow-lg">
            <UserX size={40} />
          </div>
        </div>

        {/* Heading */}
        <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2.5rem] md:text-[3rem]">
          Membre introuvable
        </h1>

        {/* Description */}
        <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-[#6f6a64] sm:text-lg">
          Ce membre de l'équipe n'existe pas ou n'est plus disponible.
        </p>

        {/* CTA Buttons */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/#equipe"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#2F3A2E] px-8 py-4 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:bg-[#212a20] hover:shadow-xl sm:w-auto"
          >
            <Users size={18} />
            Voir l'équipe
          </Link>
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-[#2F3A2E] bg-white px-8 py-4 text-sm font-semibold text-[#2F3A2E] transition-all duration-200 hover:bg-[#fdf8f0] sm:w-auto"
          >
            <Home size={18} />
            Retour à l'accueil
          </Link>
        </div>

        {/* Decorative divider */}
        <div
          aria-hidden="true"
          className="mt-12 flex items-center justify-center gap-3 text-[#b89664]/40"
        >
          <span className="h-px w-12 bg-current" />
          <span className="h-2 w-2 rotate-45 border border-current" />
          <span className="h-px w-12 bg-current" />
        </div>
      </div>
    </div>
  );
}
