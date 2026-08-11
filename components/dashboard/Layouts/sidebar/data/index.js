import * as Icons from "../icons";
import { ROLES, DASHBOARD_PERMISSIONS } from "@/lib/authorization";

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
        title: "Rendez-vous",
        icon: Icons.Calendar,
        items: [
          {
            title: "Calendrier",
            url: "/dashboard/calendar",
          },
          {
            title: "Tous les rendez-vous",
            url: "/dashboard/appointments",
          },
        ],
      },
      {
        title: "Clients",
        icon: Icons.User,
        url: "/dashboard/customers",
        items: [],
      },
      {
        title: "Services",
        icon: Icons.User,
        url: "/dashboard/services",
        items: [],
      },
      {
        title: "Paiements",
        icon: Icons.CreditCardIcon,
        items: [
          { title: "Compte Stripe", url: "/dashboard/payments" },
          { title: "Réconciliation", url: "/dashboard/payments/reconciliation", roles: DASHBOARD_PERMISSIONS.PAYMENT_RECONCILIATION },
        ],
      },
      {
        title: "Workshops & Événements",
        icon: Icons.Calendar,
        items: [
          { title: "Activités", url: "/dashboard/workshops/activities", roles: DASHBOARD_PERMISSIONS.WORKSHOPS },
          { title: "Animateurs", url: "/dashboard/workshops/animators", roles: DASHBOARD_PERMISSIONS.WORKSHOPS },
          { title: "Réservations", url: "/dashboard/workshops/reservations", roles: DASHBOARD_PERMISSIONS.WORKSHOP_RESERVATIONS },
          { title: "Liste d'attente", url: "/dashboard/workshops/waiting-list", roles: DASHBOARD_PERMISSIONS.WORKSHOP_RESERVATIONS },
        ],
        roles: DASHBOARD_PERMISSIONS.WORKSHOPS,
      },
      {
        title: "Formations",
        icon: Icons.Calendar,
        items: [
          { title: "Formations", url: "/dashboard/formations", roles: DASHBOARD_PERMISSIONS.FORMATIONS },
          { title: "Réservations", url: "/dashboard/formations/reservations", roles: DASHBOARD_PERMISSIONS.FORMATION_RESERVATIONS },
        ],
        roles: DASHBOARD_PERMISSIONS.FORMATIONS,
      },
      {
        title: "Staff",
        icon: Icons.User,
        items: [
          {
            title: "Performance",
            url: "/dashboard/staff/performance",
          },
          {
            title: "Auto-Entrepreneur",
            url: "/dashboard/staff/auto-entrepreneur",
          },
        ],
        roles: DASHBOARD_PERMISSIONS.STAFF_MANAGEMENT, // Admin only
      },
      {
        title: "Boutique",
        icon: Icons.ShoppingBagIcon,
        items: [
          // Staff: read-only catalogue browsing (no cost/margin data) + stock adjustments.
          { title: "Produits", url: "/dashboard/boutique/products", roles: DASHBOARD_PERMISSIONS.BOUTIQUE_STOCK },
          { title: "Catégories", url: "/dashboard/boutique/categories", roles: DASHBOARD_PERMISSIONS.BOUTIQUE }, // Admin only — structural CRUD
          { title: "Stock", url: "/dashboard/boutique/stock", roles: DASHBOARD_PERMISSIONS.BOUTIQUE_STOCK },
        ],
        roles: DASHBOARD_PERMISSIONS.BOUTIQUE_STOCK, // Group visible to admin + staff; sub-items filtered individually above
      },
      {
        title: "Commandes",
        icon: Icons.PackageIcon,
        url: "/dashboard/boutique/orders",
        items: [],
        roles: DASHBOARD_PERMISSIONS.ORDERS, // Admin + staff — day-to-day counter work
      },
      {
        title: "Retours",
        icon: Icons.ReceiptIcon,
        url: "/dashboard/boutique/returns",
        items: [],
        roles: DASHBOARD_PERMISSIONS.ORDERS, // Same counter-work access as Commandes
      },
      {
        title: "Factures",
        icon: Icons.ReceiptIcon,
        url: "/dashboard/invoices",
        items: [],
        roles: DASHBOARD_PERMISSIONS.INVOICES, // Admin only
      },
      {
        title: "Codes promo",
        icon: Icons.ReceiptIcon,
        url: "/dashboard/promo-codes",
        items: [],
        roles: DASHBOARD_PERMISSIONS.PROMO_CODES, // Admin only
      },
      {
        title: "Newsletter",
        icon: Icons.MailIcon,
        url: "/dashboard/newsletter",
        items: [],
        roles: DASHBOARD_PERMISSIONS.NEWSLETTER, // Admin only
      },
      {
        title: "Demandes de location",
        url: "/dashboard/rental-requests",
        icon: Icons.Calendar,
        items: [],
        roles: DASHBOARD_PERMISSIONS.RENTAL_REQUESTS, // Admin only
      },
      {
        title: "Avis clients",
        url: "/dashboard/reviews",
        icon: Icons.StarIcon,
        items: [],
        roles: DASHBOARD_PERMISSIONS.REVIEWS, // Admin only
      },
      {
        title: "Rapports",
        url: "/dashboard/reports",
        icon: Icons.PieChart,
        items: [],
        roles: DASHBOARD_PERMISSIONS.REPORTS, // Admin only
      },
    ],
  },

];

/**
 * Filter navigation items based on user role
 * @param {string} userRole - The role of the current user
 * @returns {Array} Filtered navigation data
 */
export function getNavDataForRole(userRole) {
  if (!userRole) return [];

  return ALL_NAV_DATA.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => {
        // If no roles specified, accessible to all dashboard users
        if (!item.roles) return true;
        // Check if user's role is in the allowed roles
        return item.roles.includes(userRole);
      })
      .map((item) => {
        // Filter sub-items if they exist and have role restrictions
        if (item.items && item.items.length > 0) {
          return {
            ...item,
            items: item.items.filter((subItem) => {
              if (!subItem.roles) return true;
              return subItem.roles.includes(userRole);
            }),
          };
        }
        return item;
      }),
  })).filter((section) => section.items.length > 0); // Remove empty sections
}

/**
 * Legacy export for backward compatibility
 * This should be replaced with getNavDataForRole in components
 * @deprecated Use getNavDataForRole instead
 */
export const NAV_DATA = ALL_NAV_DATA;
