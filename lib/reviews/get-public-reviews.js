import { prisma } from "@/lib/prisma";

/**
 * Public homepage testimonials, read straight from the Review table.
 *
 * This replaced a hardcoded REVIEWS array of six invented 5-star testimonials
 * with stock photos. Publishing testimonials that no customer ever wrote is a
 * misleading commercial practice under Book VI of the Belgian Code de droit
 * économique (art. VI.100, 18°) — the section now renders nothing at all until
 * real reviews exist, which is the correct state on opening day.
 *
 * Two rules keep the published set honest, and both are deliberate:
 *
 *  1. No rating filter. Showing only the 4- and 5-star reviews while hiding the
 *     rest is exactly the cherry-picking the Omnibus directive added art.
 *     VI.99/2 to catch. Every review with a written comment is eligible, and
 *     they are ordered newest-first — not best-first.
 *  2. Only reviews attached to a COMPLETED appointment, which is already
 *     enforced at write time by lib/review-eligibility.js. That is what backs
 *     the "avis vérifiés" claim displayed next to them; without it the claim
 *     would itself be the misleading practice.
 *
 * Names are cut to first name + initial before they ever leave the server. The
 * customer consented to reviewing their appointment, not to having their full
 * legal name indexed on a public homepage.
 */

const MAX_PUBLIC_REVIEWS = 9; // 3 carousel slides of 3

function toPublicName(fullName) {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente Meri Beauty";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export async function getPublicReviews(limit = MAX_PUBLIC_REVIEWS) {
  try {
    const reviews = await prisma.review.findMany({
      where: {
        // A star rating with no text is not a testimonial — nothing to display.
        AND: [{ comment: { not: null } }, { comment: { not: "" } }],
        appointment: { status: "COMPLETED" },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        rating: true,
        comment: true,
        user: { select: { fullName: true } },
        appointment: {
          select: {
            staffService: { select: { service: { select: { name: true } } } },
          },
        },
      },
    });

    return reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      review: review.comment,
      name: toPublicName(review.user?.fullName),
      service: review.appointment?.staffService?.service?.name ?? null,
    }));
  } catch (error) {
    // The homepage must render even if the database is briefly unreachable —
    // an empty list simply hides the section.
    console.error("[getPublicReviews]", error);
    return [];
  }
}
