import { readFileSync } from "fs";
import path from "path";
import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows";

type CatalogVariant = { sku: string; title: string };
type CatalogProduct = {
  title: string;
  handle: string;
  brand: string;
  franchise: string;
  line: string;
  emoji: string;
  variants: CatalogVariant[];
};

// Placeholder price for every variant (IDR). Real prices are filled in admin.
const PLACEHOLDER_PRICE = 150000;
const BATCH_SIZE = 15;

// Sample products from the original demo seed — removed on replace.
const SAMPLE_HANDLES = [
  "iron-sentinel-mk-iv",
  "converge-160-bujin-tycoon",
  "ultraman-blazar-legend-ed",
  "rex-mech-zero",
  "pokemon-tcg-chinese-30th-booster",
  "kamen-rider-ryuki-shinkocchou",
];

/**
 * Seeds the full Muru catalog from `muru-catalog.json` (generated from the SKU
 * master spreadsheet): 121 products grouped by franchise, each with its variant
 * SKUs at a placeholder price. Idempotent — re-running refreshes the catalog.
 *
 * Run with: npx medusa exec ./src/scripts/seed-muru-products.ts
 */
export default async function seedMuruProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);
  const productModule = container.resolve(Modules.PRODUCT);

  const catalog: CatalogProduct[] = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "src/scripts/muru-catalog.json"),
      "utf-8"
    )
  );
  logger.info(`Loaded catalog: ${catalog.length} products.`);

  // Run-once guard: if the catalog is already fully seeded, skip. This keeps
  // deploys fast and preserves admin edits to these products, since the seed
  // below otherwise deletes and recreates every catalog product.
  const catalogHandles = new Set(catalog.map((p) => p.handle));
  const { data: alreadySeeded } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  });
  const seededCount = alreadySeeded.filter((p: any) =>
    catalogHandles.has(p.handle)
  ).length;
  if (seededCount >= catalog.length) {
    logger.info(
      `Catalog already seeded (${seededCount}/${catalog.length} present) — skipping.`
    );
    return;
  }

  const [salesChannel] = await salesChannelModule.listSalesChannels({
    name: "Default Sales Channel",
  });
  const [shippingProfile] = await fulfillmentModule.listShippingProfiles({
    type: "default",
  });
  if (!salesChannel || !shippingProfile) {
    throw new Error("Missing default sales channel or shipping profile.");
  }

  // 1. Replace: delete samples + any existing catalog products ----------------
  const handlesToReplace = new Set([
    ...SAMPLE_HANDLES,
    ...catalog.map((p) => p.handle),
  ]);
  const { data: existing } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  });
  const toDelete = existing
    .filter((p: any) => handlesToReplace.has(p.handle))
    .map((p: any) => p.id);
  if (toDelete.length) {
    await productModule.deleteProducts(toDelete);
    logger.info(`Deleted ${toDelete.length} existing product(s) to replace.`);
  }

  // 2. Categories (one per franchise) ----------------------------------------
  const franchises = [...new Set(catalog.map((p) => p.franchise))];
  const { data: existingCats } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  });
  const catByName = new Map<string, string>(
    existingCats.map((c: any) => [c.name, c.id])
  );
  const missingCats = franchises.filter((f) => !catByName.has(f));
  if (missingCats.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingCats.map((name) => ({ name, is_active: true })),
      },
    });
    result.forEach((c: any) => catByName.set(c.name, c.id));
    logger.info(`Created categories: ${missingCats.join(", ")}.`);
  }

  // 3. Create products in batches --------------------------------------------
  const toInput = (p: CatalogProduct) => {
    // Variant option values must be unique within the product.
    const seen = new Map<string, number>();
    const variants = p.variants.map((v) => {
      let value = v.title;
      const n = seen.get(value) ?? 0;
      seen.set(value, n + 1);
      if (n > 0) value = `${value} ${n + 1}`;
      return {
        title: value,
        sku: v.sku,
        manage_inventory: false,
        options: { Variant: value },
        prices: [{ amount: PLACEHOLDER_PRICE, currency_code: "idr" }],
      };
    });
    return {
      title: p.title,
      handle: p.handle,
      subtitle: p.line || p.franchise,
      description: `${p.brand} — ${p.franchise}${p.line ? ` · ${p.line}` : ""}. Authentic, sourced direct.`,
      status: ProductStatus.PUBLISHED,
      category_ids: [catByName.get(p.franchise)!],
      shipping_profile_id: shippingProfile.id,
      sales_channels: [{ id: salesChannel.id }],
      metadata: {
        emoji: p.emoji,
        brand: p.brand,
        franchise: p.franchise,
        category_label: `${p.brand} · ${p.franchise}`.toUpperCase(),
      },
      options: [
        { title: "Variant", values: variants.map((v) => v.title) },
      ],
      variants,
    };
  };

  let created = 0;
  for (let i = 0; i < catalog.length; i += BATCH_SIZE) {
    const batch = catalog.slice(i, i + BATCH_SIZE);
    await createProductsWorkflow(container).run({
      input: { products: batch.map(toInput) },
    });
    created += batch.length;
    logger.info(`Created products ${created}/${catalog.length}…`);
  }

  logger.info(`✅ Muru catalog seed complete: ${created} products.`);
}
