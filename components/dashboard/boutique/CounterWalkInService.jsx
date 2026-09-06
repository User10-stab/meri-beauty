"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { Camera, CameraOff, Loader2, Plus, Search, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { searchCustomersForManualBooking } from "@/actions/appointment/create-manual-appointment";
import { createCounterWalkInService, searchCounterServices } from "@/actions/counter/walk-in-service";

function money(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

function ServiceScanner({ onDecoded, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        if (cancelled) return;
        scanner.stop();
        onDecoded(result.data);
      },
      { preferredCamera: "environment", highlightScanRegion: true, onDecodeError: () => {} },
    );
    scanner.start().catch(() => setError("Caméra indisponible. Utilisez le lecteur USB ou saisissez le code."));
    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
    };
  }, [onDecoded]);

  return (
    <div className="relative mt-3 w-full max-w-sm overflow-hidden rounded-[10px] bg-black">
      <button type="button" onClick={onClose} aria-label="Fermer la caméra" className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-white">
        <X className="h-4 w-4" />
      </button>
      {error ? <p className="p-6 text-sm text-white">{error}</p> : <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />}
    </div>
  );
}

export function CounterWalkInService() {
  const [open, setOpen] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [searchingServices, setSearchingServices] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState({ fullName: "", email: "", phone: "" });
  const [finalTotal, setFinalTotal] = useState("");
  const [reason, setReason] = useState("");
  // Card is EXTERNAL_TERMINAL only — see SettleAction.
  const [method, setMethod] = useState("EXTERNAL_TERMINAL");
  const [terminalReference, setTerminalReference] = useState("");
  const [received, setReceived] = useState(false);
  const [saving, setSaving] = useState(false);
  const serviceRequest = useRef(0);

  const runServiceSearch = useCallback(async (raw) => {
    const value = String(raw ?? "").trim();
    if (value.length < 2) return;
    const requestId = ++serviceRequest.current;
    setSearchingServices(true);
    const result = await searchCounterServices(value);
    if (requestId !== serviceRequest.current) return;
    setSearchingServices(false);
    if (!result.success) return toast.error(result.message);
    setServices(result.data);
    if (result.data.length === 1 && /^S(?:ERVICE)?[:\-]/i.test(value)) selectService(result.data[0]);
  }, []);

  useEffect(() => {
    const value = serviceQuery.trim();
    if (value.length < 2) {
      setServices([]);
      return undefined;
    }
    const timer = setTimeout(() => runServiceSearch(value), 250);
    return () => clearTimeout(timer);
  }, [serviceQuery, runServiceSearch]);

  useEffect(() => {
    const value = customerQuery.trim();
    if (value.length < 2 || selectedCustomer || newCustomer) {
      setCustomers([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const result = await searchCustomersForManualBooking(value);
      if (result.success) setCustomers(result.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [customerQuery, selectedCustomer, newCustomer]);

  function selectService(service) {
    setSelectedService(service);
    setServiceQuery(service.serviceName);
    setServices([]);
    setFinalTotal(String(service.price));
    setReason("");
  }

  function reset() {
    setServiceQuery("");
    setServices([]);
    setSelectedService(null);
    setCustomerQuery("");
    setCustomers([]);
    setSelectedCustomer(null);
    setNewCustomer(false);
    setCustomerForm({ fullName: "", email: "", phone: "" });
    setFinalTotal("");
    setReason("");
    // "CARD" is no longer an accepted method — resetting to it would leave
    // the form in a state the server refuses.
    setMethod("EXTERNAL_TERMINAL");
    setTerminalReference("");
    setReceived(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (!selectedService) return toast.error("Choisissez une prestation du catalogue.");
    const customer = selectedCustomer
      ? { userId: selectedCustomer.id }
      : newCustomer
        ? customerForm
        : null;
    if (!customer) return toast.error("Choisissez ou créez le client.");
    const amount = Number(finalTotal);
    const changed = Number.isFinite(amount) && amount !== selectedService.price;
    if (changed && reason.trim().length < 3) return toast.error("Indiquez la raison de l'ajustement de prix.");
    if (!received) return toast.error("Confirmez avoir reçu le paiement.");

    setSaving(true);
    const result = await createCounterWalkInService({
      staffServiceId: selectedService.staffServiceId,
      customer,
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
    if (!result.success) return toast.error(result.message);
    toast.success(result.message);
    reset();
    setOpen(false);
  }

  const handleDecoded = useCallback((value) => {
    setScanning(false);
    setServiceQuery(value);
    runServiceSearch(value);
  }, [runServiceSearch]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-[7px] border border-primary px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5">
        <Plus className="h-4 w-4" />
        Prestation sans réservation
      </button>
    );
  }

  const changed = selectedService && Number(finalTotal) !== selectedService.price;

  return (
    <form onSubmit={submit} className="mt-5 space-y-4 rounded-[10px] border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-dark dark:text-white">Encaisser une prestation du catalogue</h3>
        </div>
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="text-xs font-semibold text-gray-500">Fermer</button>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-dark dark:text-white">Prestation ou QR service</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={serviceQuery} onChange={(event) => { setServiceQuery(event.target.value); setSelectedService(null); }} placeholder="Nom, catégorie, membre du personnel ou S:…" className="h-10 w-full rounded-[7px] border border-stroke bg-white pl-9 pr-3 text-sm dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
            {searchingServices && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" />}
          </div>
          <button type="button" onClick={() => setScanning((value) => !value)} className="rounded-[7px] border border-stroke px-3 dark:border-dark-3">
            {scanning ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          </button>
        </div>
        {scanning && <ServiceScanner onDecoded={handleDecoded} onClose={() => setScanning(false)} />}
        {services.length > 0 && (
          <ul className="mt-2 max-h-52 divide-y overflow-y-auto rounded-[7px] border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
            {services.map((service) => (
              <li key={service.staffServiceId}>
                <button type="button" onClick={() => selectService(service)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-dark-3">
                  <span><strong className="block text-sm">{service.serviceName}</strong><small className="text-gray-500">{service.staffName} · {service.duration} min</small></span>
                  <strong className="text-sm text-primary">{money(service.price)}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedService && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-dark dark:text-white">Client</label>
            {!selectedCustomer && !newCustomer && (
              <>
                <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Nom, e-mail ou téléphone" className="h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
                {customers.length > 0 && (
                  <ul className="mt-2 divide-y rounded-[7px] border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                    {customers.map((customer) => <li key={customer.id}><button type="button" onClick={() => { setSelectedCustomer(customer); setCustomerQuery(customer.fullName); setCustomers([]); }} className="w-full p-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-dark-3"><strong>{customer.fullName}</strong><span className="ml-2 text-xs text-gray-500">{customer.email}</span></button></li>)}
                  </ul>
                )}
                <button type="button" onClick={() => setNewCustomer(true)} className="mt-2 text-xs font-semibold text-primary underline">Nouveau client</button>
              </>
            )}
            {selectedCustomer && <p className="rounded-[7px] border border-stroke bg-white p-3 text-sm dark:border-dark-3 dark:bg-dark-2"><strong>{selectedCustomer.fullName}</strong> · {selectedCustomer.email} <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerQuery(""); }} className="ml-2 text-xs text-primary underline">Changer</button></p>}
            {newCustomer && (
              <div className="grid gap-2 sm:grid-cols-3">
                <input required value={customerForm.fullName} onChange={(e) => setCustomerForm((v) => ({ ...v, fullName: e.target.value }))} placeholder="Nom complet" className="h-10 rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />
                <input required type="email" value={customerForm.email} onChange={(e) => setCustomerForm((v) => ({ ...v, email: e.target.value }))} placeholder="E-mail" className="h-10 rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />
                <input required value={customerForm.phone} onChange={(e) => setCustomerForm((v) => ({ ...v, phone: e.target.value }))} placeholder="Téléphone" className="h-10 rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />
                <button type="button" onClick={() => setNewCustomer(false)} className="text-left text-xs text-primary underline">Choisir un client existant</button>
              </div>
            )}
          </div>

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
          {/*
            The terminal's "APPROUVÉ" screen used to need its own tick. Card is
            now the only card option and therefore the default, so that tick sat
            on every card transaction — and it asserts the same fact the confirm
            button already states: for a card, being paid IS the terminal
            approving. One attestation, one piece of evidence. The receipt
            reference stays required, because the reference is the evidence.
          */}
          {method === "EXTERNAL_TERMINAL" && <input required value={terminalReference} onChange={(e) => setTerminalReference(e.target.value)} maxLength={100} placeholder="Référence du ticket du terminal" aria-label="Référence du ticket du terminal" className="h-10 w-full rounded-[7px] border border-stroke bg-white px-3 text-sm dark:border-dark-3 dark:bg-dark-2" />}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-3 dark:border-dark-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} />J&apos;ai bien reçu {money(finalTotal)}</label>
            <button type="submit" disabled={saving || !received} className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Encaissement…" : "Encaisser et enregistrer"}</button>
          </div>
        </>
      )}
    </form>
  );
}
