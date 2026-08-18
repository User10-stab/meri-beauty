import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ==========================
  // Create Admin
  // ==========================
  // email is no longer globally @unique; active-only uniqueness is enforced
  // by a partial index, so Prisma cannot use findUnique({ email }).
  const existingAdmin = await prisma.user.findFirst({
    where: {
      email: "admin@meribeauty.com",
      isDeleted: false,
    },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

    await prisma.user.create({
      data: {
        fullName: "Admin",
        email: "admin@meribeauty.com",
        phone: "0600000000",
        password: hashedPassword,
        role: "ADMIN",
        emailVerified: true,
        isActive: true,
      },
    });

    console.log(" Admin created successfully.");
  } else {
    console.log(" Admin already exists.");
  }

  // ==========================
  // Create Salon
  // ==========================
  const existingSalon = await prisma.salon.findUnique({
    where: {
      id: "main-salon",
    },
  });

  if (!existingSalon) {
    await prisma.salon.create({
      data: {
        id: "main-salon",

        name: "Meri Beauty",
        description: "",

        phone: "",
        email: "",
        address: "",

        instagram: "",
        facebook: "",
        tiktok: "",

        workingDays: {
          create: [
            {
              day: "MONDAY",
              isOpen: true,
              openingTime: "09:00",
              closingTime: "18:00",
            },
            {
              day: "TUESDAY",
              isOpen: true,
              openingTime: "09:00",
              closingTime: "18:00",
            },
            {
              day: "WEDNESDAY",
              isOpen: true,
              openingTime: "09:00",
              closingTime: "18:00",
            },
            {
              day: "THURSDAY",
              isOpen: true,
              openingTime: "09:00",
              closingTime: "18:00",
            },
            {
              day: "FRIDAY",
              isOpen: true,
              openingTime: "09:00",
              closingTime: "18:00",
            },
            {
              day: "SATURDAY",
              isOpen: true,
              openingTime: "09:00",
              closingTime: "18:00",
            },
            {
              day: "SUNDAY",
              isOpen: false,
              openingTime: "09:00",
              closingTime: "18:00",
            },
          ],
        },
      },
    });

    console.log(" Salon created successfully.");
  } else {
    console.log(" Salon already exists.");
  }

  // ==========================
  // Ensure Salon legal identity
  // ==========================
  // Required before any online sale can be invoiced — see
  // lib/invoicing.js#isSellerLegalDataComplete, which gates checkout on
  // legalName/vatNumber/addressLine1/postalCode/city/countryCode all being
  // set. Idempotent and safe to re-run: only fills fields still empty, so
  // it never overwrites anything Marie has since edited via Réglages >
  // Salon. Real business data (confirmed), not a placeholder.
  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" } });
  if (salon) {
    const legalIdentityDefaults = {
      legalName: "Meri Beauty",
      vatNumber: "BE0751.854.027",
      companyRegistrationNo: "0751.854.027",
      addressLine1: "Rue Bonaventure 113",
      postalCode: "1090",
      city: "Jette",
      countryCode: "BE",
    };
    const missing = Object.fromEntries(
      Object.entries(legalIdentityDefaults).filter(([field]) => !salon[field])
    );

    if (Object.keys(missing).length > 0) {
      await prisma.salon.update({ where: { id: "main-salon" }, data: missing });
      console.log(" Salon legal identity backfilled:", Object.keys(missing).join(", "));
    } else {
      console.log(" Salon legal identity already complete.");
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
