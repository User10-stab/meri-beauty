"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Package, TriangleAlert } from "lucide-react";
import { completeOrderPickup } from "@/actions/boutique/orders";
import { formatPrice } from "@/components/dashboard/boutique/counter/counter-format";
import { useCashSessionOpen } from "@/components/dashboard/boutique/counter/useCashSessionOpen";
import { CashSessionGate } from "@/components/dashboard/boutique/counter/CashSessionGate";

/** A boutique pickup order — a different world entirely (Order, not a ticket), routed to the same scan box. */
export function PickupFiche({ order, onSettled, canCollectCash = false }) {
  const [method, setMethod] = useState("CASH");
  const [terminalReference, setTerminalReference] = useState("");
  const [saving, setSaving] = useState(false);
  const needsPayment = !order.hasPayment;
  // Only Marie / an admin takes money at the counter; for everyone else
  // completeOrderPickup records it off-till, so there's no method to pick.
  const collectsAtTill = needsPayment && canCollectCash;
  const isExternalTerminal = method === "EXTERNAL_TERMINAL";
  const { open: cashSessionOpen, markOpen: markCashSessionOpen, markClosed: markCashSessionClosed } = useCashSessionOpen();

  function selectMethod(next) {
    setMethod(next);
    if (next !== "EXTERNAL_TERMINAL") setTerminalReference("");
  }

  async function handleConfirm() {
    if (collectsAtTill && isExternalTerminal && !terminalReference.trim()) {
      toast.error("Indiquez la référence du ticket du terminal.");
      return;
    }
    setSaving(true);
    const result = await completeOrderPickup({
      orderId: order.id,
      method: collectsAtTill ? method : undefined,
      ...(collectsAtTill && isExternalTerminal
        ? { terminalApproved: true, terminalReference: terminalReference.trim() }
        : {}),
    });
    setSaving(false);

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
                <div className="flex items-center gap-3">
                  {["CASH", "EXTERNAL_TERMINAL"].map((value) => (
                    <label key={value} className="flex items-center gap-1.5 text-sm text-dark dark:text-white">
                      <input type="radio" checked={method === value} onChange={() => selectMethod(value)} />
                      {value === "CASH" ? "Espèces" : "Carte — terminal"}
                    </label>
                  ))}
                </div>
                {isExternalTerminal && (
                  <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-stroke bg-gray-50 p-3 dark:border-dark-3 dark:bg-dark-2">
                    <input
                      value={terminalReference}
                      onChange={(event) => setTerminalReference(event.target.value)}
                      maxLength={100}
                      aria-label="Référence du ticket du terminal"
                      placeholder="Référence du ticket du terminal"
                      className="min-w-[220px] flex-1 rounded-[7px] border border-stroke bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                    />
                  </div>
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
            onClick={handleConfirm}
            className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
            {saving
              ? "Traitement…"
              : !needsPayment
                ? "Remettre la commande"
                : collectsAtTill
                  ? "Encaisser et remettre"
                  : "Enregistrer et remettre"}
          </button>
        )}
      </div>
    </div>
  );
}
