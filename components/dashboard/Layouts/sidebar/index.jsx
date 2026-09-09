"use client";

import { Logo } from "@/components/dashboard/logo";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getNavDataForRole } from "./data";
import { ArrowLeftIcon, ChevronUp } from "./icons";
import { MenuItem } from "./menu-item";
import { useSidebarContext } from "./sidebar-context";
import { useTranslations } from "next-intl";

/**
 * A count of things waiting on a human, shown against the nav item that leads
 * to them. Rendered only when there is something to show — a nav full of
 * zeroes teaches people to stop reading the badges.
 */
function NavBadge({ count, label: describedAs }) {
  if (!count) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-[1.375rem] items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
      aria-label={describedAs ? `${count} ${describedAs}` : undefined}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Sidebar({ userRole, dashboardPermissions = [], pickupsToVerifyCount = 0 }) {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const { setIsOpen, isOpen, isMobile, toggleSidebar } = useSidebarContext();
  const [expandedItems, setExpandedItems] = useState([]);

  // Get navigation data filtered by user role
  const NAV_DATA = getNavDataForRole(userRole, dashboardPermissions);
  const titleKeys = {
    "Tableau de bord": "dashboard", "Rendez-vous": "appointments", "Calendrier": "calendar",
    "Tous les rendez-vous": "allAppointments", "Clients": "customers", "Services": "services",
    "Paiements": "payments", "Compte Stripe": "stripe",
    "Workshops & Événements": "workshops", "Activités": "activities", "Animateurs": "animators",
    "Réservations": "reservations", "Liste d'attente": "waitingList", "Formations": "courses", "Staff": "staff",
    "Performance": "performance", "Auto-Entrepreneur": "independentStaff", "Boutique": "shop", "Produits": "products",
    "Catégories": "categories", "Stock": "stock", "Commandes": "orders", "Retours": "returns", "Factures": "invoices",
    "Codes promo": "promoCodes", "Newsletter": "newsletter", "Demandes de location": "rentalRequests",
    "Avis clients": "reviews", "Rapports": "reports"
  };
  const label = (value) => titleKeys[value] ? t(`sidebar.${titleKeys[value]}`) : value;

  // Nav items name a badge rather than carrying a number, so the data file
  // stays a plain static structure and the counts stay server-supplied.
  const badgeCounts = { pickupsToVerify: pickupsToVerifyCount };
  const badgeFor = (item) => (item.badge ? badgeCounts[item.badge] ?? 0 : 0);
  // A collapsed group hides its children, so it carries their total. Without
  // this the badge is only visible to someone who already opened the section
  // it is meant to send them to.
  const groupBadgeFor = (item) => (item.items ?? []).reduce((total, sub) => total + badgeFor(sub), 0);

  const toggleExpanded = (title) => {
    setExpandedItems((prev) => (prev.includes(title) ? [] : [title]));

    // Uncomment the following line to enable multiple expanded items
    // setExpandedItems((prev) =>
    //   prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    // );
  };

  useEffect(() => {
    // Auto-expand the group containing the active page. Deliberately keyed
    // only on pathname/userRole — NOT expandedItems — so this only fires on
    // actual navigation. Depending on expandedItems here used to fight any
    // manual click on a sibling group: while sitting on a Boutique subpage,
    // opening Formations or Workshops would set expandedItems, re-trigger
    // this effect, and since pathname still matched Boutique it would
    // immediately snap Boutique back open, collapsing the group the user
    // just tried to switch to.
    for (const section of NAV_DATA) {
      const activeItem = section.items.find((item) =>
        item.items.some((subItem) => subItem.url === pathname),
      );
      if (activeItem) {
        setExpandedItems([activeItem.title]);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, userRole, dashboardPermissions]);

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "max-w-[290px] overflow-hidden border-r border-gray-200 bg-white transition-width duration-200 ease-linear dark:border-gray-800 dark:bg-gray-dark",
          isMobile ? "fixed bottom-0 top-0 z-50" : "sticky top-0 z-30 h-screen",
          isOpen ? "w-full" : "w-0",
        )}
        aria-label="Main navigation"
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div className="flex h-full flex-col py-10 pl-[25px] pr-[7px]">
          <div className="relative pr-4.5">
            <Link
              href={"/"}
              onClick={() => isMobile && toggleSidebar()}
              className="px-0 py-2.5 min-[850px]:py-0"
            >
              <Logo />
            </Link>

            {isMobile && (
              <button
                onClick={toggleSidebar}
                className="absolute left-3/4 right-4.5 top-1/2 -translate-y-1/2 text-right"
              >
                <span className="sr-only">Close Menu</span>

                <ArrowLeftIcon className="ml-auto size-7" />
              </button>
            )}
          </div>

          {/* Navigation */}
          <div className="custom-scrollbar mt-6 flex-1 overflow-y-auto pr-3 min-[850px]:mt-10">
            {NAV_DATA.map((section) => (
              <div key={section.label} className="mb-6">
                <h2 className="mb-5 text-sm font-medium text-dark-4 dark:text-dark-6">
                  {section.label === "PRINCIPAL" ? t("main") : section.label}
                </h2>

                <nav role="navigation" aria-label={section.label}>
                  <ul className="space-y-2">
                    {section.items.map((item) => {
                      const isExpanded = expandedItems.includes(item.title);
                      // Rolled up onto the closed group only: when it is open
                      // the child below carries its own, and showing both
                      // reads as two separate things needing attention.
                      const groupCount = isExpanded ? 0 : groupBadgeFor(item);

                      return (
                      <li key={item.title}>
                        {item.items.length ? (
                          <div>
                            <MenuItem
                              isActive={item.items.some(
                                ({ url }) => url === pathname,
                              )}
                              onClick={() => toggleExpanded(item.title)}
                            >
                              <item.icon
                                className="size-6 shrink-0"
                                aria-hidden="true"
                              />

                              <span>{label(item.title)}</span>

                              <NavBadge
                                count={groupCount}
                                label={t("sidebar.pickupsToVerifyBadge")}
                              />

                              <ChevronUp
                                className={cn(
                                  "rotate-180 transition-transform duration-200",
                                  groupCount ? "ml-1.5" : "ml-auto",
                                  isExpanded && "rotate-0",
                                )}
                                aria-hidden="true"
                              />
                            </MenuItem>

                            {isExpanded && (
                              <ul
                                className="ml-9 mr-0 space-y-1.5 pb-[15px] pr-0 pt-2"
                                role="menu"
                              >
                                {item.items.map((subItem) => (
                                  <li key={subItem.title} role="none">
                                    <MenuItem
                                      as="link"
                                      href={subItem.url}
                                      isActive={pathname === subItem.url}
                                      className="flex items-center gap-3"
                                    >
                                      <span>{label(subItem.title)}</span>
                                      <NavBadge
                                        count={badgeFor(subItem)}
                                        label={t("sidebar.pickupsToVerifyBadge")}
                                      />
                                    </MenuItem>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : (
                          (() => {
                            const href =
                              "url" in item
                                ? item.url + ""
                                : "/" +
                                  item.title.toLowerCase().split(" ").join("-");

                            return (
                              <MenuItem
                                className="flex items-center gap-3 py-3"
                                as="link"
                                href={href}
                                isActive={pathname === href}
                              >
                                <item.icon
                                  className="size-6 shrink-0"
                                  aria-hidden="true"
                                />

                                <span>{label(item.title)}</span>
                                <NavBadge
                                  count={badgeFor(item)}
                                  label={t("sidebar.pickupsToVerifyBadge")}
                                />
                              </MenuItem>
                            );
                          })()
                        )}
                      </li>
                      );
                    })}
                  </ul>
                </nav>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
