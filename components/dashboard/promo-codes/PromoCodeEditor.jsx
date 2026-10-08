"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Wand2, Percent, Euro, ShoppingBag, CalendarHeart, Palette, GraduationCap, Globe2,
  UserRound, Infinity as InfinityIcon, CalendarClock, Check, Info, Layers,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { createPromoCode, updatePromoCode } from "@/actions/promo-codes";
import { parseBrusselsInputValue, toBrusselsInputValue } from "@/lib/datetime/brussels-input";
import { PROMO_CODE_SCOPES, PROMO_CODE_SCOPE_LABELS } from "@/lib/promo-code-scopes";
import { PromoTicket } from "./PromoTicket";
import { CustomerPicker, ProductPicker, ServicePicker } from "./PromoTargetPickers";
import { PromoRulesEditor, emptyRule, ruleProblem, ruleToForm, ruleToPayload } from "./PromoRulesEditor";
import { PromoUsageHistory } from "./PromoUsageHistory";
import { STATUS_META, describePromoRules, promoStatus } from "./promo-format";

const SCOPE_META = {
  BOUTIQUE: { icon: ShoppingBag, hint: "Produits de la e-boutique" },
  APPOINTMENT: { icon: CalendarHeart, hint: "Prestations réservées en ligne" },
  WORKSHOP: { icon: Palette, hint: "Ateliers & événements" },
  FORMATION: { icon: GraduationCap, hint: "Formations professionnelles" },
};

const inputClass =
  "h-10 w-full min-w-0 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none transition focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white";

// No 0/O/1/I — the code gets read aloud and typed from Instagram stories.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `MERI-${Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
}

function suggestedCode(customers, type, value) {
  if (customers.length !== 1) return randomCode();
  const first = customers[0].fullName.split(/\s+/)[0] ?? "";
  const clean = first.normalize("NFD").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 12);
  const amount = Number(value) ? String(Math.round(Number(value))) + (type === "FIXED" ? "EUR" : "") : "";
  return clean.length >= 2 ? `${clean}${amount || "VIP"}` : randomCode();
}

function splitBrussels(date) {
  const value = toBrusselsInputValue(date); // "YYYY-MM-DDTHH:mm"
  return value ? { date: value.slice(0, 10), time: value.slice(11, 16) } : { date: "", time: "23:59" };
}

const EXPIRY_PRESETS = [
  { label: "24 h", compute: () => new Date(Date.now() + 24 * 3600 * 1000) },
  { label: "7 jours", compute: () => new Date(Date.now() + 7 * 24 * 3600 * 1000) },
  { label: "30 jours", compute: () => new Date(Date.now() + 30 * 24 * 3600 * 1000) },
  {
    label: "Fin du mois",
    compute: () => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59);
    },
    endOfDay: true,
  },
];

/**
 * Full-page create/edit screen for a promo code — replaces the old modal,
 * which couldn't hold targeting (produits, prestations, clientes) and limits
 * without turning into a scroll-trap.
 *
 * @param {{ promoCode: object|null }} props
 */
export function PromoCodeEditor({ promoCode }) {
  const router = useRouter();
  const isEdit = !!promoCode;
  const initialExpiry = splitBrussels(promoCode?.expiresAt);

  const [code, setCode] = useState(promoCode?.code ?? "");
  const [type, setType] = useState(promoCode?.type ?? "PERCENTAGE");
  const [value, setValue] = useState(promoCode?.value ?? "");
  const [minOrderAmount, setMinOrderAmount] = useState(promoCode?.minOrderAmount ?? "");
  const [description, setDescription] = useState(promoCode?.description ?? "");
  const [isActive, setIsActive] = useState(promoCode?.isActive ?? true);
  // A multi-offer code: its offers replace the single value, boutique only.
  const [rules, setRules] = useState(() => (promoCode?.rules ?? []).map(ruleToForm));
  const isMulti = type === "MULTI_RULE";

  const [scopes, setScopes] = useState(promoCode?.scopes?.length ? promoCode.scopes : PROMO_CODE_SCOPES);
  const [productMode, setProductMode] = useState(promoCode?.products?.length ? "SOME" : "ALL");
  const [products, setProducts] = useState(promoCode?.products ?? []);
  const [serviceMode, setServiceMode] = useState(promoCode?.services?.length ? "SOME" : "ALL");
  const [services, setServices] = useState(promoCode?.services ?? []);

  const [audience, setAudience] = useState(promoCode?.customers?.length ? "SOME" : "ALL");
  const [customers, setCustomers] = useState(promoCode?.customers ?? []);

  const [maxUses, setMaxUses] = useState(promoCode?.maxUses ?? "");
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState(promoCode?.maxUsesPerCustomer ?? "");

  const [expiryMode, setExpiryMode] = useState(promoCode?.expiresAt ? "DATE" : "NONE");
  const [expiryDate, setExpiryDate] = useState(initialExpiry.date);
  const [expiryTime, setExpiryTime] = useState(initialExpiry.time);

  const [errors, setErrors] = useState({});
  const [isPending, startTransition] = useTransition();

  const expiresAt = expiryMode === "DATE" && expiryDate ? `${expiryDate}T${expiryTime || "23:59"}` : null;

  // What the ticket preview and the rule summary show — the same shape the
  // server returns, built from the unsaved form.
  const draft = useMemo(
    () => ({
      code,
      type,
      value: Number(value) || 0,
      minOrderAmount: Number(minOrderAmount) || null,
      scopes: isMulti ? ["BOUTIQUE"] : scopes,
      products: !isMulti && productMode === "SOME" ? products : [],
      services: !isMulti && serviceMode === "SOME" ? services : [],
      rules: isMulti ? rules : [],
      customers: audience === "SOME" ? customers : [],
      maxUses: Number(maxUses) || null,
      maxUsesPerCustomer: Number(maxUsesPerCustomer) || null,
      expiresAt: parseBrusselsInputValue(expiresAt),
      isActive,
      usedCount: promoCode?.usedCount ?? 0,
    }),
    [code, type, value, minOrderAmount, scopes, productMode, products, serviceMode, services, audience, customers, maxUses, maxUsesPerCustomer, expiresAt, isActive, promoCode?.usedCount, isMulti, rules]
  );
  const ruleSummary = describePromoRules(draft);
  const status = STATUS_META[promoStatus(draft)];

  function toggleScope(scope) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : PROMO_CODE_SCOPES.filter((s) => s === scope || prev.includes(s))));
  }

  function chooseType(next) {
    setType(next);
    if (next === "MULTI_RULE" && rules.length === 0) setRules([emptyRule()]);
  }

  function applyPreset(preset) {
    const { date, time } = splitBrussels(preset.compute());
    setExpiryMode("DATE");
    setExpiryDate(date);
    setExpiryTime(preset.endOfDay ? "23:59" : time);
  }

  function handleSubmit(e) {
    e.preventDefault();

    const clientErrors = {};
    if (isMulti) {
      const incomplete = rules.findIndex((rule) => ruleProblem(rule));
      if (!rules.length) clientErrors.rules = "Ajoutez au moins une offre à ce code.";
      else if (incomplete !== -1) clientErrors.rules = `Offre ${incomplete + 1} : ${ruleProblem(rules[incomplete])}.`;
    } else {
      if (!scopes.length) clientErrors.scopes = "Choisissez au moins un domaine.";
      if (scopes.includes("BOUTIQUE") && productMode === "SOME" && !products.length) clientErrors.productIds = "Choisissez au moins un produit.";
      if (scopes.includes("APPOINTMENT") && serviceMode === "SOME" && !services.length) clientErrors.serviceIds = "Choisissez au moins une prestation.";
    }
    if (audience === "SOME" && !customers.length) clientErrors.customerIds = "Ajoutez au moins une cliente.";
    if (expiryMode === "DATE" && !expiryDate) clientErrors.expiresAt = "Choisissez la date d'expiration.";
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      toast.error(Object.values(clientErrors)[0]);
      return;
    }
    setErrors({});

    const payload = {
      code,
      type,
      value,
      minOrderAmount: minOrderAmount === "" ? null : minOrderAmount,
      description,
      isActive,
      scopes,
      productIds: productMode === "SOME" ? products.map((p) => p.id) : [],
      serviceIds: serviceMode === "SOME" ? services.map((s) => s.id) : [],
      customerIds: audience === "SOME" ? customers.map((c) => c.id) : [],
      rules: isMulti ? rules.map(ruleToPayload) : [],
      maxUses: maxUses === "" ? null : maxUses,
      maxUsesPerCustomer: maxUsesPerCustomer === "" ? null : maxUsesPerCustomer,
      expiresAt,
    };

    startTransition(async () => {
      const result = isEdit ? await updatePromoCode({ id: promoCode.id, ...payload }) : await createPromoCode(payload);
      if (!result.success) {
        toast.error(result.message);
        if (result.errors) setErrors(Object.fromEntries(Object.entries(result.errors).map(([k, v]) => [k, v?.[0]])));
        return;
      }
      toast.success(result.message);
      if (isEdit) router.refresh();
      else router.push(`/dashboard/promo-codes/${result.data.id}`);
    });
  }

  return (
    <div className="space-y-8 pb-24">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 -mx-3 flex flex-col gap-3 border-b border-stroke bg-white/95 px-3 py-3 backdrop-blur dark:border-dark-3 dark:bg-gray-dark/95 sm:-mx-4 sm:flex-row sm:items-center sm:justify-between sm:px-4 md:-mx-6 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard/promo-codes"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-dark-2"
              aria-label="Retour aux codes promo"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-dark dark:text-white sm:text-lg">
                {isEdit ? promoCode.code : "Nouveau code promo"}
              </h1>
              {isEdit && (
                <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${status.className}`}>
                  {status.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <Switch checked={isActive} onChange={setIsActive} label={isActive ? "Actif" : "Désactivé"} />
            <Button type="submit" disabled={isPending} className="flex-1 justify-center sm:flex-none">
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? "Enregistrer" : "Créer le code"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* ── Main column ─────────────────────────────────────────── */}
          <div className="min-w-0 space-y-6">
            <Section step="1" title="Code & remise" subtitle="Ce que la cliente tape, et ce qu'elle gagne.">
              <div className="space-y-5">
                <Field label="Code" required error={errors.code}>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                      placeholder="BIENVENUE10"
                      required
                      maxLength={30}
                      className={`${inputClass} font-mono uppercase tracking-[0.12em]`}
                    />
                    <button
                      type="button"
                      onClick={() => setCode(suggestedCode(audience === "SOME" ? customers : [], type, value))}
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 transition hover:border-[#C8A46A] hover:text-[#2f3a2e] dark:border-dark-3 dark:text-dark-6"
                    >
                      <Wand2 size={14} />
                      Générer
                    </button>
                  </div>
                </Field>

                <div className={`grid grid-cols-1 gap-4 ${isMulti ? "" : "sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"}`}>
                  <Field label="Type de remise" hint={isMulti ? "Un seul code, plusieurs offres : chaque article du panier reçoit celle qui le concerne." : undefined}>
                    <div className="grid h-10 grid-cols-3 rounded-lg bg-gray-100 p-1 dark:bg-dark-2">
                      {[
                        { v: "PERCENTAGE", label: "Pourcentage", icon: Percent },
                        { v: "FIXED", label: "Montant fixe", icon: Euro },
                        { v: "MULTI_RULE", label: "Offres multiples", icon: Layers },
                      ].map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => chooseType(o.v)}
                          className={`flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition ${
                            type === o.v ? "bg-white text-[#2f3a2e] shadow-sm dark:bg-gray-dark dark:text-white" : "text-gray-500"
                          }`}
                        >
                          <o.icon size={13} />
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {!isMulti && (
                  <Field label="Valeur" required error={errors.value}>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={type === "PERCENTAGE" ? 100 : undefined}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={type === "PERCENTAGE" ? "15" : "10,00"}
                        required
                        className={`${inputClass} pr-10`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-400">
                        {type === "PERCENTAGE" ? "%" : "€"}
                      </span>
                    </div>
                  </Field>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Montant minimum d'achat" hint="Laisser vide = aucun minimum." error={errors.minOrderAmount}>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={minOrderAmount}
                        onChange={(e) => setMinOrderAmount(e.target.value)}
                        placeholder="Aucun minimum"
                        className={`${inputClass} pr-10`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-400">€</span>
                    </div>
                  </Field>
                  <Field label="Note interne" hint="Visible uniquement dans le tableau de bord." error={errors.description}>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={500}
                      placeholder="Ex. Offre anniversaire, story Instagram…"
                      className={inputClass}
                    />
                  </Field>
                </div>
              </div>
            </Section>

            {isMulti && (
              <Section step="2" title="Offres du code" subtitle="Valable sur la boutique (en ligne et à la caisse). Une offre par famille de produits.">
                <PromoRulesEditor value={rules} onChange={setRules} error={errors.rules} />
              </Section>
            )}

            {!isMulti && (
            <Section step="2" title="Où le code est-il valable ?" subtitle="Produits, prestations, ateliers, formations — ou tout à la fois.">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {PROMO_CODE_SCOPES.map((scope) => {
                  const Icon = SCOPE_META[scope].icon;
                  const on = scopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggleScope(scope)}
                      aria-pressed={on}
                      aria-label={PROMO_CODE_SCOPE_LABELS[scope]}
                      className={`relative flex flex-col items-start gap-2 rounded-xl border-2 p-3.5 text-left transition ${
                        on
                          ? "border-[#2f3a2e] bg-[#2f3a2e]/[0.04] dark:border-[#C8A46A] dark:bg-white/5"
                          : "border-gray-100 hover:border-gray-200 dark:border-dark-3"
                      }`}
                    >
                      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${on ? "bg-[#2f3a2e] text-[#C8A46A]" : "bg-gray-100 text-gray-400 dark:bg-dark-2"}`}>
                        <Icon size={17} />
                      </span>
                      <span>
                        <span className={`block text-sm font-semibold ${on ? "text-dark dark:text-white" : "text-gray-500"}`}>{PROMO_CODE_SCOPE_LABELS[scope]}</span>
                        <span className="block text-[11px] leading-snug text-gray-400">{SCOPE_META[scope].hint}</span>
                      </span>
                      <span
                        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${
                          on ? "border-[#2f3a2e] bg-[#2f3a2e] text-white" : "border-gray-300"
                        }`}
                      >
                        {on && <Check size={12} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {errors.scopes && <p className="mt-2 text-xs font-medium text-red-600">{errors.scopes}</p>}

              {scopes.includes("BOUTIQUE") && (
                <SubPanel icon={ShoppingBag} title="Produits concernés">
                  <Segmented
                    value={productMode}
                    onChange={setProductMode}
                    options={[
                      { value: "ALL", label: "Toute la boutique" },
                      { value: "SOME", label: "Produits précis" },
                    ]}
                  />
                  {productMode === "SOME" && (
                    <div className="mt-4">
                      <ProductPicker value={products} onChange={setProducts} error={errors.productIds} />
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-gray-400">
                        <Info size={12} className="mt-0.5 shrink-0" />
                        La remise ne s&apos;applique qu&apos;aux articles choisis dans le panier, pas au reste de la commande.
                      </p>
                    </div>
                  )}
                </SubPanel>
              )}

              {scopes.includes("APPOINTMENT") && (
                <SubPanel icon={CalendarHeart} title="Prestations concernées">
                  <Segmented
                    value={serviceMode}
                    onChange={setServiceMode}
                    options={[
                      { value: "ALL", label: "Toutes les prestations" },
                      { value: "SOME", label: "Prestations précises" },
                    ]}
                  />
                  {serviceMode === "SOME" && (
                    <div className="mt-4">
                      <ServicePicker value={services} onChange={setServices} error={errors.serviceIds} />
                    </div>
                  )}
                </SubPanel>
              )}
            </Section>
            )}

            <Section step="3" title="Pour qui ?" subtitle="Un code pour tout le monde, ou réservé à une ou plusieurs clientes.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceCard
                  selected={audience === "ALL"}
                  onClick={() => setAudience("ALL")}
                  icon={Globe2}
                  title="Tout le monde"
                  hint="Toute personne qui connaît le code"
                />
                <ChoiceCard
                  selected={audience === "SOME"}
                  onClick={() => setAudience("SOME")}
                  icon={UserRound}
                  title="Clientes précises"
                  hint="Refusé pour tout autre compte"
                />
              </div>
              {audience === "SOME" && (
                <div className="mt-4">
                  <CustomerPicker value={customers} onChange={setCustomers} error={errors.customerIds} />
                </div>
              )}
            </Section>

            <Section step="4" title="Limites d'utilisation" subtitle="Laissez vide pour un usage illimité.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LimitField
                  label="Par cliente"
                  hint="Combien de fois une même personne peut l'utiliser."
                  value={maxUsesPerCustomer}
                  onChange={setMaxUsesPerCustomer}
                  error={errors.maxUsesPerCustomer}
                  quick={[1, 2, 3]}
                />
                <LimitField
                  label="Au total"
                  hint={isEdit ? `Déjà utilisé ${promoCode.usedCount} fois.` : "Toutes clientes confondues."}
                  value={maxUses}
                  onChange={setMaxUses}
                  error={errors.maxUses}
                  quick={[10, 50, 100]}
                />
              </div>
            </Section>

            <Section step="5" title="Validité" subtitle="Date et heure exactes de fin (heure de Bruxelles).">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceCard
                  selected={expiryMode === "NONE"}
                  onClick={() => setExpiryMode("NONE")}
                  icon={InfinityIcon}
                  title="Durée indéterminée"
                  hint="Valable jusqu'à désactivation manuelle"
                />
                <ChoiceCard
                  selected={expiryMode === "DATE"}
                  onClick={() => setExpiryMode("DATE")}
                  icon={CalendarClock}
                  title="Date d'expiration"
                  hint="Refusé automatiquement après"
                />
              </div>
              {expiryMode === "DATE" && (
                <div className="mt-4 rounded-xl bg-gray-50 p-4 dark:bg-dark-2">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                    <Field label="Date" error={errors.expiresAt}>
                      <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={`${inputClass} bg-white`} />
                    </Field>
                    <Field label="Heure">
                      <input type="time" value={expiryTime} onChange={(e) => setExpiryTime(e.target.value)} className={`${inputClass} bg-white`} />
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-medium text-gray-400">Raccourcis :</span>
                    {EXPIRY_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => applyPreset(p)}
                        className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition hover:border-[#C8A46A] hover:text-[#2f3a2e] dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          </div>

          {/* ── Preview column ──────────────────────────────────────── */}
          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <div className="rounded-2xl border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Aperçu</p>
              <PromoTicket promo={draft} size="lg" muted={!isActive} />

              <div className="mt-5 space-y-2.5">
                <p className="text-sm font-semibold text-dark dark:text-white">
                  {isMulti
                    ? `${rules.length} offre${rules.length > 1 ? "s" : ""} dans ce code`
                    : draft.value
                    ? `${type === "PERCENTAGE" ? `${draft.value} %` : `${Number(draft.value).toFixed(2).replace(".", ",")} €`} de remise`
                    : "Définissez la valeur de la remise"}
                </p>
                <SummaryRow ok label={!isMulti && scopes.length === PROMO_CODE_SCOPES.length ? "Valable partout" : `Valable : ${draft.scopes.map((s) => PROMO_CODE_SCOPE_LABELS[s]).join(", ") || "—"}`} />
                {ruleSummary.map((r, i) => (
                  <SummaryRow key={`${i}-${r}`} ok label={r.charAt(0).toUpperCase() + r.slice(1)} />
                ))}
                {!draft.maxUses && !draft.maxUsesPerCustomer && <SummaryRow label="Utilisations illimitées" />}
                <SummaryRow label={draft.expiresAt ? "Date de fin programmée" : "Sans date de fin"} />
              </div>
            </div>

            {isEdit && (
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Utilisations" value={promoCode.usedCount} />
                <MiniStat
                  label="Remise accordée"
                  value={`${promoCode.usage.filter((u) => !u.released).reduce((s, u) => s + u.discount, 0).toFixed(2).replace(".", ",")} €`}
                />
              </div>
            )}
          </aside>
        </div>
      </form>

      {isEdit && <PromoUsageHistory usage={promoCode.usage} />}
    </div>
  );
}

function Section({ step, title, subtitle, children }) {
  return (
    <section className="rounded-2xl border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fdf8f0] text-xs font-bold text-[#b89664] ring-1 ring-[#C8A46A]/30 dark:bg-white/5">
          {step}
        </span>
        <div>
          <h2 className="text-base font-semibold text-dark dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 dark:text-dark-6">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function SubPanel({ icon: Icon, title, children }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-100 p-4 dark:border-dark-3">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-dark dark:text-white">
        <Icon size={15} className="text-[#b89664]" />
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({ label, required, hint, error, children }) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-dark-6">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-dark-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            value === o.value ? "bg-white text-[#2f3a2e] shadow-sm dark:bg-gray-dark dark:text-white" : "text-gray-500"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChoiceCard({ selected, onClick, icon: Icon, title, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-center gap-3 rounded-xl border-2 p-3.5 text-left transition ${
        selected ? "border-[#2f3a2e] bg-[#2f3a2e]/[0.04] dark:border-[#C8A46A] dark:bg-white/5" : "border-gray-100 hover:border-gray-200 dark:border-dark-3"
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-[#2f3a2e] text-[#C8A46A]" : "bg-gray-100 text-gray-400 dark:bg-dark-2"}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-dark dark:text-white">{title}</span>
        <span className="block text-[11px] text-gray-400">{hint}</span>
      </span>
    </button>
  );
}

function LimitField({ label, hint, value, onChange, error, quick }) {
  return (
    <div className="rounded-xl border border-gray-100 p-4 dark:border-dark-3">
      <Field label={label} hint={hint} error={error}>
        <input
          type="number"
          min="1"
          step="1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Illimité"
          className={inputClass}
        />
      </Field>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <QuickPill active={value === "" || value == null} onClick={() => onChange("")}>∞</QuickPill>
        {quick.map((n) => (
          <QuickPill key={n} active={Number(value) === n} onClick={() => onChange(String(n))}>
            {n}×
          </QuickPill>
        ))}
      </div>
    </div>
  );
}

function QuickPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-9 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
        active ? "bg-[#2f3a2e] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-dark-2 dark:text-dark-6"
      }`}
    >
      {children}
    </button>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex shrink-0 items-center gap-2 text-sm font-medium text-gray-600 dark:text-dark-6">
      <span className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-gray-300 dark:bg-dark-3"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

function SummaryRow({ label, ok }) {
  return (
    <p className="flex items-start gap-2 text-xs text-gray-600 dark:text-dark-6">
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-[#C8A46A]/20 text-[#8a6d3b]" : "bg-gray-100 text-gray-400 dark:bg-dark-2"}`}>
        <Check size={10} strokeWidth={3} />
      </span>
      {label}
    </p>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
      <p className="text-lg font-bold text-dark dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-dark-6">{label}</p>
    </div>
  );
}
