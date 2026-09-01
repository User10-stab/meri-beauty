import * as Icons from "../icons";
import { ROLES, DASHBOARD_PERMISSIONS, STAFF_PERMISSIONS, canAccessStaffPermission } from "@/lib/authorization";

/**
 * Complete navigation data structure
 * Each item can have a 'roles' property to restrict access
 * If no 'roles' property is specified, the item is accessible to all dashboard users
 */
const ALL_NAV_DATA = [
  {
    label: "PRINCIPAL",
    items: [
      {
        title: "Tableau de bord",
        icon: Icons.HomeIcon,
        items: [],
        url: "/dashboard",
      },
      {
        title: "Agenda & clients",
        icon: Icons.Calendar,
        items: [
          {
            title: "Calendrier",
            url: "/dashboard/calendar",
            permission: STAFF_PERMISSIONS.APPOINTMENTS,
          },
          {
            title: "Tous les rendez-vous",
            url: "/dashboard/appointments",
            permission: STAFF_PERMISSIONS.APPOINTMENTS,
          },
          {
            title: "Demandes exceptionnelles",
            url: "/dashboard/appointments/exceptions",
            roles: DASHBOARD_PERMISSIONS.APPOINTMENT_CANCELLATION_EXCEPTIONS,
          },
          { title: "Clients", url: "/dashboard/customers", permission: STAFF_PERMISSIONS.CUSTOMERS },
          { title: "Services", url: "/dashboard/services", permission: STAFF_PERMISSIONS.SERVICES },
        ],
      },
      {
        title: "Ventes & paiements",
        icon: Icons.ShoppingBagIcon,
        items: [
          { title: "Opérations", url: "/dashboard/operations", roles: [ROLES.OWNER, ROLES.ADMIN] },
          { title: "Caisse", url: "/dashboard/boutique/point-of-sale", roles: DASHBOARD_PERMISSIONS.ORDERS, permission: STAFF_PERMISSIONS.POINT_OF_SALE },
          { title: "Clôture de caisse", url: "/dashboard/boutique/caisse", roles: DASHBOARD_PERMISSIONS.ORDERS, permission: STAFF_PERMISSIONS.CASH_REGISTER },
          // Staff: read-only catalogue browsing (no cost/margin data) + stock adjustments.
          { title: "Produits", url: "/dashboard/boutique/products", roles: DASHBOARD_PERMISSIONS.BOUTIQUE_STOCK, permission: STAFF_PERMISSIONS.BOUTIQUE_STOCK },
          { title: "Catégories", url: "/dashboard/boutique/categories", roles: DASHBOARD_PERMISSIONS.BOUTIQUE }, // Admin only — structural CRUD
          { title: "Stock", url: "/dashboard/boutique/stock", roles: DASHBOARD_PERMISSIONS.BOUTIQUE_STOCK, permission: STAFF_PERMISSIONS.BOUTIQUE_STOCK },
          { title: "Commandes", url: "/dashboard/boutique/orders", roles: DASHBOARD_PERMISSIONS.ORDERS, permission: STAFF_PERMISSIONS.ORDERS },
          { title: "Retours", url: "/dashboard/boutique/returns", roles: DASHBOARD_PERMISSIONS.ORDERS, permission: STAFF_PERMISSIONS.RETURNS },
          { title: "Codes promo", url: "/dashboard/promo-codes", roles: DASHBOARD_PERMISSIONS.PROMO_CODES },
          { title: "Compte Stripe", url: "/dashboard/payments" },
          { title: "Réconciliation", url: "/dashboard/payments/reconciliation", roles: DASHBOARD_PERMISSIONS.PAYMENT_RECONCILIATION },
          { title: "Litiges Stripe", url: "/dashboard/payments/disputes", roles: DASHBOARD_PERMISSIONS.STRIPE_DISPUTES },
        ],
      },
      {
        title: "Activités & formations",
        icon: Icons.Calendar,
        items: [
          { title: "Activités", url: "/dashboard/workshops/activities", roles: DASHBOARD_PERMISSIONS.WORKSHOPS, permission: STAFF_PERMISSIONS.WORKSHOPS },
          { title: "Animateurs", url: "/dashboard/workshops/animators", roles: DASHBOARD_PERMISSIONS.WORKSHOPS, permission: STAFF_PERMISSIONS.WORKSHOPS },
          { title: "Réservations ateliers", url: "/dashboard/workshops/reservations", roles: DASHBOARD_PERMISSIONS.WORKSHOP_RESERVATIONS, permission: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS },
          { title: "Liste d'attente", url: "/dashboard/workshops/waiting-list", roles: DASHBOARD_PERMISSIONS.WORKSHOP_RESERVATIONS, permission: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS },
          // Shared queue for atelier AND formation cancellation requests.
          { title: "Demandes d'annulation", url: "/dashboard/reservations/exceptions", roles: DASHBOARD_PERMISSIONS.APPOINTMENT_CANCELLATION_EXCEPTIONS },
          { title: "Formations", url: "/dashboard/formations", roles: DASHBOARD_PERMISSIONS.FORMATIONS, permission: STAFF_PERMISSIONS.FORMATIONS },
          { title: "Réservations formations", url: "/dashboard/formations/reservations", roles: DASHBOARD_PERMISSIONS.FORMATION_RESERVATIONS, permission: STAFF_PERMISSIONS.FORMATION_RESERVATIONS },
        ],
      },
      {
        title: "Équipe & administration",
        icon: Icons.User,
        items: [
          { title: "Performance", url: "/dashboard/staff/performance", roles: DASHBOARD_PERMISSIONS.STAFF_MANAGEMENT },
          { title: "Auto-Entrepreneur", url: "/dashboard/staff/auto-entrepreneur", roles: DASHBOARD_PERMISSIONS.STAFF_MANAGEMENT },
          { title: "Newsletter", url: "/dashboard/newsletter", roles: DASHBOARD_PERMISSIONS.NEWSLETTER, permission: STAFF_PERMISSIONS.NEWSLETTER },
          { title: "Demandes de location", url: "/dashboard/rental-requests", roles: DASHBOARD_PERMISSIONS.RENTAL_REQUESTS },
          { title: "Avis clients", url: "/dashboard/reviews", roles: DASHBOARD_PERMISSIONS.REVIEWS },
          { title: "Rapports", url: "/dashboard/reports", roles: DASHBOARD_PERMISSIONS.REPORTS },
        ],
      },
    ],
  },

];

/**
 * Filter navigation items based on user role
 * @param {string} userRole - The role of the current user
 * @returns {Array} Filtered navigation data
 */
export function getNavDataForRole(userRole, grantedPermissions = []) {
  if (!userRole) return [];

  const canSee = (item) => {
    if (item.roles && !item.roles.includes(userRole)) return false;
    if (item.permission && !canAccessStaffPermission(userRole, grantedPermissions, item.permission)) return false;
    return true;
  };

  return ALL_NAV_DATA.map((section) => ({
    ...section,
    items: section.items
      .map((item) => {
        if (item.items && item.items.length > 0) {
          return {
            ...item,
            items: item.items.filter(canSee),
          };
        }
        return item;
      })
      .filter((item) => canSee(item) && (item.url || item.items.length > 0)),
  })).filter((section) => section.items.length > 0); // Remove empty sections
}

/**
 * Legacy export for backward compatibility
 * This should be replaced with getNavDataForRole in components
 * @deprecated Use getNavDataForRole instead
 */
export const NAV_DATA = ALL_NAV_DATA;
