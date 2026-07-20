import * as Icons from "../icons";

export const NAV_DATA = [
  {
    label: "PRINCIPAL",
    items: [
       {
        title: "Tableau de bord",
        icon: Icons.HomeIcon,
        items: [],
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
          url: "/dashboard/allAppointments",
        }
        ],
      },
      {
        title: "Clients",
        icon: Icons.User,
        url: "/dashboard/customers",
        items: [],
      },
      {
        title: "Staff",
        icon: Icons.User,
        items: [
          {
            title: "Auto-Entrepreneur",
            url: "/dashboard/staff/auto-entrepreneur",
          },
        ],
      },
      {
        title: "Demandes de location",
        url: "/dashboard/rental-requests",
        icon: Icons.Calendar,
        items: [],
      },
       {
         title: "Services",
         icon: Icons.User,
         url: "/dashboard/services",
         items: [],
       },
      
      // {
      //   title: "Profile",
      //   url: "/dashboard/profile",
      //   icon: Icons.User,
      //   items: [],
      // },
      // {
      //   title: "Forms",
      //   icon: Icons.Alphabet,
      //   items: [
      //     {
      //       title: "Form Elements",
      //       url: "/dashboard/forms/form-elements",
      //     },
      //     {
      //       title: "Form Layout",
      //       url: "/dashboard/forms/form-layout",
      //     },
      //   ],
      // },
      // {
      //   title: "Tables",
      //   url: "/dashboard/tables",
      //   icon: Icons.Table,
      //   items: [
      //     {
      //       title: "Tables",
      //       url: "/dashboard/tables",
      //     },
      //   ],
      // },
      // {
      //   title: "Pages",
      //   icon: Icons.Alphabet,
      //   items: [
      //     {
      //       title: "Settings",
      //       url: "/dashboard/pages/settings",
      //     },
      //   ],
      // },
    ],
  },
  // {
  //   label: "OTHERS",
  //   items: [
  //     {
  //       title: "Charts",
  //       icon: Icons.PieChart,
  //       items: [
  //         {
  //           title: "Basic Chart",
  //           url: "/dashboard/charts/basic-chart",
  //         },
  //       ],
  //     },
  //     {
  //       title: "UI Elements",
  //       icon: Icons.FourCircle,
  //       items: [
  //         {
  //           title: "Alerts",
  //           url: "/dashboard/ui-elements/alerts",
  //         },
  //         {
  //           title: "Buttons",
  //           url: "/dashboard/ui-elements/buttons",
  //         },
  //       ],
  //     },
  //   ],
  // },
];
