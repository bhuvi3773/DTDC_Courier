# Book Courier Services — Production Tech Stack & Hostinger Deployment Guide

**Architecture Standard:** Aligned with the proven, production-tested **Snappy Giftz** architecture on Hostinger Cloud.

---

## 1. System Overview & Technology Matrix

| Layer | Technology | Version | Purpose & Hostinger Compatibility |
|:---|:---|:---|:---|
| **Full-Stack Framework** | **Next.js** (App Router) | `^16.4.3` | Unified React framework powering both frontend UI pages and backend `/api/...` route handlers. Configured with `output: 'standalone'`. |
| **UI Library** | **React & React DOM** | `^19.0.1` | React 19 component architecture with modern concurrent features. |
| **Programming Language** | **TypeScript** | `^7.0.2` | Strict type safety with native `@/*` $\rightarrow$ `./src/*` path aliasing. |
| **Styling & Design System** | **Tailwind CSS v4** | `^4.3.3` | Modern `@import "tailwindcss";` with `@tailwindcss/postcss`. Zero runtime CSS-in-JS overhead. |
| **Icons** | **Lucide Icons** | `^0.546.0` | Lightweight, scalable vector icons (`lucide-react`). |
| **Motion & Micro-interactions** | **Motion** | `^12.23.24` | Modern Framer Motion package for animated modals, transitions, and sliders. |
| **Database ORM** | **Prisma ORM** | `^6.19.3` | Type-safe query engine and migration tool. Both `prisma` and `@prisma/client` are kept in **`dependencies`** to support Hostinger production installs. |
| **Production Database** | **Hostinger Managed MySQL / PostgreSQL** | MySQL 8+ / MariaDB | Hosted natively on Hostinger hPanel with connection pooling. |
| **Authentication & Encryption** | **Bcrypt.js** | `^3.0.3` | Password hashing for staff and customer credentials. |
| **Payment Gateway** | **Razorpay** | REST API & Webhooks | Order generation, HMAC SHA256 signature verification, and automated refunds with Hostinger CSP headers. |
| **Transactional Email** | **Nodemailer** | `^10.3.1` | SMTP-based transactional email delivery for invoices and notifications. |
| **Testing & Verification** | **Playwright & TSX** | Playwright `^1.64.1`, TSX `^4.21.0` | Browser E2E journeys and automated unit/integration test suites. |
| **Production Platform** | **Hostinger Business Cloud** | Node.js 22 LTS / 20 LTS | Linux Cloud Web App with native process management. |

---

## 2. Hostinger Database Architecture

Hostinger's standard managed database platform in hPanel is **MySQL 8+ / MariaDB** (or external PostgreSQL). The application supports both seamlessly via Prisma:

### A. Hostinger hPanel Database Configuration
1. Open Hostinger **hPanel** $\rightarrow$ **Databases** $\rightarrow$ **Management**.
2. Create a new MySQL database:
   - **Database Name:** e.g., `u285517860_book_courier`
   - **Username:** e.g., `u285517860_courier_user`
   - **Password:** Strong generated password
3. Copy the Hostinger connection string into `.env`:
   ```env
   # Format for Hostinger Local Database (App & DB on same Hostinger account):
   DATABASE_URL="mysql://u285517860_courier_user:YOUR_STRONG_PASSWORD@localhost:3306/u285517860_book_courier"

   # Or if using Remote MySQL / PostgreSQL:
   DATABASE_URL="mysql://u285517860_courier_user:YOUR_STRONG_PASSWORD@sqlXXX.main-hosting.eu:3306/u285517860_book_courier"
   ```

### B. Prisma Schema Provider Setting
In `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "mysql" // Or "postgresql" depending on your Hostinger database instance
  url      = env("DATABASE_URL")
}
```

### C. Database Migration & Seeding on Hostinger
Run directly via Hostinger SSH terminal or deployment script:
```bash
npx prisma db push
npx tsx prisma/seed.ts
```

---

## 3. Hostinger Production Build Architecture (Learned from Snappy Giftz)

During deployments of Snappy Giftz on Hostinger, three critical constraints were identified and permanently resolved:

### 1. Webpack Build Engine (`next build --webpack`)
- **Problem:** Turbopack failed in Hostinger's Linux container with process creation exits:
  ```text
  creating new process: node process exited before we could connect to it
  ```
- **Solution:** Configure `"build": "prisma generate && next build --webpack"` in `package.json`. Webpack compiles all code and PostCSS transforms directly within the primary Node.js process without spawning unprivileged child processes.

### 2. Prisma in Production `dependencies`
- **Problem:** Hostinger runs `npm install --omit=dev` (or `NODE_ENV=production`). If `prisma` CLI is under `devDependencies`, npm omits `node_modules/.bin/prisma`, causing `"postinstall": "prisma generate"` to fail with `prisma: command not found`.
- **Solution:** Both `prisma` and `@prisma/client` are located strictly in **`dependencies`** in `package.json`.

### 3. Native Webpack Path Aliasing in `next.config.mjs`
- **Problem:** Case-sensitive Linux filesystems can occasionally fail on `@/*` imports during route compilation.
- **Solution:** Explicitly map the `@` alias using Node's native `path.resolve`:
  ```javascript
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname, 'src'),
    };
    return config;
  }
  ```

### 4. Standalone Output Mode
- **Configuration:** `output: 'standalone'` in `next.config.mjs`.
- **Benefit:** Automatically packages only the exact production files needed by Next.js, drastically reducing disk footprint on Hostinger.

### 5. Clean TypeScript Production Scope
- In `tsconfig.json`, development test files (`src/test/**`, `playwright.config.ts`) are excluded from Next.js build compilation so production builds pass cleanly without needing test-runner devDependencies installed.

### 6. POSIX 0755 Directory Permissions for ZIP Packages
- **Problem:** Windows `Compress-Archive` omits Unix execute (`+x`) traversal bits on directories, triggering `EACCES: permission denied, scandir` errors when Next.js discovers `/src/app/api` routes on Linux.
- **Solution:** Deployment ZIP archives must be created with POSIX directory mode **`0755`** (`drwxr-xr-x`).

---

## 4. Key Configuration Files Reference

### A. `.npmrc`
Ensures peer dependency compatibility between React 19 and ecosystem libraries:
```ini
legacy-peer-deps=true
```

### B. `package.json` Scripts & Dependencies
```json
{
  "name": "book-courier-platform",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "postinstall": "prisma generate",
    "build": "prisma generate && next build --webpack",
    "start": "next start --port 3000",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "npx tsx src/test/run-all.ts",
    "seed": "npx tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.19.3",
    "@tailwindcss/postcss": "^4.3.3",
    "bcryptjs": "^3.0.3",
    "dotenv": "^17.2.3",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "next": "^16.4.3",
    "nodemailer": "^10.3.1",
    "prisma": "^6.19.3",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "typescript": "^7.0.2"
  },
  "devDependencies": {
    "@playwright/test": "^1.64.1",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^22.14.0",
    "@types/nodemailer": "^8.0.2",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "autoprefixer": "^10.4.21",
    "tailwindcss": "^4.3.3",
    "tsx": "^4.21.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## 5. Deployment Checklist on Hostinger

1. **Hostinger hPanel Setup:**
   - Create a **Node.js Web App** in hPanel.
   - Set **Node.js Version:** `22.x LTS` (or `20.x LTS`).
   - Set **Application Mode:** `Production`.
   - Set **Application Root:** `public_html`.
2. **Environment Variables:**
   - In hPanel under Node.js $\rightarrow$ **Environment Variables**, configure:
     - `NODE_ENV=production`
     - `PORT=3000`
     - `DATABASE_URL=mysql://<user>:<password>@localhost:3306/<database>`
     - `JWT_ACCESS_SECRET=<secure-random-32-chars>`
     - `JWT_REFRESH_SECRET=<secure-random-32-chars>`
     - `NEXT_PUBLIC_APP_URL=https://your-domain.com`
     - `RAZORPAY_KEY_ID=...`
     - `RAZORPAY_KEY_SECRET=...`
     - `RAZORPAY_WEBHOOK_SECRET=...`
3. **Upload Archive:**
   - Upload the POSIX-compliant deployment ZIP to `public_html/`.
   - Extract files.
4. **Build & Start:**
   - Click **Run npm install** or run `npm install` via SSH.
   - Run `npx prisma db push` to synchronize the schema.
   - Click **Start** or **Restart** on the Node.js application in hPanel.

