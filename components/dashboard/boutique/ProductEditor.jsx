"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Loader2, RefreshCw, Tag } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProductImages } from "@/components/dashboard/boutique/ProductImages";
import { BarcodeLabelDialog } from "@/components/dashboard/boutique/BarcodeLabelDialog";
import { createProduct, updateProduct, deleteProduct, generateUniqueSku } from "@/actions/boutique/products";
import { getProductCategories } from "@/actions/boutique/categories";

/** Not a real EAN/UPC — a locally-unique fallback so a product with no
 * supplier barcode can still get a printable label and be found by
 * /dashboard/boutique/scan. The DB's unique constraint is the actual safety net. */
function generateInternalBarcode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `IN${hex}`;
}

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Brouillon", hint: "Non visible sur la boutique" },
  { value: "ACTIVE", label: "Actif", hint: "Visible et en vente" },
  { value: "ARCHIVED", label: "Archivé", hint: "Retiré de la boutique" },
];

function emptyVariant(barcode) {
  return {
    _key: crypto.randomUUID(),
    id: null,
    name: "Standard",
    sku: "",
    // Defaults to an internal code rather than blank — per Marie, some
    // products (small/loose items with no supplier packaging) never get an
    // EAN/UPC, and leaving this optional meant staff had to remember to
    // click "Générer" or the product ended up with no scannable code at
    // all. Still freely overwritable with a real supplier barcode.
    barcode: barcode || generateInternalBarcode(),
    price: "",
    costPrice: "",
    comparePrice: "",
    stockQuantity: 0,
    lowStockThreshold: 3,
    weightGrams: "",
    isActive: true,
  };
}

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white";

/**
 * Dedicated product editor page (create + edit share this) — a full page
 * rather than a modal, since a product carries images, multiple variants
 * and stock: too much to reason about inside a dialog.
 *
 * @param {{ product: object|null, brands: object[], initialBarcode?: string|null }} props
 */
export function ProductEditor({ product, brands, initialBarcode = null }) {
  const router = useRouter();
  const isEdit = !!product;

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [status, setStatus] = useState(product?.status ?? "DRAFT");
  const [brandId, setBrandId] = useState(product?.brandId ?? "");
  const [categoryId, setCategoryId] = useState(product?.subcategory?.categoryId ?? "");
  const [subcategoryId, setSubcategoryId] = useState(product?.subcategoryId ?? "");
  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [images, setImages] = useState(
    product?.images?.map((img) => ({ path: img.path, alt: img.alt, isPrimary: img.isPrimary })) ?? []
  );
  const [variants, setVariants] = useState(
    product?.variants?.length
      ? product.variants.map((v) => ({ ...v, _key: v.id }))
      : [emptyVariant(initialBarcode ?? "")]
  );
  const [errors, setErrors] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [labelVariant, setLabelVariant] = useState(null);
  const [isPending, startTransition] = useTransition();

  // Categories are brand-scoped, so they're loaded per selection rather than
  // passed down from the server for every brand up front.
  useEffect(() => {
    if (!brandId) {
      setCategories([]);
      return;
    }
    let cancelled = false;
    setLoadingCategories(true);
    getProductCategories({ brandId, includeInactive: true }).then((result) => {
      if (cancelled) return;
      setCategories(result.data ?? []);
      setLoadingCategories(false);
    });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  function handleBrandChange(nextBrandId) {
    setBrandId(nextBrandId);
    // A category/subcategory picked under the old brand can't carry over —
    // the tree is brand-scoped now, so switching brand always resets both.
    setCategoryId("");
    setSubcategoryId("");
  }

  const subcategories = useMemo(
    () => categories.find((c) => c.id === categoryId)?.subcategories ?? [],
    [categories, categoryId]
  );

  function updateVariant(key, patch) {
    setVariants((prev) => prev.map((v) => (v._key === key ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    setVariants((prev) => [...prev, emptyVariant()]);
  }

  function removeVariant(key) {
    setVariants((prev) => (prev.length > 1 ? prev.filter((v) => v._key !== key) : prev));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    const payload = {
      name,
      description: description || null,
      subcategoryId,
      status,
      variants: variants.map((v, i) => ({
        id: v.id ?? undefined,
        name: v.name || "Standard",
        sku: v.sku,
        barcode: v.barcode || null,
        price: v.price,
        costPrice: v.costPrice,
        comparePrice: v.comparePrice || null,
        stockQuantity: v.id ? undefined : v.stockQuantity, // only meaningful for new variants — see server action
        lowStockThreshold: v.lowStockThreshold,
        weightGrams: v.weightGrams === "" ? 0 : v.weightGrams,
        position: i,
        isActive: v.isActive,
      })),
      images: images.map((img, i) => ({ ...img, position: i })),
    };

    startTransition(async () => {
      const result = isEdit
        ? await updateProduct({ id: product.id, ...payload })
        : await createProduct(payload);

      if (result.success) {
        toast.success(result.message);
        router.push("/dashboard/boutique/products");
        router.refresh();
      } else {
        toast.error(result.message);
        if (result.errors) setErrors(result.errors);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProduct(product.id);
      if (result.success) {
        toast.success(result.message);
        router.push("/dashboard/boutique/products");
        router.refresh();
      } else {
        toast.error(result.message);
      }
      setConfirmDelete(false);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-24">
      {/* Sticky header — Wix-style: back, title, Save always reachable */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-stroke bg-white/95 px-4 py-3 backdrop-blur dark:border-dark-3 dark:bg-gray-dark/95 sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/boutique/products"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-lg font-semibold text-dark dark:text-white">
            {isEdit ? "Modifier le produit" : "Nouveau produit"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex h-9 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 size={14} />
              Supprimer
            </button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </div>

      {!isEdit && initialBarcode && (
        <div className="rounded-lg border border-[#2f3a2e]/15 bg-[#2f3a2e]/5 px-4 py-3 text-sm text-[#2f3a2e]">
          Code-barres <span className="font-semibold">{initialBarcode}</span> scanné — aucun produit ne l'utilisait
          encore, il a été pré-rempli sur la première déclinaison ci-dessous.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Main column ─────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Section title="Informations générales">
            <div className="space-y-4">
              <Field label="Nom du produit" required>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Shampooing Hydratant"
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Décrivez le produit pour vos clientes…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                />
              </Field>
            </div>
          </Section>

          <Section title="Images">
            <ProductImages value={images} onChange={setImages} />
          </Section>

          <Section
            title="Déclinaisons"
            action={
              <button
                type="button"
                onClick={addVariant}
                className="flex items-center gap-1.5 text-sm font-medium text-[#2f3a2e] hover:underline"
              >
                <Plus size={14} />
                Ajouter une déclinaison
              </button>
            }
          >
            <div className="space-y-4">
              {variants.map((v) => (
                <VariantRow
                  key={v._key}
                  variant={v}
                  canRemove={variants.length > 1}
                  onChange={(patch) => updateVariant(v._key, patch)}
                  onRemove={() => removeVariant(v._key)}
                  onShowLabel={() => setLabelVariant(v)}
                />
              ))}
            </div>
          </Section>
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Section title="Statut">
            <div className="space-y-2">
              {STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                    status === opt.value ? "border-[#2f3a2e] bg-[#2f3a2e]/5" : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    value={opt.value}
                    checked={status === opt.value}
                    onChange={() => setStatus(opt.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                    <div className="text-xs text-gray-400">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Organisation">
            <div className="space-y-4">
              <Field label="Marque" required>
                <select value={brandId} onChange={(e) => handleBrandChange(e.target.value)} required className={inputClass}>
                  <option value="">Choisir…</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="Catégorie"
                required
                hint={!brandId ? "Choisissez d'abord une marque." : loadingCategories ? "Chargement…" : null}
              >
                <select
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setSubcategoryId("");
                  }}
                  required
                  disabled={!brandId || loadingCategories}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:bg-gray-50`}
                >
                  <option value="">Choisir…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Sous-catégorie" required hint={!categoryId ? "Choisissez d'abord une catégorie." : null}>
                <select
                  value={subcategoryId}
                  onChange={(e) => setSubcategoryId(e.target.value)}
                  required
                  disabled={!categoryId}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:bg-gray-50`}
                >
                  <option value="">Choisir…</option>
                  {subcategories.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {errors.subcategoryId && (
                  <p className="mt-1 text-xs font-medium text-red-600">{errors.subcategoryId}</p>
                )}
              </Field>
            </div>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer ce produit ?"
        message={`"${name}" sera retiré de la boutique. Les commandes passées le conservent dans leur historique.`}
        confirmLabel="Supprimer"
        danger
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <BarcodeLabelDialog variant={labelVariant} productName={name} onClose={() => setLabelVariant(null)} />
    </form>
  );
}

function Section({ title, action, children }) {
  return (
    <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

/** One variant's fields. Stock quantity is only editable for a brand-new
 * variant — an existing one can only change stock through a movement
 * (Stock page), so the ledger always reconciles. */
function VariantRow({ variant, canRemove, onChange, onRemove, onShowLabel }) {
  const isExisting = !!variant.id;
  const price = Number(variant.price) || 0;
  const cost = Number(variant.costPrice) || 0;
  const margin = price > 0 ? (((price - cost) / price) * 100).toFixed(1) : null;
  const [generatingSku, setGeneratingSku] = useState(false);

  async function handleGenerateSku() {
    if (variant.sku && !window.confirm("Remplacer la référence actuelle par une nouvelle référence générée ?")) return;
    setGeneratingSku(true);
    const result = await generateUniqueSku();
    setGeneratingSku(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    onChange({ sku: result.sku });
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <input
          type="text"
          value={variant.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Nom de la déclinaison (250ml, Teinte 03…)"
          className="w-64 border-0 border-b border-transparent bg-transparent p-0 text-sm font-medium text-gray-800 outline-none focus:border-gray-300"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={variant.isActive}
              onChange={(e) => onChange({ isActive: e.target.checked })}
            />
            Active
          </label>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Référence (SKU)" required>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={variant.sku}
              onChange={(e) => onChange({ sku: e.target.value })}
              required
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              title="Générer une référence unique"
              onClick={handleGenerateSku}
              disabled={generatingSku}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generatingSku ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
        </Field>
        <Field label="Code-barres" hint="Code fournisseur (EAN/UPC) ou un code interne généré">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={variant.barcode ?? ""}
              onChange={(e) => onChange({ barcode: e.target.value })}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              title="Générer un code interne"
              onClick={() => {
                if (variant.barcode && !window.confirm("Remplacer le code-barres actuel par un nouveau code interne ?")) return;
                onChange({ barcode: generateInternalBarcode() });
              }}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              <RefreshCw size={14} />
            </button>
            {variant.barcode && (
              <button
                type="button"
                title="Étiquette à imprimer"
                onClick={onShowLabel}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              >
                <Tag size={14} />
              </button>
            )}
          </div>
        </Field>

        {isExisting ? (
          <Field label="Stock" hint="Ajustez depuis la page Stock">
            <div className="flex h-9 items-center rounded-lg border border-gray-100 bg-gray-50 px-3 text-sm text-gray-500">
              {variant.stockQuantity} en stock
              {variant.reservedQuantity > 0 && ` (${variant.reservedQuantity} réservé)`}
            </div>
          </Field>
        ) : (
          <Field label="Stock initial">
            <input
              type="number"
              min="0"
              value={variant.stockQuantity}
              onChange={(e) => onChange({ stockQuantity: Number(e.target.value) })}
              className={inputClass}
            />
          </Field>
        )}

        <Field label="Prix de vente (€)" required>
          <input
            type="number"
            min="0"
            step="0.01"
            value={variant.price}
            onChange={(e) => onChange({ price: e.target.value })}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Prix d'achat (€)" required>
          <input
            type="number"
            min="0"
            step="0.01"
            value={variant.costPrice}
            onChange={(e) => onChange({ costPrice: e.target.value })}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Prix barré (€)" hint="Optionnel — pour une promotion">
          <input
            type="number"
            min="0"
            step="0.01"
            value={variant.comparePrice ?? ""}
            onChange={(e) => onChange({ comparePrice: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Seuil de stock bas">
          <input
            type="number"
            min="0"
            value={variant.lowStockThreshold}
            onChange={(e) => onChange({ lowStockThreshold: Number(e.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label="Poids (g)" hint="Optionnel — utilisé pour calculer les frais de port">
          <input
            type="number"
            min="0"
            value={variant.weightGrams ?? ""}
            onChange={(e) => onChange({ weightGrams: e.target.value === "" ? "" : Number(e.target.value) })}
            placeholder="ex. 250"
            className={inputClass}
          />
        </Field>
        <div className="flex flex-col justify-end pb-1.5">
          <span className="text-xs text-gray-400">Marge</span>
          <span className={`text-sm font-medium ${margin !== null && margin < 0 ? "text-red-500" : "text-gray-700"}`}>
            {margin !== null ? `${margin}%` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
