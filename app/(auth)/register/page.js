import { auth } from "@/auth";
import { redirect } from "next/navigation";
import RegisterForm from "./register-form";

export const metadata = {
  title: "Create Account | Meri Beauty",
  description: "Sign up for a Meri Beauty account to manage your appointments and bookings.",
};

export default async function RegisterPage() {
  const session = await auth();

  // Already authenticated — send straight to the dashboard
  if (session?.user) {
    redirect("/dashboard");
  }

  return <RegisterForm />;
}
