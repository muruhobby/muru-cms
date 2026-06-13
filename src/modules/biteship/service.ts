import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils";
import {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceContext,
  CreateShippingOptionDTO,
} from "@medusajs/framework/types";
import { BiteshipClient } from "./client";

type BiteshipOptions = {
  apiKey: string;
  originPostalCode: string;
  /** Comma-separated courier codes the rate request should ask for, e.g. "jne,jnt". */
  couriers: string;
  /** Fallback weight (grams) used when a variant has no weight set. */
  defaultWeight: number;
  /** Origin contact details used when booking a shipment. */
  originContactName?: string;
  originContactPhone?: string;
  originAddress?: string;
};

/** The courier services exposed as shipping options (JNE + J&T per config). */
const SERVICES = [
  { id: "jne-reg", courier_code: "jne", courier_service_code: "reg", name: "JNE Regular" },
  { id: "jne-yes", courier_code: "jne", courier_service_code: "yes", name: "JNE YES (Next Day)" },
  { id: "jnt-ez", courier_code: "jnt", courier_service_code: "ez", name: "J&T Express" },
];

export default class BiteshipFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "biteship";

  protected readonly options_: BiteshipOptions;
  protected readonly client_: BiteshipClient;

  constructor(_cradle: unknown, options: BiteshipOptions) {
    super();
    this.options_ = {
      ...options,
      defaultWeight: options.defaultWeight ?? 1000,
      couriers: options.couriers ?? "jne,jnt",
    };
    this.client_ = new BiteshipClient(this.options_.apiKey);
  }

  async getFulfillmentOptions() {
    return SERVICES.map((s) => ({
      id: s.id,
      name: s.name,
      courier_code: s.courier_code,
      courier_service_code: s.courier_service_code,
    }));
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: unknown
  ): Promise<Record<string, unknown>> {
    // Persist the courier identity onto the shipping method so it survives to
    // fulfillment time.
    return {
      ...data,
      courier_code: optionData.courier_code,
      courier_service_code: optionData.courier_service_code,
    };
  }

  async validateOption(_data: Record<string, unknown>): Promise<boolean> {
    return true;
  }

  // Returning true makes these shipping options price-calculated, so Medusa
  // calls calculatePrice() with the cart's destination + items.
  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true;
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: CalculateShippingOptionPriceContext
  ): Promise<CalculatedShippingOptionPrice> {
    const courier = String(optionData.courier_code ?? "");
    const service = String(optionData.courier_service_code ?? "");

    const dest: any = (context as any).shipping_address;
    const destinationPostal = dest?.postal_code;
    if (!destinationPostal) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A destination postal code is required to calculate shipping."
      );
    }

    const items = ((context as any).items ?? []).map((i: any) => {
      const weight = i?.variant?.weight;
      return {
        name: i?.product_title || i?.title || "Item",
        value: Math.max(1, Math.round(i?.unit_price ?? 0)),
        quantity: i?.quantity ?? 1,
        weight: weight && weight > 0 ? weight : this.options_.defaultWeight,
      };
    });

    if (!items.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot calculate shipping for an empty cart."
      );
    }

    const resp = await this.client_.rates({
      origin_postal_code: Number(this.options_.originPostalCode),
      destination_postal_code: Number(destinationPostal),
      couriers: courier,
      items,
    });

    const match =
      resp.pricing?.find(
        (p) =>
          p.courier_code === courier && p.courier_service_code === service
      ) ?? resp.pricing?.[0];

    if (!match) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `No Biteship rate available for ${courier.toUpperCase()} ${service.toUpperCase()} to ${destinationPostal}.`
      );
    }

    return {
      calculated_amount: match.price,
      is_calculated_price_tax_inclusive: false,
    };
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: any[],
    order: any,
    fulfillment: any
  ) {
    const addr = fulfillment?.delivery_address ?? order?.shipping_address;
    if (!addr) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing delivery address for Biteship order."
      );
    }
    if (!this.options_.originContactName || !this.options_.originAddress) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Biteship origin contact (BITESHIP_ORIGIN_CONTACT_NAME / BITESHIP_ORIGIN_ADDRESS) is not configured."
      );
    }

    const orderItems = (items ?? []).map((i: any) => ({
      name: i?.title || "Item",
      value: Math.max(1, Math.round(i?.unit_price ?? 0)),
      quantity: i?.quantity ?? 1,
      weight: i?.variant?.weight && i.variant.weight > 0 ? i.variant.weight : this.options_.defaultWeight,
    }));

    const biteshipOrder = await this.client_.createOrder({
      origin_contact_name: this.options_.originContactName,
      origin_contact_phone: this.options_.originContactPhone,
      origin_address: this.options_.originAddress,
      origin_postal_code: Number(this.options_.originPostalCode),
      destination_contact_name:
        `${addr.first_name ?? ""} ${addr.last_name ?? ""}`.trim() || "Customer",
      destination_contact_phone: addr.phone || "-",
      destination_address: addr.address_1,
      destination_postal_code: Number(addr.postal_code),
      courier_company: String(data.courier_code ?? "jne"),
      courier_type: String(data.courier_service_code ?? "reg"),
      delivery_type: "now",
      items: orderItems,
    });

    return {
      data: { biteship_order_id: biteshipOrder?.id, raw: biteshipOrder },
      labels: biteshipOrder?.courier?.waybill_id
        ? [
            {
              tracking_number: biteshipOrder.courier.waybill_id,
              tracking_url: biteshipOrder?.courier?.tracking_url ?? "",
              label_url: "",
            },
          ]
        : [],
    };
  }

  async cancelFulfillment(_fulfillment: Record<string, unknown>): Promise<any> {
    // Biteship cancellation can be wired here later; no-op keeps Medusa happy.
    return {};
  }
}
