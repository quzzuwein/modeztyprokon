import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getTotals() {
  const [projectCount, totalPettyCash, totalInvoice, taxAgg, pendingApprovals, approvalTotal, approvalByStatus] = await Promise.all([
    prisma.project.count(),
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
    prisma.approval.count({ where: { status: 'PENDING' } }),
    prisma.approval.count(),
    prisma.approval.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
  ]);

  const finance = {
    totalPettyCash: Number(totalPettyCash._sum.amount || 0),
    totalInvoice: Number(totalInvoice._sum.netAmount || 0),
    taxSummary: {
      gross: Number(taxAgg._sum.grossAmount || 0),
      vat: Number(taxAgg._sum.vatAmount || 0),
      withholding: Number(taxAgg._sum.withholdingAmount || 0),
      net: Number(taxAgg._sum.netAmount || 0),
    },
  };

  const expectedSummary = {
    totalProjects: projectCount,
    totalPettyCash: finance.totalPettyCash,
    totalInvoice: finance.totalInvoice,
    totalTax: finance.taxSummary.vat + finance.taxSummary.withholding + finance.taxSummary.net,
    pendingApprovals,
    totalApprovals: approvalTotal,
    approvalByStatus: {
      PENDING: approvalByStatus.find((item) => item.status === 'PENDING')?._count.status ?? 0,
      APPROVED: approvalByStatus.find((item) => item.status === 'APPROVED')?._count.status ?? 0,
      REJECTED: approvalByStatus.find((item) => item.status === 'REJECTED')?._count.status ?? 0,
    },
  };

  return { finance, expectedSummary };
}

async function validateProjectReports() {
  const projects = await prisma.project.findMany();
  const results: Array<{ projectId: string; ok: boolean; details: Record<string, unknown> }> = [];

  for (const project of projects) {
    const [pettyCash, invoice, transaction] = await Promise.all([
      prisma.pettyCashRequest.aggregate({
        where: { projectId: project.id },
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        where: { projectId: project.id },
        _sum: { netAmount: true },
      }),
      prisma.transaction.aggregate({
        where: { projectId: project.id },
        _sum: {
          grossAmount: true,
          vatAmount: true,
          withholdingAmount: true,
          netAmount: true,
        },
      }),
    ]);

    const latestApproval = await prisma.approval.findFirst({
      where: { entityType: 'project', entityId: project.id },
      orderBy: { createdAt: 'desc' },
    });

    const report = {
      projectId: project.id,
      projectName: project.name,
      contractValue: Number(project.contractValue || 0),
      totalPettyCash: Number(pettyCash._sum.amount || 0),
      totalInvoice: Number(invoice._sum.netAmount || 0),
      taxSummary: {
        gross: Number(transaction._sum.grossAmount || 0),
        vat: Number(transaction._sum.vatAmount || 0),
        withholding: Number(transaction._sum.withholdingAmount || 0),
        net: Number(transaction._sum.netAmount || 0),
      },
      approvalStatus: latestApproval?.status || 'PENDING',
    };

    const ok =
      report.contractValue === Number(project.contractValue || 0) &&
      report.totalPettyCash === Number(pettyCash._sum.amount || 0) &&
      report.totalInvoice === Number(invoice._sum.netAmount || 0) &&
      report.taxSummary.gross === Number(transaction._sum.grossAmount || 0) &&
      report.taxSummary.vat === Number(transaction._sum.vatAmount || 0) &&
      report.taxSummary.withholding === Number(transaction._sum.withholdingAmount || 0) &&
      report.taxSummary.net === Number(transaction._sum.netAmount || 0);

    results.push({ projectId: project.id, ok, details: report });
  }

  return results;
}

async function main() {
  const { finance, expectedSummary } = await getTotals();
  const projectResults = await validateProjectReports();

  const mismatches: string[] = [];

  if (expectedSummary.totalPettyCash !== finance.totalPettyCash) {
    mismatches.push('Summary petty cash mismatch');
  }

  if (expectedSummary.totalInvoice !== finance.totalInvoice) {
    mismatches.push('Summary invoice mismatch');
  }

  if (expectedSummary.totalTax !== finance.taxSummary.vat + finance.taxSummary.withholding + finance.taxSummary.net) {
    mismatches.push('Summary tax mismatch');
  }

  const failedProjects = projectResults.filter((item) => !item.ok);

  if (failedProjects.length > 0) {
    mismatches.push(`Project report mismatch count: ${failedProjects.length}`);
  }

  console.log('EXPECTED SUMMARY');
  console.log(JSON.stringify(expectedSummary, null, 2));

  console.log('\nFINANCE');
  console.log(JSON.stringify(finance, null, 2));

  console.log('\nPROJECT REPORT VALIDATION');
  console.log(JSON.stringify(projectResults, null, 2));

  if (mismatches.length > 0) {
    console.log('\nMISMATCHES');
    console.log(mismatches.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('\nVALIDATION PASSED');
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
