"use client";

import { useState } from "react";
import { Minus, Plus, PackageSearch, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getReturnableOrder, requestReturn } from "@/actions/boutique/returns";

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}
function formatDate(d) {
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
}

const REASON_CATEGORY_OPTIONS = [
  { value: "CHANGED_MIND", label: "Changement d'avis" },
  { value: "DEFECTIVE", label: "Produit défectueux" },
  { value: "WRONG_ITEM", label: "Article incorrect reçu" },
  { value: "DAMAGED_IN_TRANSIT", label: "Endommagé pendant le transport" },
  { value: "NOT_RECEIVED", label: "Colis jamais reçu" },
  { value: "GOODWILL", label: "Autre / geste commercial" },
];

export function ReturnRequestClient() {
  const [step, setStep] = useState("lookup"); // lookup | select | done
  const [lookingUp, setLookingUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState(null);
  const [selected, setSelected] = useState({}); // orderItemId -> quantity
  const [reasonCategory, setReasonCategory] = useState("");
  const [reason, setReason] = useState("");

  async function handleLookup(e) {
    e.preventDefault();
    setLookingUp(true);
    const result = await getReturnableOrder({ orderNumber, email });
    setLookingUp(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    setOrder(result.data);
    setSelected({});
    setReasonCategory("");
    setStep("select");
  }

  function toggleItem(item) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[item.id] !== undefined) delete next[item.id];
      else next[item.id] = 1;
      return next;
    });
  }

  function setQuantity(item, quantity) {
    setSelected((prev) => ({ ...prev, [item.id]: Math.min(Math.max(quantity, 1), item.remaining) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const items = Object.entries(selected).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (items.length === 0) {
      toast.error("Sélectionnez au moins un article à retourner.");
      return;
    }
    if (!reasonCategory) {
      toast.error("Merci de sélectionner un motif de retour.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Merci de préciser le motif du retour.");
      return;
    }

    setSubmitting(true);
    const result = await requestReturn({
      orderNumber: order.orderNumber,
      email,
      reasonCategory,
      reason: reason.trim(),
      items,
    });
    setSubmitting(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    setStep("done");
  }

  if (step === "done") {
    return (
      <div className="mx-auto max-w-[640px] px-6 py-20 text-center md:px-10">
        <CheckCircle2 size={40} className="mx-auto mb-5 text-[#C8A46A]" />
        <h1 className="mb-3 text-3xl text-[#2F3A2E]">Demande envoyée</h1>
        <p className="text-sm text-gray-500">
          Votre demande de retour pour la commande n°{order.orderNumber} a bien été transmise. Vous recevrez un e-mail
          de confirmation, puis une réponse de notre équipe sous peu.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-6 py-12 md:px-10">
      <h1 className="mb-2 text-3xl text-[#2F3A2E]">Retourner un article</h1>
      <p className="mb-8 text-sm text-gray-500">
        Conformément au droit de rétractation, vous disposez de 14 jours après réception pour retourner un article.
      </p>

      {step === "lookup" && (
        <form onSubmit={handleLookup} className="space-y-4 border border-neutral-200 p-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Retrouver ma commande</h2>
          <input
            type="text"
            inputMode="numeric"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="Numéro de commande (ex : 42)"
            className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
            required
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email utilisé lors de la commande"
            className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
            required
          />
          <button
            type="submit"
            disabled={lookingUp}
            className="flex w-full items-center justify-center gap-2 bg-[#2F3A2E] px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-[#3d4e3b] disabled:opacity-50"
          >
            <PackageSearch size={16} />
            {lookingUp ? "Recherche…" : "Retrouver ma commande"}
          </button>
        </form>
      )}

      {step === "select" && order && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="border border-neutral-200 p-6">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">
              Commande n°{order.orderNumber}
            </h2>
            <p className="mb-4 text-xs text-gray-400">
              {order.estimatedDeadline
                ? "Date de réception non confirmée — contactez-nous si vous n'êtes pas sûr(e) d'être encore dans les délais."
                : order.withdrawalExpired
                  ? "Le délai de 14 jours pour un simple changement d'avis est dépassé. Pour un produit défectueux, un article incorrect ou un colis endommagé, vous restez couvert et pouvez faire votre demande ci-dessous."
                  : `Retour possible jusqu'au ${formatDate(order.deadline)}`}
            </p>

            <div className="space-y-3">
              {order.items.map((item) => {
                const isSelected = selected[item.id] !== undefined;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 border p-4 transition-colors ${
                      isSelected ? "border-[#C8A46A] bg-[#C8A46A]/5" : "border-neutral-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItem(item)}
                      className="h-4 w-4 rounded border-gray-300 text-[#C8A46A] focus:ring-[#C8A46A]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#2F3A2E]">{item.productName}</p>
                      <p className="text-xs text-gray-400">
                        {item.variantName} · {formatPrice(item.unitPrice)} · {item.remaining} disponible(s) au retour
                      </p>
                    </div>
                    {isSelected && item.remaining > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setQuantity(item, (selected[item.id] ?? 1) - 1)}
                          className="flex h-8 w-8 items-center justify-center border border-neutral-200 text-gray-500 hover:border-[#C8A46A]"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-sm">{selected[item.id] ?? 1}</span>
                        <button
                          type="button"
                          onClick={() => setQuantity(item, (selected[item.id] ?? 1) + 1)}
                          className="flex h-8 w-8 items-center justify-center border border-neutral-200 text-gray-500 hover:border-[#C8A46A]"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border border-neutral-200 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Motif du retour</h2>
            <select
              value={reasonCategory}
              onChange={(e) => setReasonCategory(e.target.value)}
              className="mb-3 w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
              required
            >
              <option value="" disabled>Sélectionnez un motif</option>
              {REASON_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {order.withdrawalExpired && reasonCategory === "CHANGED_MIND" && (
              <p className="mb-3 text-xs text-amber-700">
                Le délai de 14 jours pour un changement d&apos;avis est dépassé pour cette commande.
              </p>
            )}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Expliquez brièvement pourquoi vous souhaitez retourner ce(s) article(s)"
              rows={4}
              className="w-full resize-none border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#2F3A2E] px-6 py-4 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-[#3d4e3b] disabled:opacity-50"
          >
            {submitting ? "Envoi…" : "Envoyer la demande de retour"}
          </button>
        </form>
      )}
    </div>
  );
}
