"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import Button from "@/components/ui/Button";
import { previewWixImport, runWixImport } from "@/actions/boutique/import";
import { resolveProductClassification } from "@/lib/wixImport";
import { useTranslations } from "next-intl";

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}

// A single request importing 175 products sequentially can take several
// minutes with zero feedback — indistinguishable from a hang, and easy to
// mistake for "finished" if the tab gets abandoned mid-flight. Splitting the
// work into small batches lets the UI show real progress between requests.
const IMPORT_BATCH_SIZE = 15;

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

export function ImportWixClient() {
  const t = useTranslations("dashboardBoutique.importWix");
  const router = useRouter();
  const [step, setStep] = useState("upload"); // upload | mapping | review | importing | done
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [productsCsv, setProductsCsv] = useState(null);
  const [inventoryCsv, setInventoryCsv] = useState(null);
  const [products, setProducts] = useState([]);
  const [slugs, setSlugs] = useState([]);
  const [slugMapping, setSlugMapping] = useState({});
  const [result, setResult] = useState(null);

  // Warn on tab close/refresh while a multi-minute import is mid-flight —
  // closing the tab does abort the in-flight request, unlike switching tabs.
  useEffect(() => {
    if (step !== "importing") return;
    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = t("stepImporting.leaveConfirm");
      return e.returnValue;
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [step, t]);

  async function handleAnalyze() {
    if (!productsCsv) {
      toast.error(t("stepUpload.selectProductsError"));
      return;
    }
    setLoading(true);
    const res = await previewWixImport({ productsCsv, inventoryCsv });
    setLoading(false);

    if (!res.success) {
      toast.error(res.message);
      return;
    }
    setProducts(res.data.products);
    setSlugs(res.data.slugs);
    setSlugMapping(Object.fromEntries(res.data.slugs.map((s) => [s.slug, s.suggestedKind])));
    setStep("mapping");
  }

  const resolved = useMemo(
    () =>
      products.map((p) => {
        const { brandName, categoryName } = resolveProductClassification(p, slugMapping);
        return { ...p, brandName: brandName || t("unclassified"), categoryName: categoryName || t("unclassified") };
      }),
    [products, slugMapping, t]
  );

  // Both brand AND category must be checked — a product can resolve a real
  // category while still having no brand (or vice-versa), and each falls
  // back to "Non classé" independently. Checking only category here used to
  // undercount, so the warning banner stayed silent on products that were
  // about to land with no brand at all.
  const unclassifiedCount = resolved.filter(
    (p) => p.categoryName === t("unclassified") || p.brandName === t("unclassified")
  ).length;
  const alreadyImportedCount = resolved.filter((p) => p.alreadyImported).length;

  async function handleImport() {
    setStep("importing");
    setProgress({ done: 0, total: products.length });

    const batches = chunk(products, IMPORT_BATCH_SIZE);
    let createdCount = 0;
    let updatedCount = 0;
    const errors = [];

    for (const batch of batches) {
      const res = await runWixImport({ products: batch, slugMapping });
      if (!res.success) {
        toast.error(res.message);
        setStep("review");
        return;
      }
      createdCount += res.data.createdCount;
      updatedCount += res.data.updatedCount;
      errors.push(...res.data.errors);
      setProgress((prev) => ({ ...prev, done: prev.done + batch.length }));
    }

    setResult({ createdCount, updatedCount, errors });
    setStep("done");
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        {step === "importing" ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-300">
            <ArrowLeft size={16} />
          </span>
        ) : (
          <Link
            href="/dashboard/boutique/products"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"
          >
            <ArrowLeft size={16} />
          </Link>
        )}
        <h1 className="text-lg font-semibold text-dark dark:text-white">{t("title")}</h1>
      </div>

      {step === "upload" && (
        <div className="max-w-xl space-y-5 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">
              {t("stepUpload.productsFile")} <span className="text-red-400">{t("stepUpload.productsFileRequired")}</span>
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={async (e) => setProductsCsv(e.target.files[0] ? await readFile(e.target.files[0]) : null)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#2f3a2e] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
            />
            <p className="mt-1 text-xs text-gray-400">{t("stepUpload.productsFileHint")}</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">{t("stepUpload.inventoryFile")}</label>
            <input
              type="file"
              accept=".csv"
              onChange={async (e) => setInventoryCsv(e.target.files[0] ? await readFile(e.target.files[0]) : null)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700"
            />
            <p className="mt-1 text-xs text-gray-400">
              {t("stepUpload.inventoryFileHint")}
            </p>
          </div>

          <Button type="button" onClick={handleAnalyze} disabled={loading || !productsCsv}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {t("stepUpload.analyzeButton")}
          </Button>
        </div>
      )}

      {step === "mapping" && (
        <div className="space-y-5">
          <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
            <p className="text-sm text-gray-600">
              {t("stepMapping.intro", { productsCount: products.length, slugsCount: slugs.length })}
            </p>
          </div>

          <div className="overflow-hidden rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stroke text-left text-xs uppercase tracking-wide text-gray-500 dark:border-dark-3">
                  <th className="px-4 py-3">{t("stepMapping.table.wixLabel")}</th>
                  <th className="px-4 py-3">{t("stepMapping.table.usedBy")}</th>
                  <th className="px-4 py-3">{t("stepMapping.table.classification")}</th>
                </tr>
              </thead>
              <tbody>
                {slugs.map((s) => (
                  <tr key={s.slug} className="border-b border-stroke last:border-0 dark:border-dark-3">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-800 dark:text-white">{s.readable}</span>
                      {s.suggestionReason && <span className="block text-xs text-gray-400">{s.suggestionReason}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{s.count} {s.count > 1 ? t("stepMapping.table.products") : t("stepMapping.table.product")}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-3 text-xs">
                        {[
                          { value: "subcategory", label: t("stepMapping.table.category") },
                          { value: "brand", label: t("stepMapping.table.brand") },
                          { value: "ignore", label: t("stepMapping.table.ignore") },
                        ].map((opt) => (
                          <label key={opt.value} className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name={`slug-${s.slug}`}
                              checked={slugMapping[s.slug] === opt.value}
                              onChange={() => setSlugMapping((prev) => ({ ...prev, [s.slug]: opt.value }))}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setStep("upload")} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {t("stepMapping.back")}
            </button>
            <Button type="button" onClick={() => setStep("review")}>
              {t("stepMapping.continue")}
            </Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-5">
          {unclassifiedCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                {t("stepReview.unclassifiedWarning", { count: unclassifiedCount })}
              </span>
            </div>
          )}

          {alreadyImportedCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                {alreadyImportedCount} produit(s) déjà importé(s) précédemment — ils ne seront pas dupliqués, seul un code-barres manquant sera complété si Wix en fournit un maintenant.
              </span>
            </div>
          )}

          <div className="overflow-x-auto rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stroke text-left text-xs uppercase tracking-wide text-gray-500 dark:border-dark-3">
                  <th className="px-4 py-3">{t("stepReview.table.product")}</th>
                  <th className="px-4 py-3">{t("stepReview.table.brand")}</th>
                  <th className="px-4 py-3">{t("stepReview.table.category")}</th>
                  <th className="px-4 py-3">{t("stepReview.table.price")}</th>
                  <th className="px-4 py-3">{t("stepReview.table.stock")}</th>
                  <th className="px-4 py-3">{t("stepReview.table.images")}</th>
                  <th className="px-4 py-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((p) => (
                  <tr key={p.handle} className="border-b border-stroke last:border-0 dark:border-dark-3">
                    <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-white">{p.name}</td>
                    <td className="px-4 py-2.5 text-gray-500">{p.brandName}</td>
                    <td className="px-4 py-2.5 text-gray-500">{p.categoryName}</td>
                    <td className="px-4 py-2.5 text-gray-500">{formatPrice(p.price)}</td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {p.stockQuantity}
                      {!p.stockIsExact && <span className="ml-1 text-amber-500">{t("stepReview.table.toRecount")}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{p.images.length}</td>
                    <td className="px-4 py-2.5">
                      {!p.alreadyImported ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Nouveau</span>
                      ) : p.willFillBarcode ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Code-barres à compléter</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Déjà importé — inchangé</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setStep("mapping")} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {t("stepReview.back")}
            </button>
            <Button type="button" onClick={handleImport}>
              {t("stepReview.importButton", { count: products.length })}
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="max-w-lg space-y-5 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-[#2f3a2e]" />
            <p className="text-sm font-medium text-gray-800 dark:text-white">{t("stepImporting.title")}</p>
          </div>

          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-dark-3">
              <div
                className="h-full rounded-full bg-[#2f3a2e] transition-all duration-300"
                style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-dark-6">
              {t("stepImporting.progress", { done: progress.done, total: progress.total })}
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{t("stepImporting.warning")}</span>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="max-w-lg space-y-5 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={22} className="text-green-600" />
            <p className="text-sm text-gray-700">
              {t("stepDone.success", { count: result.createdCount })}
              {result.updatedCount > 0 && (
                <> {result.updatedCount} code(s)-barres complété(s) sur des produits déjà importés.</>
              )}
            </p>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <p className="mb-1 font-semibold">{t("stepDone.failures", { count: result.errors.length })}</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {result.errors.map((e, i) => (
                  <li key={i}>{e.name} — {e.message}</li>
                ))}
              </ul>
            </div>
          )}

          <Button type="button" onClick={() => { router.push("/dashboard/boutique/products"); router.refresh(); }}>
            {t("stepDone.viewProducts")}
          </Button>
        </div>
      )}
    </div>
  );
}
