import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Replaces the flat-rate COD shipping options with Biteship "calculated"
 * courier options (JNE Regular, JNE YES, J&T Express). Idempotent.
 *
 * Prerequisites: the Biteship provider must be registered (restart Medusa after
 * adding it to medusa-config.ts) so it appears in the fulfillment_provider table.
 *
 * Run with: npx medusa exec ./src/scripts/setup-biteship-shipping.ts
 */
export default async function setupBiteshipShipping({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION);

  // 1. Find the Biteship provider --------------------------------------------
  const { data: providers } = await query.graph({
    entity: "fulfillment_provider",
    fields: ["id", "is_enabled"],
  });
  const biteship = providers.find(
    (p: any) => p.id.startsWith("biteship") && p.is_enabled
  );
  if (!biteship) {
    throw new Error(
      "Biteship fulfillment provider not found. Add it to medusa-config.ts and RESTART Medusa before running this script."
    );
  }
  logger.info(`Using Biteship provider: ${biteship.id}`);

  // 1b. Link the Biteship provider to the stock location ----------------------
  // A provider must be enabled for the location before its shipping options can
  // be created in that location's service zone.
  const [stockLocation] = await stockLocationModule.listStockLocations({});
  if (!stockLocation) {
    throw new Error("No stock location found. Run setup-id-storefront first.");
  }
  await link
    .create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: biteship.id },
    })
    .then(() => logger.info("Linked Biteship provider to stock location."))
    .catch(() => logger.info("Biteship provider already linked to location."));

  // 2. Service zone + shipping profile ---------------------------------------
  const serviceZones = await fulfillmentModule.listServiceZones(
    {},
    { relations: ["geo_zones"] }
  );
  const serviceZone = serviceZones.find((z: any) =>
    z.geo_zones?.some((g: any) => g.country_code === "id")
  );
  if (!serviceZone) {
    throw new Error("No Indonesia service zone found. Run setup-id-storefront first.");
  }
  const [shippingProfile] = await fulfillmentModule.listShippingProfiles({
    type: "default",
  });

  // 3. Disable the old flat COD options --------------------------------------
  const { data: existingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "provider_id"],
    filters: { service_zone_id: serviceZone.id },
  });
  const flatOldOnes = existingOptions.filter((o: any) =>
    ["Standard Shipping", "Free Shipping"].includes(o.name)
  );
  if (flatOldOnes.length) {
    await fulfillmentModule.deleteShippingOptions(flatOldOnes.map((o: any) => o.id));
    logger.info(`Removed flat COD options: ${flatOldOnes.map((o: any) => o.name).join(", ")}.`);
  }

  // 4. Create Biteship calculated options ------------------------------------
  const services = [
    { name: "JNE Regular", courier_code: "jne", courier_service_code: "reg" },
    { name: "JNE YES (Next Day)", courier_code: "jne", courier_service_code: "yes" },
    { name: "J&T Express", courier_code: "jnt", courier_service_code: "ez" },
  ];

  const existingNames = new Set(existingOptions.map((o: any) => o.name));
  const toCreate = services.filter((s) => !existingNames.has(s.name));

  if (!toCreate.length) {
    logger.info("Biteship shipping options already exist — skipping.");
    logger.info("✅ Biteship shipping setup complete.");
    return;
  }

  await createShippingOptionsWorkflow(container).run({
    input: toCreate.map((s) => ({
      name: s.name,
      price_type: "calculated" as const,
      provider_id: biteship.id,
      service_zone_id: serviceZone.id,
      shipping_profile_id: shippingProfile.id,
      // Persisted on the option; surfaces as `optionData` in calculatePrice().
      data: {
        courier_code: s.courier_code,
        courier_service_code: s.courier_service_code,
      },
      type: {
        label: s.name,
        description: `${s.courier_code.toUpperCase()} ${s.courier_service_code.toUpperCase()}`,
        code: `${s.courier_code}-${s.courier_service_code}`,
      },
      // Calculated options carry no fixed prices.
      prices: [],
      rules: [
        { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
        { attribute: "is_return", value: "false", operator: "eq" as const },
      ],
    })),
  });
  logger.info(`Created Biteship options: ${toCreate.map((s) => s.name).join(", ")}.`);
  logger.info("✅ Biteship shipping setup complete.");
}
