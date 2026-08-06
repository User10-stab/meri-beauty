"use client";

import { motion } from "framer-motion";

export function AnimatedBlock({ text, image, reverse = false }) {
  return (
    <div className={`flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-16 ${reverse ? "lg:flex-row-reverse" : ""}`}>
      <motion.div
        className="flex-1"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
      >
        {text}
      </motion.div>
      <motion.div
        className="flex-1"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
      >
        {image}
      </motion.div>
    </div>
  );
}
