export default function CardBotanicalSprigs({ index = 0 }) {
  const mirrored = index % 2 ? "scale-x-[-1]" : "";

  return (
    <>
      <div className="pointer-events-none absolute left-2 top-2 text-[#c9b99a]/60">
        <BotanicalSprig className={`h-[52px] w-[42px] ${mirrored}`} />
      </div>
      <div className="pointer-events-none absolute bottom-2 right-2 text-[#c9b99a]/60">
        <BotanicalSprig className={`h-[76px] w-[52px] ${mirrored}`} />
      </div>
    </>
  );
}

function BotanicalSprig({ className }) {
  return (
    <svg viewBox="0 0 60 80" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M30 76 C 30 60, 31 44, 34 28 C 36 18, 38 10, 40 4" />
        <path d="M34 28 C 30 24, 26 20, 22 14 C 26 12, 30 16, 34 28" />
        <path d="M33 36 C 29 32, 25 28, 21 22 C 25 20, 29 24, 33 36" />
        <path d="M32 44 C 28 40, 24 36, 20 30 C 24 28, 28 32, 32 44" />
        <path d="M31 52 C 27 48, 23 44, 19 38 C 23 36, 27 40, 31 52" />
        <path d="M30 60 C 26 56, 22 52, 18 46 C 22 44, 26 48, 30 60" />
        <path d="M35 30 C 39 26, 43 22, 47 16 C 43 14, 39 18, 35 30" />
        <path d="M34 38 C 38 34, 42 30, 46 24 C 42 22, 38 26, 34 38" />
        <path d="M33 46 C 37 42, 41 38, 45 32 C 41 30, 37 34, 33 46" />
      </g>
    </svg>
  );
}