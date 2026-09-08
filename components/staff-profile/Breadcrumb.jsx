"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

export default function Breadcrumb({ staffName }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="w-full border-b border-[#ede5d8]/50 bg-white py-3"
    >
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 md:px-10 lg:px-14">
        <ol className="flex items-center gap-2 text-sm">
          <li className="flex items-center">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-[#6f6a64] transition-colors hover:text-[#2F3A2E]"
            >
              <Home size={14} />
              <span>Accueil</span>
            </Link>
          </li>

          <li className="flex items-center">
            <ChevronRight size={14} className="text-[#9a9590]" />
          </li>

          <li className="flex items-center">
            <Link
              href="/#equipe"
              className="text-[#6f6a64] transition-colors hover:text-[#2F3A2E]"
            >
              Notre équipe
            </Link>
          </li>

          <li className="flex items-center">
            <ChevronRight size={14} className="text-[#9a9590]" />
          </li>

          <li>
            <span className="font-medium text-[#2F3A2E]" aria-current="page">
              {staffName}
            </span>
          </li>
        </ol>
      </div>
    </nav>
  );
}
