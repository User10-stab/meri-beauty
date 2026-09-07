"use client";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Loader2, X, User, Mail, Phone, MapPin } from "lucide-react";
import { updateCustomer } from "@/actions/customers/update-customer";
import { setCustomerVatNumberManually } from "@/actions/customers/set-customer-vat-number";
import { CountrySelect } from "@/components/shared/CountrySelect";
import countriesData from "@/data/countries.json";

const CODE_TO_NAME = new Map(countriesData.map((c) => [c.code.toUpperCase(), c.name]));
const NAME_TO_CODE = new Map(countriesData.map((c) => [c.name.toLowerCase(), c.code.toUpperCase()]));

function countryCodeToName(code) {
  if (!code) return "";
  const trimmed = String(code).trim();
  if (trimmed.length === 2) {
    return CODE_TO_NAME.get(trimmed.toUpperCase()) ?? trimmed;
  }
  // Already a name (legacy mixed storage)
  if (NAME_TO_CODE.has(trimmed.toLowerCase())) return trimmed;
  // Try code lookup as fallback
  return CODE_TO_NAME.get(trimmed.toUpperCase()) ?? trimmed;
}

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function Label({ htmlFor, icon: Icon, children, required }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-600">
      {Icon && <Icon size={12} className="text-gray-400" />}
      {children}
      {required && <span className="text-red-400">*</span>}
    </label>
  );
}

function TextInput({ id, error, ...props }) {
  return (
    <input
      id={id}
      className={`h-9 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 ${
        error ? "border-red-300 focus:border-red-400 focus:ring-red-100" : "border-gray-200 focus:border-[#2f3a2e] focus:ring-[#2f3a2e]/10 focus:border-[#2f3a2e]"
      }`}
      {...props}
    />
  );
}

/**
 * @param {{ customer: object|null, onClose: () => void, onSaved: () => void }} props
 */
export function CustomerEditModal({ customer, onClose, onSaved }) {
  const [fullName, setFullName] = useState("");
  const [nickName, setNickName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressPostalCode, setAddressPostalCode] = useState("");
  const [addressCountry, setAddressCountry] = useState("Belgique");
  const [isActive, setIsActive] = useState(true);
  const [vatNumber, setVatNumber] = useState("");
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (customer) {
      setFullName(customer.fullName ?? "");
      setNickName(customer.nickName ?? "");
      setEmail(customer.email ?? "");
      setPhone(customer.phone ?? "");
      setAddressLine1(customer.addressLine1 ?? "");
      setAddressLine2(customer.addressLine2 ?? "");
      setAddressCity(customer.addressCity ?? "");
      setAddressPostalCode(customer.addressPostalCode ?? "");
      setAddressCountry(countryCodeToName(customer.addressCountry ?? "BE"));
      setIsActive(customer.isActive ?? true);
      setVatNumber(customer.vatNumber ?? "");
      setErrors({});
    }
  }, [customer]);

  // Close on Escape
  useEffect(() => {
    if (!customer) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [customer, onClose]);

  useEffect(() => {
    if (customer) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [customer]);

  if (!customer) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);

    const payload = {
      id: customer.id,
      fullName,
      nickName,
      email,
      phone,
      isActive,
      addressLine1,
      addressLine2,
      addressCity,
      addressPostalCode,
      addressCountry,
    };

    const result = await updateCustomer(payload);

    // Separate VAT path — only touch it if the value actually changed
    let vatResult = { success: true, message: null };
    if (String(vatNumber).trim() !== String(customer.vatNumber ?? "").trim()) {
      vatResult = await setCustomerVatNumberManually(customer.id, vatNumber);
    }

    setIsSaving(false);

    if (result.success && vatResult.success) {
      toast.success(vatResult.message ?? result.message);
      setErrors({});
      onSaved();
      return;
    }

    // Surface validation errors inline; keep modal open so the user can fix them
    if (!result.success && result.errors) {
      setErrors(result.errors);
    }
    // Include VAT error inline as well if present
    if (!vatResult.success) {
      setErrors((prev) => ({ ...prev, vatNumber: vatResult.message }));
    }

    const msg = !result.success ? result.message : vatResult.message;
    toast.error(msg ?? "Veuillez corriger les erreurs.");
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-customer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#2f3a2e] text-sm font-bold text-white uppercase select-none">
              {(fullName || customer.fullName || "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 id="edit-customer-title" className="text-base font-semibold text-gray-900 leading-tight truncate">
                Modifier le client
              </h2>
              <p className="text-xs text-gray-400 truncate">{customer.email}</p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Identité */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50">
                  <User size={13} className="text-indigo-600" />
                </div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Identité</h4>
                <div className="flex-1 border-t border-gray-100" />
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="editFullName" icon={User} required>Nom complet</Label>
                  <TextInput id="editFullName" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Marie Dupont" error={errors.fullName} />
                  <FieldError message={errors.fullName} />
                </div>
                <div>
                  <Label htmlFor="editNickName" icon={User}>Surnom</Label>
                  <TextInput id="editNickName" type="text" value={nickName} onChange={(e) => setNickName(e.target.value)} placeholder="Marie (optionnel)" error={errors.nickName} />
                  <FieldError message={errors.nickName} />
                </div>
              </div>
            </div>

            {/* Contact */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50">
                  <Mail size={13} className="text-indigo-600" />
                </div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Contact</h4>
                <div className="flex-1 border-t border-gray-100" />
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="editEmail" icon={Mail} required>Email</Label>
                  <TextInput id="editEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="marie@example.com" error={errors.email} />
                  <FieldError message={errors.email} />
                </div>
                <div>
                  <Label htmlFor="editPhone" icon={Phone} required>Téléphone</Label>
                  <TextInput id="editPhone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+32 470 12 34 56" error={errors.phone} />
                  <FieldError message={errors.phone} />
                </div>
              </div>
            </div>

            {/* Adresse */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50">
                  <MapPin size={13} className="text-indigo-600" />
                </div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Adresse de facturation</h4>
                <div className="flex-1 border-t border-gray-100" />
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="editAddressLine1" icon={MapPin} required>Rue et numéro</Label>
                  <TextInput id="editAddressLine1" type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} required placeholder="Rue de la Paix 12" error={errors.addressLine1} />
                  <FieldError message={errors.addressLine1} />
                </div>
                <div>
                  <Label htmlFor="editAddressLine2" icon={MapPin}>Complément</Label>
                  <TextInput id="editAddressLine2" type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Boîte, étage (optionnel)" error={errors.addressLine2} />
                  <FieldError message={errors.addressLine2} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="editPostalCode" required>Code postal</Label>
                    <TextInput id="editPostalCode" type="text" value={addressPostalCode} onChange={(e) => setAddressPostalCode(e.target.value)} required placeholder="1000" error={errors.addressPostalCode} />
                    <FieldError message={errors.addressPostalCode} />
                  </div>
                  <div>
                    <Label htmlFor="editCity" required>Ville</Label>
                    <TextInput id="editCity" type="text" value={addressCity} onChange={(e) => setAddressCity(e.target.value)} required placeholder="Bruxelles" error={errors.addressCity} />
                    <FieldError message={errors.addressCity} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="editCountry" required>Pays</Label>
                  <CountrySelect
                    id="editCountry"
                    value={addressCountry}
                    onChange={setAddressCountry}
                    error={Boolean(errors.addressCountry)}
                    variant="default"
                  />
                  <FieldError message={errors.addressCountry} />
                </div>
              </div>
            </div>

            {/* Statut + TVA */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50">
                  <User size={13} className="text-indigo-600" />
                </div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Compte</h4>
                <div className="flex-1 border-t border-gray-100" />
              </div>
              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Compte actif</p>
                    <p className="text-xs text-gray-400">Un compte inactif ne peut plus se connecter.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    onClick={() => setIsActive((v) => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${isActive ? "bg-[#2f3a2e]" : "bg-gray-300"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isActive ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </label>

                <div>
                  <Label htmlFor="editVatNumber">Numéro de TVA (B2B)</Label>
                  <TextInput id="editVatNumber" type="text" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="BE0123456789 ou FRXX123456789" error={errors.vatNumber} />
                  <FieldError message={errors.vatNumber} />
                  <p className="mt-1.5 text-xs text-gray-400">Vérifié auprès de VIES lors de l’enregistrement.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3d4e3b] disabled:opacity-50"
            >
              {isSaving && <Loader2 size={14} className="animate-spin" />}
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
