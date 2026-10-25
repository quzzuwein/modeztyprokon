import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './lib/prisma';

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || 'modeztyprokon-dev-secret';

app.use(express.json());

const authMiddleware = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, jwtSecret) as { sub: string };

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const buildTaxSummary = (transactions: any[]) => {
  return transactions.reduce(
    (acc, item) => {
      acc.gross += Number(item.grossAmount || 0);
      acc.vat += Number(item.vatAmount || 0);
      acc.withholding += Number(item.withholdingAmount || 0);
      acc.net += Number(item.netAmount || 0);
      return acc;
    },
    { gross: 0, vat: 0, withholding: 0, net: 0 }
  );
};

const syncApprovalEntityStatus = async (entityType: string, entityId: string, status: string) => {
  if (entityType === 'petty_cash') {
    if (status === 'APPROVED') {
      await prisma.pettyCashRequest.update({
        where: { id: entityId },
        data: { status: 'APPROVED' },
      });
      return;
    }

    if (status === 'REJECTED') {
      await prisma.pettyCashRequest.update({
        where: { id: entityId },
        data: { status: 'REJECTED' },
      });
      return;
    }

    await prisma.pettyCashRequest.update({
      where: { id: entityId },
      data: { status: 'SUBMITTED' },
    });
    return;
  }

  if (entityType === 'invoice') {
    if (status === 'APPROVED') {
      await prisma.invoice.update({
        where: { id: entityId },
        data: { status: 'APPROVED' },
      });
      return;
    }

    if (status === 'REJECTED') {
      await prisma.invoice.update({
        where: { id: entityId },
        data: { status: 'REJECTED' },
      });
      return;
    }

    await prisma.invoice.update({
      where: { id: entityId },
      data: { status: 'VERIFIED' },
    });
    return;
  }

  if (entityType === 'project') {
    const projectStatus = status === 'APPROVED' ? 'ACTIVE' : status === 'REJECTED' ? 'ON_HOLD' : 'ACTIVE';

    await prisma.project.update({
      where: { id: entityId },
      data: { status: projectStatus },
    });
    return;
  }
};

const createApprovalRecord = async (
  entityType: string,
  entityId: string,
  approverId: string,
  note?: string
) => {
  return prisma.approval.create({
    data: {
      entityType,
      entityId,
      approverId,
      status: 'PENDING',
      note: note || 'Auto-generated approval',
    },
  });
};

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, app: 'MODEZTYPROkon API', db: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, app: 'MODEZTYPROkon API', db: 'disconnected' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { username },
  });

  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { sub: user.id, username: user.username, email: user.email },
    jwtSecret,
    { expiresIn: '1h' }
  );

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      companyId: user.companyId,
    },
  });
});

app.get('/auth/profile', authMiddleware, async (req: any, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      company: true,
      projectMembers: true,
    },
  });

  return res.json(user);
});

app.get('/companies', authMiddleware, async (_req, res) => {
  const companies = await prisma.company.findMany({
    include: {
      projects: true,
    },
  });

  return res.json(companies);
});

app.post('/companies', authMiddleware, async (req, res) => {
  try {
    const { code, name, npwp, address, email } = req.body;

    const company = await prisma.company.create({
      data: {
        code,
        name,
        npwp,
        address,
        email,
      },
    });

    return res.status(201).json(company);
  } catch (error) {
    return res.status(400).json({ message: 'Failed to create company' });
  }
});

app.get('/projects', authMiddleware, async (_req, res) => {
  const projects = await prisma.project.findMany({
    include: {
      company: true,
      members: {
        include: {
          user: true,
        },
      },
    },
  });

  return res.json(projects);
});

app.get('/projects/:id', authMiddleware, async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      company: true,
      members: {
        include: {
          user: true,
        },
      },
      pettyCashRequests: {
        include: {
          items: true,
        },
      },
      transactions: true,
    },
  });

  if (!project) {
    return res.status(404).json({ message: 'Project not found' });
  }

  return res.json(project);
});

app.post('/projects', authMiddleware, async (req, res) => {
  try {
    const {
      companyId,
      code,
      name,
      status,
      contractValue,
      location,
      clientName,
      createdById,
    } = req.body as any;

    const project = await prisma.project.create({
      data: {
        companyId,
        code,
        name,
        status: status || 'ACTIVE',
        contractValue: Number(contractValue || 0),
        location,
        clientName,
        createdById,
      },
    });

    await createApprovalRecord('project', project.id, createdById || req.user.id, 'Pending project approval');

    return res.status(201).json(project);
  } catch (error) {
    return res.status(400).json({ message: 'Failed to create project' });
  }
});

app.get('/petty-cash', authMiddleware, async (_req, res) => {
  const requests = await prisma.pettyCashRequest.findMany({
    include: {
      project: true,
      items: true,
      creator: true,
    },
  });

  return res.json(requests);
});

app.post('/petty-cash', authMiddleware, async (req, res) => {
  try {
    const {
      companyId,
      projectId,
      createdById,
      requestNumber,
      purpose,
      note,
      amount,
      items,
    } = req.body as any;

    const request = await prisma.pettyCashRequest.create({
      data: {
        companyId,
        projectId,
        createdById,
        requestNumber,
        requestDate: new Date(),
        purpose,
        note,
        amount: Number(amount || 0),
        status: 'SUBMITTED',
        items: {
          create: (items || []).map((item: any) => ({
            itemName: item.itemName,
            category: item.category,
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            totalAmount: Number(item.totalAmount || 0),
          })),
        },
      },
      include: {
        items: true,
      },
    });

    await createApprovalRecord('petty_cash', request.id, createdById || req.user.id, 'Pending petty cash approval');

    return res.status(201).json(request);
  } catch (error) {
    return res.status(400).json({ message: 'Failed to create petty cash request' });
  }
});

app.patch('/petty-cash/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body as any;

    const request = await prisma.pettyCashRequest.update({
      where: { id: req.params.id },
      data: {
        status,
      },
    });

    return res.json(request);
  } catch (error) {
    return res.status(400).json({ message: 'Failed to update petty cash status' });
  }
});

app.get('/tax-summary', authMiddleware, async (_req, res) => {
  const transactions = await prisma.transaction.findMany();
  return res.json(buildTaxSummary(transactions));
});

app.get('/tax/transactions', authMiddleware, async (_req, res) => {
  try {
    const transactions = await prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        project: true,
        party: true,
      },
    });

    return res.json(transactions);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch tax transactions' });
  }
});

app.post('/tax/transactions', authMiddleware, async (req, res) => {
  try {
    const {
      companyId,
      projectId,
      partyId,
      type,
      description,
      grossAmount,
      vatAmount,
      withholdingAmount,
      taxStatus,
    } = req.body as any;

    const computedNet = Number(
      req.body.netAmount ??
        (Number(grossAmount || 0) + Number(vatAmount || 0) - Number(withholdingAmount || 0))
    );

    const transaction = await prisma.transaction.create({
      data: {
        companyId,
        projectId,
        partyId,
        type: type || 'EXPENSE',
        description,
        grossAmount: Number(grossAmount || 0),
        vatAmount: Number(vatAmount || 0),
        withholdingAmount: Number(withholdingAmount || 0),
        netAmount: computedNet,
        taxStatus: taxStatus || 'NON_TAXABLE',
      },
    });

    return res.status(201).json(transaction);
  } catch (error) {
    return res.status(400).json({ message: 'Failed to create transaction' });
  }
});

app.get('/tax/project/:projectId', authMiddleware, async (req, res) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { projectId: req.params.projectId },
      include: { project: true, party: true },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      projectId: req.params.projectId,
      summary: buildTaxSummary(transactions),
      transactions,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load project tax summary' });
  }
});

app.get('/tax/summary', authMiddleware, async (_req, res) => {
  try {
    const transactions = await prisma.transaction.findMany();
    return res.json({
      summary: buildTaxSummary(transactions),
      transactions,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to calculate tax summary' });
  }
});

app.get('/dashboard/summary', authMiddleware, async (_req, res) => {
  try {
    const [projectCount, activeProjects, totalBudget, totalTransactions, pettyCashTotal] = await Promise.all([
      prisma.project.count(),
      prisma.project.count({ where: { status: 'ACTIVE' } }),
      prisma.project.aggregate({ _sum: { contractValue: true } }),
      prisma.transaction.aggregate({
        _sum: {
          grossAmount: true,
          vatAmount: true,
          withholdingAmount: true,
          netAmount: true,
        },
      }),
      prisma.pettyCashRequest.aggregate({ _sum: { amount: true } }),
    ]);

    return res.json({
      totalProjects: projectCount,
      activeProjects,
      totalBudget: Number(totalBudget._sum.contractValue || 0),
      taxSummary: {
        gross: Number(totalTransactions._sum.grossAmount || 0),
        vat: Number(totalTransactions._sum.vatAmount || 0),
        withholding: Number(totalTransactions._sum.withholdingAmount || 0),
        net: Number(totalTransactions._sum.netAmount || 0),
      },
      pettyCashTotal: Number(pettyCashTotal._sum.amount || 0),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard summary' });
  }
});

app.get('/invoices', authMiddleware, async (_req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        project: true,
        party: true,
      },
    });

    return res.json(invoices);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch invoices' });
  }
});

app.get('/invoices/:id', authMiddleware, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        project: true,
        party: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    return res.json(invoice);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch invoice' });
  }
});

app.post('/invoices', authMiddleware, async (req, res) => {
  try {
    const {
      companyId,
      projectId,
      partyId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      grossAmount,
      vatAmount,
      withholdingAmount,
      status,
    } = req.body as any;

    const netAmount = Number(
      req.body.netAmount ??
        (Number(grossAmount || 0) + Number(vatAmount || 0) - Number(withholdingAmount || 0))
    );

    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        projectId,
        partyId,
        invoiceNumber,
        invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        grossAmount: Number(grossAmount || 0),
        vatAmount: Number(vatAmount || 0),
        withholdingAmount: Number(withholdingAmount || 0),
        netAmount,
        status: status || 'DRAFT',
      },
    });

    await createApprovalRecord('invoice', invoice.id, req.user.id, 'Pending invoice approval');

    return res.status(201).json(invoice);
  } catch (error) {
    return res.status(400).json({ message: 'Failed to create invoice' });
  }
});

app.get('/journal-entries', authMiddleware, async (_req, res) => {
  try {
    const entries = await prisma.journalEntry.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        project: true,
        lines: true,
      },
    });

    return res.json(entries);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch journal entries' });
  }
});

app.get('/journal-entries/:id', authMiddleware, async (req, res) => {
  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: req.params.id },
      include: {
        project: true,
        lines: true,
      },
    });

    if (!entry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    return res.json(entry);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch journal entry' });
  }
});

app.post('/journal-entries', authMiddleware, async (req, res) => {
  try {
    const {
      companyId,
      projectId,
      entryNumber,
      description,
      postedAt,
      lines,
    } = req.body as any;

    const entry = await prisma.journalEntry.create({
      data: {
        companyId,
        projectId,
        entryNumber,
        description,
        postedAt: postedAt ? new Date(postedAt) : null,
        lines: {
          create: (lines || []).map((line: any) => ({
            accountCode: line.accountCode,
            debit: Number(line.debit || 0),
            credit: Number(line.credit || 0),
            description: line.description || null,
          })),
        },
      },
      include: {
        lines: true,
      },
    });

    return res.status(201).json(entry);
  } catch (error) {
    return res.status(400).json({ message: 'Failed to create journal entry' });
  }
});

app.get('/reports/summary', authMiddleware, async (_req, res) => {
  try {
    const [totalProjects, activeProjects, totalContractValue, totalPettyCash, totalInvoice, totalTax, pendingApprovals] = await Promise.all([
      prisma.project.count(),
      prisma.project.count({ where: { status: 'ACTIVE' } }),
      prisma.project.aggregate({ _sum: { contractValue: true } }),
      prisma.pettyCashRequest.aggregate({ _sum: { amount: true } }),
      prisma.invoice.aggregate({ _sum: { netAmount: true } }),
      prisma.transaction.aggregate({
        _sum: {
          vatAmount: true,
          withholdingAmount: true,
          netAmount: true,
        },
      }),
      prisma.approval.count({ where: { status: 'PENDING' } }),
    ]);

    return res.json({
      totalProjects,
      activeProjects,
      totalContractValue: Number(totalContractValue._sum.contractValue || 0),
      totalPettyCash: Number(totalPettyCash._sum.amount || 0),
      totalInvoice: Number(totalInvoice._sum.netAmount || 0),
      totalTax: Number(
        (totalTax._sum.vatAmount || 0) +
        (totalTax._sum.withholdingAmount || 0) +
        (totalTax._sum.netAmount || 0)
      ),
      pendingApprovals,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate reports summary' });
  }
});

app.get('/reports/project/:projectId', authMiddleware, async (req, res) => {
  try {
    const projectId = req.params.projectId;

    const [project, pettyCash, invoiceSummary, taxSummary, latestApproval] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
      }),
      prisma.pettyCashRequest.aggregate({
        where: { projectId },
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        where: { projectId },
        _sum: { netAmount: true },
      }),
      prisma.transaction.aggregate({
        where: { projectId },
        _sum: {
          grossAmount: true,
          vatAmount: true,
          withholdingAmount: true,
          netAmount: true,
        },
      }),
      prisma.approval.findFirst({
        where: {
          entityType: 'project',
          entityId: projectId,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    return res.json({
      projectId: project.id,
      projectName: project.name,
      contractValue: Number(project.contractValue || 0),
      totalPettyCash: Number(pettyCash._sum.amount || 0),
      totalInvoice: Number(invoiceSummary._sum.netAmount || 0),
      taxSummary: {
        gross: Number(taxSummary._sum.grossAmount || 0),
        vat: Number(taxSummary._sum.vatAmount || 0),
        withholding: Number(taxSummary._sum.withholdingAmount || 0),
        net: Number(taxSummary._sum.netAmount || 0),
      },
      approvalStatus: latestApproval?.status || 'PENDING',
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate project report' });
  }
});

app.get('/reports/finance', authMiddleware, async (_req, res) => {
  try {
    const [pettyCash, invoices, taxTransactions] = await Promise.all([
      prisma.pettyCashRequest.aggregate({
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        _sum: { netAmount: true },
      }),
      prisma.transaction.findMany(),
    ]);

    const taxSummary = buildTaxSummary(taxTransactions);
    const totalPettyCash = Number(pettyCash._sum.amount || 0);
    const totalInvoice = Number(invoices._sum.netAmount || 0);
    const inflow = totalInvoice;
    const outflow = totalPettyCash + Number(taxSummary.net || 0);

    return res.json({
      totalPettyCash,
      totalInvoice,
      taxSummary,
      inflow,
      outflow,
      netPosition: inflow - outflow,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate finance report' });
  }
});

app.get('/reports/approvals', authMiddleware, async (_req, res) => {
  try {
    const approvals = await prisma.approval.findMany({
      include: {
        approver: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const summary = approvals.reduce(
      (acc, item) => {
        acc[item.entityType] = acc[item.entityType] || { total: 0, pending: 0, approved: 0, rejected: 0 };
        acc[item.entityType].total += 1;

        if (item.status === 'PENDING') acc[item.entityType].pending += 1;
        if (item.status === 'APPROVED') acc[item.entityType].approved += 1;
        if (item.status === 'REJECTED') acc[item.entityType].rejected += 1;

        return acc;
      },
      {} as Record<string, { total: number; pending: number; approved: number; rejected: number }>
    );

    return res.json({
      total: approvals.length,
      summary,
      approvals,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate approval report' });
  }
});

app.listen(port, () => {
  console.log(`MODEZTYPROkon API running at http://localhost:${port}`);
});
