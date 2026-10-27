"use client";

import { useState } from "react";
import { Minus, Plus, PackageSearch, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { getReturnableOrder, requestReturn } from "@/actions/boutique/returns";
import { toIntlLocale } from "@/lib/intl-locale";

function formatPrice(n, locale) {
  return new Intl.NumberFormat(toIntlLocale(locale), { style: "currency", currency: "EUR" }).format(n);
}
function formatDate(d, locale) {
  return new Date(d).toLocaleDateString(toIntlLocale(locale), { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Brussels" });
}

const REASON_CATEGORY_KEYS = ["changedMind", "defective", "wrongItem", "damagedInTransit", "notReceived", "goodwill"];

export function ReturnRequestClient() {
  const t = useTranslations("boutique");
  const locale = useLocale();
  const language = locale === "nl" ? "nl" : locale === "en" ? "en" : "fr";
  const reasonLabels = {
    fr: ["Changement d'avis", "Produit défectueux", "Article incorrect reçu", "Endommagé pendant le transport", "Colis jamais reçu", "Autre / geste commercial"],
    nl: ["Van gedachten veranderd", "Defect product", "Verkeerd artikel ontvangen", "Beschadigd tijdens transport", "Pakket nooit ontvangen", "Overig / commercieel gebaar"],
    en: ["Changed my mind", "Defective product", "Incorrect item received", "Damaged in transit", "Package never received", "Other / goodwill gesture"],
  }[language];
  const reasonCategoryOptions = REASON_CATEGORY_KEYS.map((key, index) => ({ value: ["CHANGED_MIND", "DEFECTIVE", "WRONG_ITEM", "DAMAGED_IN_TRANSIT", "NOT_RECEIVED", "GOODWILL"][index], label: reasonLabels[index] }));
  const [step, setStep] = useState("lookup"); // lookup | select | done
  const [lookingUp, setLookingUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState(null);
  const [selected, setSelected] = useState({}); // orderItemId -> quantity
  const [reasonCategory, setReasonCategory] = useState("");
  const [reason, setReason] = useState("");

  async function handleLookup(e) {
    e.preventDefault();
    setLookingUp(true);
    const result = await getReturnableOrder({ reference, email });
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
      toast.error(t("returns.selectItemsError"));
      return;
    }
    if (!reasonCategory) {
      toast.error(language === "nl" ? "Selecteer een reden voor retour." : language === "en" ? "Please select a reason for your return." : "Merci de sélectionner un motif de retour.");
      return;
    }
    if (!reason.trim()) {
      toast.error(t("returns.reasonError"));
      return;
    }

    setSubmitting(true);
    const result = await requestReturn({
      reference: order.reference,
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
        <h1 className="mb-3 text-3xl text-[#2F3A2E]">{t("returns.requestSentTitle")}</h1>
        <p className="text-sm text-gray-500">
          {language === "nl" ? `Uw retouraanvraag voor ticket ${order.reference} is verzonden. U ontvangt binnenkort een bevestiging per e-mail en daarna een antwoord van ons team.` : language === "en" ? `Your return request for ticket ${order.reference} has been sent. You will receive an email confirmation, followed by a response from our team shortly.` : `Votre demande de retour pour le ticket ${order.reference} a bien été transmise. Vous recevrez un e-mail de confirmation, puis une réponse de notre équipe sous peu.`}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-6 py-12 md:px-10">
      <h1 className="mb-2 text-3xl text-[#2F3A2E]">{t("returns.title")}</h1>
      <p className="mb-8 text-sm text-gray-500">
        {language === "nl" ? "Volgens het herroepingsrecht heeft u 14 dagen na ontvangst om een artikel te retourneren." : language === "en" ? "Under the right of withdrawal, you have 14 days after receipt to return an item." : t("returns.subtitle")}
      </p>

      {step === "lookup" && (
        <form onSubmit={handleLookup} className="space-y-4 border border-neutral-200 p-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">{t("returns.lookupTitle")}</h2>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={language === "nl" ? "Ticketnummer (bv. T-2026-000044)" : language === "en" ? "Ticket number (e.g. T-2026-000044)" : "Numéro de ticket (ex : T-2026-000044)"}
            className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
            required
          />
          <p className="-mt-2 text-xs text-gray-400">
            {language === "nl" ? "U vindt dit bovenaan uw kassabon. Gebruik bij een oudere bon het bestelnummer." : language === "en" ? "It appears at the top of your receipt. For an older receipt, enter the order number." : "Il figure en haut de votre ticket de caisse. Sur un ancien ticket, indiquez le numéro de commande."}
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("returns.emailPlaceholder")}
            className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
            required
          />
          <button
            type="submit"
            disabled={lookingUp}
            className="flex w-full items-center justify-center gap-2 bg-[#2F3A2E] px-6 py-3.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-[#3d4e3b] disabled:opacity-50"
          >
            <PackageSearch size={16} />
            {lookingUp ? (language === "nl" ? "Zoeken…" : language === "en" ? "Searching…" : "Recherche…") : t("returns.lookupTitle")}
          </button>
        </form>
      )}

      {step === "select" && order && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="border border-neutral-200 p-6">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">
              Ticket {order.reference}
            </h2>
            <p className="mb-4 text-xs text-gray-400">
              {order.estimatedDeadline
                ? (language === "nl" ? "Ontvangstdatum niet bevestigd — neem contact met ons op als u niet zeker weet of u nog binnen de termijn valt." : language === "en" ? "Receipt date not confirmed — contact us if you are unsure whether you are still within the return period." : "Date de réception non confirmée — contactez-nous si vous n'êtes pas sûr(e) d'être encore dans les délais.")
                : order.withdrawalExpired
                  ? (language === "nl" ? "De termijn van 14 dagen voor een gewone wijziging van gedachten is verstreken. Voor een defect product, een verkeerd artikel of een beschadigd pakket kunt u hieronder nog steeds een aanvraag indienen." : language === "en" ? "The 14-day period for a change of mind has passed. You can still submit a request below for a defective product, incorrect item or damaged package." : "Le délai de 14 jours pour un simple changement d'avis est dépassé. Pour un produit défectueux, un article incorrect ou un colis endommagé, vous restez couvert et pouvez faire votre demande ci-dessous.")
                  : `${language === "nl" ? "Retour mogelijk tot" : language === "en" ? "Return available until" : "Retour possible jusqu'au"} ${formatDate(order.deadline, locale)}`}
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
                        {item.variantName} · {formatPrice(item.unitPrice, locale)} · {item.remaining} {language === "nl" ? "beschikbaar voor retour" : language === "en" ? "available to return" : "disponible(s) au retour"}
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
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">{t("returns.reasonLabel")}</h2>
            <select
              value={reasonCategory}
              onChange={(e) => setReasonCategory(e.target.value)}
              className="mb-3 w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
              required
            >
              <option value="" disabled>{language === "nl" ? "Selecteer een reden" : language === "en" ? "Select a reason" : "Sélectionnez un motif"}</option>
              {reasonCategoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {order.withdrawalExpired && reasonCategory === "CHANGED_MIND" && (
              <p className="mb-3 text-xs text-amber-700">
                {language === "nl" ? "De termijn van 14 dagen om van gedachten te veranderen is voor deze bestelling verstreken." : language === "en" ? "The 14-day change-of-mind period has passed for this order." : "Le délai de 14 jours pour un changement d'avis est dépassé pour cette commande."}
              </p>
            )}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("returns.reasonPlaceholder")}
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
            {submitting ? (language === "nl" ? "Verzenden…" : language === "en" ? "Sending…" : "Envoi…") : (language === "nl" ? "Retouraanvraag verzenden" : language === "en" ? "Submit return request" : "Envoyer la demande de retour")}
          </button>
        </form>
      )}
    </div>
  );
}
