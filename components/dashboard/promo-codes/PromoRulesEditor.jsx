"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Gift, Layers, Loader2, Percent, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { listPromoCatalogueTree } from "@/actions/promo-codes";
import { ProductPicker } from "./PromoTargetPickers";
import { defaultRuleLabel, describeRuleMechanic, ruleTargets } from "./promo-format";

const inputClass =
  "h-10 w-full min-w-0 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none transition focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white";

const KINDS = [
  { value: "PERCENT_OFF", label: "Pourcentage", icon: Percent, hint: "-X % sur les articles concernés, dès 1 article ou à partir d'une quantité." },
  { value: "NTH_DISCOUNTED", label: "Le suivant à prix réduit", icon: Tag, hint: "Ex. 2 achetés = le 3e à -50 %. Le moins cher de chaque groupe est remisé." },
  { value: "BUY_X_GET_Y_FREE", label: "Articles offerts", icon: Gift, hint: "Ex. 3 achetés = 2 offerts : 5 articles dans le panier, 3 payés." },
];

let ruleSeq = 0;
const newUid = () => `rule-${Date.now()}-${++ruleSeq}`;

export function emptyRule() {
  return {
    uid: newUid(),
    label: "",
    kind: "PERCENT_OFF",
    percent: "",
    minQuantity: 1,
    buyQuantity: 2,
    freeQuantity: 1,
    samePriceOnly: false,
    brands: [],
    categories: [],
    subcategories: [],
    products: [],
  };
}

/** A saved rule (server shape) as editable form state. */
export function ruleToForm(rule) {
  return {
    ...emptyRule(),
    ...rule,
    uid: rule.id ?? newUid(),
    percent: rule.percent ?? "",
    minQuantity: rule.minQuantity ?? 1,
    buyQuantity: rule.buyQuantity ?? 2,
    freeQuantity: rule.freeQuantity ?? 1,
  };
}

/** Form state as the payload createPromoCode / updatePromoCode expect. */
export function ruleToPayload(rule) {
  return {
    label: rule.label.trim() || defaultRuleLabel(rule),
    kind: rule.kind,
    percent: rule.percent,
    minQuantity: rule.minQuantity,
    buyQuantity: rule.buyQuantity,
    freeQuantity: rule.freeQuantity,
    samePriceOnly: rule.samePriceOnly,
    brandIds: rule.brands.map((b) => b.id),
    categoryIds: rule.categories.map((c) => c.id),
    subcategoryIds: rule.subcategories.map((s) => s.id),
    productIds: rule.products.map((p) => p.id),
  };
}

/** What stops a rule from being saved, or null. */
export function ruleProblem(rule) {
  if (ruleTargets(rule).length === 0) return "choisissez au moins une marque, une catégorie ou un produit";
  if (rule.kind !== "BUY_X_GET_Y_FREE" && !(Number(rule.percent) > 0 && Number(rule.percent) <= 100)) return "indiquez un pourcentage entre 1 et 100";
  if (rule.kind !== "PERCENT_OFF" && !(Number(rule.buyQuantity) >= 1)) return "indiquez le nombre d'articles achetés";
  if (rule.kind === "BUY_X_GET_Y_FREE" && !(Number(rule.freeQuantity) >= 1)) return "indiquez le nombre d'articles offerts";
  return null;
}

/**
 * The offers of a multi-offer code — one card per offer: what it does, and
 * the brands / categories / products it applies to.
 *
 * @param {{ value: object[], onChange: (rules: object[]) => void, error?: string }} props
 */
export function PromoRulesEditor({ value, onChange, error }) {
  const [tree, setTree] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listPromoCatalogueTree().then((result) => {
      if (!cancelled) setTree(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (uid, patch) => onChange(value.map((rule) => (rule.uid === uid ? { ...rule, ...patch } : rule)));

  return (
    <div className="space-y-4">
      {value.map((rule, index) => (
        <RuleCard
          key={rule.uid}
          index={index}
          rule={rule}
          tree={tree}
          onChange={(patch) => update(rule.uid, patch)}
          onRemove={() => onChange(value.filter((r) => r.uid !== rule.uid))}
        />
      ))}

      <button
        type="button"
        onClick={() => onChange([...value, emptyRule()])}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3.5 text-sm font-semibold text-gray-600 transition hover:border-[#C8A46A] hover:text-[#2f3a2e] dark:border-dark-3 dark:text-dark-6"
      >
        <Plus size={16} />
        Ajouter une offre
      </button>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <p className="text-[11px] leading-relaxed text-gray-400">
        Chaque article du panier reçoit l&apos;offre qui le concerne. Si deux offres visent le même article, seule la plus avantageuse
        s&apos;applique — elles ne se cumulent jamais (ex. « -15 % » et « -40 % dès 5 » sur le même produit).
      </p>
    </div>
  );
}

function RuleCard({ index, rule, tree, onChange, onRemove }) {
  const kind = KINDS.find((k) => k.value === rule.kind) ?? KINDS[0];
  const problem = ruleProblem(rule);
  const groupSize = (Number(rule.buyQuantity) || 0) + (Number(rule.freeQuantity) || 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-dark-3">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5 dark:border-dark-3">
        <p className="min-w-0 truncate text-sm font-semibold text-dark dark:text-white">
          <span className="mr-2 text-[#b89664]">Offre {index + 1}</span>
          <span className="font-normal text-gray-500">{problem ? "à compléter" : describeRuleMechanic(rule)}</span>
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
          aria-label={`Supprimer l'offre ${index + 1}`}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <Label>Type d&apos;offre</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {KINDS.map((option) => {
              const on = rule.kind === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ kind: option.value })}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-left text-xs font-semibold transition ${
                    on ? "border-[#2f3a2e] bg-[#2f3a2e]/[0.04] text-dark dark:border-[#C8A46A] dark:text-white" : "border-gray-100 text-gray-500 hover:border-gray-200 dark:border-dark-3"
                  }`}
                >
                  <option.icon size={14} className={on ? "text-[#b89664]" : "text-gray-400"} />
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">{kind.hint}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rule.kind === "PERCENT_OFF" && (
            <>
              <NumberField label="Remise" suffix="%" value={rule.percent} onChange={(percent) => onChange({ percent })} min={1} max={100} step="0.01" placeholder="15" />
              <NumberField
                label="À partir de"
                suffix="article(s)"
                value={rule.minQuantity}
                onChange={(minQuantity) => onChange({ minQuantity })}
                min={1}
                hint={Number(rule.minQuantity) > 1 ? "Les articles concernés comptent ensemble ; dès le seuil, tous sont remisés." : "1 = dès le premier article."}
              />
            </>
          )}
          {rule.kind === "NTH_DISCOUNTED" && (
            <>
              <NumberField label="Articles achetés plein tarif" value={rule.buyQuantity} onChange={(buyQuantity) => onChange({ buyQuantity })} min={1} />
              <NumberField label="Remise sur le suivant" suffix="%" value={rule.percent} onChange={(percent) => onChange({ percent })} min={1} max={100} step="0.01" placeholder="50" />
            </>
          )}
          {rule.kind === "BUY_X_GET_Y_FREE" && (
            <>
              <NumberField label="Articles payés" value={rule.buyQuantity} onChange={(buyQuantity) => onChange({ buyQuantity })} min={1} />
              <NumberField
                label="Articles offerts"
                value={rule.freeQuantity}
                onChange={(freeQuantity) => onChange({ freeQuantity })}
                min={1}
                hint={groupSize > 0 ? `La cliente met ${groupSize} articles dans son panier.` : undefined}
              />
              <label className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-dark-6 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={rule.samePriceOnly}
                  onChange={(e) => onChange({ samePriceOnly: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]/20"
                />
                <span>
                  Uniquement entre articles au même prix
                  <span className="block text-[11px] text-gray-400">Des articles de prix différents ne forment pas un lot ensemble.</span>
                </span>
              </label>
            </>
          )}
        </div>

        <div>
          <Label>Articles concernés</Label>
          <TargetPicker rule={rule} tree={tree} onChange={onChange} />
        </div>

        <div>
          <Label>Libellé affiché à la cliente</Label>
          <input
            type="text"
            value={rule.label}
            onChange={(e) => onChange({ label: e.target.value })}
            maxLength={120}
            placeholder={defaultRuleLabel(rule) || "Ex. ALBI : -21 %"}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-gray-400">Laisser vide pour utiliser le libellé proposé. Visible dans le récapitulatif de commande.</p>
        </div>

        {problem && <p className="text-xs font-medium text-amber-700">Offre incomplète : {problem}.</p>}
      </div>
    </div>
  );
}

/** Brands / categories / subcategories from the catalogue tree, plus single products. */
function TargetPicker({ rule, tree, onChange }) {
  const [open, setOpen] = useState(ruleTargets(rule).length === 0);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const brandIds = new Set(rule.brands.map((b) => b.id));
  const categoryIds = new Set(rule.categories.map((c) => c.id));
  const subcategoryIds = new Set(rule.subcategories.map((s) => s.id));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree ?? [];
    return (tree ?? []).filter(
      (brand) =>
        brand.name.toLowerCase().includes(q) ||
        brand.categories.some((c) => c.name.toLowerCase().includes(q) || c.subcategories.some((s) => s.name.toLowerCase().includes(q)))
    );
  }, [tree, query]);

  const toggleIn = (field, set, item) =>
    onChange({ [field]: set.has(item.id) ? rule[field].filter((x) => x.id !== item.id) : [...rule[field], item] });

  // Picking a brand covers everything under it — drop the now-redundant picks.
  function toggleBrand(brand) {
    if (brandIds.has(brand.id)) return onChange({ brands: rule.brands.filter((b) => b.id !== brand.id) });
    const under = new Set(brand.categories.flatMap((c) => [c.id, ...c.subcategories.map((s) => s.id)]));
    onChange({
      brands: [...rule.brands, { id: brand.id, name: brand.name }],
      categories: rule.categories.filter((c) => !under.has(c.id)),
      subcategories: rule.subcategories.filter((s) => !under.has(s.id)),
    });
  }

  function toggleCategory(brand, category) {
    if (categoryIds.has(category.id)) return onChange({ categories: rule.categories.filter((c) => c.id !== category.id) });
    const under = new Set(category.subcategories.map((s) => s.id));
    onChange({
      categories: [...rule.categories, { id: category.id, name: `${brand.name} › ${category.name}` }],
      subcategories: rule.subcategories.filter((s) => !under.has(s.id)),
    });
  }

  const toggleExpanded = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chips = [
    ...rule.brands.map((item) => ({ field: "brands", item })),
    ...rule.categories.map((item) => ({ field: "categories", item })),
    ...rule.subcategories.map((item) => ({ field: "subcategories", item })),
  ];

  return (
    <div className="space-y-3">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(({ field, item }) => (
            <span key={`${field}-${item.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#2f3a2e] py-1 pl-2.5 pr-1 text-xs font-medium text-white">
              <Layers size={12} className="shrink-0 text-[#C8A46A]" />
              <span className="truncate">{item.name}</span>
              <button
                type="button"
                onClick={() => onChange({ [field]: rule[field].filter((x) => x.id !== item.id) })}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
                aria-label={`Retirer ${item.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2f3a2e] hover:underline dark:text-[#C8A46A]"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Marques et catégories
      </button>

      {open && (
        <div className="rounded-xl border border-gray-100 dark:border-dark-3">
          <div className="relative border-b border-gray-100 p-2 dark:border-dark-3">
            <Search size={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer les marques…"
              className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {tree == null ? (
              <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
            ) : visible.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-500">Aucune marque trouvée.</p>
            ) : (
              visible.map((brand) => {
                const brandOn = brandIds.has(brand.id);
                const isOpen = expanded.has(brand.id) || query.trim() !== "";
                return (
                  <div key={brand.id}>
                    <TreeRow
                      label={brand.name}
                      count={brand.productCount}
                      checked={brandOn}
                      onToggle={() => toggleBrand(brand)}
                      expandable
                      expanded={isOpen}
                      onExpand={() => toggleExpanded(brand.id)}
                      strong
                    />
                    {isOpen &&
                      brand.categories.map((category) => {
                        const categoryOn = brandOn || categoryIds.has(category.id);
                        return (
                          <div key={category.id}>
                            <TreeRow
                              depth={1}
                              label={category.name}
                              count={category.productCount}
                              checked={categoryOn}
                              disabled={brandOn}
                              onToggle={() => toggleCategory(brand, category)}
                            />
                            {category.subcategories.length > 1 &&
                              category.subcategories.map((sub) => (
                                <TreeRow
                                  key={sub.id}
                                  depth={2}
                                  label={sub.name}
                                  count={sub.productCount}
                                  checked={categoryOn || subcategoryIds.has(sub.id)}
                                  disabled={categoryOn}
                                  onToggle={() =>
                                    toggleIn("subcategories", subcategoryIds, { id: sub.id, name: `${brand.name} › ${category.name} › ${sub.name}` })
                                  }
                                />
                              ))}
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-dark-6">Produits précis</p>
        <ProductPicker value={rule.products} onChange={(products) => onChange({ products })} emptyHint={null} />
      </div>
    </div>
  );
}

function TreeRow({ label, count, checked, disabled, onToggle, depth = 0, expandable, expanded, onExpand, strong }) {
  return (
    <div className="flex items-center gap-1" style={{ paddingLeft: depth * 22 }}>
      {expandable ? (
        <button type="button" onClick={onExpand} className="flex h-7 w-6 shrink-0 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={expanded ? "Replier" : "Déplier"}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={checked}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent dark:hover:bg-dark-2"
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-[#2f3a2e] bg-[#2f3a2e] text-white" : "border-gray-300"}`}>
          {checked && <Check size={11} strokeWidth={3} />}
        </span>
        <span className={`min-w-0 flex-1 truncate text-sm ${strong ? "font-semibold text-gray-800 dark:text-white" : "text-gray-700 dark:text-dark-6"}`}>{label}</span>
        <span className="shrink-0 text-[11px] text-gray-400">{count}</span>
      </button>
    </div>
  );
}

function Label({ children }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-dark-6">{children}</p>;
}

function NumberField({ label, suffix, value, onChange, hint, min, max, step = "1", placeholder }) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="relative">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputClass} ${suffix ? "pr-20" : ""}`}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}
