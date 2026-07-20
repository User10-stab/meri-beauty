import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ==========================
  // Create Admin
  // ==========================
  const existingAdmin = await prisma.user.findUnique({
    where: {
      email: "admin@meribeauty.com",
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });