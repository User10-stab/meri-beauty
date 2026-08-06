import { Loader2 } from "lucide-react";

// Shown by Next.js while this page's server component fetches the product
// (and brands) from the DB during navigation — e.g. right after a barcode
// scan resolves, so the screen doesn't just sit blank on a slow/remote DB.
export default function EditProductLoading() {
  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <Loader2 size={22} className="animate-spin text-[#2f3a2e] dark:text-white" />
      <p className="text-sm text-gray-500 dark:text-gray-400">Ouverture de la fiche produit…</p>
    </div>
  );
}
