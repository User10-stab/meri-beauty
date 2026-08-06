"use client";

import { CalendarDays, FileDown } from "lucide-react";

const STATUS_LABELS = {
  PENDING: "En attente de confirmation",
  CONFIRMED: "Confirmé",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absence",
};

const STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-100",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-100",
  NO_SHOW: "bg-red-50 text-red-600 border-red-100",
};

function formatDateTime(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function AppointmentCard({ appointment }) {
  const invoice = appointment.payment?.invoice;

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">{appointment.serviceName}</p>
          <p className="mt-0.5 text-xs capitalize text-ink/45">
            {formatDateTime(appointment.startTime)} · {formatTime(appointment.startTime)}–{formatTime(appointment.endTime)}
          </p>
          <p className="mt-0.5 text-xs text-ink/45">Avec {appointment.staffName}</p>
        </div>
        <StatusBadge status={appointment.status} />
      </div>

      {appointment.notes && (
        <p className="mt-3 border-t border-ink/8 pt-3 text-[13px] text-ink/60">{appointment.notes}</p>
      )}

      {appointment.review && (
        <div className="mt-3 border-t border-ink/8 pt-3 text-[13px] text-ink/60">
          Votre avis : {"★".repeat(appointment.review.rating)}{"☆".repeat(5 - appointment.review.rating)}
          {appointment.review.comment && <span className="ml-1">— {appointment.review.comment}</span>}
        </div>
      )}

      {invoice && (
        <div className="mt-3 border-t border-ink/8 pt-3">
          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/60 hover:text-gold"
          >
            <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
            Facture {invoice.number}
          </a>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink/15 bg-white/50 py-16 text-center">
      <CalendarDays className="h-8 w-8 text-ink/25" strokeWidth={1.5} />
      <p className="text-sm text-ink/45">Vous n&apos;avez pas encore pris de rendez-vous.</p>
    </div>
  );
}

export function MyAppointmentsPageClient({ appointments }) {
  return (
    <>
      <section className="relative w-full bg-primary py-16 lg:py-20">
        <div className="mx-auto max-w-[1000px] px-6 md:px-10 text-center">
          <div className="mb-4 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Mon compte</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.6rem]">
            Mes rendez-vous
          </h1>
        </div>
      </section>

      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1000px] px-6 py-12 md:px-10">
          {appointments.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {appointments.map((a) => (
                <AppointmentCard key={a.id} appointment={a} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
