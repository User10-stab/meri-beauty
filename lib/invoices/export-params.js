/** The Factures filters carried by an export URL — same keys as the page. */
export function invoiceFiltersFromSearchParams(searchParams) {
  const get = (key) => searchParams.get(key) || undefined;
  return {
    q: get("q"),
    delivery: get("delivery"),
    source: get("source"),
    paymentStatus: get("paymentStatus"),
    from: get("from"),
    to: get("to"),
  };
}

export function invoiceExportFilename(filters, extension) {
  return `factures-${filters.from ?? "debut"}_${filters.to ?? "aujourdhui"}.${extension}`;
}
