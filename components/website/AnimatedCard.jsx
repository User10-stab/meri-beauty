"use client";

import { motion } from "framer-motion";

export function AnimatedCard({ children, index = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, delay: index * 0.08, ease: "easeOut" },
      }}
      viewport={{ once: true, margin: "-50px" }}
      whileHover={{
        y: -8,
        boxShadow: "0 24px 48px rgba(0,0,0,0.12)",
        transition: { duration: 0.25 },
      }}
      animate={{
        y: [0, -3, 0],
        transition: {
          duration: 3 + (index % 3) * 0.5,
          repeat: Infinity,
          ease: "easeInOut",
        },
      }}
      className="will-change-transform"
    >
      {children}
    </motion.div>
  );
}
