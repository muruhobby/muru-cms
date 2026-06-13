const BASE_URL = "https://api.biteship.com";

export type BiteshipRateItem = {
  name: string;
  value: number;
  quantity: number;
  weight: number; // grams
};

export type BiteshipRateRequest = {
  origin_postal_code?: number;
  origin_area_id?: string;
  destination_postal_code?: number;
  destination_area_id?: string;
  couriers: string; // comma-separated courier codes
  items: BiteshipRateItem[];
};

export type BiteshipPricing = {
  courier_code: string;
  courier_service_code: string;
  courier_name: string;
  courier_service_name?: string;
  price: number;
  duration?: string;
  shipment_duration_range?: string;
  shipment_duration_unit?: string;
};

/**
 * Thin client for the Biteship REST API.
 * Auth is the API key passed directly in the `authorization` header
 * (keys are prefixed `biteship_test.` / `biteship_live.`).
 */
export class BiteshipClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    if (!this.apiKey) {
      throw new Error("BITESHIP_API_KEY is not configured.");
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        authorization: this.apiKey,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      throw new Error(
        json?.error || json?.message || `Biteship request failed (${res.status})`
      );
    }
    return json as T;
  }

  rates(input: BiteshipRateRequest) {
    return this.request<{ success: boolean; pricing: BiteshipPricing[] }>(
      "/v1/rates/couriers",
      "POST",
      input
    );
  }

  searchAreas(input: string) {
    const q = new URLSearchParams({ countries: "ID", input, type: "single" });
    return this.request<{ success: boolean; areas: any[] }>(
      `/v1/maps/areas?${q.toString()}`,
      "GET"
    );
  }

  createOrder(input: unknown) {
    return this.request<any>("/v1/orders", "POST", input);
  }
}
