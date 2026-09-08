"use client";

import { Calendar, Package, Scissors, Ticket } from "lucide-react";
import { KIND_LABEL, formatDateTime, formatPrice } from "@/components/dashboard/boutique/counter/counter-format";

const SESSION_KIND_LABEL = { workshop: "Atelier / Événement", formation: "Formation" };

function rowKey(row) {
  if (row.type === "BOOKING") return `booking:${row.kind}:${row.id}`;
  if (row.type === "SERVICE") return `service:${row.staffServiceId}`;
  if (row.type === "SESSION") return `session:${row.kind}:${row.sessionId}`;
  if (row.type === "PRODUCT") return `product:${row.variantId}`;
  return JSON.stringify(row);
}

function BookingRow({ row }) {
  return (
    <>
      <Ticket className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
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
    </>
  );
}

function ServiceRow({ row }) {
  return (
    <>
      <Scissors className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-dark dark:text-white">{row.serviceName}</p>
        <p className="truncate text-xs text-gray-500 dark:text-dark-6">
          Prestation · {row.staffName}
          {row.categoryName ? ` · ${row.categoryName}` : ""}
        </p>
      </div>
      <span className="text-sm font-bold text-primary">{formatPrice(row.price)}</span>
    </>
  );
}

function SessionRow({ row }) {
  return (
    <>
      <Calendar className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-dark dark:text-white">{row.title}</p>
        <p className="truncate text-xs text-gray-500 dark:text-dark-6">
          {SESSION_KIND_LABEL[row.kind]} · {row.seatsAvailable} place{row.seatsAvailable > 1 ? "s" : ""} restante
          {row.seatsAvailable > 1 ? "s" : ""}
        </p>
        <p className="text-xs text-gray-500 dark:text-dark-6">{formatDateTime(row.startDate)}</p>
      </div>
      <span className="text-sm font-bold text-primary">{formatPrice(row.unitPrice)}</span>
    </>
  );
}

function ProductRow({ row }) {
  return (
    <>
      <Package className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-dark dark:text-white">{row.productName}</p>
        <p className="truncate text-xs text-gray-500 dark:text-dark-6">
          Produit · {row.variantName}
          {row.isLowStock ? " · stock faible" : ""}
        </p>
      </div>
      <span className="text-sm font-bold text-primary">{formatPrice(row.unitPrice)}</span>
    </>
  );
}

const ROW_RENDERERS = { BOOKING: BookingRow, SERVICE: ServiceRow, SESSION: SessionRow, PRODUCT: ProductRow };

function ResultRow({ row, onSelect }) {
  const Row = ROW_RENDERERS[row.type] ?? BookingRow;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row)}
        className="flex w-full flex-wrap items-center gap-3 rounded-[10px] border border-stroke px-4 py-3 text-left hover:border-primary dark:border-dark-3"
      >
        <Row row={row} />
      </button>
    </li>
  );
}

function ResultSection({ title, rows, onSelect }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-dark-6">{title}</p>
      <ul className="space-y-2">
        {rows.map((row) => <ResultRow key={rowKey(row)} row={row} onSelect={onSelect} />)}
      </ul>
    </div>
  );
}

/**
 * Two different staff intents share this one search: finding something that
 * already exists (a booking to check in or settle) versus starting a new
 * sale (a service or a session seat, for an existing or brand-new client).
 * searchCounter (actions/counter/search.js) returns both kinds of row in one
 * flat, undifferentiated list — grouping them into labeled sections here is
 * what actually tells them apart, without giving the omnibar itself a
 * second mode/tab to choose between search-for-existing and create-new.
 * Ordering inside each section is whatever searchCounter already returned;
 * only the grouping is new.
 */
export function CounterResults({ rows, onSelect }) {
  const bookings = rows.filter((row) => row.type === "BOOKING");
  // A service and a session sell different things, but both answer the same
  // intent — "start a new sale" — so they share one section rather than two.
  const sellable = rows.filter((row) => row.type === "SERVICE" || row.type === "SESSION");
  const products = rows.filter((row) => row.type === "PRODUCT");

  return (
    <div className="space-y-5">
      <ResultSection title="Réservations existantes" rows={bookings} onSelect={onSelect} />
      <ResultSection title="Vendre / créer une réservation" rows={sellable} onSelect={onSelect} />
      <ResultSection title="Produits en boutique" rows={products} onSelect={onSelect} />
    </div>
  );
}
