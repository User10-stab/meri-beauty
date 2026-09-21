"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { completeAppointment } from "@/actions/appointment/manage-appointment";
import { completeWorkshopReservation } from "@/actions/workshops/manage-reservation";
import { completeFormationReservation } from "@/actions/formations/manage-reservation";
import { formatPrice } from "@/components/dashboard/boutique/counter/counter-format";
import { useCashSessionOpen } from "@/components/dashboard/boutique/counter/useCashSessionOpen";
import { CashSessionGate } from "@/components/dashboard/boutique/counter/CashSessionGate";
import {
  CounterCashReceived,
  CounterPaymentMethodTiles,
  CounterTerminalReference,
} from "@/components/dashboard/boutique/counter/CounterPaymentMethods";
import { CounterQrDialog } from "@/components/dashboard/boutique/counter/CounterQrDialog";

const SETTLE_BY_KIND = {
  appointment: completeAppointment,
  workshop: completeWorkshopReservation,
  formation: completeFormationReservation,
};

/**
 * The "Encaisser le solde" half — one screen, one deliberate act.
 *
 * This used to cost four clicks: a disclosure toggle to reveal the form, a
 * second toggle nested inside it to reveal the price field, a checkbox to
 * attest the money had arrived, and finally the confirm button. Two of those
 * decided nothing — they only hid fields — and the cashier paid for them at
 * every transaction with a customer standing there.
 *
 * What is left is the form itself and one button whose label *is* the
 * attestation. The server contract is unchanged: `paymentConfirmed: true` is
 * still sent and `completeAppointment` / `settleReservation` still refuse
 * without it. Nothing can observe a cash handover or a terminal's APPROUVÉ
 * screen, so a human still has to say the money arrived — but they say it
 * once, by pressing a button that names the amount, instead of ticking a box
 * they learn to click past on the way to the button.
 *
 * The price is always editable rather than hidden behind "Ajuster le prix".
 * Changing it reveals the reason field and disables the button until a reason
 * is given, so a price still cannot move unexplained — the same rule
 * resolveCounterPriceAdjustment enforces server-side.
 *
 * `canCollectCash` is false for every staff member who is not Marie or an
 * OWNER/ADMIN (see isTillCashOperator). Their balance is still collected and
 * invoiced by the settle action, but off-till — so the payment method, the
 * terminal reference and the till-session gate all disappear, and the button
 * is a plain "Enregistrer et clôturer".
 */
export function FicheSettleAction({ ticket, onChanged, canCollectCash = false }) {
  // « Terminal externe » is the only card option: a card collection has to carry
  // the terminal's receipt reference, or nothing ties the row to a real
  // charge. Defaulting to it means the reference field is on screen from the
  // start rather than appearing after a choice.
  const [method, setMethod] = useState("EXTERNAL_TERMINAL");
  // The terminal's "APPROUVÉ" screen used to need its own tick. Card is now
      // the only card option and therefore the default, so that tick sat on
      // every card transaction — and it asserts the same fact the confirm
      // button already states ("j'ai bien reçu X"): for a card, being paid IS
      // the terminal approving. One attestation, one piece of evidence. The
      // receipt reference stays required, because that is the evidence.
  const [terminalReference, setTerminalReference] = useState("");
  // Change helper only — the settle action records the amount due.
  const [cashReceived, setCashReceived] = useState("");
  const [saving, setSaving] = useState(false);
  const [finalTotal, setFinalTotal] = useState(String(ticket.totalPrice ?? 0));
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const isExternalTerminal = method === "EXTERNAL_TERMINAL";
  // Nothing is collected now: the client pays by transfer and an admin
  // accepts it later — see lib/payments/awaited-transfer.js.
  const awaitsTransfer = method === "TRANSFER";
  // An independent's sale is settled off-till: the salon never banks it, so a
  // transfer cannot be announced here — the server refuses it
  // (AWAITED_TRANSFER_OFF_TILL_MESSAGE) and it would never reach « Ventes en
  // attente de paiement », which lists salon payments only.
  const settleMethods = ticket.independent
    ? ["CASH", "EXTERNAL_TERMINAL"]
    : ["CARD_QR", "CASH", "EXTERNAL_TERMINAL", "TRANSFER"];
  // « Carte QR »: the client pays on their own phone. The QR is generated for
  // the amount due AFTER any price adjustment, and the settle call carries
  // both the adjustment and the session id — so the server reconciles them in
  // one go and refuses a session whose amount no longer matches.
  const paysByQr = method === "CARD_QR";
  const [qrOpen, setQrOpen] = useState(false);
  const { open: cashSessionOpen, markOpen: markCashSessionOpen, markClosed: markCashSessionClosed } = useCashSessionOpen();
  const parsedFinalTotal = Number(finalTotal);
  const priceChanged = Number.isFinite(parsedFinalTotal) && parsedFinalTotal !== Number(ticket.totalPrice ?? 0);
  const amountDue = Number.isFinite(parsedFinalTotal)
    ? Math.max(0, Math.round((parsedFinalTotal - Number(ticket.paidAmount ?? 0)) * 100) / 100)
    : Number(ticket.balanceDue ?? 0);
  // A balance is taken *at the till* only when this cashier may — otherwise
  // it's recorded off-till by the settle action, with no method to pick.
  const takesMoneyAtTill = canCollectCash && amountDue > 0;

  function selectMethod(next) {
    setMethod(next);
    if (next !== "EXTERNAL_TERMINAL") setTerminalReference("");
    if (next !== "CASH") setCashReceived("");
  }

  async function handleSettle(qrSessionId = null) {
    if (!Number.isFinite(parsedFinalTotal) || parsedFinalTotal < Number(ticket.paidAmount ?? 0)) {
      toast.error("Le prix final doit être valide et ne peut pas être inférieur au montant déjà encaissé.");
      return;
    }
    if (priceChanged && adjustmentReason.trim().length < 3) {
      toast.error("Indiquez la raison de l'ajustement de prix.");
      return;
    }
    if (takesMoneyAtTill && isExternalTerminal && !terminalReference.trim()) {
      toast.error("Indiquez la référence du ticket du terminal.");
      return;
    }
    // Nothing is settled until the client has actually paid: the dialog polls
    // Stripe and calls back with the session id, which the server re-verifies.
    if (takesMoneyAtTill && paysByQr && !qrSessionId) {
      setQrOpen(true);
      return;
    }
    setSaving(true);
    const settle = SETTLE_BY_KIND[ticket.kind];
    const result = await settle(ticket.reservationId, {
      // Off-till: no method, no attestation — the settle action records the
      // collection detached from every cash session (isTillCashOperator).
      ...(takesMoneyAtTill
        ? {
            method,
            // An awaited transfer attests nothing: no money changed hands.
            paymentConfirmed: !awaitsTransfer,
            ...(isExternalTerminal
              ? { terminalApproved: true, terminalReference: terminalReference.trim() }
              : {}),
            ...(qrSessionId ? { qrSessionId } : {}),
          }
        : {}),
      ...(priceChanged ? { finalTotal: parsedFinalTotal, adjustmentReason: adjustmentReason.trim() } : {}),
    });
    setSaving(false);
    setQrOpen(false);

    if (!result.success) {
      toast.error(result.message);
      if (result.requiresCashSession) markCashSessionClosed();
      return;
    }
    toast.success(
      amountDue <= 0
        ? `Prix ajusté et dossier clôturé — ${ticket.holderName}`
        : awaitsTransfer
          ? `Virement de ${formatPrice(amountDue)} attendu — ${ticket.holderName}`
          : `${formatPrice(amountDue)} encaissés — ${ticket.holderName}`
    );
    onChanged();
  }

  return (
    <div className="rounded-[10px] bg-orange-light-5 px-4 py-3 text-orange-dark dark:bg-orange-light/10 dark:text-orange-light">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-bold">
          <Wallet className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={2} />
          {amountDue <= 0
            ? "Aucun solde restant"
            : takesMoneyAtTill
              ? `Solde à encaisser : ${formatPrice(amountDue)}`
              : `Solde à enregistrer : ${formatPrice(amountDue)}`}
        </p>
        <p className="text-xs">Prix total : {formatPrice(ticket.totalPrice)} · Déjà encaissé : {formatPrice(ticket.paidAmount)}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-orange-dark/15 pt-3">
          <div className="grid w-full gap-2 sm:grid-cols-[210px_1fr]">
            <label className="flex items-center gap-2 text-sm">
              <span className="whitespace-nowrap text-xs font-bold">Prix final</span>
              <input
                type="number"
                min={Number(ticket.paidAmount ?? 0)}
                max="100000"
                step="0.01"
                value={finalTotal}
                onChange={(event) => setFinalTotal(event.target.value)}
                aria-label="Prix final TTC"
                className="w-full rounded-[7px] border border-orange-dark/20 bg-white px-3 py-2 text-sm text-dark outline-none focus:border-orange-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            </label>
            {priceChanged && (
              <input
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                maxLength={250}
                placeholder="Raison obligatoire : geste commercial, correction de tarif…"
                className="rounded-[7px] border border-orange-dark/20 bg-white px-3 py-2 text-sm text-dark outline-none focus:border-orange-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            )}
          </div>
          {takesMoneyAtTill && (
            <>
          <div className="w-full space-y-2 text-dark dark:text-white">
            <CounterPaymentMethodTiles methods={settleMethods} value={method} onChange={selectMethod} />
            {awaitsTransfer && (
              <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-900/10 dark:text-sky-200">
                <p className="font-semibold">Virement en attente de validation</p>
                <p className="mt-1">
                  Le dossier est clôturé mais rien n&apos;est encaissé. À la réception du virement, acceptez-le dans « Ventes en attente de paiement » :
                  c&apos;est là que le paiement et la facture sont créés.
                </p>
              </div>
            )}
            {isExternalTerminal && <CounterTerminalReference value={terminalReference} onChange={setTerminalReference} />}
            {method === "CASH" && <CounterCashReceived id={`settle-cash-${ticket.reservationId}`} value={cashReceived} onChange={setCashReceived} amountDue={amountDue} />}
          </div>
          {method === "CASH" && !cashSessionOpen && (
            <CashSessionGate onOpened={markCashSessionOpen} />
          )}
            </>
          )}
          {/* The button is the attestation. It names the amount, so pressing
              it is a statement about money that arrived rather than a step on
              the way to one. It stays disabled while a changed price has no
              reason, so a price cannot move unexplained — and, for cash, while
              no till is open, so it's never even possible to submit a
              collection that would land invisibly outside the Livre de caisse. */}
          <button
            type="button"
            disabled={
              saving ||
              (priceChanged && adjustmentReason.trim().length < 3) ||
              (takesMoneyAtTill && isExternalTerminal && !terminalReference.trim()) ||
              (takesMoneyAtTill && method === "CASH" && !cashSessionOpen)
            }
            onClick={() => handleSettle()}
            className="ml-auto inline-flex items-center gap-2 rounded-[7px] bg-dark px-4 py-2 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-dark"
          >
            {saving
              ? "Traitement…"
              : takesMoneyAtTill && awaitsTransfer
                ? `Clôturer — virement de ${formatPrice(amountDue)} attendu`
              : takesMoneyAtTill && paysByQr
                ? `Afficher le QR — ${formatPrice(amountDue)}`
              : takesMoneyAtTill
                ? `J'ai bien reçu ${formatPrice(amountDue)} — encaisser et facturer`
                : amountDue > 0
                  ? `Enregistrer ${formatPrice(amountDue)} et clôturer`
                  : "Je confirme cet ajustement — clôturer"}
          </button>
      </div>
      {qrOpen && (
        <CounterQrDialog
          surface={ticket.kind}
          targetId={ticket.reservationId}
          amount={amountDue}
          onPaid={(qrSessionId) => handleSettle(qrSessionId)}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}
