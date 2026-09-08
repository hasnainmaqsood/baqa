# Baqal Dashboard — Supabase Backend

A shop dashboard (products, sellers, clients, sales, digital khata/credit ledger)
backed by Express + Supabase.

## 1. Create the Supabase database

Open your Supabase project → **SQL Editor** → paste the contents of `supabase.sql`
→ Run. (This file was missing from the original project — without it, every
API call fails because the tables and RPC functions it relies on don't exist.)

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your Supabase project URL and
**service role key** (Project Settings → API → `service_role` secret — it's a
long JWT starting with `eyJ...`, not the project ref).

```env
PORT=3000
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

The service-role key must stay on the Node.js server and must never be placed
in frontend JavaScript — the frontend only ever talks to `/api/...` on this
server, never to Supabase directly.

## 3. Install and run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## API

- `GET/POST /api/products`
- `PUT/DELETE /api/products/:id`
- `GET /api/products/low-stock`
- `GET/POST /api/sellers`
- `PUT/DELETE /api/sellers/:id`
- `GET/POST /api/clients`
- `PUT/DELETE /api/clients/:id`
- `GET /api/clients/:id/khata`
- `GET /api/sales`
- `POST /api/sales/complete`
- `POST /api/clients/:id/payment`
- `POST /api/next-invoice`
- `GET /api/dashboard/stats`
- `GET /api/health`

## Deploying

This is a standard Node/Express app — it works as-is on Render, Railway,
Fly.io, a VPS, etc.

1. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as environment
   variables in your host's dashboard (don't upload your real `.env` file).
2. Build/start command: `npm install && npm start`.
3. The app listens on `process.env.PORT`, which most platforms set
   automatically.

## What was fixed in this pass

- **Missing `supabase.sql`** — the file the README told you to run didn't
  exist in the archive. Recreated it: `products`, `sellers`, `clients`,
  `sales` tables plus the `next_invoice_no`, `complete_sale`, and
  `record_khata_payment` functions the backend calls via `supabase.rpc(...)`.
- **Static files exposed the whole project** — `express.static(__dirname)`
  served `server.js`, `.env`, `package.json`, and `node_modules` to anyone
  who requested them by URL. Frontend assets now live in `public/`, and only
  that folder is served.
- **Broken low-stock query** — `/api/products/low-stock` used
  `.filter("stock", "lte", "low_stock")`, which compares the `stock` column
  to the literal string `"low_stock"`, not to the `low_stock` column. Fixed
  to compare the two columns correctly.
- **Invalid Supabase key in `.env`** — the service-role key was set to the
  project ref, not a real key (real ones are JWTs starting with `eyJ...`).
  Replaced with a clearly-marked placeholder; you must add your real key.
- **Unnecessary dependency** — removed the `path` npm package from
  `package.json`. It shadowed nothing (Node's built-in `path` module always
  wins), so it was dead weight; `require("path")` in `server.js` still works
  exactly as before.
- Added `.gitignore` and `.env.example` so secrets and `node_modules` don't
  end up committed or re-zipped.

### Known dead code (left in place, not deleted)

`public/js/storage.js`, `render.js`, `charts.js`, and `print.js` are not
loaded anywhere — `index.html` only loads `js/app.js` as a module, and
`app.js` is fully self-contained (it has its own fetch logic, chart
rendering, and receipt printing). Those four files also mix `lifetimeCredit`
(camelCase) with the database's real `lifetime_credit` column, which would
silently break khata balances if they were ever wired in. Left untouched
since removing files wasn't asked for — just flagging it in case a future
change starts importing them.
