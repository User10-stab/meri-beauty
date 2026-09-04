"use client";

import { useState } from "react";
import { User, Mail, Phone, MessageSquare, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { checkEmailExists } from "@/actions/shared/check-email-exists";
import { ExistingAccountBanner } from "@/components/shared/ExistingAccountBanner";
import { initCustomerVerification } from "@/actions/reservation/init-customer-verification";
import { isDisposableEmail } from "@/lib/validations/customer-identity";
import { useTranslations } from "next-intl";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";
import { CountrySelect } from "@/components/shared/CountrySelect";

function Field({ label, htmlFor, required, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-[13px] font-semibold tracking-wide text-[#2F3A2E]">
        {label} {required && <span className="text-[#b89664]">*</span>}
      </label>
      {children}
    </div>
  );
}
function InputIcon({ children }) {
  return <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#9a9590]">{children}</div>;
}

export default function CustomerInfoStep({ data, updateData, nextStep }) {
  const t = useTranslations("reservationSteps");
  const [formData, setFormData] = useState(
    data.customerInfo ?? { 
      fullName: "", 
      email: "", 
      phone: "", 
      newsletterSubscribed: false,
      isCompany: false,
      vatNumber: "",
      addressLine1: "",
      addressLine2: "",
      addressCity: "",
      addressPostalCode: "",
      addressCountry: "Belgique",
    }
  );
  const [notes, setNotes] = useState(data.notes ?? "");
  const [emailStatus, setEmailStatus] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
    if (name === "email") setEmailStatus(null);
  };
  const handleEmailBlur = async () => {
    const email = formData.email.trim();
    if (!email || !email.includes("@")) return;
    setCheckingEmail(true);
    try {
      const result = await checkEmailExists(email);
      if (result.exists) setEmailStatus("exists");
    } catch {}
    finally { setCheckingEmail(false); }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName.trim()) { toast.error(t("customer.enterFullName")); return; }
    if (!formData.email.trim() || !formData.email.includes("@")) { toast.error(t("customer.enterValidEmail")); return; }
    if (isDisposableEmail(formData.email)) { toast.error(t("customer.disposableEmail")); return; }
    if (!formData.phone.trim()) { toast.error(t("customer.enterPhone")); return; }
    
    setSendingVerification(true);
    try {
      const result = await initCustomerVerification({
        fullName: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        newsletterSubscribed: formData.newsletterSubscribed,
        isCompany: formData.isCompany,
        vatNumber: formData.vatNumber?.trim() || null,
        addressLine1: formData.addressLine1?.trim() || null,
        addressLine2: formData.addressLine2?.trim() || null,
        addressCity: formData.addressCity?.trim() || null,
        addressPostalCode: formData.addressPostalCode?.trim() || null,
        addressCountry: formData.addressCountry || "Belgique",
      });
      if (result.verified) { updateData({ customerInfo: formData, notes }); nextStep(); }
      else { toast.success(result.message, { duration: 6000 }); }
    } catch (err) {
      console.error("[CustomerInfoStep] initCustomerVerification failed:", err);
      toast.error(t("customer.genericError"));
    } finally { setSendingVerification(false); }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("customer.title")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#6f6a64]">{t("customer.subtitle")}</p>
        <p className="mt-1 text-xs text-[#9a9590]">{t("customer.accountCreated")}</p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="relative space-y-5 overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)]">
          <CardBotanicalSprigs />
          <Field label={t("customer.fullName")} htmlFor="fullName" required>
            <div className="relative">
              <InputIcon><User size={16} /></InputIcon>
              <input type="text" id="fullName" name="fullName" value={formData.fullName} onChange={handleChange} placeholder={t("customer.fullNamePlaceholder")} className="w-full rounded-full border border-[#ede5d8] bg-white py-3 pl-10 pr-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none" required />
            </div>
          </Field>

          <Field label={t("customer.email")} htmlFor="email" required>
            <div className="relative">
              <InputIcon><Mail size={16} /></InputIcon>
              <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} onBlur={handleEmailBlur} placeholder={t("customer.emailPlaceholder")} className={`w-full rounded-full border bg-white py-3 pl-10 pr-10 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:outline-none focus:ring-2 ${emailStatus === "exists" ? "border-amber-300 focus:border-amber-400 focus:ring-amber-100" : "border-[#ede5d8] focus:border-[#2F3A2E] focus:ring-[#2F3A2E]/10"}`} required />
              {checkingEmail && (<div className="absolute inset-y-0 right-3 flex items-center"><div className="h-4 w-4 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" /></div>)}
            </div>
            {emailStatus === "exists" && (
              <div className="mt-3">
                <ExistingAccountBanner email={formData.email} callbackUrl="/reservation" onDismiss={() => setEmailStatus("dismissed")} />
              </div>
            )}
          </Field>

          <Field label={t("customer.phone")} htmlFor="phone" required>
            <div className="relative">
              <InputIcon><Phone size={16} /></InputIcon>
              <input type="tel" id="phone" name="phone" value={formData.phone} onChange={handleChange} placeholder={t("customer.phonePlaceholder")} className="w-full rounded-full border border-[#ede5d8] bg-white py-3 pl-10 pr-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none" required />
            </div>
          </Field>

          {/* Client Type */}
          <div>
            <label className="mb-2 block text-[13px] font-semibold tracking-wide text-[#2F3A2E]">
              Type de client
            </label>
            <div className="flex gap-3">
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-2 px-4 py-2.5 text-sm font-medium transition-all focus-within:ring-2 focus-within:ring-[#2F3A2E]/20">
                <input
                  type="radio"
                  name="isCompany"
                  value="false"
                  checked={!formData.isCompany}
                  onChange={() => setFormData(prev => ({ ...prev, isCompany: false }))}
                  className="h-4 w-4 border-[#ede5d8] text-[#2F3A2E] focus:ring-[#2F3A2E]/20"
                />
                <span className={!formData.isCompany ? "text-[#2F3A2E]" : "text-[#9a9590]"}>
                  Particulier
                </span>
              </label>
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-2 px-4 py-2.5 text-sm font-medium transition-all focus-within:ring-2 focus-within:ring-[#2F3A2E]/20">
                <input
                  type="radio"
                  name="isCompany"
                  value="true"
                  checked={formData.isCompany}
                  onChange={() => setFormData(prev => ({ ...prev, isCompany: true }))}
                  className="h-4 w-4 border-[#ede5d8] text-[#2F3A2E] focus:ring-[#2F3A2E]/20"
                />
                <span className={formData.isCompany ? "text-[#2F3A2E]" : "text-[#9a9590]"}>
                  Entreprise
                </span>
              </label>
            </div>
          </div>

          {/* VAT Number - only shown for Business */}
          {formData.isCompany && (
            <Field label="N° TVA" htmlFor="vatNumber">
              <input
                type="text"
                id="vatNumber"
                name="vatNumber"
                value={formData.vatNumber}
                onChange={handleChange}
                placeholder="BE0123456789"
                className="w-full rounded-full border border-[#ede5d8] bg-white py-3 px-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none"
              />
            </Field>
          )}

          {/* Address Section */}
          <div className="space-y-4 border-t border-[#ede5d8]/50 pt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9a9590]">
              Adresse (optionnelle)
            </p>
            
            <Field label="Rue et numéro" htmlFor="addressLine1">
              <input
                type="text"
                id="addressLine1"
                name="addressLine1"
                value={formData.addressLine1}
                onChange={handleChange}
                placeholder="Rue de la Paix 123"
                className="w-full rounded-full border border-[#ede5d8] bg-white py-3 px-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none"
              />
            </Field>

            <Field label="Complément d'adresse" htmlFor="addressLine2">
              <input
                type="text"
                id="addressLine2"
                name="addressLine2"
                value={formData.addressLine2}
                onChange={handleChange}
                placeholder="Appartement, bâtiment, etc."
                className="w-full rounded-full border border-[#ede5d8] bg-white py-3 px-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Code postal" htmlFor="addressPostalCode">
                <input
                  type="text"
                  id="addressPostalCode"
                  name="addressPostalCode"
                  value={formData.addressPostalCode}
                  onChange={handleChange}
                  placeholder="1000"
                  className="w-full rounded-full border border-[#ede5d8] bg-white py-3 px-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none"
                />
              </Field>

              <Field label="Ville" htmlFor="addressCity">
                <input
                  type="text"
                  id="addressCity"
                  name="addressCity"
                  value={formData.addressCity}
                  onChange={handleChange}
                  placeholder="Bruxelles"
                  className="w-full rounded-full border border-[#ede5d8] bg-white py-3 px-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none"
                />
              </Field>
            </div>

            <Field label="Pays" htmlFor="addressCountry">
              <CountrySelect
                id="addressCountry"
                name="addressCountry"
                value={formData.addressCountry}
                onChange={(val) => setFormData((prev) => ({ ...prev, addressCountry: val }))}
                variant="rounded"
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ede5d8]/50 bg-[#fdf8f0]/50 px-4 py-3">
            <input type="checkbox" name="newsletterSubscribed" checked={formData.newsletterSubscribed} onChange={handleChange} className="mt-0.5 h-4 w-4 rounded border-[#ede5d8] text-[#2F3A2E] focus:ring-[#2F3A2E]/20" />
            <span className="text-xs leading-relaxed text-[#6f6a64]">{t("customer.newsletter")}</span>
          </label>
        </div>

        <div className="relative overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)]">
          <CardBotanicalSprigs index={1} />
          <Field label={t("customer.notes")} htmlFor="notes">
            <div className="relative">
              <div className="pointer-events-none absolute left-3.5 top-3 text-[#9a9590]"><MessageSquare size={16} /></div>
              <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("customer.notesPlaceholder")} rows={3} className="w-full rounded-2xl border border-[#ede5d8] bg-white py-3 pl-10 pr-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none resize-none" />
            </div>
          </Field>
        </div>

        <button type="submit" disabled={sendingVerification} className={`w-full rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all ${sendingVerification ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#b89664] hover:bg-[#a38353] hover:shadow-md hover:-translate-y-px"}`}>
          {sendingVerification ? (<span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />{t("customer.sendingVerification")}</span>) : (t("customer.continueToReview"))}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-[#9a9590]">En continuant, vous acceptez nos conditions générales et notre politique de confidentialité.</p>
      </form>
    </div>
  );
}
