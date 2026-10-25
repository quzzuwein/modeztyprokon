import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { code: 'PTMKT' },
    update: {},
    create: {
      code: 'PTMKT',
      name: 'PT Maju Konstruksi',
      npwp: '01.234.567.8-123.456',
      address: 'Bandung',
      email: 'info@ptmajukonstruksi.com',
    },
  });

  const passwordHash = await bcrypt.hash('admin123', 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@ptmajukonstruksi.com' },
    update: {},
    create: {
      companyId: company.id,
      username: 'superadmin',
      fullName: 'Super Admin',
      email: 'superadmin@ptmajukonstruksi.com',
      passwordHash,
      phone: '08111111111',
    },
  });

  const project = await prisma.project.upsert({
    where: {
      companyId_code: {
        companyId: company.id,
        code: 'PRJ-001',
      },
    },
    update: {},
    create: {
      companyId: company.id,
      code: 'PRJ-001',
      name: 'Pembangunan Gedung Kantor',
      status: 'ACTIVE',
      contractValue: 1200000000,
      location: 'Bandung',
      clientName: 'PT Client A',
      createdById: superAdmin.id,
    },
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: superAdmin.id,
      },
    },
    update: {},
    create: {
      projectId: project.id,
      userId: superAdmin.id,
      role: 'PM',
    },
  });

  const supplier = await prisma.party.upsert({
    where: {
      companyId_name: {
        companyId: company.id,
        name: 'PT Material Jaya',
      },
    },
    update: {},
    create: {
      companyId: company.id,
      name: 'PT Material Jaya',
      type: 'SUPPLIER',
      npwp: '01.222.333.4-555.666',
      isPkp: true,
      address: 'Bandung',
      email: 'material@ptmaterialjaya.com',
    },
  });

  await prisma.taxProfile.upsert({
    where: { partyId: supplier.id },
    update: {},
    create: {
      partyId: supplier.id,
      npwpStatus: 'HAS_NPWP',
      pkpStatus: 'PKP',
      vatStatus: 'TAXABLE',
      vatRate: 11,
      withholdingType: 'PPH23',
      withholdingRate: 2,
      effectiveFrom: new Date(),
      notes: 'Supplier PKP',
    },
  });

  const pettyCashRequest = await prisma.pettyCashRequest.create({
    data: {
      companyId: company.id,
      projectId: project.id,
      createdById: superAdmin.id,
      requestNumber: 'PC-001',
      requestDate: new Date(),
      purpose: 'Pembelian bahan kecil',
      note: 'Pembelian besi siku dan material kecil',
      amount: 2500000,
      status: 'SUBMITTED',
      items: {
        create: [
          {
            itemName: 'Besi siku',
            category: 'MATERIAL',
            quantity: 10,
            unitPrice: 200000,
            totalAmount: 2000000,
          },
          {
            itemName: 'Solar',
            category: 'TRANSPORT',
            quantity: 2,
            unitPrice: 250000,
            totalAmount: 500000,
          },
        ],
      },
    },
    include: {
      items: true,
    },
  });

  await prisma.transaction.create({
    data: {
      companyId: company.id,
      projectId: project.id,
      partyId: supplier.id,
      type: 'EXPENSE',
      description: 'Pengeluaran kas lapangan untuk pembelian material',
      grossAmount: 2500000,
      vatAmount: 275000,
      withholdingAmount: 50000,
      netAmount: 2700000,
      taxStatus: 'TAXABLE',
    },
  });

  await prisma.invoice.create({
    data: {
      companyId: company.id,
      projectId: project.id,
      partyId: supplier.id,
      invoiceNumber: 'INV-001',
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      grossAmount: 2500000,
      vatAmount: 275000,
      withholdingAmount: 50000,
      netAmount: 2700000,
      status: 'APPROVED',
    },
  });

  const journalEntry = await prisma.journalEntry.create({
    data: {
      companyId: company.id,
      projectId: project.id,
      entryNumber: 'JE-001',
      description: 'Pembukuan pengeluaran kas lapangan',
      lines: {
        create: [
          {
            accountCode: '511',
            debit: 2500000,
            description: 'Biaya material',
          },
          {
            accountCode: '112',
            credit: 2500000,
            description: 'Kas proyek',
          },
        ],
      },
    },
    include: {
      lines: true,
    },
  });

  console.log('Seed data created successfully');
  console.log({ company, superAdmin, project, supplier, pettyCashRequest, journalEntry });
}

main()
  .catch((error) => {
    console.error('Seeder failed');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
