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

export type ForgeLensRecord = {
  id: string;
  invoiceId: string;
  observedAt: string;
  status: "quoted" | "paid";
  resolver: string;
  inputTon: number;
  outputUsdt: number;
  slippagePercent: number;
  routeCount: number;
  outgoingTxHash?: string;
};
