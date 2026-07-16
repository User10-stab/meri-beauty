import { verifyEmail } from "@/app/actions/verify-email";
import Link from "next/link";
import { Sparkles, CheckCircle2, XCircle, ArrowRight } from "lucide-react";

export const metadata = {
  title: "Verify Email | Meri Beauty",
  description: "Confirm your email address to activate your Meri Beauty account.",
};

export default async function VerifyEmailPage({ searchParams }) {
  // Await searchParams in Next.js 15
  const params = await searchParams;
  const token = params?.token || "";

  // Trigger verification server-side on load
  const result = await verifyEmail(token);

  return (
    <div className="min-h-screen flex items-center justify-center bg-radial from-[#f4f6f4] via-[#f8faf7] to-[#eef2ed] px-4 py-12 sm:px-6 lg:px-8 dark:from-[#0f1410] dark:via-[#131a12] dark:to-[#111811]">
      <div className="max-w-md w-full space-y-6 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md p-8 sm:p-10 rounded-3xl shadow-2xl border border-[#2F3A2E]/10 dark:border-[#2F3A2E]/30 text-center animate-in fade-in duration-300">

        {/* Logo and title */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#2F3A2E] text-white shadow-md mb-2">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#2F3A2E] dark:text-[#a8c4a2] font-serif">
            Email Verification
          </h2>
        </div>

        {/* Verification Status Card */}
        {result.success ? (
          <div className="space-y-4 animate-in fade-in zoom-in-95 duration-350 delay-100">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 shadow-inner">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
              Account Verified!
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed px-4">
              {result.message}
            </p>
            <div className="pt-2">
              <Link
                href="/login"
                className="w-full inline-flex justify-center items-center gap-2 py-3.5 px-4 text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] transition-all shadow-md active:scale-[0.98]"
              >
                Sign In Now
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4 animate-in fade-in zoom-in-95 duration-350 delay-100">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 shadow-inner">
              <XCircle className="h-10 w-10" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
              Verification Failed
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed px-4">
              {result.message}
            </p>
            <div className="pt-2">
              <Link
                href="/register"
                className="w-full inline-flex justify-center items-center gap-2 py-3.5 px-4 text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] transition-all shadow-md active:scale-[0.98]"
              >
                Register New Account
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        )}

        {/* Back link */}
        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <Link
            href="/login"
            className="text-xs font-semibold text-zinc-500 hover:text-[#2F3A2E] dark:text-zinc-400 dark:hover:text-[#a8c4a2] transition-colors"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
