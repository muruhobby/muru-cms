import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createRegionsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Idempotently configures the backend for an Indonesia (IDR) storefront so that
 * carts can be created and completed into orders:
 *   - IDR as the store's default supported currency
 *   - "Indonesia" region (country `id`, currency `idr`, system payment provider)
 *   - tax region for `id`
 *   - a fulfillment set + service zone on the existing stock location
 *   - flat-rate "Standard" (Rp 20.000) and "Free" shipping options
 *
 * Run with: npx medusa exec ./src/scripts/setup-id-storefront.ts
 */
export default async function setupIdStorefront({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const storeModule = container.resolve(Modules.STORE);
  const regionModule = container.resolve(Modules.REGION);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION);
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);

  const COUNTRY = "id";
  const CURRENCY = "idr";

  // 1. Store default currency -> IDR ----------------------------------------
  const [store] = await storeModule.listStores();
  const hasIdr = store.supported_currencies?.some(
    (c) => c.currency_code === CURRENCY
  );
  if (!hasIdr) {
    await storeModule.updateStores(store.id, {
      supported_currencies: [{ currency_code: CURRENCY, is_default: true }],
    });
    logger.info(`Set store default currency to ${CURRENCY.toUpperCase()}.`);
  }

  // 2. Region ----------------------------------------------------------------
  // Match an existing IDR region first (the admin may have created one already,
  // possibly under a different/misspelled name) before creating a new one.
  const allRegions = await regionModule.listRegions(
    {},
    { relations: ["countries"] }
  );
  let region = allRegions.find(
    (r) =>
      r.currency_code === CURRENCY ||
      (r as any).countries?.some((c: any) => c.iso_2 === COUNTRY)
  );

  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Indonesia",
            currency_code: CURRENCY,
            countries: [COUNTRY],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
    region = result[0];
    logger.info(`Created region "Indonesia" (${region.id}).`);
  } else {
    logger.info(`Using existing IDR region "${region.name}" (${region.id}).`);
    // Correct an obvious typo and ensure the system payment provider is enabled.
    if (region.name !== "Indonesia") {
      await regionModule.updateRegions(region.id, { name: "Indonesia" });
      logger.info(`Renamed region "${region.name}" -> "Indonesia".`);
    }
    // Ensure the system payment provider is linked to the region (idempotent).
    await link
      .create({
        [Modules.REGION]: { region_id: region.id },
        [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
      })
      .then(() => logger.info("Linked system payment provider to region."))
      .catch(() => logger.info("Payment provider already linked to region."));
  }

  // 3. Tax region ------------------------------------------------------------
  try {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: COUNTRY, provider_id: "tp_system" }],
    });
    logger.info(`Created tax region for "${COUNTRY}".`);
  } catch (e) {
    logger.info(`Tax region for "${COUNTRY}" already exists — skipping.`);
  }

  // 4. Default sales channel + location on store -----------------------------
  const [stockLocation] = await stockLocationModule.listStockLocations({});
  if (!stockLocation) {
    throw new Error("No stock location found — expected 'South Tangerang'.");
  }
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: { default_location_id: stockLocation.id },
    },
  });

  // Link stock location to the manual fulfillment provider (idempotent).
  await link
    .create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    })
    .catch(() => logger.info("Location<->provider link already exists."));

  // Link the sales channel to the stock location — without this the cart cannot
  // see the location's shipping options at checkout.
  const [salesChannel] = await salesChannelModule.listSalesChannels({
    name: "Default Sales Channel",
  });
  if (salesChannel) {
    await linkSalesChannelsToStockLocationWorkflow(container)
      .run({
        input: { id: stockLocation.id, add: [salesChannel.id] },
      })
      .catch(() =>
        logger.info("Sales channel <-> location link already exists.")
      );
    logger.info("Linked Default Sales Channel to stock location.");
  }

  // 5. Shipping profile ------------------------------------------------------
  const profiles = await fulfillmentModule.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = profiles[0];
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    });
    shippingProfile = result[0];
    logger.info("Created default shipping profile.");
  }

  // 6. Fulfillment set + service zone ---------------------------------------
  // Reuse the existing service zone (created in admin) if present; otherwise
  // create a fulfillment set + zone and link it to the stock location.
  const serviceZones = await fulfillmentModule.listServiceZones(
    {},
    { relations: ["geo_zones"] }
  );
  let serviceZone = serviceZones.find((z: any) =>
    z.geo_zones?.some((g: any) => g.country_code === COUNTRY)
  );

  if (!serviceZone) {
    const fulfillmentSet = await fulfillmentModule.createFulfillmentSets({
      name: "Indonesia delivery",
      type: "shipping",
      service_zones: [
        {
          name: "Indonesia",
          geo_zones: [{ country_code: COUNTRY, type: "country" }],
        },
      ],
    });
    await link
      .create({
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
      })
      .catch(() => logger.info("Location<->set link already exists."));
    serviceZone = (fulfillmentSet as any).service_zones[0];
    logger.info(`Created fulfillment set "${fulfillmentSet.name}".`);
  } else {
    logger.info(`Using existing service zone "${serviceZone.name}" (${serviceZone.id}).`);
  }

  if (!serviceZone) {
    throw new Error("Could not resolve a service zone for Indonesia delivery.");
  }
  const serviceZoneId = serviceZone.id;

  // 7. Shipping options ------------------------------------------------------
  const { data: existingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
    filters: { service_zone_id: serviceZoneId },
  });
  const existingNames = new Set(existingOptions.map((o: any) => o.name));

  const optionsToCreate = [
    {
      name: "Standard Shipping",
      amount: 20000,
      type: { label: "Standard", description: "Ship in 2-5 days.", code: "standard" },
    },
    {
      name: "Free Shipping",
      amount: 0,
      type: { label: "Free", description: "Free over Rp 300.000.", code: "free" },
    },
  ].filter((o) => !existingNames.has(o.name));

  if (optionsToCreate.length) {
    await createShippingOptionsWorkflow(container).run({
      input: optionsToCreate.map((o) => ({
        name: o.name,
        price_type: "flat" as const,
        provider_id: "manual_manual",
        service_zone_id: serviceZoneId,
        shipping_profile_id: shippingProfile.id,
        type: o.type,
        prices: [
          { currency_code: CURRENCY, amount: o.amount },
          { region_id: region.id, amount: o.amount },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
          { attribute: "is_return", value: "false", operator: "eq" as const },
        ],
      })),
    });
    logger.info(`Created shipping options: ${optionsToCreate.map((o) => o.name).join(", ")}.`);
  } else {
    logger.info("Shipping options already exist — skipping.");
  }

  logger.info("✅ Indonesia storefront backend setup complete.");
}
