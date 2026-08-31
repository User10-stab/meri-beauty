"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  X,
  User,
  Mail,
  Phone,
  Calendar,
  Tag,
  MessageSquare,
  Clock,
  Check,
  X as XIcon,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function getStatusColor(status) {
  switch (status) {
    case "PENDING":
      return "bg-yellow-100 text-yellow-800";
    case "APPROVED":
      return "bg-green-100 text-green-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "CANCELLED":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function getStatusText(status) {
  switch (status) {
    case "PENDING":
      return "En attente";
    case "APPROVED":
      return "Approuvée";
    case "REJECTED":
      return "Rejetée";
    case "CANCELLED":
      return "Annulée";
    default:
      return status;
  }
}

function getCommissionTypeText(type) {
  switch (type) {
    case "PERCENTAGE":
      return "Pourcentage";
    case "FIXED":
      return "Fixe";
    case "HYBRID":
      return "Hybride";
    default:
      return type || "—";
  }
}

// ─── Detail row primitive ───────────────────────────────────────────────────

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
        <Icon size={15} className="text-gray-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
          {label}
        </p>
        <div className="mt-0.5 text-sm font-medium text-gray-800">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Section divider ────────────────────────────────────────────────────────

function SectionDivider() {
  return <div className="border-t border-gray-100" />;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {object | null} props.rentalRequest - the rental request data to display
 * @param {boolean} props.open - whether the modal is open
 * @param {() => void} props.onClose - callback to close the modal
 * @param {(row: object) => void} [props.onApprove] - placeholder approve handler
 * @param {(row: object) => void} [props.onReject] - placeholder reject handler
 */
export function RentalRequestDetailsModal({
  rentalRequest,
  open,
  onClose,
  onApprove,
  onReject,
}) {
  const panelRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Trap focus and handle Escape
  useEffect(() => {
    if (!open) return;

    previousActiveElement.current = document.activeElement;

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!open || !rentalRequest) return null;

  const row = rentalRequest;
  const user = row.user;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Détails de la demande de location"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="
          mx-4 flex max-h-[85vh] w-full max-w-lg flex-col
          rounded-2xl border border-gray-100 bg-white shadow-xl
          shadow-gray-900/10 animate-in fade-in-0 zoom-in-95
          duration-200
        "
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Détails de la demande
          </h2>
           {/* Status badge */}
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(
                  row.status
                )}`}
              >
                {getStatusText(row.status)}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="
                flex h-7 w-7 items-center justify-center rounded-lg
                text-gray-400 transition-colors hover:bg-gray-100
                hover:text-gray-600 focus-visible:outline
                focus-visible:outline-2 focus-visible:outline-indigo-500
                "
            >
            <X size={16} />
            </button>
             
            </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">

            {/* Applicant information */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Informations du demandeur
              </h3>
              <div className="space-y-3">
                {user && (
                  <>
                    <DetailRow icon={User} label="Nom complet">
                      {user.fullName || "—"}
                    </DetailRow>
                    <DetailRow icon={Mail} label="Email">
                      <span className="text-indigo-600">
                        {user.email || "—"}
                      </span>
                    </DetailRow>
                    <DetailRow icon={Phone} label="Téléphone">
                      {user.phone || "—"}
                    </DetailRow>
                  </>
                )}
                {!user && (
                  <p className="text-sm text-gray-400 italic">
                    Demandeur non rattaché à un compte
                  </p>
                )}
              </div>
            </div>

            <SectionDivider />

            {/* Rental details */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Détails de la location
              </h3>
              <div className="space-y-3">
                <DetailRow icon={Tag} label="Type de location">
                  {row.rentalType || "—"}
                </DetailRow>
                <DetailRow icon={Calendar} label="Date de début">
                  {formatDate(row.startDate)}
                </DetailRow>
                <DetailRow icon={Calendar} label="Rythme souhaité">
                  {row.desiredPace
                    ? { "1_day_per_week": "1 jour par semaine", "2_days_per_week": "2 jours par semaine", "3_days_per_week": "3 jours par semaine", "full_week": "Toute la semaine" }[row.desiredPace] || row.desiredPace
                    : "Non spécifié"}
                </DetailRow>
                {/* <DetailRow icon={Tag} label="Type de commission">
                  {getCommissionTypeText(row.commissionType)}
                </DetailRow> */}
              </div>
            </div>

            {/* Message */}
            {row.message && (
              <>
                <SectionDivider />
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Message
                  </h3>
                  <DetailRow icon={MessageSquare} label="Message">
                    <div className="mt-0.5 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">
                      {row.message}
                    </div>
                  </DetailRow>
                </div>
              </>
            )}

            <SectionDivider />

            {/* Metadata */}
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Informations supplémentaires
              </h3>
              <div className="space-y-3">
                <DetailRow icon={Clock} label="Date de création">
                  {formatDateTime(row.createdAt)}
                </DetailRow>
                {row.updatedAt && row.updatedAt !== row.createdAt && (
                  <DetailRow icon={Clock} label="Dernière modification">
                    {formatDateTime(row.updatedAt)}
                  </DetailRow>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer with Approve / Reject ────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={() => {
              onReject?.(row);
              onClose();
            }}
            className="
              inline-flex items-center gap-2 rounded-lg border
              border-red-200 bg-white px-4 py-2 text-sm font-medium
              text-red-600 transition-colors hover:bg-red-50
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-offset-2 focus-visible:outline-red-500
            "
          >
            <XIcon size={15} />
            Rejeter
          </button>
          <button
            type="button"
            onClick={() => {
              onApprove?.(row);
              onClose();
            }}
            className="
              inline-flex items-center gap-2 rounded-lg
              bg-[#2f3a2e] px-5 py-2 text-sm font-semibold text-white
              shadow-sm transition-all hover:bg-[#3d4e3b]
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-offset-2 focus-visible:outline-[#2f3a2e]
              active:scale-[0.98]
            "
          >
            <Check size={15} />
            Approuver
          </button>
        </div>
      </div>
    </div>
  );
}