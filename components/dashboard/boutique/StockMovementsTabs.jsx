import Link from "next/link";
import { ListOrdered, TrendingUp } from "lucide-react";

const TABS = [
  { key: "journal", href: "/dashboard/boutique/stock/mouvements", label: "Journal des mouvements", icon: ListOrdered },
  { key: "performance", href: "/dashboard/boutique/stock/mouvements/performance", label: "Performance par produit", icon: TrendingUp },
];

/**
 * The two views of the Mouvements de stock: the movement-by-movement ledger,
 * and the per-product roll-up over several months used to decide what stays
 * on the shelf. Separate routes (not a query param) so each keeps its own
 * filters in the URL.
 */
export function StockMovementsTabs({ active }) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-stroke dark:border-dark-3" aria-label="Vues des mouvements de stock">
      {TABS.map(({ key, href, label, icon: Icon }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              isActive
                ? "border-[#2f3a2e] text-[#2f3a2e] dark:border-white dark:text-white"
                : "border-transparent text-gray-500 hover:text-primary dark:text-dark-6"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
