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

app.listen(port, () => {
  console.log(`MODEZTYPROkon API running at http://localhost:${port}`);
});
