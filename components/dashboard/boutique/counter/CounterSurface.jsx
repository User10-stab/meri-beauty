"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { ScanLine, Ticket } from "lucide-react";
import { lookupCounterCode } from "@/actions/counter/lookup";
import { searchCounter } from "@/actions/counter/search";
import { lookupActivityCheckInById } from "@/actions/activities/check-in";
import { CounterOmniBar } from "@/components/dashboard/boutique/counter/CounterOmniBar";
import { CounterResults } from "@/components/dashboard/boutique/counter/CounterResults";
import { CounterFiche } from "@/components/dashboard/boutique/counter/CounterFiche";
import { PickupFiche } from "@/components/dashboard/boutique/counter/PickupFiche";
import { CounterBookingComposer } from "@/components/dashboard/boutique/counter/CounterBookingComposer";
import { CounterCart } from "@/components/dashboard/boutique/counter/CounterCart";

// Route only exact known code shapes. A customer may legitimately be stored
// under a single name, so generic alphanumeric text must remain a name search.
function looksLikeCode(value) {
  return /^(?:[AFR]-?[0-9A-F]{10}|[0-9A-F]{8})$/i.test(value.trim());
}

/**
 * The counter, merged into one screen: a single field for a QR ticket, a
 * boutique pickup code, or a customer/service name (this section) sitting
 * above the retail till (CounterCart). Previously two separate components —
 * CounterPanel and PointOfSaleClient — were stacked on this page, each with
 * its own search box and its own camera library (qr-scanner here,
 * @zxing/browser at the till). This is the merge: one page, one component
 * tree under components/dashboard/boutique/counter/, and one scanner
 * library (@zxing/browser, via CounterScanner) everywhere a camera is used.
 *
 * The retail till stays a *separate* section rather than one shared basket:
 * Payment has four mutually-exclusive source columns (Order,
 * WorkshopReservation, FormationReservation, Appointment — each
 * @unique) — a single payment spanning a boutique order and a booking is
 * not representable, so a "one basket for everything" design was never
 * achievable. What is merged is the search box and the scanner; each kind of
 * sale keeps its own settle button and its own money path, same as before.
 *
 * The free-text search fans out through searchCounter to bookings, services,
 * boutique products, and atelier/formation sessions with open seats, all
 * from this one field — and it is the only entry point into every one of
 * those flows. Selecting a booking opens its fiche. Selecting a service or
 * a session with a permitted result type hands that row straight to
 * CounterBookingComposer (as pendingService/pendingSession), which pops
 * open already filled in. Selecting a product hands it straight to
 * CounterCart the same way (as pendingProduct) — added directly to the
 * cart, no retyping the same name in a second search box. There is no
 * standalone "sell something" button anywhere on this page any more.
 */
export function CounterSurface({
  canCheckIn = false,
  canSettle = false,
  canPickup = false,
  canCreateWalkInService = false,
  canCreateSessionBooking = false,
  canAdjustStock = false,
  canOpenCashSession = false,
}) {
  const [input, setInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState(null); // { domain: "TICKET", ...presentReservation } or { domain: "PICKUP", ...order }
  const [nameResults, setNameResults] = useState(null); // array, when a name matched more than one thing
  const [pendingService, setPendingService] = useState(null); // a SERVICE row selected from search, handed to the composer
  const [pendingSession, setPendingSession] = useState(null); // a SESSION row selected from search, handed to the composer
  const [pendingProduct, setPendingProduct] = useState(null); // a PRODUCT row selected from search, handed to the till
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

  async function openBooking(row) {
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

  // A service or session row lacking the matching permission falls back to
  // this toast rather than silently opening the composer for something the
  // staff member can't actually complete. Nothing else routes here any
  // more — a product row always goes straight to the till (see below), and
  // every permitted service/session row goes straight to the composer.
  function notifyNotPermitted() {
    toast.error("Vous n'avez pas la permission d'encaisser cette vente depuis la caisse.");
  }

  function selectResult(row) {
    if (row.type === "BOOKING") {
      openBooking(row);
    } else if (row.type === "SESSION") {
      // Opens the booking composer straight into "Atelier / formation"
      // mode, pre-filled with this session — see
      // CounterBookingComposer's pendingSession prop.
      if (canCreateSessionBooking) {
        setPendingSession(row);
      } else {
        notifyNotPermitted();
      }
    } else if (row.type === "SERVICE") {
      // Opens the booking composer straight into "Prestation" mode,
      // pre-filled with this service — see pendingService.
      if (canCreateWalkInService) {
        setPendingService(row);
      } else {
        notifyNotPermitted();
      }
    } else if (row.type === "PRODUCT") {
      // Added straight to the till's cart — see CounterCart's
      // pendingProduct prop. No separate permission to gate on: everyone
      // who reaches this page already holds POINT_OF_SALE, which is all
      // CounterCart itself requires.
      setPendingProduct(row);
    }
  }

  const runNameSearch = useCallback(
    async (value) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setTicket(null);
      const result = await searchCounter(value);
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
      if (result.data.length === 1 && result.data[0].type === "BOOKING") {
        openBooking(result.data[0]);
        return;
      }
      setNameResults(result.data);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function runDispatch(value) {
    if (looksLikeCode(value)) {
      runCodeLookup(value);
    } else {
      runNameSearch(value);
    }
  }

  const handleDecoded = useCallback(
    (decoded) => {
      const value = decoded.trim();
      // A ticket/pickup code is case-insensitive hex — safe to normalise for
      // display. A service QR (S:<staffServiceId>) is not: staffService ids
      // are case-sensitive, so uppercasing here would break the exact-id
      // match in searchCounterServices. Route exactly like typed input
      // (looksLikeCode) instead of always assuming a check-in code.
      if (looksLikeCode(value)) {
        setInput(value.toUpperCase());
        runCodeLookup(value);
      } else {
        setInput(value);
        runNameSearch(value);
      }
    },
    [runCodeLookup, runNameSearch]
  );

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

  const showCounterSection = canCheckIn || canSettle || canPickup;

  return (
    <div className="space-y-6">
      {showCounterSection && (
        <section className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <div className="mb-1 flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" strokeWidth={1.75} />
            <h2 className="text-base font-bold text-dark dark:text-white">Pointage &amp; encaissement</h2>
          </div>
          <p className="mb-4 text-xs text-gray-500 dark:text-dark-6">
            Scannez le QR du client, saisissez son code, ou cherchez par nom de client ou de service.
          </p>

          <CounterOmniBar
            value={input}
            onChange={setInput}
            onSubmit={runDispatch}
            onDecoded={handleDecoded}
            loading={loading}
            scanning={scanning}
            onToggleScanning={setScanning}
          />

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
              <CounterResults rows={nameResults} onSelect={selectResult} />
            </div>
          )}

          {ticket && (
            <div className="mt-4">
              {ticket.domain === "PICKUP" ? (
                <PickupFiche order={ticket} onSettled={() => setTicket(null)} />
              ) : (
                <CounterFiche
                  key={`${ticket.code}:${ticket.checkedInSeats}:${ticket.balanceDue}:${ticket.seatsCount}:${ticket.totalPrice}`}
                  ticket={ticket}
                  onChanged={handleTicketChanged}
                />
              )}
            </div>
          )}

          {(canCreateWalkInService || canCreateSessionBooking) && (
            <CounterBookingComposer
              canCreateWalkInService={canCreateWalkInService}
              canCreateSessionBooking={canCreateSessionBooking}
              pendingService={pendingService}
              onConsumePendingService={() => setPendingService(null)}
              pendingSession={pendingSession}
              onConsumePendingSession={() => setPendingSession(null)}
            />
          )}
        </section>
      )}

      <CounterCart
        canAdjustStock={canAdjustStock}
        canOpenCashSession={canOpenCashSession}
        pendingProduct={pendingProduct}
        onConsumePendingProduct={() => setPendingProduct(null)}
      />
    </div>
  );
}
