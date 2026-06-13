# CLI scripts

Run any script with `npx medusa exec ./src/scripts/<file>.ts` (or the npm alias).

## Production deployment

These run automatically in `predeploy:prod` (`npm run` aliases shown):

| Script | npm alias | What it does |
| --- | --- | --- |
| `bootstrap-admin.ts` | `bootstrap:admin` | Idempotently creates the admin owner from `ADMIN_EMAIL`/`ADMIN_PASSWORD` and grants Super Admin. Safe on every deploy. |
| `seed-employee-role.ts` | `seed:employee-role` | Creates/updates the RBAC **Employee** role and its allowed resources. Safe on every deploy. |

Run **once** on a fresh production database (idempotent — safe to re-run):

| Script | npm alias | What it does |
| --- | --- | --- |
| `setup-id-storefront.ts` | `setup:storefront` | Indonesia/IDR region, tax region, sales-channel↔stock-location link, system payment provider. **Checkout cannot work without this.** |
| `setup-biteship-shipping.ts` | `setup:shipping` | Links the Biteship fulfillment provider to the location and creates the JNE/J&T calculated shipping options (replaces flat options). Requires the Biteship provider to be registered (set `BITESHIP_*` env + restart) and a funded Biteship balance to actually return rates. |

## Optional / development

| Script | npm alias | What it does |
| --- | --- | --- |
| `seed-muru-products.ts` | `seed:products` | Seeds the sample Muru catalog (emoji-placeholder products, IDR prices). Demo data only — a real store adds products in admin. |

## First-time production checklist

```bash
npm run predeploy:prod      # migrate + admin + employee role
npm run setup:storefront    # region / currency / shipping prerequisites
npm run setup:shipping      # Biteship courier options (needs BITESHIP_* env)
# npm run seed:products     # optional sample catalog
```
