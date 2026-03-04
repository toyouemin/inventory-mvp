import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const locations = [
    { code: "WAREHOUSE", name: "창고" },
    { code: "STORE", name: "매장" },
  ];

  for (const loc of locations) {
    await prisma.location.upsert({
      where: { code: loc.code },
      create: loc,
      update: { name: loc.name },
    });
  }

  console.log("Location 시드 완료: 창고, 매장");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
