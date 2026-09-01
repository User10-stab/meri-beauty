export function BotanicalLeft() {
  return (
    <svg 
      viewBox="0 0 170 420" 
      fill="none" 
      className="h-[420px] w-[150px] text-[#E8E0D5]" 
      aria-hidden="true"
    >
      <g 
        stroke="currentColor" 
        strokeWidth="0.9" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        fill="none"
      >
        {/* Main stem */}
        <path d="M50 400 C 52 320, 48 240, 52 160 C 56 100, 60 50, 64 16" opacity="0.85" />
        
        {/* Left side branches */}
        <path d="M52 165 C 38 157, 24 149, 16 139 C 24 135, 38 143, 52 165" />
        <path d="M52 190 C 38 182, 24 174, 16 164 C 24 160, 38 168, 52 190" />
        <path d="M51 215 C 37 207, 23 199, 15 189 C 23 185, 37 193, 51 215" />
        <path d="M51 242 C 37 234, 23 226, 15 216 C 23 212, 37 220, 51 242" />
        <path d="M50 270 C 36 262, 22 254, 14 244 C 22 240, 36 248, 50 270" />
        <path d="M50 298 C 38 290, 26 282, 18 272 C 26 268, 38 276, 50 298" />
        
        {/* Right side branches */}
        <path d="M52 155 C 66 147, 80 139, 88 129 C 80 125, 66 133, 52 155" />
        <path d="M51 182 C 65 174, 79 166, 87 156 C 79 152, 65 160, 51 182" />
        <path d="M51 210 C 65 202, 79 194, 87 184 C 79 180, 65 188, 51 210" />
        <path d="M50 235 C 64 227, 78 219, 86 209 C 78 205, 64 213, 50 235" />
        <path d="M50 262 C 64 254, 78 246, 86 236 C 78 232, 64 240, 50 262" />
        
        {/* Top leaves */}
        <path d="M64 16 C 56 10, 48 6, 40 4 C 46 12, 56 16, 64 16" />
        <path d="M64 16 C 72 10, 80 6, 88 4 C 82 12, 72 16, 64 16" />
      </g>
    </svg>
  );
}
