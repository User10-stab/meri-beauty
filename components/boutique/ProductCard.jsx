import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ProductPrice } from "@/components/boutique/ProductPrice";

export function ProductCard({ product, variant = "grid" }) {
  const t = useTranslations("boutique");

  if (variant === "list") {
    return (
      <Link href={`/boutique/${product.slug}`} className="group flex items-center gap-4 py-4">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden bg-neutral-50">
          {product.image ? (
            <Image
              src={product.image}
              alt={product.name}
              fill
              sizes="96px"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wide text-gray-300">
              Meri Beauty
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate text-sm font-medium text-[#2F3A2E] transition-colors group-hover:text-[#C8A46A]">
            {product.name}
          </h3>
          <ProductPrice
            priceIncl={product.priceFrom}
            priceExcl={product.priceFromExclVat}
            compareIncl={product.comparePriceFrom}
            compareExcl={product.comparePriceFromExclVat}
            size="sm"
          />
          {!product.inStock && (
            <span className="inline-block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              {t("soldOut")}
            </span>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/boutique/${product.slug}`} className="group block">
      <div className="relative aspect-square overflow-hidden bg-neutral-50">
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wide text-gray-300">
            Meri Beauty
          </div>
        )}
        {!product.inStock && (
          <span className="absolute left-3 top-3 bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {t("soldOut")}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-0.5">
        <h3 className="text-sm font-medium text-[#2F3A2E] transition-colors group-hover:text-[#C8A46A]">
          {product.name}
        </h3>
        <div className="pt-0.5">
          <ProductPrice
            priceIncl={product.priceFrom}
            priceExcl={product.priceFromExclVat}
            compareIncl={product.comparePriceFrom}
            compareExcl={product.comparePriceFromExclVat}
            size="sm"
          />
        </div>
      </div>
    </Link>
  );
}
