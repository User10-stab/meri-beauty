"use client";

import { CalendarClock, Infinity as InfinityIcon } from "lucide-react";
import { formatExpiryLabel, formatPromoValue, scopeSummary } from "./promo-format";

/**
 * The code drawn as a physical coupon — dark salon green stub with the
 * value, cream body with the code, split by a perforated edge whose notches
 * are real cut-outs (CSS mask), so it sits on any background. Used as the
 * live preview in the editor and at the top of each card in the list.
 */
export function PromoTicket({ promo, muted = false, size = "md" }) {
  const big = size === "lg";
  const stubWidth = big ? 144 : 112;
  const code = promo.code?.trim() || "VOTRECODE";
  // Shrink long codes instead of truncating them — the whole code is the point.
  const codeSize = code.length > 14
    ? (big ? "text-base tracking-[0.06em]" : "text-sm tracking-[0.05em]")
    : code.length > 10
      ? (big ? "text-xl tracking-[0.08em]" : "text-base tracking-[0.08em]")
      : (big ? "text-2xl tracking-[0.12em]" : "text-lg tracking-[0.12em]");
  const notch = (y) => `radial-gradient(circle 10px at ${stubWidth}px ${y}, #0000 97%, #000 100%)`;
  const mask = `${notch("0")}, ${notch("100%")}`;

  return (
    <div className={`drop-shadow-[0_10px_18px_rgba(47,58,46,0.22)] ${muted ? "opacity-60 grayscale" : ""}`}>
      <div
        className="flex overflow-hidden rounded-2xl"
        style={{ WebkitMaskImage: mask, maskImage: mask, WebkitMaskComposite: "source-in", maskComposite: "intersect" }}
      >
        {/* Stub */}
        <div
          className={`relative flex shrink-0 flex-col items-center justify-center bg-[#2f3a2e] text-center text-white ${
            big ? "px-4 py-7" : "px-3 py-5"
          }`}
          style={{ width: stubWidth }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(200,164,106,0.4),transparent_65%)]" />
          <span className="relative text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C8A46A]">Remise</span>
          <span className={`relative mt-1.5 whitespace-nowrap font-bold leading-none tracking-tight ${big ? "text-3xl" : "text-2xl"}`}>
            {promo.value ? formatPromoValue(promo) : "—"}
          </span>
        </div>

        {/* Body, with the perforation along its left edge */}
        <div className="relative flex min-w-0 flex-1 flex-col justify-center bg-gradient-to-br from-[#fdf8f0] to-[#f3e8d4] px-5 py-4">
          <span className="absolute inset-y-3 left-0 border-l-2 border-dashed border-[#C8A46A]/60" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b89664]">Code promo</span>
          <span
            className={`mt-1 break-all font-mono font-bold leading-tight text-[#2f3a2e] ${codeSize}`}
            title={code}
          >
            {code}
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6f6a64]">
            <span className="inline-flex items-center gap-1">
              {promo.expiresAt ? <CalendarClock size={12} /> : <InfinityIcon size={12} />}
              {formatExpiryLabel(promo.expiresAt)}
            </span>
            <span className="font-medium text-[#2f3a2e]/70">{scopeSummary(promo.scopes)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
