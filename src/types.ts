export type SwapIntent = {
  from: string;
  to: string;
  amount: string;
  risk: "low" | "moderate" | "high";
  source?: string;
};

export type InvoiceStatus = "pending" | "paid" | "expired";

export type Invoice = {
  id: string;
  description: string;
  amount: string;
  receiveToken: string;
  merchantAddress: string;
  createdAt: string;
  status: InvoiceStatus;
  paidWith?: string;
};

export type RouteQuote = {
  id: string;
  venue: string;
  expectedReceive: number;
  priceImpact: number;
  slippage: number;
  confidence: number;
  latencyMs: number;
  note: string;
};
