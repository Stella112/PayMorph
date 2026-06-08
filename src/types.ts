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
  memo?: string;
  expiresAt?: string;
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

export type PaymentSchedule = {
  id: string;
  description: string;
  amount: string;
  receiveToken?: string;
  merchantAddress: string;
  cadence: "daily" | "weekly" | "monthly";
  nextRunAt: string;
  active: boolean;
  lastInvoiceId?: string;
};

export type AgentActivity = {
  id: string;
  createdAt: string;
  agent: "Collections Agent" | "Route Guardian" | "Risk Guard";
  severity: "info" | "good" | "warning";
  title: string;
  detail: string;
  invoiceId?: string;
};
