import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findUnique({
    where: {
      email: "admin@meribeauty.com",
    },
  });

  if (existingAdmin) {
    console.log("✅ Admin already exists.");
    return;
  }

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

  console.log("✅ Admin created successfully.");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });