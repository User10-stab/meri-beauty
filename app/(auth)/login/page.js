import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

export const metadata = {
  title: "Connexion | Meri Beauty",
  description: "Connectez-vous à votre espace Meri Beauty pour gérer vos rendez-vous et vos réservations.",
};

export default async function LoginPage() {

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
