# MODEZTYPROkon

MODEZTYPROkon is a simple ERP starter for contractor and construction businesses in Indonesia.

This repo includes:
- Prisma schema for core project + tax + accounting data
- seed data for sample company and admin user
- Express API with auth, company, project, petty cash, and tax summary endpoints
- ready structure for further ERP development

## Quick start

1. Install dependencies
   ```bash
   npm install
   ```

2. Copy env file
   ```bash
   cp .env.example .env
   ```

3. Generate Prisma client
   ```bash
   npx prisma generate
   ```

4. Run Prisma migration
   ```bash
   npx prisma migrate dev --name init
   ```

5. Seed sample data
   ```bash
   npm run prisma:seed
   ```

6. Run app
   ```bash
   npm run dev
   ```

## Default login
- username: `superadmin`
- password: `admin123`

## API samples
- `POST /auth/login`
- `GET /health`
- `GET /companies`
- `GET /projects`
- `GET /petty-cash`
- `GET /tax-summary`

## Main structure
- `prisma/schema.prisma` — database schema
- `prisma/seed.ts` — sample seed data
- `src/index.ts` — Express API entry point
- `src/lib/prisma.ts` — Prisma client instance

## Notes
This is a working starter project. It is intentionally simplified so the schema and the backend can be developed safely without Prisma relation-name errors.
