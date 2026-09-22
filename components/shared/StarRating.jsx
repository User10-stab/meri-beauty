"use client";

import { Star } from "lucide-react";

/**
 * Clickable 1-5 star input, shared by every "leave a review" modal
 * (appointments, ateliers/événements, formations).
 */
export function StarRatingInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4, 5].map((rating) => {
        const active = rating <= value;
        return (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            className="rounded-full p-1 transition-transform hover:scale-110"
            aria-label={`${rating} étoile${rating > 1 ? "s" : ""}`}
          >
            <Star className={`h-7 w-7 ${active ? "fill-[#C8A46A] text-[#C8A46A]" : "text-neutral-300"}`} />
          </button>
        );
      })}
    </div>
  );
}

/** Read-only star display for an already-submitted review. */
export function StaticStars({ rating }) {
  return (
    <div className="flex items-center gap-1 text-[#C8A46A]">
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={`h-4 w-4 ${index < rating ? "fill-current" : "text-neutral-300"}`}
        />
      ))}
    </div>
  );
}
