import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";

export const metadata = {
  title: "Sign In | Meri Beauty",
  description: "Access your dashboard to manage appointments, staff, and customer bookings.",
};

export default async function LoginPage() {

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
