"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import QrScanner from "qr-scanner";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Loader2,
  Package,
  ScanLine,
  Search,
  Ticket,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { lookupCounterCode } from "@/actions/counter/lookup";
import { isCashSessionOpen } from "@/actions/dashboard/cash-sessions";
import { searchCounterTickets } from "@/actions/boutique/settlements";
import { lookupActivityCheckInById, confirmActivityCheckIn } from "@/actions/activities/check-in";
import { completeOrderPickup } from "@/actions/boutique/orders";
import { completeAppointment } from "@/actions/appointment/manage-appointment";
import { completeWorkshopReservation } from "@/actions/workshops/manage-reservation";
import { completeFormationReservation } from "@/actions/formations/manage-reservation";

/**
 * One field for the counter: scan or type a code, or type a customer's name
 * when they have neither — a phone with a dead battery, a booking made by
 * phone that never got the confirmation e-mail, or a formation paid in full
 * where there is no balance to chase. Whatever gets you to a ticket, the
 * fiche that opens is the same one, with the same two independent actions:
 * "Pointer l'arrivée" writes nothing about money, "Encaisser le solde"
 * writes nothing about presence. A rendez-vous, un atelier, une formation ou
 * un retrait boutique can all land here — one scanner, four doors.
 */

const SETTLE_BY_KIND = {
  appointment: completeAppointment,
  workshop: completeWorkshopReservation,
  formation: completeFormationReservation,
};

const KIND_LABEL = {
  appointment: "Rendez-vous",
  workshop: "Atelier / Événement",
  formation: "Formation",
};

// Route only exact known code shapes. A customer may legitimately be stored
// under a single name, so generic alphanumeric text must remain a name search.
function looksLikeCode(value) {
  return /^(?:[AFR]-?[0-9A-F]{10}|[0-9A-F]{8})$/i.test(value.trim());
}

function formatPrice(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-BE", {
    timeZone: "Europe/Brussels",
    dateStyle: "full",
    timeStyle: "short",
  });
}

function isToday(value) {
  if (!value) return false;
  const opts = { timeZone: "Europe/Brussels" };
  return new Date(value).toLocaleDateString("fr-BE", opts) === new Date().toLocaleDateString("fr-BE", opts);
}

// A CASH payment recorded with no till session open is permanently invisible
// from the Livre de caisse — Transaction.cashSessionId is set once, at
// payment time, and never backfilled. Checked once per fiche mount, not
// blocking: staff can still proceed, they're just warned.
function useCashSessionOpen() {
  const [open, setOpen] = useState(true); // optimistic until the check resolves
  useEffect(() => {
    isCashSessionOpen()
      .then((result) => setOpen(Boolean(result.success && result.data)))
      .catch(() => {});
  }, []);
  return open;
}

function CameraScanner({ onDecoded, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let decoded = false;

    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        if (cancelled || decoded) return;
        decoded = true;
        scanner.stop();
        onDecoded(result.data);
      },
      {
        preferredCamera: "environment",
        highlightScanRegion: true,
        highlightCodeOutline: true,
        onDecodeError: () => {}, // fires every frame with nothing in view — not a real error
      }
    );

    scanner.start().catch((err) => {
      if (cancelled) return;
      console.error("[CounterPanel] camera init failed:", err);
      setError("Caméra indisponible. Saisissez le code à la main.");
    });

    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
    };
  }, [onDecoded]);

  return (
    <div className="relative mt-7 mx-auto w-80 h-70 overflow-hidden rounded-[10px] border border-stroke bg-black dark:border-dark-3">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer la caméra"
        className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
      {error ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-white/80">
          <CameraOff className="h-6 w-6" strokeWidth={1.5} />
          {error}
        </div>
      ) : (
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
      )}
    </div>
  );
}

/** The "Pointer l'arrivée" half of the fiche. Absent entirely once nothing is left to check in. */
function CheckInAction({ ticket, onChanged }) {
  const [admitting, setAdmitting] = useState(false);

  if (!ticket.admissible) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] bg-red-light-6 px-4 py-3 text-sm font-semibold text-red-dark dark:bg-red/10 dark:text-red">
        <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
        {ticket.blockedReason}
      </div>
    );
  }

  async function handleAdmit() {
    setAdmitting(true);
    const result = await confirmActivityCheckIn({ code: ticket.code });
    setAdmitting(false);

    if (!result.success) {
      toast.error(result.message);
      onChanged(null); // stale card — force a re-lookup by clearing it
      return;
    }
    const seatsAdmitted = result.seatsAdmitted ?? ticket.remainingSeats;
    toast.success(
      `${seatsAdmitted} place${seatsAdmitted > 1 ? "s" : ""} pointée${seatsAdmitted > 1 ? "s" : ""} — ${result.data.holderName}`
    );
    onChanged(result.data);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-stroke px-4 py-3 dark:border-dark-3">
      <div className="flex items-center gap-2 text-sm text-dark dark:text-white">
        <span>Places réservées</span>
        <strong className="rounded-[7px] border border-stroke px-3 py-2 font-semibold dark:border-dark-3">
          {ticket.seatsCount}
        </strong>
        {ticket.checkedInSeats > 0 && (
          <span className="text-body-color dark:text-dark-6">({ticket.remainingSeats} restantes)</span>
        )}
      </div>
      <button
        type="button"
        disabled={admitting}
        onClick={handleAdmit}
        className="ml-auto inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
        {admitting
          ? "Pointage…"
          : ticket.remainingSeats > 1
            ? `Pointer ${ticket.remainingSeats} places`
            : "Pointer l'arrivée"}
      </button>
    </div>
  );
}

/** The "Encaisser le solde" half — a separate, collapsible attestation, same pattern the old till list used. */
function SettleAction({ ticket, onChanged }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("CARD");
  const [received, setReceived] = useState(false);
  const [terminalApproved, setTerminalApproved] = useState(false);
  const [terminalReference, setTerminalReference] = useState("");
  const [saving, setSaving] = useState(false);
  const isExternalTerminal = method === "EXTERNAL_TERMINAL";
  const cashSessionOpen = useCashSessionOpen();

  function selectMethod(next) {
    setMethod(next);
    if (next !== "EXTERNAL_TERMINAL") {
      setTerminalApproved(false);
      setTerminalReference("");
    }
  }

  async function handleSettle() {
    if (isExternalTerminal && (!terminalApproved || !terminalReference.trim())) {
      toast.error("Confirmez le paiement approuvé et indiquez la référence du ticket terminal.");
      return;
    }
    setSaving(true);
    const settle = SETTLE_BY_KIND[ticket.kind];
    const result = await settle(ticket.reservationId, {
      method,
      paymentConfirmed: true,
      ...(isExternalTerminal ? { terminalApproved, terminalReference: terminalReference.trim() } : {}),
    });
    setSaving(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success(`${formatPrice(ticket.balanceDue)} encaissés — ${ticket.holderName}`);
    onChanged();
  }

  return (
    <div className="rounded-[10px] bg-orange-light-5 px-4 py-3 text-orange-dark dark:bg-orange-light/10 dark:text-orange-light">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold">Solde à encaisser : {formatPrice(ticket.balanceDue)}</p>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-[7px] bg-white/70 px-3 py-1.5 text-xs font-bold underline underline-offset-2 hover:bg-white dark:bg-black/20 dark:hover:bg-black/30"
        >
          <Wallet className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={2} />
          {open ? "Annuler" : "Encaisser ce solde"}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-orange-dark/15 pt-3">
          <div className="flex items-center gap-3">
            {["CASH", "CARD", "EXTERNAL_TERMINAL"].map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={method === value} onChange={() => selectMethod(value)} />
                {value === "CASH" ? "Espèces" : value === "EXTERNAL_TERMINAL" ? "Terminal externe" : "Carte"}
              </label>
            ))}
          </div>
          {isExternalTerminal && (
            <div className="flex w-full flex-wrap items-center gap-3 rounded-[10px] border border-orange-dark/15 bg-white/60 p-3 text-orange-dark dark:bg-black/10 dark:text-orange-light">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={terminalApproved}
                  onChange={(event) => setTerminalApproved(event.target.checked)}
                />
                Terminal APPROUVÉ
              </label>
              <input
                value={terminalReference}
                onChange={(event) => setTerminalReference(event.target.value)}
                maxLength={100}
                placeholder="Référence du ticket terminal"
                className="min-w-[220px] flex-1 rounded-[7px] border border-orange-dark/20 bg-white px-3 py-2 text-sm outline-none focus:border-orange-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            </div>
          )}
          {method === "CASH" && !cashSessionOpen && (
            <p className="w-full rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Aucune session de caisse n&apos;est ouverte — cet encaissement en espèces n&apos;apparaîtra jamais dans le Livre de caisse.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={received} onChange={(event) => setReceived(event.target.checked)} />
            J&apos;ai bien reçu {formatPrice(ticket.balanceDue)}
          </label>
          <button
            type="button"
            disabled={!received || saving || (isExternalTerminal && (!terminalApproved || !terminalReference.trim()))}
            onClick={handleSettle}
            className="ml-auto inline-flex items-center gap-2 rounded-[7px] bg-dark px-4 py-2 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-dark"
          >
            {saving ? "Encaissement…" : "Confirmer et facturer"}
          </button>
        </div>
      )}
    </div>
  );
}

function TicketFiche({ ticket, onChanged }) {
  const owesMoney = ticket.balanceDue > 0;
  const wrongDay = !isToday(ticket.sessionStartDate);

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {KIND_LABEL[ticket.kind]}
          </span>
          <h2 className="text-lg font-bold text-dark dark:text-white">{ticket.activityTitle}</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-dark-6">{formatDateTime(ticket.sessionStartDate)}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            ticket.remainingSeats <= 0
              ? "bg-green-light-6 text-green-dark dark:bg-green/10 dark:text-green"
              : ticket.admissible
                ? "bg-blue-light-5 text-blue-dark dark:bg-blue/10 dark:text-blue-light"
                : "bg-red-light-6 text-red-dark dark:bg-red/10 dark:text-red"
          }`}
        >
          {ticket.remainingSeats <= 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
          {ticket.remainingSeats <= 0 ? "Déjà pointé" : ticket.admissible ? "Non pointé" : "Entrée refusée"}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-dark-6">Au nom de</dt>
          <dd className="mt-1 text-base font-bold text-dark dark:text-white">{ticket.holderName}</dd>
          <dd className="text-xs text-gray-500 dark:text-dark-6">{ticket.holderEmail}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-dark-6">Places</dt>
          <dd className="mt-1 text-base font-bold text-dark dark:text-white">
            {ticket.remainingSeats} restante{ticket.remainingSeats > 1 ? "s" : ""} sur {ticket.seatsCount}
          </dd>
        </div>
      </dl>

      {wrongDay && (
        <div className="mx-6 mb-4 flex items-start gap-2 rounded-[10px] bg-orange-light-5 px-4 py-3 text-xs font-medium text-orange-dark dark:bg-orange-light/10 dark:text-orange-light">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
          Ceci ne concerne pas une session d&apos;aujourd&apos;hui.
        </div>
      )}

      <div className="space-y-3 px-6 pb-6">
        <CheckInAction ticket={ticket} onChanged={onChanged} />
        {owesMoney && <SettleAction ticket={ticket} onChanged={() => onChanged(null)} />}
      </div>
    </div>
  );
}

/** A boutique pickup order — a different world entirely (Order, not a ticket), routed to the same scan box. */
function PickupFiche({ order, onSettled }) {
  const [method, setMethod] = useState("CASH");
  const [terminalApproved, setTerminalApproved] = useState(false);
  const [terminalReference, setTerminalReference] = useState("");
  const [saving, setSaving] = useState(false);
  const needsPayment = !order.hasPayment;
  const isExternalTerminal = method === "EXTERNAL_TERMINAL";
  const cashSessionOpen = useCashSessionOpen();

  function selectMethod(next) {
    setMethod(next);
    if (next !== "EXTERNAL_TERMINAL") {
      setTerminalApproved(false);
      setTerminalReference("");
    }
  }

  async function handleConfirm() {
    if (needsPayment && isExternalTerminal && (!terminalApproved || !terminalReference.trim())) {
      toast.error("Confirmez le paiement approuvé et indiquez la référence du ticket terminal.");
      return;
    }
    setSaving(true);
    const result = await completeOrderPickup({
      orderId: order.id,
      method: needsPayment ? method : undefined,
      ...(needsPayment && isExternalTerminal
        ? { terminalApproved, terminalReference: terminalReference.trim() }
        : {}),
    });
    setSaving(false);

    if (!result.success) {
      toast.error(result.message);
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
              À encaisser : {formatPrice(order.totalAmount)}
            </p>
            <div className="flex items-center gap-3">
              {["CASH", "CARD", "EXTERNAL_TERMINAL"].map((value) => (
                <label key={value} className="flex items-center gap-1.5 text-sm text-dark dark:text-white">
                  <input type="radio" checked={method === value} onChange={() => selectMethod(value)} />
                  {value === "CASH" ? "Espèces" : value === "EXTERNAL_TERMINAL" ? "Terminal externe" : "Carte"}
                </label>
              ))}
            </div>
            {isExternalTerminal && (
              <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-stroke bg-gray-50 p-3 dark:border-dark-3 dark:bg-dark-2">
                <label className="flex items-center gap-2 text-sm font-medium text-dark dark:text-white">
                  <input
                    type="checkbox"
                    checked={terminalApproved}
                    onChange={(event) => setTerminalApproved(event.target.checked)}
                  />
                  Terminal APPROUVÉ
                </label>
                <input
                  value={terminalReference}
                  onChange={(event) => setTerminalReference(event.target.value)}
                  maxLength={100}
                  placeholder="Référence du ticket terminal"
                  className="min-w-[220px] flex-1 rounded-[7px] border border-stroke bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                />
              </div>
            )}
            {method === "CASH" && !cashSessionOpen && (
              <p className="rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Aucune session de caisse n&apos;est ouverte — cet encaissement en espèces n&apos;apparaîtra jamais dans le Livre de caisse.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-dark-6">Déjà payée — il ne reste qu&apos;à remettre la commande.</p>
        )}

        {order.readyForPickup && (
          <button
            type="button"
            disabled={saving || (needsPayment && isExternalTerminal && (!terminalApproved || !terminalReference.trim()))}
            onClick={handleConfirm}
            className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
            {saving ? "Traitement…" : needsPayment ? "Encaisser et remettre" : "Remettre la commande"}
          </button>
        )}
      </div>
    </div>
  );
}

function ResultsList({ rows, onSelect }) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={`${row.kind}:${row.id}`}>
          <button
            type="button"
            onClick={() => onSelect(row)}
            className="flex w-full flex-wrap items-center justify-between gap-3 rounded-[10px] border border-stroke px-4 py-3 text-left hover:border-primary dark:border-dark-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-dark dark:text-white">{row.customerName}</p>
              <p className="truncate text-xs text-gray-500 dark:text-dark-6">
                {KIND_LABEL[row.kind]} · {row.label}
              </p>
              <p className="text-xs text-gray-500 dark:text-dark-6">{formatDateTime(row.occurredAt)}</p>
            </div>
            <div className="flex items-center gap-2 text-right">
              {row.checkedIn && (
                <span className="rounded-full bg-green-light-6 px-2 py-0.5 text-[10px] font-semibold text-green-dark dark:bg-green/10 dark:text-green">
                  Pointé
                </span>
              )}
              {row.balanceDue > 0 && (
                <span className="text-sm font-bold text-primary">{formatPrice(row.balanceDue)}</span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {{ canCheckIn?: boolean, canSettle?: boolean, canPickup?: boolean }} props
 */
export function CounterPanel({ canCheckIn = false, canSettle = false, canPickup = false }) {
  const [input, setInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState(null); // { domain: "TICKET", ...presentReservation } or { domain: "PICKUP", ...order }
  const [nameResults, setNameResults] = useState(null); // array, when a name matched more than one thing
  const requestRef = useRef(0);

  const openTicket = useCallback((data) => {
    setNameResults(null);
    setTicket(data);
  }, []);

  const runCodeLookup = useCallback(
    async (raw) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      const result = await lookupCounterCode(raw);
      if (requestRef.current !== requestId) return;
      setLoading(false);

      if (!result.success) {
        toast.error(result.message);
        setTicket(null);
        return;
      }
      openTicket(result.data);
    },
    [openTicket]
  );

  const runNameSearch = useCallback(
    async (value) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setTicket(null);
      const result = await searchCounterTickets(value);
      if (requestRef.current !== requestId) return;
      setLoading(false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (result.data.length === 0) {
        toast.error(`Aucun résultat pour « ${value} ».`);
        setNameResults([]);
        return;
      }
      if (result.data.length === 1) {
        selectResult(result.data[0]);
        return;
      }
      setNameResults(result.data);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function selectResult(row) {
    const requestId = ++requestRef.current;
    setLoading(true);
    const result = await lookupActivityCheckInById({ kind: row.kind, id: row.id });
    if (requestRef.current !== requestId) return;
    setLoading(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    openTicket({ domain: "TICKET", ...result.data });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;

    if (looksLikeCode(value)) {
      runCodeLookup(value);
    } else {
      runNameSearch(value);
    }
  }

  const handleDecoded = useCallback(
    (decoded) => {
      setScanning(false);
      setInput(decoded.trim().toUpperCase());
      runCodeLookup(decoded);
    },
    [runCodeLookup]
  );

  if (!canCheckIn && !canSettle && !canPickup) return null;

  function handleTicketChanged(nextTicket) {
    // Passing the freshly-returned data avoids a round trip; passing
    // nothing (a settlement, or a stale-card refusal) re-reads from scratch.
    if (nextTicket) {
      setTicket({ domain: "TICKET", ...nextTicket });
    } else if (ticket?.code) {
      runCodeLookup(ticket.code);
    } else {
      setTicket(null);
    }
  }

  return (
    <section className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <ScanLine className="h-5 w-5 text-primary" strokeWidth={1.75} />
        <h2 className="text-base font-bold text-dark dark:text-white">Pointage &amp; encaissement</h2>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-dark-6">
        Scannez le QR du client, saisissez son code, ou cherchez par nom s&apos;il n&apos;en a pas.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="counter-input" className="mb-2 block text-sm font-medium text-dark dark:text-white">
            Code ou nom du client
          </label>
          <input
            id="counter-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="R-XXXXXXXXXX ou Nom Prénom"
            autoComplete="off"
            className="w-full rounded-[7px] border border-stroke bg-transparent px-4 py-2.5 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-opacity-90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Search className="h-4 w-4" strokeWidth={2} />}
          {loading ? "Recherche…" : "Rechercher"}
        </button>
        <button
          type="button"
          onClick={() => setScanning((open) => !open)}
          className="inline-flex items-center gap-2 rounded-[7px] border border-stroke px-5 py-2.5 text-sm font-semibold text-dark hover:border-primary hover:text-primary dark:border-dark-3 dark:text-white"
        >
          {scanning ? <CameraOff className="h-4 w-4" strokeWidth={2} /> : <Camera className="h-4 w-4" strokeWidth={2} />}
          {scanning ? "Arrêter" : "Scanner"}
        </button>
      </form>

      {scanning && <CameraScanner onDecoded={handleDecoded} onClose={() => setScanning(false)} />}

      {!ticket && nameResults === null && !scanning && (
        <p className="mt-4 flex items-center gap-2 text-sm text-gray-500 dark:text-dark-6">
          <Ticket className="h-4 w-4" strokeWidth={1.75} />
          Rien à afficher pour l&apos;instant.
        </p>
      )}

      {nameResults?.length === 0 && (
        <p className="mt-4 text-sm text-gray-500 dark:text-dark-6">Aucun résultat pour ce nom.</p>
      )}

      {nameResults && nameResults.length > 0 && (
        <div className="mt-4">
          <ResultsList rows={nameResults} onSelect={selectResult} />
        </div>
      )}

      {ticket && (
        <div className="mt-4">
          {ticket.domain === "PICKUP" ? (
            <PickupFiche order={ticket} onSettled={() => setTicket(null)} />
          ) : (
            <TicketFiche
              key={`${ticket.code}:${ticket.checkedInSeats}:${ticket.balanceDue}`}
              ticket={ticket}
              onChanged={handleTicketChanged}
            />
          )}
        </div>
      )}
    </section>
  );
}
