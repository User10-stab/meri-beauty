"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Banknote, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { confirmManualRefundLeg } from "@/actions/dashboard/cancel-and-refund";

/**
 * Every refund still owed to a customer.
 *
 * This application does not move money — an OWNER/ADMIN refunds cards by
 * hand in the Stripe dashboard and hands cash back at the counter. So this
 * panel is not a status display, it is the worklist that makes that policy
 * survivable: each row says exactly what to pay back, by which method, and
 * against which original payment.
 *
 * The two halves are genuinely different jobs and are kept visually apart:
 *
 *   Stripe    — go and do it there; nothing to tick here, because the
 *               charge.refunded webhook is better evidence than a checkbox.
 *   In person — hand over the money, then attest to it, because Stripe has
 *               no idea these payments ever existed.
 *
 * The amount shown for a Stripe leg is the one thing worth getting right:
 * on a reservation settled 50 % online and 50 % at the till, the invoice
 * says 21 € and Stripe must only be asked for the 10,50 € it actually took.
 * That figure is computed once by planRefund and printed here so nobody has
 * to work it out standing at a counter.
 */

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString("fr-BE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SOURCE_LABEL = Object.freeze({
  APPOINTMENT: "Rendez-vous",
  WORKSHOP: "Atelier / événement",
  FORMATION: "Formation",
  ORDER: "Commande",
  POS: "Vente au comptoir",
});

function documentLabel(operation) {
  return operation?.creditNote?.number ?? operation?.refundReceiptNumber ?? "document en attente";
}

function OperationMeta({ leg }) {
  return (
    <>
      <p className="mt-0.5 text-[12px] text-gray-600">
        {SOURCE_LABEL[leg.refundOperation?.source] ?? leg.refundOperation?.source} ·{" "}
        {documentLabel(leg.refundOperation)} · décidé le {shortDate(leg.refundOperation?.createdAt)}
      </p>
      <p className="mt-1 max-w-prose text-[12px] text-gray-500">{leg.refundOperation?.reason}</p>
    </>
  );
}

/**
 * A card refund waiting to be made in Stripe. Deliberately has no confirm
 * button: confirming here would be an admin asserting something the webhook
 * can verify, and the two would eventually disagree.
 */
function StripeLegRow({ leg }) {
  const paymentIntentId = leg.stripePaymentIntentId ?? leg.sourceTransaction?.stripePaymentIntentId ?? null;

  // A rendez-vous is a Connect DIRECT charge on the staff member's own
  // Stripe account, so it does not appear on the platform dashboard at all.
  // Linking to /payments/<pi> without the account id sends the admin to a
  // page where the payment does not exist — and the natural next move from
  // there is to go looking for it, or to assume it is already refunded.
  const account = leg.connectedAccountId ?? null;
  const stripeUrl = paymentIntentId
    ? account
      ? `https://dashboard.stripe.com/${account}/payments/${paymentIntentId}`
      : `https://dashboard.stripe.com/payments/${paymentIntentId}`
    : null;

  // A leg that settled for less than it owed: real money moved, so it is
  // SUCCEEDED, but the remainder is still the customer's. What must be
  // refunded now is the shortfall, NOT the original figure — showing the
  // original here would walk the admin straight into refunding it twice.
  const alreadySettled = leg.settledAmount == null ? 0 : Number(leg.settledAmount);
  const shortfall = Number(leg.amount) - alreadySettled;
  const isPartial = leg.status === "SUCCEEDED" && alreadySettled > 0 && shortfall > 0.01;
  const amountDue = isPartial ? shortfall : Number(leg.amount);

  return (
    <li className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px]">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <CreditCard size={15} />
            {money(amountDue)} — à rembourser dans Stripe
          </p>
          <OperationMeta leg={leg} />
          {isPartial && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-amber-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Déjà remboursé {money(alreadySettled)} sur {money(leg.amount)} — il reste{" "}
              {money(shortfall)}.
            </p>
          )}
          {leg.status === "FAILED" && leg.failureReason && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-red-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {leg.failureReason}
            </p>
          )}
        </div>

        <div className="min-w-[280px] flex-1">
          <p className="mb-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-[12px] text-blue-900">
            Remboursez <strong>exactement {money(amountDue)}</strong> — pas le total de la facture. Seul
            ce montant est passé par Stripe.
          </p>
          {account && (
            <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Paiement encaissé sur le compte Stripe de{" "}
              <strong>{leg.connectedAccountStaffName ?? "l'intervenant"}</strong> — il n&apos;apparaît pas
              sur le compte principal. Utilisez le lien ci-dessous.
            </p>
          )}
          {paymentIntentId ? (
            <p className="mb-2 font-mono text-[11px] break-all text-gray-600">{paymentIntentId}</p>
          ) : (
            <p className="mb-2 text-[12px] text-amber-800">
              Aucun identifiant de paiement Stripe enregistré — retrouvez le paiement du{" "}
              {shortDate(leg.sourceTransaction?.paidAt)} dans Stripe.
            </p>
          )}
          {stripeUrl && (
            <a
              href={stripeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-[13px] font-medium text-blue-800 hover:bg-blue-50"
            >
              <ExternalLink size={14} /> Ouvrir dans Stripe
            </a>
          )}
          <p className="mt-2 text-[12px] text-gray-500">
            Rien à confirmer ici : la réception est enregistrée automatiquement dès que Stripe le signale.
          </p>
        </div>
      </div>
    </li>
  );
}

/** Cash or terminal-card money, which Stripe knows nothing about. */
function InPersonLegRow({ leg, onDone }) {
  const [reference, setReference] = useState("");
  const [handedOver, setHandedOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isCard = leg.method === "CARD";
  const canConfirm = isCard ? reference.trim().length > 0 : handedOver;

  async function handleConfirm() {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    const result = await confirmManualRefundLeg({
      legId: leg.id,
      terminalReference: isCard ? reference.trim() : null,
      cashHandedOver: !isCard && handedOver,
    });
    setSubmitting(false);
    if (result.success) {
      toast.success(result.message);
      onDone();
    } else {
      toast.error(result.message);
    }
  }

  return (
    <li className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px]">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {isCard ? <CreditCard size={15} /> : <Banknote size={15} />}
            {money(leg.amount)} — {isCard ? "carte, terminal en boutique" : "espèces"}
          </p>
          <OperationMeta leg={leg} />
          {leg.pieceNumber && (
            <p className="mt-1 text-[12px] text-gray-500">Pièce de caisse : {leg.pieceNumber}</p>
          )}
        </div>

        <div className="min-w-[280px] flex-1">
          <p className="mb-2 text-[12px] font-medium text-amber-900">
            {isCard
              ? "Effectuez d'abord le remboursement sur le terminal, puis saisissez la référence du ticket."
              : "Remettez d'abord les espèces au client, puis confirmez ci-dessous."}
          </p>

          {isCard ? (
            <input
              type="text"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Référence du ticket du terminal"
              className="mb-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[13px] focus:border-gray-900 focus:outline-none"
            />
          ) : (
            <label className="mb-2 flex items-start gap-2 text-[13px] text-gray-800">
              <input
                type="checkbox"
                checked={handedOver}
                onChange={(event) => setHandedOver(event.target.checked)}
                className="mt-0.5"
              />
              <span>Je confirme avoir remis {money(leg.amount)} en espèces au client.</span>
            </label>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            Confirmer le remboursement
          </button>
        </div>
      </div>
    </li>
  );
}

export function OutstandingRefunds({ legs }) {
  const router = useRouter();
  if (!legs || legs.length === 0) return null;

  const stripeLegs = legs.filter((leg) => leg.method === "ONLINE");
  const inPersonLegs = legs.filter((leg) => leg.method !== "ONLINE");
  // What is still owed — a partially settled leg contributes only its
  // remainder, never the figure it started at.
  const total = legs.reduce(
    (sum, leg) => sum + (Number(leg.amount) - Number(leg.settledAmount ?? 0)),
    0,
  );

  return (
    <section className="rounded-2xl border border-amber-300 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Remboursements dus — {money(total)}</h2>
      <p className="mb-4 mt-1 text-[13px] text-gray-600">
        Ces annulations sont enregistrées et documentées, mais l&apos;argent n&apos;est pas encore reparti.
        Tant qu&apos;une ligne reste ici, le client n&apos;a pas été informé.
      </p>

      {stripeLegs.length > 0 && (
        <>
          <h3 className="mb-2 text-[13px] font-semibold text-blue-900">
            À rembourser dans Stripe ({stripeLegs.length})
          </h3>
          <ul className="mb-4 space-y-3">
            {stripeLegs.map((leg) => (
              <StripeLegRow key={leg.id} leg={leg} />
            ))}
          </ul>
        </>
      )}

      {inPersonLegs.length > 0 && (
        <>
          <h3 className="mb-2 text-[13px] font-semibold text-amber-900">
            À rendre en main propre ({inPersonLegs.length})
          </h3>
          <ul className="space-y-3">
            {inPersonLegs.map((leg) => (
              <InPersonLegRow key={leg.id} leg={leg} onDone={() => router.refresh()} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
