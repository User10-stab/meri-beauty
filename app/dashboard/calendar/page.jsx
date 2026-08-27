import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  // Redirect to the new dashboard calendar route
  redirect("/dashboard/calendrier");
}

