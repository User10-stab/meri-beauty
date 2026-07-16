"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock } from "lucide-react";
import { loginSchema } from "@/lib/validations/login";
import { loginUser } from "@/actions/auth/login";
import AuthForm from "@/components/auth-form";

export default function LoginForm() {
  const router = useRouter();

  const onSubmit = async (data) => {
    const response = await loginUser(data);

    if (!response.success) {
      return response; // Return to AuthForm to display error banner
    }

    // Success response
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1000);

    return {
      success: true,
      message: "Success! Redirecting you to your dashboard...",
    };
  };

  return (
    <AuthForm
      subtitle="Sign in to manage your premium salon space"
      fields={[
        {
          name: "email",
          label: "Email Address",
          type: "email",
          placeholder: "you@example.com",
          icon: Mail,
        },
        {
          name: "password",
          label: "Password",
          type: "password",
          placeholder: "••••••••",
          icon: Lock,
        },
      ]}
      schema={loginSchema}
      onSubmit={onSubmit}
      submitText="Sign In"
      loadingText="Signing in..."
      footerText="Don't have an account?"
      footerLinkHref="/register"
      footerLinkText="Create an account"
      extraElements={({ register, isLoading }) => (
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <input
              id="rememberMe"
              type="checkbox"
              disabled={isLoading}
              {...register("rememberMe")}
              className="h-4.5 w-4.5 text-[#2F3A2E] border-zinc-300 rounded focus:ring-[#2F3A2E]/40 dark:bg-zinc-800 dark:border-zinc-700 cursor-pointer"
            />
            <label htmlFor="rememberMe" className="ml-2 block text-sm text-zinc-650 dark:text-zinc-400 select-none cursor-pointer">
              Remember me
            </label>
          </div>

          <div className="text-sm">
            <Link
              href="/forgot-password"
              className="font-semibold text-[#2F3A2E] hover:text-[#3d4d3c] dark:text-[#a8c4a2] dark:hover:text-[#c2d9bc] transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        </div>
      )}
    />
  );
}
