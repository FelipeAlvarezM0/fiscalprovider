import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.taxCategory.createMany({
    data: [
      {
        code: "OFFICE_SUPPLIES",
        name: "Office Supplies",
        deductible: true,
        supported: true,
        formTargetsJson: ["Schedule C"]
      },
      {
        code: "MEALS",
        name: "Meals",
        deductible: true,
        supported: true,
        formTargetsJson: ["Schedule C"]
      },
      {
        code: "TRAVEL",
        name: "Travel",
        deductible: true,
        supported: true,
        formTargetsJson: ["Schedule C"]
      },
      {
        code: "SOFTWARE",
        name: "Software",
        deductible: true,
        supported: true,
        formTargetsJson: ["Schedule C"]
      },
      {
        code: "BANK_FEES",
        name: "Bank Fees",
        deductible: true,
        supported: true,
        formTargetsJson: ["Schedule C"]
      },
      {
        code: "GROSS_RECEIPTS",
        name: "Gross Receipts",
        deductible: false,
        supported: true,
        formTargetsJson: ["Schedule C"]
      }
    ],
    skipDuplicates: true
  });

  await prisma.categoryMappingRule.createMany({
    data: [
      {
        code: "OFFICE_SUPPLIES",
        vendorPattern: "amazon|staples|office depot",
        confidenceBase: "86",
        reason: "Vendor pattern indicates office supplies."
      },
      {
        code: "MEALS",
        vendorPattern: "doordash|ubereats|grubhub|restaurant|cafe",
        confidenceBase: "70",
        reason: "Vendor pattern suggests meal expense."
      },
      {
        code: "TRAVEL",
        vendorPattern: "delta|united|american airlines|hilton|marriott",
        confidenceBase: "84",
        reason: "Merchant pattern suggests travel expense."
      },
      {
        code: "SOFTWARE",
        keywordPattern: "subscription|saas|hosting|software|cloud",
        confidenceBase: "82",
        reason: "Description indicates software or recurring SaaS expense."
      },
      {
        code: "BANK_FEES",
        keywordPattern: "fee|service charge|overdraft",
        confidenceBase: "78",
        reason: "Description indicates bank fee."
      }
    ],
    skipDuplicates: true
  });
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
