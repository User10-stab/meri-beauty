import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMyAppointments } from "@/actions/customer/get-my-appointments";
import { MyAppointmentsPageClient } from "@/components/website/MyAppointmentsPageClient";

export const metadata = { title: "Mes rendez-vous — Meri Beauty" };

export default async function AppointmentsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const result = await getMyAppointments();
  const appointments = result.data ?? [];

  return <MyAppointmentsPageClient appointments={appointments} />;
}
