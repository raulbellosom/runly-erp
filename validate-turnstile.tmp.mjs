import { PrismaClient } from "@prisma/client";
import { createGrowthPropertyService } from "./apps/api/src/routes/growth/growth-property-service.js";
import { decryptPassword } from "./apps/api/src/services/smtp-service.js";

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findFirst({ where: { enabled: true } });
  if (!company) throw new Error("No enabled company found to test against");
  console.log("Using company:", company.slug);

  const service = createGrowthPropertyService({ prisma });

  // 1. Create a throwaway external property
  const created = await service.createExternalProperty({
    companyId: company.id,
    name: "VALIDATION TEST - DELETE ME",
    domain: "validation-test.invalid",
  });
  console.log("Created property:", created.id, "status:", created.status);

  // 2. Set real Turnstile-shaped keys through the real update path (real encryption)
  const plaintextSecret = "0x4AAAAAAAvalidation-secret-key";
  const updated = await service.updateProperty({
    companyId: company.id,
    propertyId: created.id,
    patch: { turnstileSiteKey: "0x4AAAAAAAvalidation-site-key", turnstileSecretKey: plaintextSecret },
  });
  console.log("turnstileSiteKey stored:", updated.turnstileSiteKey);
  console.log("turnstileSecretKey is encrypted (differs from plaintext):", updated.turnstileSecretKey !== plaintextSecret);

  // 3. Round-trip: decrypt exactly how createTurnstileVerifier does it
  const decrypted = decryptPassword(updated.turnstileSecretKey);
  console.log("Decrypted matches original plaintext:", decrypted === plaintextSecret);

  // 4. Confirm listProperties includes it with correct shape (as admin route would see pre-strip)
  const list = await service.listProperties({ companyId: company.id });
  const found = list.find((p) => p.id === created.id);
  console.log("Found in listProperties:", Boolean(found), "kind:", found?.kind, "status:", found?.status);

  // 5. Cleanup — remove the throwaway row entirely (hard delete, this was never real data)
  await prisma.growthProperty.delete({ where: { id: created.id } });
  console.log("Cleaned up test property.");
}

main()
  .catch((err) => { console.error("VALIDATION FAILED:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
