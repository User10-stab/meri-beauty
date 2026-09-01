"use client";

import { useState } from "react";
import { User, Mail, Phone, MessageSquare, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { checkEmailExists } from "@/actions/shared/check-email-exists";
import { ExistingAccountBanner } from "@/components/shared/ExistingAccountBanner";
import { initCustomerVerification } from "@/actions/reservation/init-customer-verification";
import { isDisposableEmail } from "@/lib/validations/customer-identity";
import { useTranslations } from "next-intl";

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
    data.customerInfo ?? { fullName: "", email: "", phone: "", newsletterSubscribed: false }
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
        <div className="rounded-[1.4rem] border border-[#ede5d8]/70 bg-white p-6 shadow-sm space-y-5">
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

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#ede5d8]/50 bg-[#fdf8f0]/50 px-4 py-3">
            <input type="checkbox" name="newsletterSubscribed" checked={formData.newsletterSubscribed} onChange={handleChange} className="mt-0.5 h-4 w-4 rounded border-[#ede5d8] text-[#2F3A2E] focus:ring-[#2F3A2E]/20" />
            <span className="text-xs leading-relaxed text-[#6f6a64]">{t("customer.newsletter")}</span>
          </label>
        </div>

        <div className="rounded-[1.4rem] border border-[#ede5d8]/70 bg-white p-6 shadow-sm">
          <Field label={t("customer.notes")} htmlFor="notes">
            <div className="relative">
              <div className="pointer-events-none absolute left-3.5 top-3 text-[#9a9590]"><MessageSquare size={16} /></div>
              <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("customer.notesPlaceholder")} rows={3} className="w-full rounded-2xl border border-[#ede5d8] bg-white py-3 pl-10 pr-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10 focus:outline-none resize-none" />
            </div>
          </Field>
        </div>

        <button type="submit" disabled={sendingVerification} className={`w-full rounded-full px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all ${sendingVerification ? "cursor-not-allowed bg-[#2F3A2E]/60" : "bg-[#2F3A2E] hover:bg-[#212a20] hover:shadow-md hover:-translate-y-px"}`}>
          {sendingVerification ? (<span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />{t("customer.sendingVerification")}</span>) : (t("customer.continueToReview"))}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-[#9a9590]">En continuant, vous acceptez nos conditions générales et notre politique de confidentialité.</p>
      </form>
    </div>
  );
}
