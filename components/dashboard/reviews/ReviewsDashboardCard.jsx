"use client";

import { Star } from "lucide-react";

function StaticStars({ rating }) {
  return (
    <div className="flex items-center gap-1 text-amber-400">
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} className={`h-4 w-4 ${index < rating ? "fill-current" : "text-gray-300"}`} />
      ))}
    </div>
  );
}

function formatReviewDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function ReviewsDashboardCard({ data }) {
  const reviews = data?.reviews ?? [];
  const averageRating = data?.averageRating ?? 0;
  const totalReviews = data?.totalReviews ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-sm text-gray-500 dark:text-dark-6">Note moyenne</p>
          <div className="mt-2 flex items-end gap-3">
            <span className="text-3xl font-bold text-dark dark:text-white">{averageRating.toFixed(1)}</span>
            <StaticStars rating={Math.round(averageRating)} />
          </div>
        </div>

        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-sm text-gray-500 dark:text-dark-6">Total des avis</p>
          <div className="mt-2 text-3xl font-bold text-dark dark:text-white">{totalReviews}</div>
        </div>
      </div>

      <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
          <h2 className="text-lg font-semibold text-dark dark:text-white">Derniers avis</h2>
        </div>

        {reviews.length === 0 ? (
          <div className="px-6 py-10 text-sm text-gray-500 dark:text-dark-6">Aucun avis pour le moment.</div>
        ) : (
          <div className="divide-y divide-stroke dark:divide-dark-3">
            {reviews.map((review) => (
              <div key={review.id} className="px-6 py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-dark dark:text-white">{review.customerName}</p>
                    <p className="text-sm text-gray-500 dark:text-dark-6">{review.serviceName}</p>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-dark-6">{formatReviewDate(review.createdAt)}</div>
                </div>
                <div className="mt-3">
                  <StaticStars rating={review.rating} />
                </div>
                {review.comment ? (
                  <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-dark-6">{review.comment}</p>
                ) : (
                  <p className="mt-3 text-sm italic text-gray-400 dark:text-dark-6">Aucun commentaire.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
