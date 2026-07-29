"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Store, Wallet, Truck, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createOrderFromCart, createOrderCheckoutSession } from "@/actions/boutique/orders";

const SHIPPING_FLAT_COST = 4.95;
const FREE_SHIPPING_THRESHOLD = 50;

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
    title: "Livraison à domicile",
    description: `Payez maintenant, livraison bpost. €${SHIPPING_FLAT_COST.toFixed(2)} — offerte dès €${FREE_SHIPPING_THRESHOLD}.`,
  },
];

export function CheckoutPageClient({ cart, customerSession }) {
  const router = useRouter();
  const isAuthenticated = Boolean(customerSession);

  const [fulfilmentMode, setFulfilmentMode] = useState(null);
  const [customerInfo, setCustomerInfo] = useState(
    customerSession ?? { fullName: "", email: "", phone: "", newsletterSubscribed: false }
  );
  const [shippingAddress, setShippingAddress] = useState({ line1: "", line2: "", city: "", postalCode: "" });
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const shippingCost = useMemo(() => {
    if (fulfilmentMode !== "SHIPPING_PREPAID") return 0;
    return cart.subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT_COST;
  }, [fulfilmentMode, cart.subtotal]);

  const total = cart.subtotal + shippingCost;

  function handleCustomerChange(e) {
    const { name, value, type, checked } = e.target;
    setCustomerInfo((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  function handleAddressChange(e) {
    const { name, value } = e.target;
    setShippingAddress((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!fulfilmentMode) {
      toast.error("Veuillez choisir un mode de retrait.");
      return;
    }
    if (!isAuthenticated) {
      if (!customerInfo.fullName.trim() || !customerInfo.email.trim() || !customerInfo.phone.trim()) {
        toast.error("Veuillez compléter vos informations de contact.");
        return;
      }
    }
    if (fulfilmentMode === "SHIPPING_PREPAID") {
      if (!shippingAddress.line1.trim() || !shippingAddress.city.trim() || !/^\d{4}$/.test(shippingAddress.postalCode.trim())) {
        toast.error("Veuillez compléter une adresse de livraison valide (code postal belge à 4 chiffres).");
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        fulfilmentMode,
        customerInfo: isAuthenticated
          ? { userId: customerSession.id, fullName: customerSession.fullName, email: customerSession.email, phone: customerSession.phone }
          : customerInfo,
        shippingAddress: fulfilmentMode === "SHIPPING_PREPAID" ? shippingAddress : null,
        notes: notes || null,
      };

      const result = await createOrderFromCart(payload);
      if (!result.success) {
        toast.error(result.message);
        setSubmitting(false);
        return;
      }

      if (!result.data.requiresPayment) {
        router.push(`/boutique/order/success?onsite=1&number=${result.data.orderNumber}&code=${result.data.pickupCode}`);
        return;
      }

      const sessionResult = await createOrderCheckoutSession(result.data.orderId);
      if (!sessionResult.success || !sessionResult.url) {
        toast.error(sessionResult.message || "Impossible de démarrer le paiement.");
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

          {/* Shipping address */}
          {fulfilmentMode === "SHIPPING_PREPAID" && (
            <section className="border border-neutral-200 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">
                Adresse de livraison
              </h2>
              <div className="space-y-4">
                <input
                  name="line1"
                  value={shippingAddress.line1}
                  onChange={handleAddressChange}
                  placeholder="Rue et numéro"
                  className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  required
                />
                <input
                  name="line2"
                  value={shippingAddress.line2}
                  onChange={handleAddressChange}
                  placeholder="Complément d'adresse (optionnel)"
                  className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-4">
                  <input
                    name="postalCode"
                    value={shippingAddress.postalCode}
                    onChange={handleAddressChange}
                    placeholder="Code postal"
                    maxLength={4}
                    className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                    required
                  />
                  <input
                    name="city"
                    value={shippingAddress.city}
                    onChange={handleAddressChange}
                    placeholder="Ville"
                    className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                    required
                  />
                </div>
                <p className="text-xs text-gray-400">Livraison en Belgique uniquement.</p>
              </div>
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
                <input
                  type="email"
                  name="email"
                  value={customerInfo.email}
                  onChange={handleCustomerChange}
                  placeholder="Email"
                  className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  required
                />
                <input
                  type="tel"
                  name="phone"
                  value={customerInfo.phone}
                  onChange={handleCustomerChange}
                  placeholder="Téléphone"
                  className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
                  required
                />
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
                  €{(item.variant.price * item.quantity).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1.5 border-t border-neutral-100 pt-4 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Sous-total</span>
              <span>€{cart.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Livraison</span>
              <span>{fulfilmentMode === "SHIPPING_PREPAID" ? (shippingCost === 0 ? "Offerte" : `€${shippingCost.toFixed(2)}`) : "—"}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-100 pt-2 text-base font-semibold text-[#2F3A2E]">
              <span>Total</span>
              <span>€{total.toFixed(2)}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 flex w-full items-center justify-center gap-2 bg-[#C8A46A] px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#B8945A] disabled:cursor-not-allowed disabled:bg-gray-300"
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
