"use client";

import { useEffect, useState } from "react";
import { Calendar, Loader2, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { createCounterWalkInService } from "@/actions/counter/walk-in-service";
import { createCounterReservation } from "@/actions/counter/create-reservation";
import { searchPointOfSaleCustomers } from "@/actions/boutique/point-of-sale";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { CounterBuyerForm } from "@/components/dashboard/boutique/counter/CounterBuyerForm";
import { useCashSessionOpen } from "@/components/dashboard/boutique/counter/useCashSessionOpen";
import { CashSessionGate } from "@/components/dashboard/boutique/counter/CashSessionGate";

function money(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const EMPTY_ADDRESS = { addressLine1: "", addressLine2: "", addressCity: "", addressPostalCode: "", addressCountry: "BE" };
const EMPTY_BUYER = {
  id: null,
  fullName: "",
  email: "",
  phone: "",
  vatNumber: "",
  isCompany: false,
  vatInvoiceReady: false,
  vatValidationName: null,
  ...EMPTY_ADDRESS,
};

/**
 * This composer has no entry point of its own any more — the counter's one
 * search box (CounterOmniBar, via CounterSurface's selectResult) is it. A
 * SERVICE or SESSION row selected up there lands here as a `pending*` prop
 * and the composer pops open already filled in; there is nothing to search
 * or scan a second time down here, and nothing to render while neither prop
 * has fired. Which half renders is derived from that, not chosen from a
 * tab: `selectedService` set means "Prestation", `session` set means
 * "Atelier / formation" — never both.
 *
 * The buyer half (identity, VAT/VIES, billing address) is a single shared
 * `buyer` state and one CounterBuyerForm, used by whichever mode is active —
 * exactly one of them ever is, so there is nothing to keep in sync between
 * two copies. A walk-in service used to have its own, separate customer
 * capture with no VAT/address fields at all, which meant a brand-new
 * professional client could never get an invoiced appointment — only an
 * already-matched customer who happened to already carry a VAT number could.
 *
 * @param {boolean} [props.canCreateWalkInService] Mirrors the APPOINTMENTS
 *   permission createCounterWalkInService itself re-checks server-side.
 * @param {boolean} [props.canCreateSessionBooking] Mirrors
 *   WORKSHOP_RESERVATIONS/FORMATION_RESERVATIONS, which
 *   createCounterReservation re-checks per kind server-side.
 * @param {object} [props.pendingService] A SERVICE row selected from the
 *   omnibar's search (actions/counter/search.js) — opens the composer
 *   straight into "Prestation" mode, pre-filled. See CounterSurface's
 *   selectResult.
 * @param {() => void} [props.onConsumePendingService] Called once the
 *   pending service has been copied into local state, so the parent's
 *   selection doesn't keep re-triggering this effect.
 * @param {object} [props.pendingSession] A SESSION row selected from the
 *   omnibar's search (actions/counter/search.js) — opens the composer
 *   straight into "Séance" mode, pre-filled. See CounterSurface's
 *   selectResult.
 * @param {() => void} [props.onConsumePendingSession] Called once the
 *   pending session has been copied into local state, so the parent's
 *   selection doesn't keep re-triggering this effect.
 */
export function CounterBookingComposer({
  canCreateWalkInService = true,
  canCreateSessionBooking = true,
  canCollectCash = false,
  pendingService,
  onConsumePendingService,
  pendingSession,
  onConsumePendingSession,
}) {
  // Only Marie / an admin puts cash into the Livre de caisse. For everyone
  // else the counter payment is recorded off-till by the server (see
  // isTillCashOperator), so the till-session gate never applies to them.
  const tillGateApplies = canCollectCash;
  // Shared by both modes — one till, one open/closed state regardless of
  // which form (SERVICE or SESSION) is currently rendered.
  const { open: cashSessionOpen, markOpen: markCashSessionOpen, markClosed: markCashSessionClosed } = useCashSessionOpen();

  // ── Buyer — shared by both modes (see docstring) ───────────────────────
  const [buyer, setBuyer] = useState(EMPTY_BUYER);
  const [buyerAddressOnFile, setBuyerAddressOnFile] = useState(false);
  const [buyerMatches, setBuyerMatches] = useState([]);
  const [buyerVatCheck, setBuyerVatCheck] = useState(null);

  // ── SERVICE mode ──────────────────────────────────────────────────────
  const [selectedService, setSelectedService] = useState(null);
  const [finalTotal, setFinalTotal] = useState("");
  const [reason, setReason] = useState("");
  // Card is EXTERNAL_TERMINAL only — see SettleAction.
  const [method, setMethod] = useState("EXTERNAL_TERMINAL");
  const [terminalReference, setTerminalReference] = useState("");
  const [received, setReceived] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── SESSION mode ──────────────────────────────────────────────────────
  const [session, setSession] = useState(null); // the SESSION row from searchCounter
  const [seatsCount, setSeatsCount] = useState(1);
  const [paymentMode, setPaymentMode] = useState("DEPOSIT"); // "FULL" | "DEPOSIT"
  const [sessionFinalTotal, setSessionFinalTotal] = useState("0");
  const [sessionReason, setSessionReason] = useState("");
  const [sessionMethod, setSessionMethod] = useState("EXTERNAL_TERMINAL");
  const [sessionTerminalReference, setSessionTerminalReference] = useState("");
  const [sessionReceived, setSessionReceived] = useState(false);
  const [sessionSaving, setSessionSaving] = useState(false);

  // Derived, never chosen: exactly one of the two pending props fires at a
  // time (CounterSurface never sets both), so exactly one of these is ever
  // set. No separate "mode" state to fall out of sync with it.
  const mode = session ? "SESSION" : selectedService ? "SERVICE" : null;

  useEffect(() => {
    if (!pendingService) return;
    // Defensive only — CounterSurface's own selectResult already refuses to
    // route a SERVICE row here without this permission.
    if (canCreateWalkInService) {
      setSession(null);
      setSelectedService(pendingService);
      setFinalTotal(String(pendingService.price));
      setReason("");
    }
    onConsumePendingService?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingService]);

  useEffect(() => {
    if (!pendingSession) return;
    // Same defensive check, mirrored for the SESSION side.
    if (canCreateSessionBooking) {
      setSelectedService(null);
      setSession(pendingSession);
      setSeatsCount(1);
      setSessionFinalTotal(String(round2(pendingSession.unitPrice)));
    }
    onConsumePendingSession?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSession]);

  // Same debounce as the retail till's own buyer search (CounterCart) —
  // searchPointOfSaleCustomers is gated on POINT_OF_SALE, which the
  // composer already requires to render, and returns the address/VAT
  // fields CounterBuyerForm needs. Shared by both modes: whichever one is
  // active, `buyer` is the only customer state there is.
  useEffect(() => {
    const query = buyer.email || buyer.fullName;
    if (buyer.id || query.trim().length < 2) {
      setBuyerMatches([]);
      return undefined;
    }
    const timeout = setTimeout(async () => {
      const result = await searchPointOfSaleCustomers(query);
      if (result.success) setBuyerMatches(result.data);
    }, 250);
    return () => clearTimeout(timeout);
  }, [buyer.email, buyer.fullName, buyer.id]);

  function reset() {
    setBuyer(EMPTY_BUYER);
    setBuyerAddressOnFile(false);
    setBuyerMatches([]);
    setBuyerVatCheck(null);
    setSelectedService(null);
    setFinalTotal("");
    setReason("");
    // "CARD" is no longer an accepted method — resetting to it would leave
    // the form in a state the server refuses.
    setMethod("EXTERNAL_TERMINAL");
    setTerminalReference("");
    setReceived(false);
    setSession(null);
    setSeatsCount(1);
    setPaymentMode("DEPOSIT");
    setSessionFinalTotal("0");
    setSessionReason("");
    setSessionMethod("EXTERNAL_TERMINAL");
    setSessionTerminalReference("");
    setSessionReceived(false);
  }

  // Only the address fields the server's counterCustomerSchema actually
  // reads — never the display-only ones (id, isCompany, vatInvoiceReady,
  // vatValidationName) CounterBuyerForm also keeps on this same object.
  function buildBuyerPayload() {
    const addressFields = buyer.addressLine1
      ? {
          addressLine1: buyer.addressLine1,
          addressLine2: buyer.addressLine2,
          addressCity: buyer.addressCity,
          addressPostalCode: buyer.addressPostalCode,
          addressCountry: buyer.addressCountry,
        }
      : {};
    return buyer.id
      ? { userId: buyer.id, vatNumber: buyer.vatNumber || undefined, ...addressFields }
      : {
          fullName: buyer.fullName,
          email: buyer.email,
          phone: buyer.phone,
          vatNumber: buyer.vatNumber || undefined,
          ...addressFields,
        };
  }

  // Shared front-door check for both submit paths: a real identity, and —
  // only once a VAT number is attached — a billing address to go with it.
  // The server (resolveCounterCustomer) refuses this exact same case, but
  // failing fast here means the cashier sees it before typing a payment
  // amount, not after a round trip that undoes nothing since nothing was
  // created yet.
  function buyerValidationError() {
    const hasIdentity = buyer.id || (buyer.fullName.trim() && buyer.email.trim() && buyer.phone.trim());
    if (!hasIdentity) return "Choisissez ou créez le client — nom, e-mail et téléphone sont requis.";
    if (buyerNeedsAddress && !buyer.addressLine1.trim()) {
      return "Adresse de facturation obligatoire pour un client avec un numéro de TVA.";
    }
    return null;
  }

  async function submit(event) {
    event.preventDefault();
    if (!selectedService) return toast.error("Choisissez une prestation du catalogue.");
    const buyerError = buyerValidationError();
    if (buyerError) return toast.error(buyerError);
    const amount = Number(finalTotal);
    const changed = Number.isFinite(amount) && amount !== selectedService.price;
    if (changed && reason.trim().length < 3) return toast.error("Indiquez la raison de l'ajustement de prix.");
    if (!received) return toast.error("Confirmez avoir reçu le paiement.");

    setSaving(true);
    const result = await createCounterWalkInService({
      staffServiceId: selectedService.staffServiceId,
      customer: buildBuyerPayload(),
      method,
      paymentConfirmed: true,
      // Pressing the confirm button is the attestation for both facts: the
      // money arrived, and for a card that means the terminal approved it.
      terminalApproved: true,
      terminalReference,
      finalTotal: amount,
      ...(changed ? { adjustmentReason: reason.trim() } : {}),
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.message);
      if (result.requiresCashSession) markCashSessionClosed();
      return;
    }
    toast.success(result.message);
    reset();
  }

  // ── Buyer controller — shared by both modes, same shape as CounterCart's ──
  function selectBuyer(match) {
    setBuyer({
      id: match.id,
      fullName: match.fullName,
      email: match.email,
      phone: match.phone ?? "",
      vatNumber: match.vatNumber ?? "",
      isCompany: Boolean(match.isCompany),
      vatInvoiceReady: Boolean(match.vatInvoiceReady),
      vatValidationName: match.vatValidationName ?? null,
      addressLine1: match.addressLine1 ?? "",
      addressLine2: match.addressLine2 ?? "",
      addressCity: match.addressCity ?? "",
      addressPostalCode: match.addressPostalCode ?? "",
      addressCountry: match.addressCountry ?? "BE",
    });
    setBuyerAddressOnFile(Boolean(match.addressLine1));
    setBuyerVatCheck(null);
    setBuyerMatches([]);
  }

  function updateBuyer(field, value) {
    const wasMatched = Boolean(buyer.id);
    if (wasMatched) setBuyerAddressOnFile(false);
    setBuyer((current) => ({
      ...current,
      ...(wasMatched ? EMPTY_ADDRESS : null),
      ...(wasMatched ? { isCompany: false, vatInvoiceReady: false, vatValidationName: null } : null),
      id: null,
      [field]: value,
    }));
  }

  function updateBuyerAddress(field, value) {
    setBuyer((current) => ({ ...current, [field]: value }));
  }

  function updateBuyerVat(value) {
    setBuyer((current) => ({ ...current, vatNumber: value, vatInvoiceReady: false, vatValidationName: null }));
    setBuyerVatCheck(null);
  }

  async function handleVerifyBuyerVat() {
    if (!buyer.vatNumber.trim()) {
      toast.error("Renseignez d'abord un numéro de TVA.");
      return;
    }
    setBuyerVatCheck({ loading: true });
    const result = await verifyVatNumber(buyer.vatNumber);
    if (!result.success) {
      setBuyerVatCheck({ error: true, message: result.message });
      return;
    }
    setBuyerVatCheck({
      valid: result.valid,
      message: result.valid
        ? result.name
          ? `Actif — enregistré au nom de « ${result.name} ».`
          : "Actif dans le registre VIES."
        : "Ce numéro n'est pas reconnu par le registre européen VIES.",
    });
  }

  // Unlike the retail till's blanket "new or no address on file" rule
  // (PointOfSaleClient / CounterCart — a house rule for Order, not a legal
  // one), a sale only needs an address when a VAT number is actually
  // attached: resolveCounterCustomer's own gate is
  // `user.vatNumber && !user.addressLine1`, never address-on-its-own.
  // Importing the till's blanket rule here would block an ordinary B2C
  // sale — see the unified-counter plan's trap #10. Shared by both modes:
  // an appointment for a new professional client needs this exactly as
  // much as an atelier/formation seat does.
  const buyerNeedsAddress = Boolean(buyer.vatNumber.trim()) && !buyerAddressOnFile;
  const buyerWillHaveVatInvoice = buyer.vatInvoiceReady || Boolean(buyer.vatNumber.trim());
  const buyerWillBeBelgianB2B = buyerWillHaveVatInvoice && buyer.vatNumber.trim().toUpperCase().startsWith("BE");

  function changeSeatsCount(value) {
    const seats = Math.max(1, Math.min(session?.seatsAvailable ?? 1, Number(value) || 1));
    setSeatsCount(seats);
    if (session) setSessionFinalTotal(String(round2(session.unitPrice * seats)));
  }

  const sessionTotal = Number(sessionFinalTotal) || 0;
  const sessionDepositAmount = session ? round2((sessionTotal * (session.depositPercentage ?? 50)) / 100) : 0;
  const sessionCollected = paymentMode === "FULL" ? sessionTotal : sessionDepositAmount;
  const sessionPriceChanged = session != null && sessionTotal !== round2(session.unitPrice * seatsCount);

  async function submitSession(event) {
    event.preventDefault();
    if (!session) return toast.error("Choisissez une séance.");
    const buyerError = buyerValidationError();
    if (buyerError) return toast.error(buyerError);
    if (sessionPriceChanged && sessionReason.trim().length < 3) return toast.error("Indiquez la raison de l'ajustement de prix.");
    if (sessionMethod === "EXTERNAL_TERMINAL" && !sessionTerminalReference.trim()) return toast.error("Indiquez la référence du ticket du terminal.");
    if (!sessionReceived) return toast.error("Confirmez avoir reçu le paiement.");

    setSessionSaving(true);
    const result = await createCounterReservation({
      kind: session.kind.toUpperCase(),
      sessionId: session.sessionId,
      seatsCount,
      customer: buildBuyerPayload(),
      ...(sessionPriceChanged ? { finalTotal: sessionTotal, adjustmentReason: sessionReason.trim() } : {}),
      payment: {
        mode: paymentMode,
        method: sessionMethod,
        paymentConfirmed: true,
        ...(sessionMethod === "EXTERNAL_TERMINAL" ? { terminalReference: sessionTerminalReference.trim() } : {}),
      },
    });
    setSessionSaving(false);
    if (!result.success) {
      toast.error(result.message);
      if (result.requiresCashSession) markCashSessionClosed();
      return;
    }
    toast.success(result.message);
    reset();
  }

  // Nothing selected from the search above yet — nothing to show. No
  // standalone toggle button here any more: the counter's one search field,
  // one screen up, is the only entry point (see CounterSurface).
  if (!mode) return null;

  const changed = selectedService && Number(finalTotal) !== selectedService.price;

  return (
    <div className="mt-5 space-y-4 rounded-[10px] border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-dark dark:text-white">
          {mode === "SERVICE" ? <Scissors className="h-4 w-4 text-primary" /> : <Calendar className="h-4 w-4 text-primary" />}
          {mode === "SERVICE" ? "Encaisser une prestation du catalogue" : "Vendre une place d'atelier ou de formation"}
        </h3>
        <button type="button" onClick={reset} className="text-xs font-semibold text-gray-500">Fermer</button>
      </div>

      {mode === "SERVICE" && (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-[7px] border border-stroke bg-white p-3 dark:border-dark-3 dark:bg-dark-2">
            <div>
              <strong className="block text-sm">{selectedService.serviceName}</strong>
              <small className="text-gray-500">{selectedService.staffName} · {selectedService.duration} min · {money(selectedService.price)}</small>
            </div>
            <button type="button" onClick={() => setSelectedService(null)} className="rounded-[7px] border border-stroke p-1.5 dark:border-dark-3">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <CounterBuyerForm
            customer={buyer}
            updateCustomer={updateBuyer}
            updateCustomerAddress={updateBuyerAddress}
            updateCustomerVat={updateBuyerVat}
            isWalkIn={false}
            toggleWalkIn={() => {}}
            walkInEmail=""
            setWalkInEmail={() => {}}
            walkInEmailMatch={null}
            useMatchedAccountInstead={() => {}}
            matches={buyerMatches}
            selectCustomer={selectBuyer}
            vatCheck={buyerVatCheck}
            handleVerifyVat={handleVerifyBuyerVat}
            needsAddress={buyerNeedsAddress}
            willHaveVatInvoice={buyerWillHaveVatInvoice}
            willBeBelgianB2B={buyerWillBeBelgianB2B}
            allowWalkIn={false}
            showInvoiceOptOut={false}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">Prix final TTC
              <input type="number" min="0" max="100000" step="0.01" required value={finalTotal} onChange={(e) => setFinalTotal(e.target.value)} className="mt-1.5 h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />
            </label>
            <label className="text-xs font-semibold">Raison de l&apos;ajustement {changed ? "(obligatoire)" : ""}
              <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!changed} placeholder="Geste commercial, correction…" className="mt-1.5 h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm disabled:opacity-50 dark:border-dark-3 dark:bg-dark-2" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {["CASH", "EXTERNAL_TERMINAL"].map((value) => <label key={value} className="flex items-center gap-1.5 text-sm"><input type="radio" checked={method === value} onChange={() => setMethod(value)} />{value === "CASH" ? "Espèces" : "Carte — terminal"}</label>)}
          </div>
          {method === "EXTERNAL_TERMINAL" && <input required value={terminalReference} onChange={(e) => setTerminalReference(e.target.value)} maxLength={100} placeholder="Référence du ticket du terminal" aria-label="Référence du ticket du terminal" className="h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />}
          {tillGateApplies && method === "CASH" && !cashSessionOpen && <CashSessionGate onOpened={markCashSessionOpen} />}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-3 dark:border-dark-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} />J&apos;ai bien reçu {money(finalTotal)}</label>
            <button type="submit" disabled={saving || !received || (tillGateApplies && method === "CASH" && !cashSessionOpen)} className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Encaissement…" : "Encaisser et enregistrer"}</button>
          </div>
        </form>
      )}

      {mode === "SESSION" && (
        <form onSubmit={submitSession} className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-[7px] border border-stroke bg-white p-3 dark:border-dark-3 dark:bg-dark-2">
            <div>
              <strong className="block text-sm">{session.title}</strong>
              <small className="text-gray-500">
                {new Date(session.startDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })}
                {" · "}{session.seatsAvailable} place{session.seatsAvailable > 1 ? "s" : ""} restante{session.seatsAvailable > 1 ? "s" : ""}
              </small>
            </div>
            <button type="button" onClick={() => setSession(null)} className="rounded-[7px] border border-stroke p-1.5 dark:border-dark-3"><X className="h-3.5 w-3.5" /></button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">Places
              <input type="number" min={1} max={session.seatsAvailable} step="1" value={seatsCount} onChange={(e) => changeSeatsCount(e.target.value)} className="mt-1.5 h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />
            </label>
            <label className="text-xs font-semibold">Mode de paiement
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="mt-1.5 h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2">
                <option value="DEPOSIT">Acompte ({session.depositPercentage ?? 50}%)</option>
                <option value="FULL">Paiement intégral</option>
              </select>
            </label>
            <label className="text-xs font-semibold">Prix total TTC
              <input type="number" min="0" max="100000" step="0.01" value={sessionFinalTotal} onChange={(e) => setSessionFinalTotal(e.target.value)} className="mt-1.5 h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />
            </label>
          </div>
          <p className="text-xs text-gray-500 dark:text-dark-6">
            Prix indicatif au tarif catalogue TTC belge — recalculé côté serveur selon le régime de TVA du client (ex. entreprise UE hors Belgique validée). Modifiez-le uniquement pour un geste commercial ou une correction, avec une raison.
          </p>
          {sessionPriceChanged && (
            <input value={sessionReason} onChange={(e) => setSessionReason(e.target.value)} maxLength={250} placeholder="Raison obligatoire : geste commercial, correction…" className="h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />
          )}

          <CounterBuyerForm
            customer={buyer}
            updateCustomer={updateBuyer}
            updateCustomerAddress={updateBuyerAddress}
            updateCustomerVat={updateBuyerVat}
            isWalkIn={false}
            toggleWalkIn={() => {}}
            walkInEmail=""
            setWalkInEmail={() => {}}
            walkInEmailMatch={null}
            useMatchedAccountInstead={() => {}}
            matches={buyerMatches}
            selectCustomer={selectBuyer}
            vatCheck={buyerVatCheck}
            handleVerifyVat={handleVerifyBuyerVat}
            needsAddress={buyerNeedsAddress}
            willHaveVatInvoice={buyerWillHaveVatInvoice}
            willBeBelgianB2B={buyerWillBeBelgianB2B}
            allowWalkIn={false}
            showInvoiceOptOut={false}
          />

          <div className="flex flex-wrap items-center gap-4 border-t border-stroke pt-3 dark:border-dark-3">
            {["CASH", "EXTERNAL_TERMINAL"].map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <input type="radio" checked={sessionMethod === value} onChange={() => setSessionMethod(value)} />
                {value === "CASH" ? "Espèces" : "Carte — terminal"}
              </label>
            ))}
          </div>
          {sessionMethod === "EXTERNAL_TERMINAL" && (
            <input
              required
              value={sessionTerminalReference}
              onChange={(e) => setSessionTerminalReference(e.target.value)}
              maxLength={100}
              placeholder="Référence du ticket du terminal"
              aria-label="Référence du ticket du terminal"
              className="h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2"
            />
          )}
          {tillGateApplies && sessionMethod === "CASH" && !cashSessionOpen && <CashSessionGate onOpened={markCashSessionOpen} />}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-3 dark:border-dark-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sessionReceived} onChange={(e) => setSessionReceived(e.target.checked)} />
              J&apos;ai bien reçu {money(sessionCollected)}
            </label>
            <button
              type="submit"
              disabled={sessionSaving || !sessionReceived || (tillGateApplies && sessionMethod === "CASH" && !cashSessionOpen)}
              className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {sessionSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {sessionSaving ? "Encaissement…" : "Encaisser et réserver"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
