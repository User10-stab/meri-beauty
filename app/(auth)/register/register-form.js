"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2,
  Sparkles,
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  User,
  AtSign,
  Mail,
  Phone,
  Lock,
  KeyRound,
} from "lucide-react";
import { registerClientSchema } from "@/lib/validations/register-client";
import { registerUser } from "@/actions/auth/register";

const fields = [
  {
    name: "fullName",
    label: "Full Name",
    type: "text",
    placeholder: "Jane Doe",
    icon: User,
    autoComplete: "name",
  },
  {
    name: "nickName",
    label: "Nickname",
    type: "text",
    placeholder: "Jane (optional)",
    icon: AtSign,
    autoComplete: "nickname",
  },
  {
    name: "email",
    label: "Email Address",
    type: "email",
    placeholder: "you@example.com",
    icon: Mail,
    autoComplete: "email",
  },
  {
    name: "phone",
    label: "Phone Number",
    type: "tel",
    placeholder: "+1 234 567 8900",
    icon: Phone,
    autoComplete: "tel",
  },
  {
    name: "password",
    label: "Password",
    type: "password",
    placeholder: "••••••••",
    icon: Lock,
    autoComplete: "new-password",
  },
  {
    name: "confirmPassword",
    label: "Confirm Password",
    type: "password",
    placeholder: "••••••••",
    icon: KeyRound,
    autoComplete: "new-password",
  },
];

export default function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Preserve any callbackUrl so that after registration → email verification
  // → sign in, the user lands back on the page they came from (e.g. the
  // rental request form).
  const callbackUrl = searchParams.get("callbackUrl") || "";
  const [showPassword, setShowPassword] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [serverSuccess, setServerSuccess] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(registerClientSchema),
    defaultValues: {
      fullName: "",
      nickName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
      newsletterSubscribed: false,
    },
  });

  const togglePasswordVisibility = (fieldName) => {
    setShowPassword((prev) => ({ ...prev, [fieldName]: !prev[fieldName] }));
  };

  const onSubmit = async (data) => {
    setIsLoading(true);
    setServerError(null);
    setServerSuccess(null);

    try {
      // Strip confirmPassword — it's client-only validation, not a DB field
      const { confirmPassword: _confirm, ...serverData } = data;

      const response = await registerUser(serverData);

      if (!response.success) {
        // Surface per-field server errors back into the form
        if (response.errors) {
          Object.entries(response.errors).forEach(([field, message]) => {
            if (message) setError(field, { type: "server", message });
          });
        }
        setServerError(response.message);
        setIsLoading(false);
        return;
      }

      // Do not auto-login — user must verify email first.
      // Redirect to login with the callbackUrl preserved so that after email
      // verification → sign in, the user returns to where they started
      // (e.g. the rental request form).
      toast.success(
        "Votre compte a été créé avec succès. Un e-mail de vérification vous a été envoyé. Veuillez consulter votre boîte de réception et vérifier votre adresse e-mail avant de vous connecter.",
        { duration: 8000 }
      );
      setServerSuccess(response.message);

      // Build the login URL, carrying the callbackUrl and pre-filling the
      // email so the user doesn't have to type it again.
      const loginParams = new URLSearchParams();
      if (data.email) loginParams.set("email", data.email);
      if (callbackUrl) loginParams.set("callbackUrl", callbackUrl);
      const loginHref = `/login${loginParams.toString() ? `?${loginParams.toString()}` : ""}`;

      // Short delay so the toast is visible before navigating
      setTimeout(() => router.push(loginHref), 2000);
    } catch (err) {
      console.error("[RegisterForm] submit error:", err);
      setServerError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-radial from-[#f4f6f4] via-[#f8faf7] to-[#eef2ed] px-4 py-12 sm:px-6 lg:px-8 dark:from-[#0f1410] dark:via-[#131a12] dark:to-[#111811]">
      <div className="max-w-lg w-full space-y-8 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md p-8 sm:p-10 rounded-3xl shadow-2xl border border-[#2F3A2E]/10 dark:border-[#2F3A2E]/30 transition-all duration-300">

        {/* Header */}
        <div className="text-center space-y-3 ">
          <div className="flex items-center justify-center ">
            <div className="flex items-center justify-center w-[85px] h-[85px] bg-[#2f3a2e] rounded-full">
               <Image
                className="rounded-full "
                src="/Images/Logo.webp"
                alt="Logo"
                width={70}
                height={70}
              />
            </div>
          </div>
          
          {/* <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#2F3A2E] text-white shadow-md">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#2F3A2E] dark:text-[#a8c4a2] font-serif">
            Meri Beauty
          </h2> */}
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Create your account to get started
          </p>
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

        {/* Form */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
          {/* Two-column grid on sm+ for full name / nickname */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.slice(0, 2).map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                register={register}
                errors={errors}
                isLoading={isLoading}
                showPassword={showPassword}
                onTogglePassword={togglePasswordVisibility}
              />
            ))}
          </div>

          {/* Single-column for the rest */}
          <div className="space-y-4">
            {fields.slice(2).map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                register={register}
                errors={errors}
                isLoading={isLoading}
                showPassword={showPassword}
                onTogglePassword={togglePasswordVisibility}
              />
            ))}
          </div>

          {/* Password strength hint */}
          <p className="text-xs text-zinc-400 dark:text-zinc-500 -mt-2 pl-1">
            Password must be at least 8 characters.
          </p>

          {/* Newsletter opt-in */}
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <input
              type="checkbox"
              id="newsletterSubscribed"
              disabled={isLoading}
              {...register("newsletterSubscribed")}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 dark:border-zinc-600 text-[#2F3A2E] focus:ring-[#2F3A2E]/40 dark:focus:ring-[#a8c4a2]/30 transition-colors disabled:opacity-60 cursor-pointer"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors leading-snug">
              Je souhaite recevoir des offres exclusives et des actualités par email.
            </span>
          </label>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading || !!serverSuccess}
            className="group relative w-full flex justify-center py-4 px-4 border border-transparent text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] focus:outline-none focus:ring-4 focus:ring-[#2F3A2E]/40 dark:focus:ring-[#a8c4a2]/30 transition-all duration-300 ease-out shadow-lg hover:shadow-[#2F3A2E]/25 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Creating account...
              </span>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Already have an account?{" "}
            <Link
              href={callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"}
              className="font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Reusable field input extracted to keep the form JSX clean.
 */
function FieldInput({ field, register, errors, isLoading, showPassword, onTogglePassword }) {
  const Icon = field.icon;
  const isPasswordField = field.type === "password";
  const isVisible = showPassword[field.name];
  const hasError = !!errors[field.name];

  return (
    <div className="space-y-1">
      <label
        htmlFor={field.name}
        className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider"
      >
        {field.label}
        {field.name === "nickName" && (
          <span className="ml-1 normal-case font-normal text-zinc-400 dark:text-zinc-500">
            (optional)
          </span>
        )}
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
          autoComplete={field.autoComplete}
          disabled={isLoading}
          {...register(field.name)}
          className={`block w-full pl-11 ${isPasswordField ? "pr-12" : "pr-4"} py-3.5 bg-zinc-50/50 dark:bg-zinc-800/30 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 rounded-2xl border ${
            hasError
              ? "border-red-400 focus:ring-red-400/40 focus:border-red-500"
              : "border-zinc-200/80 dark:border-zinc-700 focus:ring-[#2F3A2E]/30 focus:border-[#2F3A2E] dark:focus:ring-[#a8c4a2]/30 dark:focus:border-[#a8c4a2]"
          } focus:outline-none focus:ring-4 transition-all duration-200 disabled:opacity-60`}
          placeholder={field.placeholder}
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={() => onTogglePassword(field.name)}
            aria-label={isVisible ? "Hide password" : "Show password"}
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
}
