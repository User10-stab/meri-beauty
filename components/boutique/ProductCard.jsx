import Link from "next/link";

export function ProductCard({ product }) {
  return (
    <Link href={`/boutique/${product.slug}`} className="group block">
      <div className="relative aspect-square overflow-hidden bg-neutral-50">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wide text-gray-300">
            Meri Beauty
          </div>
        )}
        {!product.inStock && (
          <span className="absolute left-3 top-3 bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Épuisé
          </span>
        )}
      </div>

      <div className="mt-3 space-y-0.5">
        {product.brand && (
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-gray-400">{product.brand.name}</p>
        )}
        <h3 className="text-sm font-medium text-[#2F3A2E] transition-colors group-hover:text-[#C8A46A]">
          {product.name}
        </h3>
        <div className="flex items-baseline gap-2 pt-0.5">
          <span className="text-sm font-semibold text-[#2F3A2E]">€{product.priceFrom.toFixed(2)}</span>
          {product.comparePriceFrom != null && (
            <span className="text-xs text-gray-400 line-through">€{product.comparePriceFrom.toFixed(2)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
