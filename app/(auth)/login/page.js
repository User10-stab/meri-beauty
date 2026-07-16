import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

export const metadata = {
  title: "Sign In | Meri Beauty",
  description: "Access your dashboard to manage appointments, staff, and customer bookings.",
};

export default async function LoginPage() {
  const session = await auth();

  // If already authenticated, redirect directly to /dashboard
  if (session?.user) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
