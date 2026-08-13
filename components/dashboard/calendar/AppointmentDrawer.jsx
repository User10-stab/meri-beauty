"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  X,
  User,
  Phone,
  Mail,
  Scissors,
  Tag,
  CalendarDays,
  Clock,
  Timer,
  CreditCard,
  FileText,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { confirmAppointment, rejectAppointment, completeAppointment } from "@/actions/appointment/manage-appointment";
import { getStaffColor } from "./staffColors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(min) {
  if (!min) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function formatPrice(amount) {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

const PAYMENT_STATUS_LABELS = {
  PENDING: { key: "paymentStatus.pending" },
  PAID: { key: "paymentStatus.paid" },
  PARTIALLY_PAID: { key: "paymentStatus.partiallyPaid" },
  REFUNDED: { key: "paymentStatus.refunded" },
};

const PAYMENT_STATUS_STYLES = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-100",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-100",
  PARTIALLY_PAID: "bg-blue-50 text-blue-700 border-blue-100",
  REFUNDED: "bg-gray-100 text-gray-600 border-gray-200",
};

// ─── Row component ────────────────────────────────────────────────────────────

function DrawerRow({ icon: Icon, label, value, valueClassName = "" }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
        <Icon size={14} className="text-gray-500 dark:text-gray-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-400 dark:text-gray-500">{label}</p>
        <p className={`mt-0.5 text-sm font-medium text-gray-800 dark:text-gray-200 ${valueClassName}`}>
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Slide-in drawer showing full appointment details, with the same
 * Confirmer / Terminer / Annuler actions available from the dashboard's
 * appointments list — kept in sync so managing a booking from the calendar
 * isn't a reduced experience compared to the list view.
 *
 * @param {{
 *   appointment: object | null,
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onAppointmentUpdated: () => void,
 *   isAdmin: boolean,
 * }} props
 */
export function AppointmentDrawer({
  appointment,
  isOpen,
  onClose,
  onAppointmentUpdated,
  isAdmin = false,
}) {
  const t = useTranslations();
  const drawerRef = useRef(null);
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: "success"|"error", message }
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [completeMethod, setCompleteMethod] = useState("CASH");

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Clear feedback when a new appointment opens
  useEffect(() => {
    setFeedback(null);
    setShowPaymentDialog(false);
    setCompleteMethod("CASH");
  }, [appointment?.id]);

  async function handleConfirm() {
    if (!appointment?.id || isPending) return;
    setIsPending(true);
    setFeedback(null);
    try {
      const result = await confirmAppointment(appointment.id);
      if (result.success) {
        setFeedback({ type: "success", message: result.message ?? t("success.appointmentConfirmed") });
        onAppointmentUpdated();
      } else {
        setFeedback({ type: "error", message: result.message ?? t("errors.generic") });
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleComplete() {
    if (!appointment?.id || isPending) return;
    if (appointment.paymentStatus === "PARTIALLY_PAID") {
      setShowPaymentDialog(true);
      return;
    }
    setIsPending(true);
    setFeedback(null);
    try {
      const result = await completeAppointment(appointment.id);
      if (result.success) {
        setFeedback({ type: "success", message: result.message ?? t("success.appointmentCompleted") });
        onAppointmentUpdated();
      } else {
        setFeedback({ type: "error", message: result.message ?? t("errors.generic") });
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleCompleteWithPayment() {
    if (!appointment?.id || isPending) return;
    setIsPending(true);
    setFeedback(null);
    try {
      const result = await completeAppointment(appointment.id, { method: completeMethod });
      setShowPaymentDialog(false);
      if (result.success) {
        setFeedback({ type: "success", message: result.message ?? t("success.appointmentCompleted") });
        onAppointmentUpdated();
      } else {
        setFeedback({ type: "error", message: result.message ?? t("errors.generic") });
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleCancel() {
    if (!appointment?.id || isPending) return;
    setIsPending(true);
    setFeedback(null);
    try {
      const result = await rejectAppointment(appointment.id);
      if (result.success) {
        setFeedback({ type: "success", message: t("success.appointmentCancelled") });
        onAppointmentUpdated();
      } else {
        setFeedback({ type: "error", message: result.message ?? t("errors.generic") });
      }
    } finally {
      setIsPending(false);
    }
  }

  if (!appointment) return null;

  const color = getStaffColor(appointment.staffId);
  const paymentConfig = PAYMENT_STATUS_LABELS[appointment.paymentStatus];
  const paymentLabel = paymentConfig ? t(paymentConfig.key) : null;
  const paymentClassName = PAYMENT_STATUS_STYLES[appointment.paymentStatus] ?? null;
  const actionsDone = feedback?.type === "success";
  const balanceDue =
    appointment.totalAmount !== null && appointment.paidAmount !== null
      ? appointment.totalAmount - appointment.paidAmount
      : null;

  const startHour = appointment.startTime
    ? new Date(appointment.startTime).getHours() * 60 +
      new Date(appointment.startTime).getMinutes()
    : 0;
  const endHour = appointment.endTime
    ? new Date(appointment.endTime).getHours() * 60 +
      new Date(appointment.endTime).getMinutes()
    : 0;
  const derivedDuration = appointment.duration ?? (endHour - startHour);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Détails du rendez-vous"
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out dark:bg-gray-dark ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700"
          style={{ borderTop: `4px solid ${color.dot}` }}
        >
          <div>
            <h2 className="text-base font-bold text-gray-800 dark:text-white">
              {t("appointmentDetails.title")}
            </h2>
            <p className="mt-0.5 text-xs text-gray-400">
              {formatDate(appointment.date)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Feedback banner */}
          {feedback && (
            <div
              className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                feedback.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle size={15} />
              ) : (
                <XCircle size={15} />
              )}
              {feedback.message}
            </div>
          )}

          {/* ── Section: Client ────────────────────────────────────── */}
          <Section title={t("appointmentDetails.client")}>
            <DrawerRow icon={User} label={t("appointmentDetails.client")} value={appointment.customerName} />
            <DrawerRow icon={Phone} label={t("common.phone")} value={appointment.customerPhone} />
            <DrawerRow icon={Mail} label={t("common.email")} value={appointment.customerEmail} />
          </Section>

          {/* ── Section: Service ───────────────────────────────────── */}
          <Section title={t("appointmentDetails.service")}>
            <DrawerRow icon={Scissors} label={t("appointmentDetails.service")} value={appointment.serviceName} />
            <DrawerRow icon={Tag} label={t("appointmentDetails.category")} value={appointment.categoryName} />
            <DrawerRow
              icon={User}
              label={t("appointmentDetails.staff")}
              value={appointment.staffName}
            />
          </Section>

          {/* ── Section: Horaire ───────────────────────────────────── */}
          <Section title={t("appointmentDetails.date")}>
            <DrawerRow icon={CalendarDays} label={t("appointmentDetails.date")} value={formatDate(appointment.date)} />
            <DrawerRow
              icon={Clock}
              label={t("appointmentDetails.time")}
              value={`${formatTime(appointment.startTime)} – ${formatTime(appointment.endTime)}`}
            />
            <DrawerRow
              icon={Timer}
              label={t("appointmentDetails.duration")}
              value={formatDuration(derivedDuration)}
            />
          </Section>

          {/* ── Section: Paiement ──────────────────────────────────── */}
          <Section title={t("appointmentPayment.collectBalance")}>
            <DrawerRow
              icon={CreditCard}
              label={t("common.total")}
              value={formatPrice(appointment.totalAmount ?? appointment.price)}
            />
            {appointment.depositAmount !== null && (
              <DrawerRow
                icon={CreditCard}
                label={t("appointmentDetails.depositCollected")}
                value={formatPrice(appointment.depositAmount)}
              />
            )}
            {appointment.paidAmount !== null && (
              <DrawerRow
                icon={CreditCard}
                label={t("success.paid")}
                value={formatPrice(appointment.paidAmount)}
              />
            )}
            {appointment.remainingAmount !== null && (
              <DrawerRow
                icon={CreditCard}
                label={t("appointmentPayment.paymentDue")}
                value={formatPrice(appointment.remainingAmount)}
              />
            )}
            <div className="flex items-start gap-3 py-2.5">
              <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                <CreditCard size={14} className="text-gray-500 dark:text-gray-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-400">{t("common.status")}</p>
                {paymentLabel ? (
                  <span
                    className={`mt-0.5 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${paymentClassName}`}
                  >
                    {paymentLabel}
                  </span>
                ) : (
                  <p className="mt-0.5 text-sm font-medium text-gray-500">—</p>
                )}
              </div>
            </div>
          </Section>

          {/* ── Section: Notes ─────────────────────────────────────── */}
          {appointment.notes && (
            <Section title={t("appointmentDetails.notes")}>
              <div className="flex items-start gap-3 py-2.5">
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                  <FileText size={14} className="text-gray-500 dark:text-gray-400" />
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">
                  {appointment.notes}
                </p>
              </div>
            </Section>
          )}

          {/* ── Encaisser le solde (partial payment) ───────────────── */}
          {showPaymentDialog && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-gray-800/30">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{t("appointmentPayment.collectBalance")}</h3>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("appointmentPayment.stillDue")}{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {formatPrice(balanceDue)}
                </span>{" "}
                sur place. Une facture sera émise pour le montant total dès l&apos;encaissement.
              </p>
              <label className="mt-3 block text-xs font-medium text-gray-500 dark:text-gray-400">{t("appointmentPayment.paymentMethod")}</label>
              <select
                value={completeMethod}
                onChange={(e) => setCompleteMethod(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="CASH">Espèces</option>
                <option value="CARD">Carte</option>
              </select>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPaymentDialog(false)}
                  disabled={isPending}
                  className="rounded-lg border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleCompleteWithPayment}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2f3a2e] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3d4e3b] disabled:opacity-60"
                >
                  {isPending && <Loader2 size={12} className="animate-spin" />}
                  {t("appointmentActions.confirm")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer actions ───────────────────────────────────────────── */}
        {!actionsDone && !showPaymentDialog && (
          <div className="flex items-center gap-3 border-t border-gray-100 px-5 py-4 dark:border-gray-700">
            {appointment.status === "PENDING" && (
              <>
                <button
                  onClick={handleConfirm}
                  disabled={isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2f3a2e] px-4 py-2.5 text-sm font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                  {t("appointmentActions.confirm")}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
                >
                  <XCircle size={15} />
                  {t("appointmentActions.reject")}
                </button>
              </>
            )}

            {appointment.status === "CONFIRMED" && (
              <>
                <button
                  onClick={handleComplete}
                  disabled={isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2f3a2e] px-4 py-2.5 text-sm font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                  {t("appointmentActions.complete")}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
                >
                  <XCircle size={15} />
                  {t("appointmentActions.cancel")}
                </button>
              </>
            )}

            {(appointment.status === "COMPLETED" || appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") && (
              <p className="w-full text-center text-xs text-gray-400">{t("appointmentDetails.cannotModify")}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {title}
      </h3>
      <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-gray-50/60 px-3 dark:divide-gray-700/50 dark:border-gray-700 dark:bg-gray-800/30">
        {children}
      </div>
    </div>
  );
}
