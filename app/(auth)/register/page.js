import { auth } from "@/auth";
import { redirect } from "next/navigation";
import RegisterForm from "./register-form";

export const metadata = {
  title: "Créer un compte | Meri Beauty",
  description: "Créez votre compte Meri Beauty pour gérer vos rendez-vous et vos réservations.",
};

export default async function RegisterPage() {
  const session = await auth();

  // Already authenticated — send straight to the dashboard
  if (session?.user) {
    redirect("/dashboard");
  }

  return <RegisterForm />;
}
