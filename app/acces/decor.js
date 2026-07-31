"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

const SPARKLES = [
  { className: "left-[6%] top-[22%] h-4 w-4", delay: 0 },
  { className: "right-[16%] top-[16%] h-6 w-6", delay: 0.8 },
  { className: "left-[12%] bottom-[24%] h-5 w-5", delay: 1.6 },
  { className: "right-[8%] bottom-[30%] h-3 w-3", delay: 2.2 },
  { className: "left-[28%] top-[12%] h-3 w-3", delay: 2.8 },
];

export default function FloatingDecor() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      {/* Glow orbs */}
      <div className="absolute -right-24 top-[18%] h-[420px] w-[420px] rounded-full bg-gold/15 blur-[130px]" />
      <div className="absolute -left-32 bottom-[8%] h-[380px] w-[380px] rounded-full bg-[#8a6a3f]/20 blur-[130px]" />

      {/* Rotating dashed ring */}
      <div className="absolute right-[6%] top-[14%] hidden h-[400px] w-[400px] animate-spin-slow rounded-full border border-dashed border-gold/15 lg:block" />
      <div className="absolute right-[9%] top-[17%] hidden h-[340px] w-[340px] animate-spin-slow rounded-full border border-gold/10 [animation-direction:reverse] lg:block" />

      {/* Floating sparkles */}
      {SPARKLES.map((s, i) => (
        <motion.span
          key={i}
          className={`absolute ${s.className} text-gold/60`}
          animate={{
            opacity: [0.15, 0.85, 0.15],
            scale: [1, 1.25, 1],
            y: [0, -12, 0],
          }}
          transition={{
            duration: 4.5,
            delay: s.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <Sparkles className="h-full w-full" />
        </motion.span>
      ))}
    </div>
  );
}
