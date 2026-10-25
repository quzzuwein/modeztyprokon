import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runSmokeTests() {
  const result: any[] = [];

  // 1. Health check
  const health = await prisma.$queryRaw`SELECT 1 as ok`;
  result.push({ name: 'health-db', ok: !!health, details: health });

  // 2. Project count baseline
  const projectCount = await prisma.project.count();
  result.push({ name: 'project-count', ok: typeof projectCount === 'number', details: { projectCount } });

  // 3. Approval count baseline
  const approvalCount = await prisma.approval.count();
  result.push({ name: 'approval-count', ok: typeof approvalCount === 'number', details: { approvalCount } });

  // 4. Summary aggregates
  const [pettyCash, invoice, tax] = await Promise.all([
    prisma.pettyCashRequest.aggregate({ _sum: { amount: true } }),
    prisma.invoice.aggregate({ _sum: { netAmount: true } }),
    prisma.transaction.aggregate({
      _sum: {
        grossAmount: true,
        vatAmount: true,
        withholdingAmount: true,
        netAmount: true,
      },
    }),
  ]);

  result.push({
    name: 'report-aggregates',
    ok: true,
    details: {
      pettyCash: Number(pettyCash._sum.amount || 0),
      invoice: Number(invoice._sum.netAmount || 0),
      tax: {
        gross: Number(tax._sum.grossAmount || 0),
        vat: Number(tax._sum.vatAmount || 0),
        withholding: Number(tax._sum.withholdingAmount || 0),
        net: Number(tax._sum.netAmount || 0),
      },
    },
  });

  // 5. Check for orphaned approval records without matching entity
  const approvals = await prisma.approval.findMany({
    select: { id: true, entityType: true, entityId: true },
  });

  const orphaned = [] as any[];

  for (const approval of approvals) {
    if (approval.entityType === 'project') {
      const project = await prisma.project.findUnique({ where: { id: approval.entityId } });
      if (!project) orphaned.push(approval);
    }

    if (approval.entityType === 'invoice') {
      const invoiceItem = await prisma.invoice.findUnique({ where: { id: approval.entityId } });
      if (!invoiceItem) orphaned.push(approval);
    }

    if (approval.entityType === 'petty_cash') {
      const petty = await prisma.pettyCashRequest.findUnique({ where: { id: approval.entityId } });
      if (!petty) orphaned.push(approval);
    }
  }

  result.push({
    name: 'orphaned-approvals',
    ok: orphaned.length === 0,
    details: { orphaned },
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.some((item) => item.ok === false)) {
    process.exitCode = 1;
  }
}

runSmokeTests()
  .catch((error) => {
    console.error('Smoke test failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
