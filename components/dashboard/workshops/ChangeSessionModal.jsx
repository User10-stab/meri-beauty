"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Copy } from "lucide-react";
import {
  changeReservationSession,
  changeReservationSeats,
  getWorkshopTransferOptions,
} from "@/actions/workshops/manage-reservation";
import Button from "@/components/ui/Button";
import { useTranslations } from "next-intl";

const APPLY_TARGET_PRICE = "APPLY_TARGET_PRICE";
const KEEP_CURRENT_PRICE = "KEEP_CURRENT_PRICE";

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));
}

/** Session/activity transfers are free admin corrections. Seat-count changes
 * deliberately keep their existing paid 10% workflow. */
export function ChangeSessionModal({ open, onClose, reservation }) {
  const t = useTranslations("dashboardWorkshops.changeSessionModal");
  const router = useRouter();
  const [mode, setMode] = useState("session");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [newSeatsCount, setNewSeatsCount] = useState("");
  const [reason, setReason] = useState("");
  const [priceDecision, setPriceDecision] = useState("");
  const [transferData, setTransferData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [isSubmitting, startSubmit] = useTransition();

  useEffect(() => {
    if (!open || !reservation?.id) return;
    let cancelled = false;
    setIsLoadingOptions(true);
    setLoadError("");
    setTransferData(null);
    getWorkshopTransferOptions(reservation.id)
      .then((result) => {
        if (cancelled) return;
        if (result.success) setTransferData(result.data);
        else setLoadError(result.message);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("loadError"));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reservation?.id, t]);

  const selectedTarget = useMemo(
    () => transferData?.options?.find((option) => option.id === selectedSessionId) ?? null,
    [selectedSessionId, transferData]
  );
  const priceDifference = Number(selectedTarget?.priceDifference ?? 0);
  const requiresPriceDecision = priceDifference > 0.01;
  const overpayment = Boolean(
    selectedTarget && Number(transferData?.paidAmount ?? 0) > Number(selectedTarget.targetTotal) + 0.01
  );
  const previewTotal =
    selectedTarget && priceDecision === APPLY_TARGET_PRICE
      ? Number(selectedTarget.targetTotal)
      : Number(transferData?.currentTotal ?? reservation?.totalPrice ?? 0);
  const previewBalance = Math.max(0, previewTotal - Number(transferData?.paidAmount ?? 0));
  const capacity = reservation?.session?.capacity ?? reservation?.session?.workshop?.capacity ?? 8;
  const changeFeePreview = Number(reservation?.totalPrice ?? 0) * 0.1;

  if (!open || !reservation) return null;

  function resetState() {
    setMode("session");
    setSelectedSessionId("");
    setNewSeatsCount("");
    setReason("");
    setPriceDecision("");
    setTransferData(null);
    setLoadError("");
    setPaymentUrl(null);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function handleTargetChange(value) {
    setSelectedSessionId(value);
    const target = transferData?.options?.find((option) => option.id === value);
    setPriceDecision(Number(target?.priceDifference ?? 0) > 0.01 ? "" : APPLY_TARGET_PRICE);
  }

  function handleSubmitSession() {
    if (!selectedSessionId) return toast.error(t("errorSelectSession"));
    if (!reason.trim()) return toast.error(t("errorReasonRequired"));
    if (requiresPriceDecision && !priceDecision) return toast.error(t("errorPriceDecision"));
    if (overpayment) return toast.error(t("overpaymentBlocked"));

    startSubmit(async () => {
      const result = await changeReservationSession(reservation.id, selectedSessionId, { reason, priceDecision });
      if (result.success) {
        if (result.emailSent === false) toast.warning(result.message);
        else toast.success(result.message);
        handleClose();
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleSubmitSeats() {
    const seats = parseInt(newSeatsCount, 10);
    if (!seats || seats < 1) return toast.error(t("errorInvalidSeats"));
    startSubmit(async () => {
      const result = await changeReservationSeats(reservation.id, seats);
      if (result.success) {
        toast.success(result.message);
        setPaymentUrl(result.paymentUrl);
      } else {
        toast.error(result.message);
      }
    });
  }

  function copyLink() {
    navigator.clipboard.writeText(paymentUrl);
    toast.success(t("linkCopied"));
  }

  const transferBlocked = Boolean(transferData?.blockedReason || loadError || overpayment);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">{t("title")}</h2>
          <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600" aria-label={t("close")}>
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-500">
          {reservation.session?.workshop?.title} — {reservation.customer?.fullName}
          <br />
          {t("currentSession")} {formatSessionDate(reservation.session?.startDate)} · {reservation.seatsCount} place
          {reservation.seatsCount > 1 ? "s" : ""}
        </p>

        {!paymentUrl && (
          <div className="mb-4 flex gap-2 border-b border-gray-200">
            {[["session", t("changeSession")], ["seats", t("changeSeats")]].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  mode === value ? "border-[#2f3a2e] text-[#2f3a2e]" : "border-transparent text-gray-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!paymentUrl ? (
          mode === "session" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {t("freeAdminTransfer")}
              </div>

              {!transferData?.blockedReason && transferData?.existingInvoiceNumber && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {t("existingInvoiceNote", { number: transferData.existingInvoiceNumber })}
                </div>
              )}

              {isLoadingOptions ? (
                <p className="text-sm text-gray-500">{t("loadingSessions")}</p>
              ) : loadError || transferData?.blockedReason ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {loadError || transferData?.blockedReason}
                </p>
              ) : (
                <>
                  <div>
                    <label htmlFor="workshop-transfer-session" className="mb-1 block text-sm font-medium text-gray-700">{t("newSessionLabel")}</label>
                    <select
                      id="workshop-transfer-session"
                      value={selectedSessionId}
                      onChange={(event) => handleTargetChange(event.target.value)}
                      className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                    >
                      <option value="">{t("selectSession")}</option>
                      {(transferData?.options ?? []).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.activityTitle} — {formatSessionDate(option.startDate)} — {option.availableSeats} place(s) — {formatMoney(option.targetTotal)}
                        </option>
                      ))}
                    </select>
                    {transferData?.options?.length === 0 && (
                      <p className="mt-2 text-xs text-amber-600">{t("noOtherSessions")}</p>
                    )}
                  </div>

                  {selectedTarget && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <span>{t("currentTotal")} <strong>{formatMoney(transferData.currentTotal)}</strong></span>
                        <span>{t("targetTotal")} <strong>{formatMoney(selectedTarget.targetTotal)}</strong></span>
                        <span>{t("alreadyPaid")} <strong>{formatMoney(transferData.paidAmount)}</strong></span>
                        <span>{t("priceDifference")} <strong>{formatMoney(priceDifference)}</strong></span>
                      </div>

                      {requiresPriceDecision && (
                        <fieldset className="mt-3 space-y-2 border-t border-gray-200 pt-3">
                          <legend className="text-sm font-semibold text-gray-800">{t("priceDecisionLabel")}</legend>
                          <label className="flex cursor-pointer gap-2">
                            <input type="radio" name="priceDecision" value={APPLY_TARGET_PRICE} checked={priceDecision === APPLY_TARGET_PRICE} onChange={(event) => setPriceDecision(event.target.value)} />
                            <span>{t("applyTargetPrice", { amount: formatMoney(priceDifference) })}</span>
                          </label>
                          <label className="flex cursor-pointer gap-2">
                            <input type="radio" name="priceDecision" value={KEEP_CURRENT_PRICE} checked={priceDecision === KEEP_CURRENT_PRICE} onChange={(event) => setPriceDecision(event.target.value)} />
                            <span>{t("waiveDifference", { amount: formatMoney(priceDifference) })}</span>
                          </label>
                        </fieldset>
                      )}

                      {overpayment ? (
                        <p className="mt-3 rounded-md bg-amber-100 px-3 py-2 text-amber-800">{t("overpaymentBlocked")}</p>
                      ) : (
                        <p className="mt-3 border-t border-gray-200 pt-3 font-medium">
                          {t("resultingBalance")} {formatMoney(previewBalance)}
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label htmlFor="workshop-transfer-reason" className="mb-1 block text-sm font-medium text-gray-700">{t("reasonLabel")}</label>
                    <textarea
                      id="workshop-transfer-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder={t("reasonPlaceholder")}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>

                  <Button
                    onClick={handleSubmitSession}
                    disabled={isSubmitting || transferBlocked || !selectedSessionId || !reason.trim() || (requiresPriceDecision && !priceDecision)}
                    className="w-full bg-[#2f3a2e]"
                  >
                    {isSubmitting ? t("transferring") : t("confirmTransfer")}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              <label htmlFor="workshop-reservation-seats" className="mb-1 block text-sm font-medium text-gray-700">{t("newSeatsLabel", { capacity })}</label>
              <input
                id="workshop-reservation-seats"
                type="number"
                min={1}
                max={capacity}
                value={newSeatsCount}
                onChange={(event) => setNewSeatsCount(event.target.value)}
                placeholder={String(reservation.seatsCount)}
                className="mb-4 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              />
              <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                {t("changeFeeSeats")} <strong>{formatMoney(changeFeePreview)}</strong>
              </div>
              <Button onClick={handleSubmitSeats} disabled={isSubmitting || !newSeatsCount} className="w-full bg-[#2f3a2e]">
                {isSubmitting ? t("generating") : t("generateLink")}
              </Button>
            </>
          )
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-600">{t("sendLink")}</p>
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="flex-1 truncate text-xs text-gray-600">{paymentUrl}</span>
              <button type="button" onClick={copyLink} className="text-gray-400 hover:text-gray-700">
                <Copy size={14} />
              </button>
            </div>
            <Button onClick={handleClose} className="w-full bg-[#2f3a2e]">{t("close")}</Button>
          </>
        )}
      </div>
    </div>
  );
}
