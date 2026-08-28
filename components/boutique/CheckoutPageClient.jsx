"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Store, Wallet, Truck, Check, Loader2, AlertTriangle, CheckCircle2, BadgeCheck, BadgeX, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { createOrderFromCart, createOrderCheckoutSession } from "@/actions/boutique/orders";
import { getCartShippingCost, requestShippingQuote } from "@/actions/boutique/shipping";
import { checkEmailExists } from "@/actions/shared/check-email-exists";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { validatePromoCode } from "@/actions/promo-codes";
import { ExistingAccountBanner } from "@/components/shared/ExistingAccountBanner";
import { PromoCodeField } from "@/components/shared/PromoCodeField";
import { MondialRelayPicker } from "@/components/boutique/MondialRelayPicker";
import { isDisposableEmail } from "@/lib/validations/customer-identity";
import { resolveGoodsVatPolicy, hasReusableVatValidation, applyVatRate, roundMoney, BELGIUM_VAT_RATE, VAT_LEGAL_NOTES } from "@/lib/tax-policy";

const MODES = [
  {
    value: "PICKUP_PREPAID",
    icon: Store,
    title: "Retrait en boutique — payer en ligne",
    description: "Payez maintenant, récupérez votre commande au salon.",
  },
  {
    value: "PICKUP_ON_SITE",
    icon: Wallet,
    title: "Retrait en boutique — payer sur place",
    description: "Réservez maintenant, réglez en boutique au retrait (sous 7 jours).",
  },
  {
    value: "SHIPPING_PREPAID",
    icon: Truck,
    title: "Livraison en point relais",
    description: "Payez maintenant, livraison Mondial Relay. Frais de port calculés au poids — gratuite dès €150.",
  },
];

export function CheckoutPageClient({ cart, customerSession }) {
  const router = useRouter();
  const isAuthenticated = Boolean(customerSession);
  // A signed-in customer can still reach checkout with no address on file —
  // an account created before the mandatory-address rule, or never completed
  // in /mon-compte. Only that case, not "is authenticated", decides whether
  // the billing address is still required below: a guest always needs it,
  // a returning customer only needs it once.
  const hasAddressOnFile = isAuthenticated && Boolean(customerSession.addressLine1);

  const [fulfilmentMode, setFulfilmentMode] = useState(null);
  const [customerInfo, setCustomerInfo] = useState(
    customerSession ?? {
      fullName: "",
      email: "",
      phone: "",
      newsletterSubscribed: false,
      addressLine1: "",
      addressLine2: "",
      addressCity: "",
      addressPostalCode: "",
      addressCountry: "BE",
      vatNumber: "",
    }
  );
  const [pickupPoint, setPickupPoint] = useState(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(null);
  const [shippingDetails, setShippingDetails] = useState({ cost: 0, isFree: true, loading: true, quoteRequired: false });
  const [quoteRequest, setQuoteRequest] = useState({ submitting: false, sent: false });
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [vatCheck, setVatCheck] = useState(null);
  const [savedVatProfile, setSavedVatProfile] = useState(customerSession ?? null);

  // null = not checked yet | "exists" = verified account found | "dismissed" = user chose to continue as guest
  const [emailStatus, setEmailStatus] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  // Leaving for Stripe happens through window.location, after `submitting`
  // becomes true. If the customer uses the browser Back button, the browser
  // may restore this page from its back/forward cache with that React state
  // intact, leaving the button on "TRAITEMENT…" forever. pageshow fires both
  // on a normal load and on a cached restore, so the form becomes usable
  // again without weakening the double-submit guard while a request is live.
  useEffect(() => {
    const resetSubmittingAfterNavigation = () => setSubmitting(false);
    window.addEventListener("pageshow", resetSubmittingAfterNavigation);
    return () => window.removeEventListener("pageshow", resetSubmittingAfterNavigation);
  }, []);

  async function handleEmailBlur() {
    const email = customerInfo.email.trim();
    if (!email || !email.includes("@")) return;

    setCheckingEmail(true);
    try {
      const result = await checkEmailExists(email);
      if (result.exists) setEmailStatus("exists");
    } catch {
      // Non-critical — silently ignore, the person can still proceed
    } finally {
      setCheckingEmail(false);
    }
  }

  async function handleVerifyVat() {
    if (!customerInfo.vatNumber?.trim()) {
      toast.error("Renseignez d'abord un numéro de TVA.");
      return;
    }

    setVatCheck({ loading: true });
    const result = await verifyVatNumber(customerInfo.vatNumber);
    if (!result.success) {
      setVatCheck({ error: true, message: result.message });
      return;
    }

    setVatCheck({
      valid: result.valid,
      message: result.valid
        ? result.name
          ? `Actif — enregistré au nom de « ${result.name} ».`
          : "Actif dans le registre VIES."
        : "Ce numéro n'est pas reconnu par le registre européen VIES.",
    });
    if (result.valid) {
      setSavedVatProfile({ isCompany: true, vatNumber: customerInfo.vatNumber, vatValidatedAt: new Date().toISOString() });
    }
  }

  // Fetch real shipping cost from server (weight-based calculation)
  useEffect(() => {
    async function fetchShippingCost() {
      if (fulfilmentMode !== "SHIPPING_PREPAID") {
        setShippingDetails({ cost: 0, costExclVat: 0, isFree: true, loading: false, quoteRequired: false });
        return;
      }

      setShippingDetails(prev => ({ ...prev, loading: true }));
      const result = await getCartShippingCost();
      if (result.success) {
        setShippingDetails({
          cost: result.data.cost,
          // Read from the carrier grid, which is already net — the summary
          // shows carriage HT beside the goods HT.
          costExclVat: result.data.costExclVat,
          isFree: result.data.isFree,
          loading: false,
          quoteRequired: false,
          untilFree: result.data.untilFree,
          totalWeightKg: result.data.totalWeightKg
        });
      } else if (result.data?.quoteRequired) {
        // >30kg: no flat-rate price exists, don't pretend it's free — block checkout
        // and point the customer at a way to actually reach us instead of a dead end.
        setShippingDetails({
          cost: 0,
          isFree: false,
          loading: false,
          quoteRequired: true,
          totalWeightKg: result.data.totalWeightKg
        });
      } else {
        setShippingDetails({ cost: 0, isFree: true, loading: false, quoteRequired: false });
      }
    }

    fetchShippingCost();
  }, [fulfilmentMode, cart.subtotal, cart.items]);

  const shippingCost = shippingDetails.cost;
  const quoteRequired = fulfilmentMode === "SHIPPING_PREPAID" && shippingDetails.quoteRequired;

  // Live VAT-treatment preview — same resolveGoodsVatPolicy the server calls
  // in createOrderFromCart, run here purely for display. It never sets the
  // actual charge: createOrderFromCart re-resolves it server-side from the
  // real submitted order, so a stale/spoofed client value here can't affect
  // what's billed. The fallback keeps the preview safely at 21% if malformed
  // account data ever reaches the page.
  const vatPreview = useMemo(() => {
    const destinationCountry = fulfilmentMode === "SHIPPING_PREPAID" ? pickupPoint?.countryCode ?? "BE" : "BE";
    try {
      return {
        ...resolveGoodsVatPolicy({
          fulfilmentMode: fulfilmentMode ?? "PICKUP_PREPAID",
          destinationCountry,
          customer: savedVatProfile && savedVatProfile.vatNumber === customerInfo.vatNumber
            ? savedVatProfile
            : null,
        }),
        destinationCountry,
      };
    } catch {
      return { vatTreatment: "DOMESTIC", vatRate: BELGIUM_VAT_RATE, destinationCountry };
    }
  }, [fulfilmentMode, pickupPoint?.countryCode, savedVatProfile, customerInfo.vatNumber]);

  const vatSubtotal = useMemo(
    () => cart.items.reduce(
      (sum, item) => sum + applyVatRate(item.variant.priceExclVat, vatPreview.vatRate) * item.quantity,
      0
    ),
    [cart.items, vatPreview.vatRate]
  );
  const discountAmount = appliedPromo?.discountAmount ?? 0;
  const total = Math.max(0, vatSubtotal + shippingCost - discountAmount);

  /**
   * The summary the customer reads, built from the net side.
   *
   * Catalogue prices are stored TTC, with derived HT twins carried by the
   * cart. The carrier grid is genuinely HT. Only the promo discount has to be
   * netted down because it applies to the customer-facing total.
   *
   * VAT is then the difference between that net base and the amount actually
   * charged, rather than a fifth independently rounded number: computed this
   * way the four printed lines always reconcile to the cent, which is the
   * whole point of showing them.
   */
  const netTotals = useMemo(() => {
    const goodsNet = cart.items.reduce(
      (sum, item) => sum + Number(item.variant.priceExclVat) * item.quantity,
      0
    );
    const shippingNet = Number(shippingDetails.costExclVat) || 0;
    const discountNet = discountAmount / (1 + vatPreview.vatRate / 100);
    const subtotalNet = roundMoney(goodsNet + shippingNet - discountNet);
    return {
      goodsNet: roundMoney(goodsNet),
      shippingNet: roundMoney(shippingNet),
      discountNet: roundMoney(discountNet),
      subtotalNet,
      vatAmount: roundMoney(total - subtotalNet),
    };
  }, [cart.items, shippingDetails.costExclVat, discountAmount, vatPreview.vatRate, total]);
  const hasSavedVatProof = isAuthenticated && hasReusableVatValidation(savedVatProfile, customerInfo.vatNumber);

  const vatNote = useMemo(() => {
    if (vatPreview.taxNote === VAT_LEGAL_NOTES.FOREIGN_EU_B2B_ZERO) {
      return {
        tone: "good",
        text: "TVA à 0% appliquée — autoliquidation.",
      };
    }
    if (!customerInfo.vatNumber?.trim()) {
      return { tone: "info", text: "Ajoutez un numéro de TVA UE puis vérifiez-le auprès de VIES. Sans validation VIES, la TVA à 21% reste appliquée." };
    }
    return {
      tone: "info",
      text: "La TVA à 21% reste appliquée. Le taux de 0% exige un numéro de TVA actif, validé par VIES et délivré par un autre pays de l’Union européenne.",
    };
  }, [vatPreview, customerInfo.vatNumber]);

  function handleCustomerChange(e) {
    const { name, value, type, checked } = e.target;
    setCustomerInfo((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
    if (name === "email") setEmailStatus(null);
    if (name === "vatNumber") {
      setVatCheck(null);
      setSavedVatProfile(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!fulfilmentMode) {
      toast.error("Veuillez choisir un mode de retrait.");
      return;
    }
    if (quoteRequired) {
      toast.error("Votre commande dépasse 30 kg. Contactez-nous pour un devis de livraison personnalisé.");
      return;
    }
    if (!acceptedTerms) {
      toast.error("Veuillez accepter les CGV et la politique de confidentialité.");
      return;
    }
    if (!isAuthenticated) {
      if (!customerInfo.fullName.trim() || !customerInfo.email.trim() || !customerInfo.phone.trim()) {
        toast.error("Veuillez compléter vos informations de contact.");
        return;
      }
      if (isDisposableEmail(customerInfo.email)) {
        toast.error("Les adresses e-mail temporaires ne sont pas acceptées.");
        return;
      }
      if (emailStatus === "exists") {
        toast.error(
          "Cette adresse email est déjà associée à un compte. Connectez-vous ou cliquez sur « Continuer quand même »."
        );
        return;
      }
    }
    // Also runs for a signed-in customer whose account has no address yet —
    // an invoice cannot legally exist without one (art. 226(5)), and this is
    // the last chance to catch it before the button below charges Stripe.
    if (!hasAddressOnFile) {
      if (!customerInfo.addressLine1.trim() || !customerInfo.addressCity.trim() || !customerInfo.addressPostalCode.trim()) {
        toast.error("Veuillez indiquer votre adresse de facturation — elle est obligatoire pour la facture.");
        return;
      }
    }
    if (fulfilmentMode === "SHIPPING_PREPAID") {
      if (!pickupPoint?.name?.trim() || !pickupPoint?.city?.trim() || !/^\d{4}$/.test((pickupPoint?.postalCode ?? "").trim())) {
        toast.error("Veuillez choisir un point relais Mondial Relay valide.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        fulfilmentMode,
        customerInfo: isAuthenticated
          ? {
              userId: customerSession.id,
              // Identity fields come from the trusted session, never from
              // what the client typed (resolveOrCreateCustomer's IDOR note).
              // The address is the exception: when hasAddressOnFile is false
              // there is no server-known value yet, so what was just typed
              // into the form below is the only source — resolveOrCreateCustomer
              // persists it onto this same account.
              fullName: customerSession.fullName,
              email: customerSession.email,
              phone: customerSession.phone,
              vatNumber: customerInfo.vatNumber || "",
              addressLine1: customerInfo.addressLine1,
              addressLine2: customerInfo.addressLine2,
              addressCity: customerInfo.addressCity,
              addressPostalCode: customerInfo.addressPostalCode,
              addressCountry: customerInfo.addressCountry,
            }
          : customerInfo,
        pickupPoint: fulfilmentMode === "SHIPPING_PREPAID" ? pickupPoint : null,
        notes: notes || null,
        promoCode: appliedPromo?.code ?? null,
        // Re-checked and recorded server-side — the guard above is only a
        // courtesy message, the action is a public endpoint.
        termsAccepted: acceptedTerms,
      };

      const result = await createOrderFromCart(payload);
      if (!result.success) {
        toast.error(result.message);
        setSubmitting(false);
        return;
      }

      if (result.data.requiresEmailVerification) {
        setPendingVerificationEmail(result.data.email);
        setSubmitting(false);
        return;
      }

      if (!result.data.requiresPayment) {
        // createOrderFromCart already converted the cart server-side for an
        // on-site order, but router.push is a client-side transition — the
        // header badge (mounted once, higher up the tree) won't remount to
        // pick that up on its own, so it'd keep showing the old count.
        window.dispatchEvent(new CustomEvent("boutique:cart-updated", { detail: { itemCount: 0 } }));
        router.push(`/boutique/order/success?onsite=1&number=${result.data.orderNumber}&code=${result.data.pickupCode}`);
        return;
      }

      const sessionResult = await createOrderCheckoutSession(result.data.orderId, result.data.checkoutToken);
      if (!sessionResult.success) {
        toast.error(sessionResult.message || "Impossible de démarrer le paiement.");
        setSubmitting(false);
        return;
      }

      if (sessionResult.freeOrder) {
        // A 100%-off promo code covered the whole order — already confirmed
        // server-side, nothing to pay on Stripe's side.
        window.dispatchEvent(new CustomEvent("boutique:cart-updated", { detail: { itemCount: 0 } }));
        router.push(`/boutique/order/success?free=1&number=${sessionResult.orderNumber}${sessionResult.pickupCode ? `&code=${sessionResult.pickupCode}` : ""}`);
        return;
      }

      if (!sessionResult.url) {
        toast.error("Impossible de démarrer le paiement.");
        setSubmitting(false);
        return;
      }
      window.location.href = sessionResult.url;
    } catch (error) {
      console.error("[CheckoutPageClient]", error);
      toast.error("Une erreur est survenue. Veuillez réessayer.");
      setSubmitting(false);
    }
  }

  async function handleRequestQuote() {
    const info = isAuthenticated ? customerSession : customerInfo;
    if (!info?.fullName?.trim() || !info?.email?.trim() || !info?.phone?.trim()) {
      toast.error("Veuillez compléter vos informations de contact.");
      return;
    }
    if (!isAuthenticated && isDisposableEmail(info.email)) {
      toast.error("Les adresses e-mail temporaires ne sont pas acceptées.");
      return;
    }
    if (!pickupPoint?.name?.trim() || !pickupPoint?.city?.trim() || !/^\d{4}$/.test((pickupPoint?.postalCode ?? "").trim())) {
      toast.error("Veuillez choisir un point relais Mondial Relay valide.");
      return;
    }

    setQuoteRequest({ submitting: true, sent: false });
    const result = await requestShippingQuote({
      fullName: info.fullName,
      email: info.email,
      phone: info.phone,
      pickupPoint,
      notes: notes || null,
    });

    if (result.success) {
      setQuoteRequest({ submitting: false, sent: true });
      toast.success(result.message);
    } else {
      setQuoteRequest({ submitting: false, sent: false });
      toast.error(result.message);
    }
  }

  const vatField = (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#2F3A2E]">
        Numéro de TVA (optionnel)
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          name="vatNumber"
          value={customerInfo.vatNumber ?? ""}
          onChange={handleCustomerChange}
          placeholder="BE0123456789 ou FRXX123456789"
          className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleVerifyVat}
          disabled={vatCheck?.loading}
          className="inline-flex shrink-0 items-center gap-1.5 border border-neutral-200 px-3 text-xs font-semibold text-gray-600 transition-colors hover:border-[#C8A46A] hover:text-[#2F3A2E] disabled:opacity-50"
        >
          {vatCheck?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldQuestion className="h-3.5 w-3.5" />}
          Vérifier
        </button>
      </div>
      {vatCheck && !vatCheck.loading && (
        <p
          className={`flex items-center gap-1.5 text-xs font-medium ${
            vatCheck.error ? "text-amber-600" : vatCheck.valid ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {vatCheck.error ? (
            <ShieldQuestion className="h-3.5 w-3.5 shrink-0" />
          ) : vatCheck.valid ? (
            <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <BadgeX className="h-3.5 w-3.5 shrink-0" />
          )}
          {vatCheck.message}
        </p>
      )}
      <p className="text-xs text-gray-400">
        Après validation, ce numéro sera réutilisé pendant 90 jours.
      </p>
    </div>
  );

  if (pendingVerificationEmail) {
    return (
      <div className="mx-auto max-w-[600px] px-6 py-20 text-center md:px-10">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#C8A46A]/10">
          <CheckCircle2 className="h-8 w-8 text-[#C8A46A]" />
        </div>
        <h1 className="text-2xl font-bold text-[#2F3A2E]">Confirmez votre email</h1>
        <p className="mx-auto mt-3 max-w-md text-ink/60 text-gray-500">
          Nous avons envoyé un email de confirmation à <strong>{pendingVerificationEmail}</strong>. Une fois confirmée,
          vous recevrez vos identifiants de connexion par email et pourrez finaliser votre paiement.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-12 md:px-10">
      <h1 className="mb-8 text-3xl text-[#2F3A2E]">Finaliser la commande</h1>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          {/* Fulfilment mode */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Mode de retrait</h2>
            <div className="space-y-3">
              {MODES.map((mode) => {
                const Icon = mode.icon;
                const selected = fulfilmentMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setFulfilmentMode(mode.value)}
                    className={`flex w-full items-start gap-4 border p-5 text-left transition-colors ${
                      selected ? "border-[#C8A46A] bg-[#C8A46A]/5" : "border-neutral-200 hover:border-[#C8A46A]/50"
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${
                        selected ? "bg-[#C8A46A] text-white" : "bg-neutral-100 text-gray-500"
                      }`}
                    >
                      <Icon size={19} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#2F3A2E]">{mode.title}</p>
                      <p className="mt-0.5 text-sm text-gray-500">{mode.description}</p>
                    </div>
                    {selected && <Check size={20} className="flex-shrink-0 text-[#C8A46A]" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Pickup point (Mondial Relay) */}
          {fulfilmentMode === "SHIPPING_PREPAID" && (
            <section className="border border-neutral-200 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">
                Point relais Mondial Relay
              </h2>
              <MondialRelayPicker value={pickupPoint} onChange={setPickupPoint} />
            </section>
          )}

          {isAuthenticated && (
            <section className="border border-neutral-200 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">
                Facturation professionnelle
              </h2>
              {hasSavedVatProof ? (
                <div className="flex items-start gap-3 bg-emerald-50 px-4 py-3 text-emerald-800">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold">TVA {customerInfo.vatNumber} vérifiée</p>
                    <p className="mt-0.5 text-xs text-emerald-700">
                      La validation VIES est réutilisée pendant 90 jours. Pour changer ce numéro, utilisez votre{" "}
                      <Link href="/profile" className="underline underline-offset-2">profil</Link>.
                    </p>
                  </div>
                </div>
              ) : vatField}
            </section>
          )}

          {/* Customer info */}
          {!isAuthenticated && (
            <section className="border border-neutral-200 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Vos informations</h2>
              <div className="space-y-4">
                <input
                  name="fullName"
                  value={customerInfo.fullName}
                  onChange={handleCustomerChange}
                  placeholder="Nom complet"
                  className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  required
                />
                <div className="relative">
                  <input
                    type="email"
                    name="email"
                    value={customerInfo.email}
                    onChange={handleCustomerChange}
                    onBlur={handleEmailBlur}
                    placeholder="Email"
                    className={`w-full border px-4 py-3 text-sm focus:outline-none ${
                      emailStatus === "exists" ? "border-amber-400 focus:border-amber-500" : "border-neutral-200 focus:border-[#C8A46A]"
                    }`}
                    required
                  />
                  {checkingEmail && (
                    <div className="absolute inset-y-0 right-3 flex items-center">
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    </div>
                  )}
                </div>
                {emailStatus === "exists" && (
                  <ExistingAccountBanner
                    email={customerInfo.email}
                    callbackUrl="/boutique/checkout"
                    onDismiss={() => setEmailStatus("dismissed")}
                  />
                )}
                <input
                  type="tel"
                  name="phone"
                  value={customerInfo.phone}
                  onChange={handleCustomerChange}
                  placeholder="Téléphone"
                  className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  required
                />
                {vatField}

                {/* Billing address — mandatory for every invoice (Belgian legal
                    requirement). Not marked required at the HTML level since a
                    returning customer whose account already has an address on
                    file doesn't need to resubmit it (it arrives pre-filled via
                    customerSession). The submit handler enforces it above
                    whenever !hasAddressOnFile, and resolveOrCreateCustomer
                    enforces the same rule server-side — before Stripe is
                    charged, not after: see cmtbaqxua0003gczkbigl9x23. */}
                <div className="space-y-3 border-t border-neutral-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#2F3A2E]">
                    Adresse de facturation
                  </p>
                  <input
                    type="text"
                    name="addressLine1"
                    value={customerInfo.addressLine1}
                    onChange={handleCustomerChange}
                    autoComplete="address-line1"
                    placeholder="Rue et numéro"
                    className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  />
                  <input
                    type="text"
                    name="addressLine2"
                    value={customerInfo.addressLine2}
                    onChange={handleCustomerChange}
                    autoComplete="address-line2"
                    placeholder="Boîte, étage, complément (optionnel)"
                    className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <input
                      type="text"
                      name="addressPostalCode"
                      value={customerInfo.addressPostalCode}
                      onChange={handleCustomerChange}
                      autoComplete="postal-code"
                      placeholder="Code postal"
                      className="col-span-1 w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                    />
                    <input
                      type="text"
                      name="addressCity"
                      value={customerInfo.addressCity}
                      onChange={handleCustomerChange}
                      autoComplete="address-level2"
                      placeholder="Ville"
                      className="col-span-2 w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                    />
                  </div>
                  <select
                    name="addressCountry"
                    value={customerInfo.addressCountry}
                    onChange={handleCustomerChange}
                    autoComplete="country"
                    className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  >
                    <option value="BE">Belgique</option>
                    <option value="FR">France</option>
                    <option value="LU">Luxembourg</option>
                    <option value="NL">Pays-Bas</option>
                    <option value="DE">Allemagne</option>
                  </select>
                </div>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    name="newsletterSubscribed"
                    checked={customerInfo.newsletterSubscribed}
                    onChange={handleCustomerChange}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-[#C8A46A] focus:ring-[#C8A46A]"
                  />
                  <span className="text-sm text-gray-600">Je souhaite recevoir des offres exclusives par email</span>
                </label>
                <p className="text-xs text-gray-400">Un compte sera créé automatiquement pour suivre votre commande.</p>
              </div>
            </section>
          )}

          {/* Notes */}
          <section className="border border-neutral-200 p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Notes (optionnel)</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Une demande particulière ?"
              className="w-full resize-none border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
            />
          </section>
        </div>

        {/* Summary */}
        <div className="h-fit border border-neutral-200 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Récapitulatif</h2>
          <ul className="space-y-2 text-sm text-gray-600">
            {cart.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {item.variant.product.name} × {item.quantity}
                </span>
                <span className="flex-shrink-0 font-medium text-[#2F3A2E]">
                  €{(applyVatRate(item.variant.priceExclVat, vatPreview.vatRate) * item.quantity).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <PromoCodeField subtotal={vatSubtotal} onApplied={setAppliedPromo} />
          </div>

          {/* Read in the order the price is actually built: goods HT,
              carriage HT, the discount off the net base, the VAT on what
              remains, then the amount charged. The invoice issued for this
              order prints the same four figures. */}
          <div className="mt-4 space-y-1.5 border-t border-neutral-100 pt-4 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Sous-total HT</span>
              <span>€{netTotals.goodsNet.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Livraison HT</span>
              <span>
                {fulfilmentMode !== "SHIPPING_PREPAID"
                  ? "—"
                  : quoteRequired
                    ? "Devis requis"
                    : shippingCost === 0
                      ? "Offerte"
                      : `€${netTotals.shippingNet.toFixed(2)}`}
              </span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Réduction ({appliedPromo.code})</span>
                <span>-€{netTotals.discountNet.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>TVA ({vatPreview.vatRate}%)</span>
              <span>{quoteRequired ? "—" : `€${netTotals.vatAmount.toFixed(2)}`}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-100 pt-2 text-base font-semibold text-[#2F3A2E]">
              <span>Total TTC</span>
              <span>{quoteRequired ? "—" : `€${total.toFixed(2)}`}</span>
            </div>
          </div>

          {vatNote && (
            <div
              className={`mt-4 flex items-start gap-2.5 border p-3 text-xs ${
                vatNote.tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-neutral-50 text-neutral-600"
              }`}
            >
              {vatNote.tone === "good" ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-neutral-400" />
              )}
              <p>{vatNote.text}</p>
            </div>
          )}

          {quoteRequired && (
            quoteRequest.sent ? (
              <div className="mt-4 flex items-start gap-3 border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" />
                <p>Votre demande de devis a été envoyée. Nous vous recontacterons sous peu par email ou téléphone.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                  <p>
                    Votre commande dépasse 30&nbsp;kg ({shippingDetails.totalWeightKg?.toFixed(1)}&nbsp;kg) : aucun tarif de
                    livraison automatique ne s&apos;applique. Demandez un devis personnalisé, ou choisissez le retrait en boutique.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRequestQuote}
                  disabled={quoteRequest.submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                >
                  {quoteRequest.submitting && <Loader2 size={14} className="animate-spin" />}
                  Demander un devis
                </button>
              </div>
            )
          )}

          <label className="mt-4 flex items-start gap-2.5 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              J&apos;ai lu et j&apos;accepte les{" "}
              <a href="/cgv" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#C8A46A]">
                Conditions générales de vente
              </a>{" "}
              et la{" "}
              <a href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#C8A46A]">
                Politique de confidentialité
              </a>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting || quoteRequired || !acceptedTerms}
            className="mt-3 flex w-full items-center justify-center gap-2 bg-[#C8A46A] px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#B8945A] disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Traitement…
              </>
            ) : (
              "Confirmer la commande"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
