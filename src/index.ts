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

  const summary = transactions.reduce(
    (acc, item) => {
      acc.gross += Number(item.grossAmount);
      acc.vat += Number(item.vatAmount);
      acc.withholding += Number(item.withholdingAmount);
      acc.net += Number(item.netAmount);
      return acc;
    },
    { gross: 0, vat: 0, withholding: 0, net: 0 }
  );

  return res.json(summary);
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

app.listen(port, () => {
  console.log(`MODEZTYPROkon API running at http://localhost:${port}`);
});
