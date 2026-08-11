const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
ALTER TABLE "Payment"
ADD COLUMN IF NOT EXISTS "promoCodeId" TEXT,
ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
`);

  await prisma.$executeRawUnsafe(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_promoCodeId_fkey'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_promoCodeId_fkey"
      FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
`);

  await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "Payment_promoCodeId_idx"
ON "Payment"("promoCodeId");
`);

  const verify = await prisma.$queryRawUnsafe(`
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='Payment'
  AND column_name IN ('promoCodeId','discountAmount')
ORDER BY column_name;
`);

  console.log(JSON.stringify({ ok: true, verify }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
