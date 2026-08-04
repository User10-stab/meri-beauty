import { requireDashboard } from "@/lib/route-protection";
import { isAdminRole } from "@/lib/authorization";
import { CalendarPageClient } from "@/components/dashboard/calendar/CalendarPageClient";

export const metadata = {
  title: "Calendrier — Dashboard",
  description: "Vue jour/semaine des rendez-vous, ateliers et formations.",
};

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { user } = await requireDashboard(); // OWNER/ADMIN/STAFF — getCalendarEvents() re-checks and scopes server-side

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Calendrier</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          {isAdminRole(user.role)
            ? "Rendez-vous de toute l'équipe, ateliers et formations."
            : "Vos rendez-vous."}
        </p>
      </div>

      <CalendarPageClient isAdmin={isAdminRole(user.role)} />
    </div>
  );
}
