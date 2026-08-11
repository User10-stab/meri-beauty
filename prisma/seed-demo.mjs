import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * LOCAL DEV ONLY — fabricated demo content (services, one staff member,
 * boutique catalogue) so the site isn't empty while testing. Nothing here
 * is real Wix data (no export file was available) — invented but plausible
 * beauty-studio content, reusing already-uploaded sample images in
 * public/uploads/ so nothing 404s. Idempotent: safe to re-run, skips
 * anything that already exists by its unique key.
 */
async function main() {
  const admin = await prisma.user.findUnique({ where: { email: "admin@meribeauty.com" } });
  if (!admin) {
    throw new Error("Run `npm run seed` first — this script needs the admin user to exist.");
  }

  // ==========================
  // Service categories + services
  // ==========================
  const categoryDefs = [
    { name: "Ongles", description: "Manucure, pose gel et nail art" },
    { name: "Cils & Regard", description: "Extensions et rehaussement de cils" },
    { name: "Soins du visage", description: "Soins et rituels visage" },
  ];

  const categories = {};
  for (const def of categoryDefs) {
    categories[def.name] = await prisma.category.upsert({
      where: { name: def.name },
      update: {},
      create: def,
    });
  }
  console.log(` ${Object.keys(categories).length} service categories ready.`);

  const serviceDefs = [
    { category: "Ongles", name: "Manucure classique", price: 35, duration: 45 },
    { category: "Ongles", name: "Pose gel", price: 55, duration: 60 },
    { category: "Cils & Regard", name: "Extension de cils (pose complète)", price: 60, duration: 90 },
    { category: "Cils & Regard", name: "Rehaussement de cils", price: 45, duration: 60 },
    { category: "Soins du visage", name: "Soin du visage éclat", price: 75, duration: 60 },
  ];

  const staffPhotoPool = [
    "/uploads/staff/1785315132451-63c4352aa4f3cfb9.jpg",
    "/uploads/staff/1784028508869-71f54017700898f2.jpg",
    "/uploads/staff/1785315102589-626cece35cb4f6fc.jpg",
  ];

  // ==========================
  // One staff member
  // ==========================
  const staffEmail = "sarah.dupont@meribeauty.com";
  let staffUser = await prisma.user.findUnique({ where: { email: staffEmail } });
  if (!staffUser) {
    const hashedPassword = await bcrypt.hash("Staff@123", 12);
    staffUser = await prisma.user.create({
      data: {
        fullName: "Sarah Dupont",
        email: staffEmail,
        phone: "0470111222",
        password: hashedPassword,
        role: "STAFF",
        emailVerified: true,
        isActive: true,
      },
    });
    console.log(" Staff user created: sarah.dupont@meribeauty.com / Staff@123");
  } else {
    console.log(" Staff user already exists.");
  }

  let staff = await prisma.staff.findUnique({ where: { userId: staffUser.id } });
  if (!staff) {
    staff = await prisma.staff.create({
      data: {
        userId: staffUser.id,
        type: "EMPLOYEE",
        languages: ["Français", "Anglais"],
        bio: "Spécialiste ongles et cils, 6 ans d'expérience en institut.",
        photo: staffPhotoPool[0],
        yearsOfExperience: 6,
        setupCompleted: true,
      },
    });
    console.log(" Staff profile created.");
  } else {
    console.log(" Staff profile already exists.");
  }

  for (const def of serviceDefs) {
    // Service.name has no @unique constraint — look up by name+category
    // before creating, since upsert() requires a real unique key.
    let service = await prisma.service.findFirst({
      where: { name: def.name, categoryId: categories[def.category].id },
    });
    if (!service) {
      service = await prisma.service.create({
        data: { name: def.name, categoryId: categories[def.category].id },
      });
    }

    const existingLink = await prisma.staffService.findUnique({
      where: { staffId_serviceId: { staffId: staff.id, serviceId: service.id } },
    });
    if (!existingLink) {
      await prisma.staffService.create({
        data: {
          staffId: staff.id,
          serviceId: service.id,
          createdById: admin.id,
          price: def.price,
          duration: def.duration,
          photo: staffPhotoPool[1],
        },
      });
    }
  }
  console.log(` ${serviceDefs.length} services linked to Sarah Dupont.`);

  // ==========================
  // Boutique: Brand -> Category -> Subcategory -> Product -> Variant -> Image
  // ==========================
  const brand = await prisma.brand.upsert({
    where: { slug: "meri-beauty-studio" },
    update: {},
    create: {
      name: "Meri Beauty Studio",
      slug: "meri-beauty-studio",
      description: "Notre propre gamme de soins et produits d'entretien.",
    },
  });

  const productCategory = await prisma.productCategory.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: "soins-visage" } },
    update: {},
    create: {
      name: "Soins visage",
      slug: "soins-visage",
      brandId: brand.id,
    },
  });

  const nailsCategory = await prisma.productCategory.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: "ongles" } },
    update: {},
    create: {
      name: "Ongles",
      slug: "ongles",
      brandId: brand.id,
    },
  });

  const cremesSubcat = await prisma.productSubcategory.upsert({
    where: { categoryId_slug: { categoryId: productCategory.id, slug: "cremes" } },
    update: {},
    create: { name: "Crèmes", slug: "cremes", categoryId: productCategory.id },
  });

  const vernisSubcat = await prisma.productSubcategory.upsert({
    where: { categoryId_slug: { categoryId: nailsCategory.id, slug: "vernis" } },
    update: {},
    create: { name: "Vernis", slug: "vernis", categoryId: nailsCategory.id },
  });

  const productDefs = [
    {
      slug: "creme-hydratante-eclat",
      name: "Crème hydratante éclat",
      description: "Crème visage hydratante à l'acide hyaluronique, pour tous types de peau.",
      subcategoryId: cremesSubcat.id,
      image: "/uploads/products/1785916246689-4b3882f66477d12a.jpg",
      variant: { name: "50 ml", sku: "MBS-CRM-50", price: 29.9, costPrice: 12, stockQuantity: 20 },
    },
    {
      slug: "serum-anti-age",
      name: "Sérum anti-âge",
      description: "Sérum concentré en vitamine C, effet éclat immédiat.",
      subcategoryId: cremesSubcat.id,
      image: "/uploads/products/1785916246505-04e269f39bd52e74.jpg",
      variant: { name: "30 ml", sku: "MBS-SER-30", price: 39.9, costPrice: 16, stockQuantity: 15 },
    },
    {
      slug: "vernis-semi-permanent-rouge-passion",
      name: "Vernis semi-permanent — Rouge Passion",
      description: "Vernis semi-permanent longue tenue, application en institut ou à domicile.",
      subcategoryId: vernisSubcat.id,
      image: "/uploads/products/1785493074435-a29c665eb420981b.png",
      variant: { name: "Rouge Passion", sku: "MBS-VRN-RP", price: 14.9, costPrice: 5, stockQuantity: 30 },
    },
  ];

  for (const def of productDefs) {
    const product = await prisma.product.upsert({
      where: { slug: def.slug },
      update: {},
      create: {
        name: def.name,
        slug: def.slug,
        description: def.description,
        subcategoryId: def.subcategoryId,
        status: "ACTIVE",
      },
    });

    const existingVariant = await prisma.productVariant.findUnique({ where: { sku: def.variant.sku } });
    if (!existingVariant) {
      await prisma.productVariant.create({
        data: { productId: product.id, ...def.variant },
      });
    }

    const existingImage = await prisma.productImage.findFirst({ where: { productId: product.id } });
    if (!existingImage) {
      await prisma.productImage.create({
        data: { productId: product.id, path: def.image, isPrimary: true },
      });
    }
  }
  console.log(` ${productDefs.length} boutique products ready (brand: Meri Beauty Studio).`);

  console.log("\nDemo data seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
