import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** LOCAL DEV ONLY — one throwaway CUSTOMER account for testing booking/checkout flows. */
async function main() {
  const email = "julie.martin@example.com";
  const password = "Client@123";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(" Client already exists:", email);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      fullName: "Julie Martin",
      email,
      phone: "0470222333",
      password: hashedPassword,
      role: "CUSTOMER",
      emailVerified: true,
      isActive: true,
      newsletterSubscribed: false,
    },
  });

  console.log(` Client created: ${email} / ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
