# muru-cms

Medusa v2 backend (admin dashboard + Store/Admin REST APIs).

- **API:** http://localhost:9000
- **Admin dashboard:** http://localhost:9000/app

## Prerequisites

- **Node.js 20 or 22** (Medusa does not support Node 23+). This repo is built against **Node 22**.
- **PostgreSQL 14+** running locally (or a remote connection URL).
- **npm** (the lockfile and scripts assume npm).
- *(Optional)* **Redis** — only needed if you switch the event bus / cache / workflow engine off the default in-memory drivers.

If you use `nvm`:

```bash
nvm install 22
nvm use 22
```

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

A `.env` file is already present with local defaults. Update it if your Postgres
credentials differ:

```bash
# .env
DATABASE_URL=postgres://angelavanx@localhost:5432/medusa_cms_ecommerce
DB_NAME=medusa_cms_ecommerce
REDIS_URL=redis://localhost:6379

JWT_SECRET=supersecret      # change before deploying
COOKIE_SECRET=supersecret   # change before deploying

STORE_CORS=http://localhost:8000,http://localhost:3000
ADMIN_CORS=http://localhost:5173,http://localhost:9000
AUTH_CORS=http://localhost:5173,http://localhost:9000,http://localhost:3000
```

> `JWT_SECRET` and `COOKIE_SECRET` must be changed to strong random values before
> deploying. CORS values are comma-separated lists of allowed origins.
>
> **macOS / Homebrew Postgres:** the default superuser is your system username with
> no password (not `postgres`), so the URL is `postgres://<your-username>@localhost:5432/<db>`.
> Run `whoami` to get the username. On Linux/Docker it's usually
> `postgres://postgres:postgres@localhost:5432/<db>`.

## 3. Create the database

Make sure Postgres is running, then create the database (skip if it already exists):

```bash
createdb medusa_cms_ecommerce
# or, using Medusa's helper:
npx medusa db:create
```

## 4. Run migrations

Creates all the core tables:

```bash
npx medusa db:migrate
```

## 5. Create an admin user

Needed to log in to the dashboard at `/app`:

```bash
npx medusa user --email admin@example.com --password supersecret
```

## 6. (Optional) Seed demo data

Populates a sample region, products, etc. via `src/scripts/seed.ts`:

```bash
npm run seed
```

## 7. Start the dev server

```bash
npm run dev
```

- API → http://localhost:9000
- Admin dashboard → http://localhost:9000/app

The dev server hot-reloads on changes to `src/`.

## Production

```bash
npm run build       # builds server + admin into .medusa/
npm run start:prod  # migrate -> bootstrap admin -> seed Employee role -> start
```

`start:prod` is the recommended deploy command (it's what `railway.toml` runs). It:
1. runs migrations,
2. idempotently creates the owner admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
3. idempotently ensures the `Employee` RBAC role exists (and assigns it to `EMPLOYEE_EMAIL` if set),
4. starts the server.

Use plain `npm run start` if you want to start without the migrate/bootstrap steps.

## Roles & permissions (RBAC)

RBAC is **enabled** for this backend (`MEDUSA_FF_RBAC=true` in `.env`, plus the
`@medusajs/medusa/rbac` module is registered in `medusa-config.ts`). Two roles ship:

| Role | Access |
| --- | --- |
| **Super Admin** (`role_super_admin`) | Full access (`*:*`). Auto-assigned to the owner by `bootstrap-admin`. |
| **Employee** | Day-to-day only: products, inventory, orders, fulfillments, customers, promotions, pricing. **Cannot** manage admin users, roles, API keys, or store/region/tax/sales-channel settings. |

> ⚠️ With RBAC on, **an admin user with no role is locked out of every gated route.**
> Always assign a role. The `bootstrap-admin` script handles the owner automatically.

**Assign the Employee role to someone:**
1. Create the user (e.g. `npx medusa user -e staff@store.com -p '...'`).
2. Set `EMPLOYEE_EMAIL=staff@store.com` in `.env`.
3. Run `npm run seed:employee-role`.
4. Have them **log out and back in** — roles are read into the JWT at login.

Edit `EMPLOYEE_ALLOWED_RESOURCES` in `src/scripts/seed-employee-role.ts` to widen/narrow
what the Employee can do. (Enforcement is per-route: core admin routes already declare the
required `resource:operation` policies, so the allow-list takes effect immediately.)

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the backend in watch mode |
| `npm run build` | Build server + admin for production |
| `npm run start` | Start the production build |
| `npm run start:prod` | Migrate + bootstrap admin + seed role + start (deploy command) |
| `npm run seed` | Seed demo data |
| `npm run bootstrap:admin` | Create the owner admin from env vars |
| `npm run seed:employee-role` | Create/refresh the Employee role (assign to `EMPLOYEE_EMAIL`) |
| `npx medusa db:migrate` | Run pending migrations |
| `npx medusa db:create` | Create the database |
| `npx medusa user -e <email> -p <password>` | Create an admin user (CLI) |

## Project structure

```
src/
  admin/        Admin dashboard customizations (widgets, routes)
  api/          Custom API routes (admin/ and store/)
  jobs/         Scheduled jobs
  links/        Module links
  modules/      Custom modules (e.g. payment / file providers)
  subscribers/  Event subscribers
  workflows/    Custom workflows
  scripts/      One-off scripts (seed.ts, etc.)
medusa-config.ts  Medusa configuration & module registration
```

## Notes

- `npm audit` reports vulnerabilities that live inside Medusa's own transitive
  dependencies (e.g. `react-router` in the admin, `uuid` via telemetry). These are
  expected and are not fixable at the app level. **Do not run `npm audit fix --force`** —
  it tries to "fix" them by downgrading `@medusajs/medusa` to v1, which breaks the project.
- Learn more in the [Medusa documentation](https://docs.medusajs.com).
