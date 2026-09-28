"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import { createSalonExpense, updateSalonExpense } from "@/actions/dashboard/gestion";
import {
  SALON_EXPENSE_CATEGORIES,
  SALON_EXPENSE_CATEGORY_LABELS,
  SALON_EXPENSE_VAT_RATES,
} from "@/lib/gestion/expenses";
import { calculateVatTotals } from "@/lib/tax-policy";

function toDateInput(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}

function toMonthInput(value) {
  return toDateInput(value).slice(0, 7);
}

function todayInput() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}

// A lease is usually VAT-exempt; utilities carry the standard rate.
const DEFAULT_VAT = { RENT: 0, ELECTRICITY: 21, WATER: 6, INTERNET: 21, OTHER: 21 };

function emptyForm() {
  return {
    category: "RENT",
    label: SALON_EXPENSE_CATEGORY_LABELS.RENT,
    amountTtc: "",
    vatRate: DEFAULT_VAT.RENT,
    isRecurring: true,
    date: todayInput(),
    startMonth: todayInput().slice(0, 7),
    endMonth: "",
    note: "",
  };
}

const inputClass =
  "mt-1.5 h-9 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white";
const labelClass = "text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-dark-6";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value ?? 0);
}

/**
 * Add or edit one of the salon's running costs. A monthly charge (loyer,
 * abonnement internet…) is entered once and counts every month until its end
 * month; a one-off bill counts on its date.
 *
 * @param {{ open: boolean, expense: object|null, onClose: () => void, onSaved: () => void }} props
 */
export function SalonExpenseModal({ open, expense, onClose, onSaved }) {
  const isEditing = Boolean(expense);
  const [saving, startSaving] = useTransition();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (!expense) {
      setForm(emptyForm());
      return;
    }
    setForm({
      category: expense.category,
      label: expense.label,
      amountTtc: String(expense.amountTtc),
      vatRate: expense.vatRate,
      isRecurring: expense.isRecurring,
      date: toDateInput(expense.date),
      startMonth: toMonthInput(expense.date),
      endMonth: expense.endDate ? toMonthInput(expense.endDate) : "",
      note: expense.note ?? "",
    });
  }, [open, expense]);

  if (!open) return null;

  function set(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function changeCategory(category) {
    setForm((current) => {
      // Keep a label the user typed; replace only the default one.
      const labelIsDefault = !current.label || current.label === SALON_EXPENSE_CATEGORY_LABELS[current.category];
      return {
        ...current,
        category,
        label: labelIsDefault ? SALON_EXPENSE_CATEGORY_LABELS[category] : current.label,
        vatRate: DEFAULT_VAT[category] ?? current.vatRate,
      };
    });
  }

  const amount = Number(String(form.amountTtc).replace(",", "."));
  const preview = Number.isFinite(amount) && amount > 0 ? calculateVatTotals(amount, form.vatRate) : null;

  function handleSubmit(event) {
    event.preventDefault();
    setErrors({});
    const payload = { ...form, amountTtc: String(form.amountTtc).replace(",", "."), vatRate: Number(form.vatRate) };
    startSaving(async () => {
      const result = isEditing ? await updateSalonExpense(expense.id, payload) : await createSalonExpense(payload);
      if (result.success) {
        toast.success(result.message);
        onSaved();
      } else {
        toast.error(result.message);
        if (result.errors) setErrors(result.errors);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="salon-expense-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm print:hidden"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-dark">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="salon-expense-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {isEditing ? "Modifier la charge" : "Ajouter une charge"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="expense-category" className={labelClass}>
                Type <span className="text-red-400">*</span>
              </label>
              <select
                id="expense-category"
                value={form.category}
                onChange={(event) => changeCategory(event.target.value)}
                className={inputClass}
              >
                {SALON_EXPENSE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {SALON_EXPENSE_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
              {errors.category && <p className="mt-1 text-xs font-medium text-red-600">{errors.category}</p>}
            </div>

            <div>
              <label htmlFor="expense-label" className={labelClass}>
                Libellé <span className="text-red-400">*</span>
              </label>
              <input
                id="expense-label"
                type="text"
                value={form.label}
                maxLength={200}
                onChange={(event) => set({ label: event.target.value })}
                placeholder="Ex. Engie — facture de septembre"
                className={inputClass}
              />
              {errors.label && <p className="mt-1 text-xs font-medium text-red-600">{errors.label}</p>}
            </div>

            <div>
              <label htmlFor="expense-amount" className={labelClass}>
                Montant TTC (€) <span className="text-red-400">*</span>
              </label>
              <input
                id="expense-amount"
                type="text"
                inputMode="decimal"
                value={form.amountTtc}
                onChange={(event) => set({ amountTtc: event.target.value })}
                placeholder="0,00"
                className={inputClass}
              />
              {errors.amountTtc && <p className="mt-1 text-xs font-medium text-red-600">{errors.amountTtc}</p>}
            </div>

            <div>
              <label htmlFor="expense-vat" className={labelClass}>
                TVA
              </label>
              <select
                id="expense-vat"
                value={form.vatRate}
                onChange={(event) => set({ vatRate: Number(event.target.value) })}
                className={inputClass}
              >
                {SALON_EXPENSE_VAT_RATES.map((value) => (
                  <option key={value} value={value}>
                    {value} %
                  </option>
                ))}
              </select>
              {errors.vatRate && <p className="mt-1 text-xs font-medium text-red-600">{errors.vatRate}</p>}
            </div>
          </div>

          {preview && (
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-gray-600 dark:bg-dark-2 dark:text-dark-6">
              HT {formatEuro(preview.totalExclVat)} · TVA {formatEuro(preview.vatAmount)} · TTC{" "}
              {formatEuro(preview.totalInclVat)} — la marge est calculée sur le montant HT.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-white">
            <input
              type="checkbox"
              checked={form.isRecurring}
              onChange={(event) => set({ isRecurring: event.target.checked })}
            />
            Charge mensuelle (revient chaque mois)
          </label>

          {form.isRecurring ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="expense-start-month" className={labelClass}>
                  À partir du mois <span className="text-red-400">*</span>
                </label>
                <input
                  id="expense-start-month"
                  type="month"
                  value={form.startMonth}
                  onChange={(event) => set({ startMonth: event.target.value })}
                  className={inputClass}
                />
                {errors.startMonth && <p className="mt-1 text-xs font-medium text-red-600">{errors.startMonth}</p>}
              </div>
              <div>
                <label htmlFor="expense-end-month" className={labelClass}>
                  Jusqu&apos;au mois (optionnel)
                </label>
                <input
                  id="expense-end-month"
                  type="month"
                  value={form.endMonth}
                  min={form.startMonth || undefined}
                  onChange={(event) => set({ endMonth: event.target.value })}
                  className={inputClass}
                />
                {errors.endMonth && <p className="mt-1 text-xs font-medium text-red-600">{errors.endMonth}</p>}
                <p className="mt-1 text-xs text-gray-400">Vide = toujours en cours.</p>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="expense-date" className={labelClass}>
                Date de la facture <span className="text-red-400">*</span>
              </label>
              <input
                id="expense-date"
                type="date"
                value={form.date}
                onChange={(event) => set({ date: event.target.value })}
                className={inputClass}
              />
              {errors.date && <p className="mt-1 text-xs font-medium text-red-600">{errors.date}</p>}
            </div>
          )}

          <div>
            <label htmlFor="expense-note" className={labelClass}>
              Note
            </label>
            <textarea
              id="expense-note"
              value={form.note}
              maxLength={500}
              rows={2}
              onChange={(event) => set({ note: event.target.value })}
              className="mt-1.5 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
            {errors.note && <p className="mt-1 text-xs font-medium text-red-600">{errors.note}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#232b22] disabled:opacity-60"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {isEditing ? "Enregistrer" : "Ajouter"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
