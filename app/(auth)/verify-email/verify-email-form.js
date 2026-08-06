"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Mail, Loader2, Sparkles, AlertCircle, Check, ArrowLeft, RefreshCcw } from "lucide-react";
import { resendVerificationSchema } from "@/lib/validations/resend-verification";
import { resendVerificationEmail } from "@/actions/auth/verify-email";

export default function VerifyEmailForm({ success, message }) {
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [serverSuccess, setServerSuccess] = useState(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: {
      email: "",
    },
  });

  if (success && message) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-radial from-[#f4f6f4] via-[#f8faf7] to-[#eef2ed] px-4 py-12 sm:px-6 lg:px-8 dark:from-[#0f1410] dark:via-[#131a12] dark:to-[#111811]">
        <div className="max-w-md w-full space-y-8 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md p-8 sm:p-10 rounded-3xl shadow-2xl border border-[#2F3A2E]/10 dark:border-[#2F3A2E]/30 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
            <Check className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold text-[#2F3A2E] dark:text-[#a8c4a2] font-serif">
            Email Verified
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {message}
          </p>
          <div className="pt-2">
            <Link
              href="/login"
              className="w-full inline-flex justify-center items-center gap-2 py-3.5 px-4 text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] transition-all shadow-md active:scale-[0.98]"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Define onSubmit before any early-return blocks so it's always initialized
  // when referenced via handleSubmit(onSubmit).
  const onSubmit = async (data) => {
    setIsLoading(true);
    setServerError(null);
    setServerSuccess(null);

    try {
      const response = await resendVerificationEmail(data);

      if (!response.success) {
        if (response.errors) {
          Object.entries(response.errors).forEach(([field, message]) => {
            if (message) {
              setServerError(message);
            }
          });
        }
        setServerError(response.message);
        setIsLoading(false);
        return;
      }

      setServerSuccess(response.message);
      reset();
      setIsLoading(false);
    } catch (error) {
      console.error("[resendVerificationEmail] submit error:", error);
      setServerError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  if (!success && message) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-radial from-[#f4f6f4] via-[#f8faf7] to-[#eef2ed] px-4 py-12 sm:px-6 lg:px-8 dark:from-[#0f1410] dark:via-[#131a12] dark:to-[#111811]">
        <div className="max-w-md w-full space-y-8 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md p-8 sm:p-10 rounded-3xl shadow-2xl border border-[#2F3A2E]/10 dark:border-[#2F3A2E]/30">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold text-[#2F3A2E] dark:text-[#a8c4a2] font-serif">
              Verification Failed
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {message}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <div className="space-y-1">
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider"
                >
                  Email Address
                </label>
                <div className="relative rounded-2xl shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    disabled={isLoading}
                    {...register("email")}
                    className={`block w-full pl-11 pr-4 py-3.5 bg-zinc-50/50 dark:bg-zinc-800/30 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 rounded-2xl border ${
                      errors.email
                        ? "border-red-400 focus:ring-red-400/40 focus:border-red-500"
                        : "border-zinc-200/80 dark:border-zinc-700 focus:ring-[#2F3A2E]/30 focus:border-[#2F3A2E] dark:focus:ring-[#a8c4a2]/30 dark:focus:border-[#a8c4a2]"
                    } focus:outline-none focus:ring-4 transition-all duration-200`}
                    placeholder="you@example.com"
                  />
                </div>
                {errors.email && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium pl-1 animate-in fade-in duration-150">
                    {errors.email.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-4 px-4 border border-transparent text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] focus:outline-none focus:ring-4 focus:ring-[#2F3A2E]/40 dark:focus:ring-[#a8c4a2]/30 transition-all duration-300 ease-out shadow-lg hover:shadow-[#2F3A2E]/25 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Sending...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCcw className="h-4 w-4" />
                    Resend Verification Email
                  </span>
                )}
              </button>
            </div>
          </form>

          <div className="text-center mt-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-radial from-[#f4f6f4] via-[#f8faf7] to-[#eef2ed] px-4 py-12 sm:px-6 lg:px-8 dark:from-[#0f1410] dark:via-[#131a12] dark:to-[#111811]">
      <div className="max-w-md w-full space-y-8 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md p-8 sm:p-10 rounded-3xl shadow-2xl border border-[#2F3A2E]/10 dark:border-[#2F3A2E]/30">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#2F3A2E] text-white shadow-md">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#2F3A2E] dark:text-[#a8c4a2] font-serif">
            Verify Your Email
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Enter your email to resend the verification link
          </p>
        </div>

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

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider"
              >
                Email Address
              </label>
              <div className="relative rounded-2xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
                </div>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  disabled={isLoading}
                  {...register("email")}
                  className={`block w-full pl-11 pr-4 py-3.5 bg-zinc-50/50 dark:bg-zinc-800/30 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 rounded-2xl border ${
                    errors.email
                      ? "border-red-400 focus:ring-red-400/40 focus:border-red-500"
                      : "border-zinc-200/80 dark:border-zinc-700 focus:ring-[#2F3A2E]/30 focus:border-[#2F3A2E] dark:focus:ring-[#a8c4a2]/30 dark:focus:border-[#a8c4a2]"
                  } focus:outline-none focus:ring-4 transition-all duration-200`}
                  placeholder="you@example.com"
                />
              </div>
              {errors.email && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium pl-1 animate-in fade-in duration-150">
                  {errors.email.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-4 px-4 border border-transparent text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] focus:outline-none focus:ring-4 focus:ring-[#2F3A2E]/40 dark:focus:ring-[#a8c4a2]/30 transition-all duration-300 ease-out shadow-lg hover:shadow-[#2F3A2E]/25 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Sending...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <RefreshCcw className="h-4 w-4" />
                  Resend Verification Email
                </span>
              )}
            </button>
          </div>
        </form>

        <div className="text-center mt-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
