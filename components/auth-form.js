"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Loader2, Sparkles, AlertCircle, Check, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import LocaleSwitcher from "@/components/LocaleSwitcher";

/**
 * Reusable, configuration-driven authentication form wrapper.
 * Manages form state, client-side zod validation, visual loaders, and alerts.
 * 
 * @param {object} props
 * @param {string} props.title - Form card main title.
 * @param {string} [props.subtitle] - Optional descriptive subtitle.
 * @param {Array<{name: string, label: string, type: string, placeholder: string, icon?: React.ComponentType}>} props.fields - Inputs to generate.
 * @param {import("zod").ZodTypeAny} props.schema - Zod schema for client-side validations.
 * @param {function} props.onSubmit - Submission callback (must return `{ success: boolean, message: string }`).
 * @param {string} [props.submitText="Envoyer"] - Label of the submit button.
 * @param {string} [props.loadingText="Envoi en cours…"] - Loading text of the submit button.
 * @param {string} [props.footerText] - Bottom description string (e.g. "Don't have an account?").
 * @param {string} [props.footerLinkHref] - Bottom link target.
 * @param {string} [props.footerLinkText] - Bottom link label.
 * @param {function} [props.extraElements] - Render prop returning custom sub-fields (receives `{ register, isLoading }`).
 * @param {boolean} [props.backToSignIn=false] - If true, adds a "Retour à la connexion" backlink.
 * @param {object} [props.defaultValues] - Pre-fills form fields (e.g. email carried over from a checkout redirect).
 */
export default function AuthForm({
  title,
  subtitle,
  fields = [],
  schema,
  onSubmit,
  submitText = "Envoyer",
  loadingText = "Envoi en cours…",
  footerText,
  footerLinkHref,
  footerLinkText,
  extraElements,
  backToSignIn = false,
  defaultValues,
}) {
  const t = useTranslations("common");
  const [showPassword, setShowPassword] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [serverSuccess, setServerSuccess] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const togglePasswordVisibility = (fieldName) => {
    setShowPassword((prev) => ({
      ...prev,
      [fieldName]: !prev[fieldName],
    }));
  };

  const handleFormSubmit = async (data) => {
    setIsLoading(true);
    setServerError(null);
    setServerSuccess(null);

    try {
      const response = await onSubmit(data);

      if (!response.success) {
        setServerError(response.message);
        setIsLoading(false);
        return;
      }

      setServerSuccess(response.message);
      setIsLoading(false);
    } catch (error) {
      console.error("[AuthForm] submit error:", error);
      setServerError(t("unexpectedError"));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-radial from-[#f4f6f4] via-[#f8faf7] to-[#eef2ed] px-4 py-12 sm:px-6 lg:px-8 dark:from-[#0f1410] dark:via-[#131a12] dark:to-[#111811]">
      <div className="max-w-md w-full space-y-8 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md p-8 sm:p-10 rounded-3xl shadow-2xl border border-[#2F3A2E]/10 dark:border-[#2F3A2E]/30 transition-all duration-300">
        <div className="flex justify-end"><LocaleSwitcher /></div>
        
        {/* Header block */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#2F3A2E] text-white shadow-md">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#2F3A2E] dark:text-[#a8c4a2] font-serif">
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {subtitle}
            </p>
          )}
        </div>

        {/* Status banners */}
        {serverError && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300 text-sm animate-in fade-in slide-in-from-top-2 duration-250">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="font-medium">{serverError}</p>
          </div>
        )}

        {serverSuccess && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-300 text-sm animate-in fade-in slide-in-from-top-2 duration-250">
            <Check className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="font-medium">{serverSuccess}</p>
          </div>
        )}

        {/* Form Body */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(handleFormSubmit)}>
          <div className="space-y-4">
            {fields.map((field) => {
              const Icon = field.icon;
              const isPasswordField = field.type === "password";
              const isVisible = showPassword[field.name];

              return (
                <div key={field.name} className="space-y-1">
                  <label htmlFor={field.name} className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                    {field.label}
                  </label>
                  <div className="relative rounded-2xl shadow-sm">
                    {Icon && (
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Icon className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
                      </div>
                    )}
                    <input
                      id={field.name}
                      type={isPasswordField ? (isVisible ? "text" : "password") : field.type}
                      disabled={isLoading}
                      {...register(field.name)}
                      className={`block w-full ${Icon ? "pl-11" : "px-4"} ${isPasswordField ? "pr-12" : "pr-4"} py-3.5 bg-zinc-50/50 dark:bg-zinc-800/30 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 rounded-2xl border ${
                        errors[field.name]
                          ? "border-red-400 focus:ring-red-400/40 focus:border-red-500"
                          : "border-zinc-200/80 dark:border-zinc-700 focus:ring-[#2F3A2E]/30 focus:border-[#2F3A2E] dark:focus:ring-[#a8c4a2]/30 dark:focus:border-[#a8c4a2]"
                      } focus:outline-none focus:ring-4 transition-all duration-200`}
                      placeholder={field.placeholder}
                    />
                    {isPasswordField && (
                      <button
                        type="button"
                        onClick={() => togglePasswordVisibility(field.name)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-zinc-400 hover:text-[#2F3A2E] dark:text-zinc-500 dark:hover:text-[#a8c4a2] transition-colors"
                      >
                        {isVisible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    )}
                  </div>
                  {errors[field.name] && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium pl-1 animate-in fade-in duration-150">
                      {errors[field.name].message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Conditional elements injected from page layout */}
          {extraElements && extraElements({ register, isLoading })}

          {/* Form Submit button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-4 px-4 border border-transparent text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] focus:outline-none focus:ring-4 focus:ring-[#2F3A2E]/40 dark:focus:ring-[#a8c4a2]/30 transition-all duration-300 ease-out shadow-lg hover:shadow-[#2F3A2E]/25 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {loadingText}
                </span>
              ) : (
                submitText
              )}
            </button>
          </div>
        </form>

        {/* Footer navigations */}
        {footerText && footerLinkHref && footerLinkText && (
          <div className="text-center mt-6">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {footerText}{" "}
              <Link
                href={footerLinkHref}
                className="font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
              >
                {footerLinkText}
              </Link>
            </p>
          </div>
        )}

        {/* Back Link */}
        {backToSignIn && (
          <div className="text-center mt-6">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Retour à la connexion
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
