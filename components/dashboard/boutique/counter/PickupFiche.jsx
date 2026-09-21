"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Package, TriangleAlert } from "lucide-react";
import { completeOrderPickup } from "@/actions/boutique/orders";
import { formatPrice } from "@/components/dashboard/boutique/counter/counter-format";
import { useCashSessionOpen } from "@/components/dashboard/boutique/counter/useCashSessionOpen";
import { CashSessionGate } from "@/components/dashboard/boutique/counter/CashSessionGate";
import {
  CounterCashReceived,
  CounterPaymentMethodTiles,
  CounterTerminalReference,
} from "@/components/dashboard/boutique/counter/CounterPaymentMethods";
import { CounterQrDialog } from "@/components/dashboard/boutique/counter/CounterQrDialog";

/** A boutique pickup order — a different world entirely (Order, not a ticket), routed to the same scan box. */
export function PickupFiche({ order, onSettled, canCollectCash = false }) {
  // Same default as every other Pointage screen: the terminal, whose
  // reference field is then on screen from the start.
  const [method, setMethod] = useState("EXTERNAL_TERMINAL");
  const [terminalReference, setTerminalReference] = useState("");
  // Change helper only — completeOrderPickup records the order total.
  const [cashReceived, setCashReceived] = useState("");
  const [saving, setSaving] = useState(false);
  const needsPayment = !order.hasPayment;
  // Only Marie / an admin takes money at the counter; for everyone else
  // completeOrderPickup records it off-till, so there's no method to pick.
  const collectsAtTill = needsPayment && canCollectCash;
  const isExternalTerminal = method === "EXTERNAL_TERMINAL";
  const awaitsTransfer = method === "TRANSFER";
  // « Carte QR »: the client pays on their own phone before the goods are
  // handed over. The server re-verifies the session with Stripe.
  const paysByQr = method === "CARD_QR";
  const [qrOpen, setQrOpen] = useState(false);
  const { open: cashSessionOpen, markOpen: markCashSessionOpen, markClosed: markCashSessionClosed } = useCashSessionOpen();

  function selectMethod(next) {
    setMethod(next);
    if (next !== "EXTERNAL_TERMINAL") setTerminalReference("");
    if (next !== "CASH") setCashReceived("");
  }

  async function handleConfirm(qrSessionId = null) {
    if (collectsAtTill && isExternalTerminal && !terminalReference.trim()) {
      toast.error("Indiquez la référence du ticket du terminal.");
      return;
    }
    if (collectsAtTill && paysByQr && !qrSessionId) {
      setQrOpen(true);
      return;
    }
    setSaving(true);
    const result = await completeOrderPickup({
      orderId: order.id,
      method: collectsAtTill ? method : undefined,
      ...(collectsAtTill && isExternalTerminal
        ? { terminalApproved: true, terminalReference: terminalReference.trim() }
        : {}),
      ...(qrSessionId ? { qrSessionId } : {}),
    });
    setSaving(false);
    setQrOpen(false);

    if (!result.success) {
      toast.error(result.message);
      if (result.requiresCashSession) markCashSessionClosed();
      return;
    }
    toast.success(result.message ?? "Commande remise au client.");
    onSettled();
  }

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex items-center gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3">
        <Package className="h-5 w-5 text-primary" strokeWidth={1.75} />
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">Retrait boutique</span>
          <h2 className="text-lg font-bold text-dark dark:text-white">Commande {order.orderNumber}</h2>
        </div>
      </div>

      <div className="space-y-4 px-6 py-5">
        <p className="text-sm text-dark dark:text-white">{order.user?.fullName ?? "Client"}</p>

        {!order.readyForPickup ? (
          <div className="flex items-start gap-2 rounded-[10px] bg-red-light-6 px-4 py-3 text-sm font-semibold text-red-dark dark:bg-red/10 dark:text-red">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
            Cette commande n&apos;est pas prête pour le retrait (statut : {order.status}).
          </div>
        ) : needsPayment ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-dark dark:text-white">
              {collectsAtTill ? "À encaisser" : "À enregistrer"} : {formatPrice(order.totalAmount)}
            </p>
            {collectsAtTill && (
              <>
                <CounterPaymentMethodTiles methods={["CARD_QR", "CASH", "EXTERNAL_TERMINAL", "TRANSFER"]} value={method} onChange={selectMethod} />
                {awaitsTransfer && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-900/10 dark:text-sky-200">
                    <p className="font-semibold">Virement en attente de validation</p>
                    <p className="mt-1">
                      La commande est remise mais rien n&apos;est encaissé. À la réception du virement, acceptez-le dans « Ventes en attente de
                      paiement » : c&apos;est là que le paiement, le ticket et la facture sont créés.
                    </p>
                  </div>
                )}
                {isExternalTerminal && <CounterTerminalReference value={terminalReference} onChange={setTerminalReference} />}
                {method === "CASH" && (
                  <CounterCashReceived id={`pickup-cash-${order.id}`} value={cashReceived} onChange={setCashReceived} amountDue={Number(order.totalAmount)} />
                )}
                {method === "CASH" && !cashSessionOpen && (
                  <CashSessionGate onOpened={markCashSessionOpen} />
                )}
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-dark-6">Déjà payée — il ne reste qu&apos;à remettre la commande.</p>
        )}

        {order.readyForPickup && (
          <button
            type="button"
            disabled={
              saving ||
              (collectsAtTill && isExternalTerminal && !terminalReference.trim()) ||
              (collectsAtTill && method === "CASH" && !cashSessionOpen)
            }
            onClick={() => handleConfirm()}
            className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
            {saving
              ? "Traitement…"
              : !needsPayment
                ? "Remettre la commande"
                : collectsAtTill && awaitsTransfer
                  ? `Remettre — virement de ${formatPrice(order.totalAmount)} attendu`
                : collectsAtTill && paysByQr
                  ? `Afficher le QR — ${formatPrice(order.totalAmount)}`
                : collectsAtTill
                  ? `J'ai bien reçu ${formatPrice(order.totalAmount)} — encaisser et remettre`
                  : "Enregistrer et remettre"}
          </button>
        )}
      </div>
      {qrOpen && (
        <CounterQrDialog
          surface="order"
          targetId={order.id}
          amount={Number(order.totalAmount)}
          onPaid={(qrSessionId) => handleConfirm(qrSessionId)}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}
