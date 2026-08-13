import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

export const metadata = {
  title: "Connexion | Meri Beauty",
  description: "Connectez-vous à votre espace Meri Beauty pour gérer vos rendez-vous et vos réservations.",
};

// The register-link href is derived from the callbackUrl query param
// (see login-form.js) — without forcing dynamic rendering, Next.js
// statically prerenders this page with no callbackUrl known, then the
// client re-derives it from the real URL after hydration, producing a
// server/client HTML mismatch (React warns, keeps the client value).
export const dynamic = "force-dynamic";

export default async function LoginPage() {

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
