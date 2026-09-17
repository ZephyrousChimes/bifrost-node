const API_BASE = process.env.NEXT_PUBLIC_BIFROST_API ?? "http://localhost:8080";

export interface Money {
  amount: number;
  currency: string;
}

export interface Charge {
  id: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
  currency: string;
  failure_code: string | null;
  failure_message: string | null;
  acquirer_reference: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  object: "payment";
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  currency: string;
  status: "requires_confirmation" | "processing" | "requires_capture" | "succeeded" | "canceled";
  capture_method: "automatic" | "manual";
  latest_charge: string | null;
  charges: Charge[];
  description: string | null;
  metadata: Record<string, string>;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Balance {
  object: "balance";
  pending: Money[];
  available: Money[];
}

export interface BifrostEvent {
  id: string;
  object: "event";
  type: string;
  created_at: string;
  data: { object: unknown };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.message ?? "Request failed", body?.error?.code);
  }
  return body as T;
}

export const bifrostApi = {
  getBalance: (apiKey: string) => request<Balance>("/v1/balance", apiKey),
  listPayments: (apiKey: string, limit = 20) => request<{ data: Payment[] }>(`/v1/payments?limit=${limit}`, apiKey),
  listEvents: (apiKey: string, limit = 20) => request<{ data: BifrostEvent[] }>(`/v1/events?limit=${limit}`, apiKey),
  // Registration doesn't need a key -- it's how a merchant gets one in the first place.
  register: (name: string, email: string) =>
    fetch(`${API_BASE}/v1/merchants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email }),
    }).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? "Registration failed", body?.error?.code);
      return body as { merchant: { id: string; name: string }; api_key: { secret_key: string } };
    }),
};
