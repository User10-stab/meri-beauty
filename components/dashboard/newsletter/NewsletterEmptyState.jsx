"use client";

import { Send } from "lucide-react";

/**
 * Empty state for when no newsletters exist yet.
 */
export function NewsletterEmptyState() {
  return (
    <tr>
      <td colSpan={7}>
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <Send size={28} className="text-gray-400" />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-700">
              Aucune newsletter
            </p>
            <p className="mt-1 text-sm text-gray-400">
              Créez votre première newsletter pour communiquer avec vos clients.
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}