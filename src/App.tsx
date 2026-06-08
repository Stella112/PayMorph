import { useEffect, useState } from "react";
import { useOmniston } from "@ston-fi/omniston-sdk-react";
import { useIsConnectionRestored, useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  Copy,
  FileText,
  Gauge,
  History,
  QrCode,
  Send,
  Link2,
  Plus,
  Play,
  ReceiptText,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Pause,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  buildTonPaymentTransaction,
  decimalToUnits,
  fetchFreshTonToTokenQuote,
  getSettlementToken,
  hexBocToBase64,
  normalizeTonAddress,
  normalizeSettlementToken,
  settlementTokens,
  trackTonSwap,
  unitsToDecimal,
  useLiveTonToTokenQuote,
} from "./omniston-live";
import type { AgentActivity, ForgeLensRecord, Invoice, PaymentSchedule } from "./types";
import {
  buildTelegramPaymentStartParam,
  parsePayMorphStartParam,
  readTelegramStartParam,
} from "./telegram";

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "";
const MIRA_CONTEXT_URL = "https://paymorph.vercel.app/mira-context.txt";

const seedInvoice: Invoice = {
  id: "PM-DEMO",
  description: "Tiny mainnet payment test",
  amount: "0.01",
  receiveToken: "USDT",
  merchantAddress: "Connect a merchant wallet and create a new invoice",
  createdAt: new Date().toISOString(),
  status: "pending",
};

function loadInvoices(): Invoice[] {
  try {
    const saved = localStorage.getItem("paymorph-invoices-v2");
    return saved ? JSON.parse(saved) : [seedInvoice];
  } catch {
    return [seedInvoice];
  }
}

function loadForgeLensRecords(): ForgeLensRecord[] {
  try {
    const saved = localStorage.getItem("paymorph-forgelens-v1");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function loadSchedules(): PaymentSchedule[] {
  try {
    const saved = localStorage.getItem("paymorph-schedules-v1");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function loadAgentActivity(): AgentActivity[] {
  try {
    const saved = localStorage.getItem("paymorph-agent-activity-v1");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function advanceSchedule(date: Date, cadence: PaymentSchedule["cadence"]) {
  const next = new Date(date);
  if (cadence === "daily") next.setDate(next.getDate() + 1);
  if (cadence === "weekly") next.setDate(next.getDate() + 7);
  if (cadence === "monthly") next.setMonth(next.getMonth() + 1);
  return next;
}

function advanceSchedulePast(date: Date, cadence: PaymentSchedule["cadence"], now: Date) {
  let next = advanceSchedule(date, cadence);
  while (next <= now) next = advanceSchedule(next, cadence);
  return next;
}

function shortAddress(address: string) {
  if (!address || address.length < 15) return address || "Not connected";
  return `${address.slice(0, 7)}...${address.slice(-6)}`;
}

function defaultExpiryValue() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function isInvoiceExpired(invoice: Invoice) {
  return Boolean(invoice.expiresAt && invoice.status !== "paid" && new Date(invoice.expiresAt) <= new Date());
}

function buildPaymentLink(invoice: Invoice) {
  const params = new URLSearchParams({
    amount: invoice.amount,
    merchant: invoice.merchantAddress,
    description: invoice.description,
    receiveToken: invoice.receiveToken,
  });
  if (invoice.memo) params.set("memo", invoice.memo);
  if (invoice.expiresAt) params.set("expiresAt", invoice.expiresAt);
  return `${window.location.origin}/pay/${encodeURIComponent(invoice.id)}?${params.toString()}`;
}

function qrCodeUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(value)}`;
}

export default function App() {
  const [invoices, setInvoices] = useState<Invoice[]>(loadInvoices);
  const [forgeLensRecords, setForgeLensRecords] = useState<ForgeLensRecord[]>(loadForgeLensRecords);
  const [schedules, setSchedules] = useState<PaymentSchedule[]>(loadSchedules);
  const [agentActivity, setAgentActivity] = useState<AgentActivity[]>(loadAgentActivity);
  const [view, setView] = useState<"dashboard" | "agents" | "forgelens" | "create" | "pay">("dashboard");
  const [activeInvoiceId, setActiveInvoiceId] = useState(seedInvoice.id);
  const [isSharedCheckout, setIsSharedCheckout] = useState(false);
  const [copied, setCopied] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<
    "idle" | "building" | "awaiting-signature" | "tracking" | "paid" | "failed"
  >("idle");
  const [paymentError, setPaymentError] = useState("");
  const [outgoingTxHash, setOutgoingTxHash] = useState("");
  const [form, setForm] = useState({
    description: "Tiny PayMorph test",
    amount: "0.01",
    receiveToken: "USDT",
    merchantAddress: "",
    memo: "PM demo",
    expiresAt: defaultExpiryValue(),
  });
  const [scheduleForm, setScheduleForm] = useState({
    description: "Weekly design retainer",
    amount: "10",
    receiveToken: "USDT",
    merchantAddress: "",
    cadence: "weekly" as PaymentSchedule["cadence"],
    nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
  });

  const [tonConnectUI] = useTonConnectUI();
  const isConnectionRestored = useIsConnectionRestored();
  const walletAddress = useTonAddress();
  const wallet = useTonWallet();
  const rawWalletAddress = wallet?.account.address || walletAddress;
  const omniston = useOmniston();

  useEffect(() => {
    localStorage.setItem("paymorph-invoices-v2", JSON.stringify(invoices));
  }, [invoices]);

  useEffect(() => {
    localStorage.setItem("paymorph-forgelens-v1", JSON.stringify(forgeLensRecords));
  }, [forgeLensRecords]);

  useEffect(() => {
    localStorage.setItem("paymorph-schedules-v1", JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    localStorage.setItem("paymorph-agent-activity-v1", JSON.stringify(agentActivity));
  }, [agentActivity]);

  function logAgentActivity(activity: Omit<AgentActivity, "id" | "createdAt">) {
    setAgentActivity((current) =>
      [
        {
          ...activity,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, 80),
    );
  }

  function runCollectionsAgent() {
    const now = new Date();
    const dueSchedules = schedules.filter(
      (schedule) => schedule.active && new Date(schedule.nextRunAt) <= now,
    );
    if (dueSchedules.length === 0) return;

    const generatedInvoices = dueSchedules.map((schedule) => ({
      id: `PM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      description: schedule.description,
      amount: schedule.amount,
      receiveToken: normalizeSettlementToken(schedule.receiveToken),
      merchantAddress: schedule.merchantAddress,
      createdAt: now.toISOString(),
      status: "pending" as const,
      memo: schedule.id,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }));

    setInvoices((current) => [...generatedInvoices, ...current]);
    setSchedules((current) =>
      current.map((schedule) => {
        const generatedIndex = dueSchedules.findIndex((due) => due.id === schedule.id);
        if (generatedIndex === -1) return schedule;
        return {
          ...schedule,
          lastInvoiceId: generatedInvoices[generatedIndex].id,
          nextRunAt: advanceSchedulePast(new Date(schedule.nextRunAt), schedule.cadence, now).toISOString(),
        };
      }),
    );
    dueSchedules.forEach((schedule, index) => {
      logAgentActivity({
        agent: "Collections Agent",
        severity: "info",
        title: "Recurring invoice created",
        detail: `${schedule.amount} ${normalizeSettlementToken(schedule.receiveToken)} invoice link created for ${schedule.description}. No funds move until a customer approves it. Next ${schedule.cadence} run scheduled automatically.`,
        invoiceId: generatedInvoices[index].id,
      });
    });
  }

  useEffect(() => {
    runCollectionsAgent();
    const timer = window.setInterval(runCollectionsAgent, 60_000);
    return () => window.clearInterval(timer);
  }, [schedules]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutMatch = window.location.pathname.match(/^\/pay\/([^/]+)\/?$/);
    const telegramLaunch = parsePayMorphStartParam(readTelegramStartParam());
    if (telegramLaunch?.action === "create") {
      setView("create");
    } else if (telegramLaunch?.action === "forgelens") {
      setView("forgelens");
    } else if (telegramLaunch?.action === "pay") {
      const importedInvoice: Invoice = {
        id: telegramLaunch.invoiceId,
        description: telegramLaunch.description,
        amount: telegramLaunch.amount,
        receiveToken: normalizeSettlementToken(telegramLaunch.receiveToken),
        merchantAddress: telegramLaunch.merchant,
        createdAt: new Date().toISOString(),
        status: "pending",
        memo: telegramLaunch.memo || undefined,
        expiresAt: telegramLaunch.expiresAt || undefined,
      };
      setInvoices((current) =>
        current.some((invoice) => invoice.id === importedInvoice.id)
          ? current
          : [importedInvoice, ...current],
      );
      setActiveInvoiceId(importedInvoice.id);
      setIsSharedCheckout(true);
      setView("pay");
      return;
    }

    const invoiceId = params.get("pay") || (checkoutMatch ? decodeURIComponent(checkoutMatch[1]) : "");
    if (invoiceId) {
      const linkedInvoice = invoices.find((invoice) => invoice.id === invoiceId);
      if (!linkedInvoice && params.get("amount") && params.get("merchant")) {
        const importedInvoice: Invoice = {
          id: invoiceId,
          description: params.get("description") || "PayMorph payment",
          amount: params.get("amount") || "0",
          receiveToken: normalizeSettlementToken(params.get("receiveToken") || undefined),
          merchantAddress: params.get("merchant") || "",
          createdAt: new Date().toISOString(),
          status: "pending",
          memo: params.get("memo") || undefined,
          expiresAt: params.get("expiresAt") || undefined,
        };
        setInvoices((current) => [importedInvoice, ...current]);
      }
      setActiveInvoiceId(invoiceId);
      setIsSharedCheckout(Boolean(checkoutMatch || params.get("pay")));
      setView("pay");
    }
    if (params.get("source") === "mira") {
      setView("create");
      setForm((current) => ({
        ...current,
        description: params.get("description") || current.description,
        amount: params.get("amount") || current.amount,
      }));
    }
  }, []);

  const activeInvoice = invoices.find((invoice) => invoice.id === activeInvoiceId) || invoices[0];
  const activeInvoiceExpired = activeInvoice ? isInvoiceExpired(activeInvoice) : false;
  const activeInvoiceStatus = activeInvoiceExpired ? "expired" : activeInvoice?.status;
  const activeSettlementToken = getSettlementToken(activeInvoice?.receiveToken || "USDT");
  const isDirectTonPayment = activeSettlementToken.route === "direct";
  const isMerchantShareMode = Boolean(
    activeInvoice && view === "pay" && !isSharedCheckout && activeInvoiceStatus !== "paid",
  );
  const { quote, status: quoteStatus, error: quoteError } = useLiveTonToTokenQuote(
    activeInvoice?.amount || "0",
    activeSettlementToken.symbol,
    Boolean(activeInvoice && view === "pay" && activeInvoiceStatus === "pending" && !isMerchantShareMode && !isDirectTonPayment),
  );
  const quotedTonAmount = isDirectTonPayment ? activeInvoice?.amount || null : quote ? unitsToDecimal(quote.inputUnits, 9, 6) : null;
  const swapData = quote?.settlementData.$case === "swap" ? quote.settlementData.value : null;
  const slippagePercent = swapData ? swapData.recommendedSlippagePips / 10000 : null;
  const routeCount = swapData?.routes.length || 0;
  const activePaidRecord = forgeLensRecords.find(
    (record) => record.status === "paid" && record.invoiceId === activeInvoice?.id,
  );
  const activeOutgoingTxHash = outgoingTxHash || activePaidRecord?.outgoingTxHash || "";
  const miraPrompt = activeInvoiceStatus === "paid"
    ? `Mira, explain this completed PayMorph payment receipt in beginner-friendly language.

Reference context: ${MIRA_CONTEXT_URL}

Invoice: ${activeInvoice.id}
Merchant receives: ${activePaidRecord?.outputUsdt.toFixed(6) || activeInvoice.amount} ${activeInvoice.receiveToken}
Customer paid: ${activePaidRecord?.inputTon.toFixed(6) || "confirmed"} TON
Resolver: ${activePaidRecord?.resolver || "STON.fi Omniston"}
Recommended slippage: ${activePaidRecord ? activePaidRecord.slippagePercent.toFixed(2) : "recorded"}%
Routes: ${activePaidRecord?.routeCount || "recorded"}
Outgoing transaction: ${activeOutgoingTxHash || "shown in PayMorph"}

Explain that the payer approved the TON transaction${activeInvoice.receiveToken === "TON" ? ", and PayMorph used a direct wallet transfer to the merchant." : ", STON.fi Omniston handled the route, and PayMorph only marks it complete after on-chain settlement confirmation."}`
    : isDirectTonPayment
    ? `Mira, explain this direct PayMorph TON payment in beginner-friendly language.

Reference context: ${MIRA_CONTEXT_URL}

Invoice: ${activeInvoice.id}
Merchant receives: ${activeInvoice.amount} TON
Customer pays: ${activeInvoice.amount} TON plus network gas
Settlement mode: Direct wallet-approved TON transfer

Explain that no STON.fi route is needed because the merchant selected TON as the receive token. The payer should verify the amount, merchant address, and wallet approval before signing.`
    : quote
    ? `Mira, explain this live PayMorph mainnet payment in beginner-friendly language.

Reference context: ${MIRA_CONTEXT_URL}

Invoice: ${activeInvoice.id}
Merchant receives: ${unitsToDecimal(quote.outputUnits, activeSettlementToken.decimals, 6)} ${activeSettlementToken.symbol}
Customer pays: ${quotedTonAmount} TON
Resolver: ${quote.resolverName}
Recommended slippage: ${slippagePercent?.toFixed(2)}%
Routes: ${routeCount}

Explain the conversion, wallet approval, network fees, and what the payer should verify before signing.`
    : `Mira, explain how a PayMorph fixed-output TON-to-${activeSettlementToken.symbol} payment works while the live quote loads.

Reference context: ${MIRA_CONTEXT_URL}`;

  useEffect(() => {
    if (!quote || !quotedTonAmount || !activeInvoice || view !== "pay") return;
    const key = `${activeInvoice.id}:${quote.inputUnits}:${quote.outputUnits}:${routeCount}:${slippagePercent}`;
    setForgeLensRecords((current) => {
      if (current[0]?.id === key) return current;
      return [
        {
          id: key,
          invoiceId: activeInvoice.id,
          observedAt: new Date().toISOString(),
          status: "quoted" as const,
          resolver: quote.resolverName,
          inputTon: Number(quotedTonAmount),
          outputUsdt: Number(unitsToDecimal(quote.outputUnits, activeSettlementToken.decimals, 6)),
          slippagePercent: slippagePercent || 0,
          routeCount,
        },
        ...current,
      ].slice(0, 60);
    });
  }, [quote?.quoteId, quote?.inputUnits, quote?.outputUnits, routeCount, slippagePercent, activeSettlementToken.decimals, view]);

  function createInvoice() {
    if (!form.merchantAddress && !rawWalletAddress) {
      setPaymentError("Connect the merchant wallet or paste its TON address.");
      return;
    }
    if (form.expiresAt && new Date(form.expiresAt) <= new Date()) {
      setPaymentError("Choose a future expiry time for this payment link.");
      return;
    }
    const merchantAddress = normalizeTonAddress(form.merchantAddress || rawWalletAddress);
    const invoice: Invoice = {
      id: `PM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      description: form.description,
      amount: form.amount,
      receiveToken: normalizeSettlementToken(form.receiveToken),
      merchantAddress,
      createdAt: new Date().toISOString(),
      status: "pending",
      memo: form.memo.trim() || undefined,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
    };
    setInvoices((current) => [invoice, ...current]);
    setActiveInvoiceId(invoice.id);
    setIsSharedCheckout(false);
    setPaymentStatus("idle");
    setPaymentError("");
    setView("pay");
  }

  function createSchedule() {
    const merchantAddress = normalizeTonAddress(scheduleForm.merchantAddress || rawWalletAddress);
    const amount = Number(scheduleForm.amount);
    const nextRun = new Date(scheduleForm.nextRunAt);
    if (!scheduleForm.description.trim()) {
      setPaymentError("Add a description for this recurring invoice.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a valid USDT amount greater than zero.");
      return;
    }
    if (Number.isNaN(nextRun.getTime())) {
      setPaymentError("Choose a valid first run date and time.");
      return;
    }
    if (!merchantAddress) {
      setPaymentError("Connect the merchant wallet or paste its TON address.");
      return;
    }
    const schedule: PaymentSchedule = {
      id: `SCH-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      description: scheduleForm.description.trim(),
      amount: String(amount),
      receiveToken: normalizeSettlementToken(scheduleForm.receiveToken),
      merchantAddress,
      cadence: scheduleForm.cadence,
      nextRunAt: nextRun.toISOString(),
      active: true,
    };
    setSchedules((current) => [schedule, ...current]);
    logAgentActivity({
      agent: "Collections Agent",
      severity: "info",
      title: "Invoice schedule activated",
      detail: `${schedule.amount} ${normalizeSettlementToken(schedule.receiveToken)} invoice links will be created ${schedule.cadence}. First run: ${new Date(schedule.nextRunAt).toLocaleString()}. Customers still approve every payment.`,
    });
    setPaymentError("");
  }

  function toggleSchedule(scheduleId: string) {
    setSchedules((current) =>
      current.map((schedule) =>
        schedule.id === scheduleId ? { ...schedule, active: !schedule.active } : schedule,
      ),
    );
  }

  function runScheduleNow(schedule: PaymentSchedule) {
    setSchedules((current) =>
      current.map((item) =>
        item.id === schedule.id ? { ...item, active: true, nextRunAt: new Date().toISOString() } : item,
      ),
    );
  }

  function deleteSchedule(scheduleId: string) {
    setSchedules((current) => current.filter((schedule) => schedule.id !== scheduleId));
    setInvoices((current) =>
      current.filter((invoice) => invoice.status === "paid" || invoice.memo !== scheduleId),
    );
    logAgentActivity({
      agent: "Collections Agent",
      severity: "info",
      title: "Invoice schedule deleted",
      detail: "The recurring invoice schedule was removed. Any unpaid invoice links generated by it were also cleared.",
    });
  }

  function deleteInvoice(invoiceId: string) {
    const invoice = invoices.find((item) => item.id === invoiceId);
    if (invoice?.status === "paid") {
      setPaymentError("Paid invoices are kept as settlement receipts and cannot be deleted.");
      return;
    }
    setInvoices((current) => current.filter((item) => item.id !== invoiceId));
    setForgeLensRecords((current) => current.filter((record) => record.invoiceId !== invoiceId));
    if (activeInvoiceId === invoiceId) {
      const nextInvoice = invoices.find((item) => item.id !== invoiceId);
      setActiveInvoiceId(nextInvoice?.id || seedInvoice.id);
      if (!nextInvoice) setView("dashboard");
    }
    logAgentActivity({
      agent: "Collections Agent",
      severity: "info",
      title: "Pending invoice deleted",
      detail: `${invoiceId} was removed from PayMorph. Paid settlement receipts are still preserved.`,
    });
  }

  async function copyPaymentLink(invoice: Invoice) {
    const link = buildPaymentLink(invoice);
    await navigator.clipboard.writeText(link);
    setCopied(invoice.id);
    setTimeout(() => setCopied(""), 1500);
  }

  async function shareTelegramPaymentLink(invoice: Invoice) {
    if (!TELEGRAM_BOT_USERNAME) {
      setPaymentError("Add VITE_TELEGRAM_BOT_USERNAME after creating the PayMorph Telegram bot.");
      return;
    }
    const startParam = buildTelegramPaymentStartParam(
      invoice.id,
      invoice.amount,
      invoice.merchantAddress,
      invoice.description,
      invoice.receiveToken,
      invoice.memo || "",
      invoice.expiresAt || "",
    );
    const link = `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=${encodeURIComponent(startParam)}`;
    await navigator.clipboard.writeText(link);
    setCopied(`telegram:${invoice.id}`);
    setTimeout(() => setCopied(""), 1500);
  }

  async function copyMiraPrompt() {
    await navigator.clipboard.writeText(miraPrompt);
    setCopied("mira");
    setTimeout(() => setCopied(""), 1500);
  }

  async function copyMiraContext(prompt: string, copiedKey: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(copiedKey);
      setTimeout(() => setCopied(""), 1500);
    } catch (reason) {
      setPaymentError(
        `Copy this prompt manually, then send it to Mira: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
  }

  async function beginPayment() {
    setPaymentError("");
    setOutgoingTxHash("");

    if (!tonConnectUI.connected) {
      tonConnectUI.openModal();
      return;
    }
    if (isInvoiceExpired(activeInvoice)) {
      setPaymentError("This payment link has expired. Ask the merchant for a fresh PayMorph checkout link.");
      return;
    }
    if (!rawWalletAddress || !wallet) {
      setPaymentError("Connect a TON mainnet wallet first.");
      return;
    }
    if (wallet.account.chain !== "-239") {
      setPaymentError("PayMorph live settlement currently requires a TON mainnet wallet.");
      return;
    }
    if (!activeInvoice.merchantAddress || activeInvoice.merchantAddress.includes("Connect")) {
      setPaymentError("Create a new invoice with a valid merchant TON wallet.");
      return;
    }
    if (!isDirectTonPayment && !quote) {
      setPaymentError("Wait for a live Omniston quote before approving.");
      return;
    }

    try {
      setPaymentStatus("building");
      if (isDirectTonPayment) {
        setPaymentStatus("awaiting-signature");
        const signed = await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          network: "-239",
          messages: [
            {
              address: normalizeTonAddress(activeInvoice.merchantAddress),
              amount: decimalToUnits(activeInvoice.amount, activeSettlementToken.decimals),
            },
          ],
        });

        setPaymentStatus("paid");
        setOutgoingTxHash("Direct TON transfer submitted by wallet");
        setInvoices((current) =>
          current.map((invoice) =>
            invoice.id === activeInvoice.id ? { ...invoice, status: "paid", paidWith: "TON" } : invoice,
          ),
        );
        setForgeLensRecords((current) => [
          {
            id: `paid:${activeInvoice.id}:${signed.boc.slice(0, 18)}`,
            invoiceId: activeInvoice.id,
            observedAt: new Date().toISOString(),
            status: "paid",
            resolver: "Direct TON transfer",
            inputTon: Number(activeInvoice.amount),
            outputUsdt: Number(activeInvoice.amount),
            slippagePercent: 0,
            routeCount: 1,
            outgoingTxHash: "Direct TON transfer submitted by wallet",
          },
          ...current,
        ]);
        return;
      }
      const freshQuote = await fetchFreshTonToTokenQuote(
        omniston,
        activeInvoice.amount,
        activeSettlementToken.symbol,
      );
      const freshQuotedTonAmount = unitsToDecimal(freshQuote.inputUnits, 9, 6);
      const freshSwapData =
        freshQuote.settlementData.$case === "swap" ? freshQuote.settlementData.value : null;
      const transaction = await buildTonPaymentTransaction(
        omniston,
        freshQuote.quoteId,
        rawWalletAddress,
        normalizeTonAddress(activeInvoice.merchantAddress),
      );

      setPaymentStatus("awaiting-signature");
      const signed = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: "-239",
        messages: transaction.messages.map((message) => ({
          address: message.targetAddress,
          amount: message.sendAmount,
          payload: hexBocToBase64(message.payload),
          stateInit: hexBocToBase64(message.jettonWalletStateInit),
        })),
      });

      setPaymentStatus("tracking");
      const tracker = trackTonSwap(
        omniston,
        freshQuote.quoteId,
        rawWalletAddress,
        signed.boc,
        (progress) => {
          setOutgoingTxHash(progress.outgoingTxHash);
          if (progress.status === "TRADE_STATUS_FULLY_FILLED") {
            setPaymentStatus("paid");
            setInvoices((current) =>
              current.map((invoice) =>
                invoice.id === activeInvoice.id
                  ? { ...invoice, status: "paid", paidWith: "TON" }
                  : invoice,
              ),
            );
            setForgeLensRecords((current) => [
              {
                id: `paid:${activeInvoice.id}:${progress.outgoingTxHash}`,
                invoiceId: activeInvoice.id,
                observedAt: new Date().toISOString(),
                status: "paid",
                resolver: freshQuote.resolverName,
                inputTon: Number(freshQuotedTonAmount),
                outputUsdt: Number(unitsToDecimal(freshQuote.outputUnits, activeSettlementToken.decimals, 6)),
                slippagePercent: freshSwapData ? freshSwapData.recommendedSlippagePips / 10000 : 0,
                routeCount: freshSwapData?.routes.length || 0,
                outgoingTxHash: progress.outgoingTxHash,
              },
              ...current,
            ]);
            tracker.unsubscribe();
          } else if (
            progress.status === "TRADE_STATUS_FAILED" ||
            progress.status === "TRADE_STATUS_CANCELLED"
          ) {
            setPaymentStatus("failed");
            setPaymentError(`On-chain trade ended with status: ${progress.status}`);
            tracker.unsubscribe();
          }
        },
        (message) => {
          setPaymentStatus("failed");
          setPaymentError(message);
        },
      );
    } catch (reason) {
      setPaymentStatus("failed");
      setPaymentError(formatPaymentError(reason));
    }
  }

  function formatPaymentError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.toLowerCase().includes("refund due to a slippage")) {
      return "The live route moved during wallet emulation, so the swap would refund instead of settle. Wait a few seconds and try again with a fresh quote, or use a less brittle tiny test like 0.10 USDT.";
    }
    return message;
  }

  async function toggleWalletConnection() {
    if (!isConnectionRestored) return;
    if (tonConnectUI.connected) {
      await tonConnectUI.disconnect();
      return;
    }
    tonConnectUI.openModal();
  }

  const quoteRecords = forgeLensRecords.filter((record) => record.status === "quoted");
  const paidRecords = forgeLensRecords.filter((record) => record.status === "paid");
  const averageRate =
    quoteRecords.length > 0
      ? quoteRecords.reduce((sum, record) => sum + record.outputUsdt / record.inputTon, 0) / quoteRecords.length
      : 0;
  const bestObserved = quoteRecords.reduce<ForgeLensRecord | null>(
    (best, record) =>
      !best || record.outputUsdt / record.inputTon > best.outputUsdt / best.inputTon ? record : best,
    null,
  );
  const currentRate =
    quote && quotedTonAmount ? Number(unitsToDecimal(quote.outputUnits, 6, 6)) / Number(quotedTonAmount) : 0;
  const routeSignal =
    activeInvoiceStatus === "paid"
      ? "settled"
      : activeInvoiceStatus === "expired"
      ? "expired"
      : isDirectTonPayment
      ? "direct"
      : !quote
      ? "waiting"
      : slippagePercent !== null && slippagePercent > 1
        ? "risk"
        : averageRate && currentRate >= averageRate * 1.002
          ? "favorable"
          : "normal";

  useEffect(() => {
    if (!quote || !currentRate) return;
    if (routeSignal === "favorable") {
      logAgentActivity({
        agent: "Route Guardian",
        severity: "good",
        title: "Favorable route detected",
        detail: `Current route is ${((currentRate / averageRate - 1) * 100).toFixed(2)}% better than ForgeLens history.`,
        invoiceId: activeInvoice.id,
      });
    }
    if (routeSignal === "risk") {
      logAgentActivity({
        agent: "Risk Guard",
        severity: "warning",
        title: "High slippage warning",
        detail: `Omniston recommends ${slippagePercent?.toFixed(2)}% slippage. Review carefully before signing.`,
        invoiceId: activeInvoice.id,
      });
    }
  }, [quote?.quoteId, routeSignal]);

  const miraMemoryPrompt = `Mira, remember this PayMorph ForgeLens performance summary.

Reference context: ${MIRA_CONTEXT_URL}

Live quote observations: ${quoteRecords.length}
Completed on-chain payments: ${paidRecords.length}
Average observed TON to USDT rate: ${averageRate ? averageRate.toFixed(4) : "No history yet"}
Best observed rate: ${bestObserved ? (bestObserved.outputUsdt / bestObserved.inputTon).toFixed(4) : "No history yet"}
Total USDT settled: ${paidRecords.reduce((sum, record) => sum + record.outputUsdt, 0).toFixed(4)}

Use this memory when I ask about future PayMorph routes. Explain whether new quotes are better or worse than my history.`;
  const totalSettledUsdt = paidRecords.reduce((sum, record) => sum + record.outputUsdt, 0);
  const recentSettlements =
    paidRecords
      .slice(0, 5)
      .map(
        (record) =>
          `- ${record.invoiceId}: merchant received ${record.outputUsdt.toFixed(4)} USDT; customer paid ${record.inputTon.toFixed(6)} TON through ${record.resolver}; slippage ${record.slippagePercent.toFixed(2)}%`,
      )
      .join("\n") || "- No paid settlements yet";
  const miraStrategyPrompt = `Mira, act as the PayMorph ForgeLens Strategy Agent.

Reference context: ${MIRA_CONTEXT_URL}

Goal:
Help a beginner merchant decide what to do after receiving PayMorph payments. Keep this educational, conservative, and wallet-approved.

Current PayMorph treasury snapshot:
- Completed on-chain payments: ${paidRecords.length}
- Total USDT settled: ${totalSettledUsdt.toFixed(4)}
- Live Omniston route observations: ${quoteRecords.length}
- Average observed TON to USDT rate: ${averageRate ? averageRate.toFixed(4) : "No history yet"}
- Best observed TON to USDT rate: ${bestObserved ? (bestObserved.outputUsdt / bestObserved.inputTon).toFixed(4) : "No history yet"}
- Active invoice schedules: ${schedules.filter((schedule) => schedule.active).length}

Recent settlements:
${recentSettlements}

Create a beginner-first TON treasury strategy with:
1. A low-risk default allocation for received USDT.
2. When it may make sense to swap a small portion to TON through STON.fi Omniston.
3. Risks to explain before any wallet approval.
4. A simple next action I can take inside PayMorph.

Important: do not claim funds can move automatically. PayMorph should only prepare strategy and checkout/swap context; every real transaction must be approved by the wallet owner.`;
  const miraDashboardPrompt = `Mira, summarize my PayMorph payment operations.

Reference context: ${MIRA_CONTEXT_URL}

Total invoices: ${invoices.length}
Pending invoices: ${invoices.filter((invoice) => invoice.status === "pending").length}
Paid invoices: ${invoices.filter((invoice) => invoice.status === "paid").length}
Active schedules: ${schedules.filter((schedule) => schedule.active).length}
ForgeLens quote observations: ${quoteRecords.length}
Completed on-chain payments: ${paidRecords.length}

Help me identify what needs follow-up, which invoices are still pending, and what I should verify before asking customers to pay.`;
  const miraCreatePrompt = `Mira, help me create a PayMorph payment request.

Reference context: ${MIRA_CONTEXT_URL}

I want a beginner-friendly TON payment link where the merchant receives ${form.receiveToken} and the customer pays TON${form.receiveToken === "TON" ? " as a direct wallet-approved transfer." : " through STON.fi Omniston."}

Draft a tiny test invoice first:
- Description: ${form.description}
- Merchant receives: ${form.amount} ${form.receiveToken}

Explain what I should verify before sharing the link.`;
  const miraAgentPrompt = `Mira, remember and help coordinate these PayMorph payment operations.

Reference context: ${MIRA_CONTEXT_URL}

Active payment schedules: ${schedules.filter((schedule) => schedule.active).length}
Pending invoices: ${invoices.filter((invoice) => invoice.status === "pending").length}
Completed payments: ${paidRecords.length}
Current route signal: ${routeSignal}
Recent automated actions:
${agentActivity.slice(0, 5).map((activity) => `- ${activity.agent}: ${activity.title} - ${activity.detail}`).join("\n") || "- No actions yet"}

Help me review upcoming collections, explain route risks, and draft reminders. Never claim a transaction completed without on-chain confirmation.`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("dashboard")}>
          <img className="brand-logo" src="/paymorph-logo.png" alt="" />
          PayMorph
        </button>
        <nav>
          <button className={view === "dashboard" ? "nav-active" : ""} onClick={() => setView("dashboard")}>
            Dashboard
          </button>
          <button className={view === "agents" ? "nav-active" : ""} onClick={() => setView("agents")}>
            Agents
          </button>
          <button className={view === "forgelens" ? "nav-active" : ""} onClick={() => setView("forgelens")}>
            ForgeLens
          </button>
          <button className={view === "create" ? "nav-active" : ""} onClick={() => setView("create")}>
            Create
          </button>
        </nav>
        <button className="wallet-control" onClick={toggleWalletConnection} disabled={!isConnectionRestored}>
          <Wallet size={17} />
          <span>
            {!isConnectionRestored
              ? "Loading wallet..."
              : walletAddress
                ? shortAddress(walletAddress)
                : "Connect wallet"}
          </span>
        </button>
      </header>

      {view === "dashboard" && (
        <>
          <section className="hero">
            <div>
              <img className="hero-logo" src="/paymorph-logo.png" alt="PayMorph" />
              <div className="eyebrow"><Sparkles size={16} /> TON payments routed by STON.fi</div>
              <h1>Payment links that morph into the token merchants want.</h1>
              <p>
                PayMorph lets merchants request USDT, USDC, or TON, share a checkout link or QR code, and accept
                wallet-approved TON payments from customers.
              </p>
              <div className="hero-actions">
                <button className="primary-action hero-action" onClick={() => setView("create")}>
                  <Plus size={18} /> Create payment link
                </button>
                <button className="secondary-action hero-action" onClick={() => setView("forgelens")}>
                  <Gauge size={18} /> View ForgeLens
                </button>
              </div>
            </div>
            <div className="hero-proof">
              <strong>USDT, USDC, or TON invoice</strong>
              <ArrowRight size={22} />
              <strong>TON payer</strong>
              <ArrowRight size={22} />
              <strong>Omniston or direct</strong>
            </div>
          </section>

          <section className="landing-flow">
            <article>
              <ReceiptText size={22} />
              <strong>Create</strong>
              <span>Set amount, memo, expiry, wallet address, and generate a payment link.</span>
            </article>
            <article>
              <QrCode size={22} />
              <strong>Share</strong>
              <span>Send a web checkout, Telegram Mini App link, or QR code to the customer.</span>
            </article>
            <article>
              <ShieldCheck size={22} />
              <strong>Approve</strong>
              <span>The payer signs from their wallet. PayMorph never takes custody.</span>
            </article>
            <article>
              <Bot size={22} />
              <strong>Assist</strong>
              <span>Mira explains routes, risks, receipts, and treasury strategy in your Ops group.</span>
            </article>
          </section>

          <section className="stats">
            <article><span>Total invoices</span><strong>{invoices.length}</strong></article>
            <article><span>Paid on-chain</span><strong>{invoices.filter((invoice) => invoice.status === "paid").length}</strong></article>
            <article><span>Pending</span><strong>{invoices.filter((invoice) => invoice.status === "pending" && !isInvoiceExpired(invoice)).length}</strong></article>
          </section>

          <section className="feature-grid">
            <article>
              <span>STON.fi Track</span>
              <strong>TON payments with flexible settlement</strong>
              <p>Customers pay TON while merchants receive USDT, USDC, or direct TON depending on the invoice.</p>
            </article>
            <article>
              <span>Mira Track</span>
              <strong>Telegram Ops group assistant</strong>
              <p>PayMorph prepares context that Mira can use to review invoices, explain routes, and guide beginner merchants.</p>
            </article>
            <article>
              <span>ForgeLens</span>
              <strong>Route and settlement memory</strong>
              <p>Completed payments become usable history for future route checks and conservative treasury strategy prompts.</p>
            </article>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div className="panel-title"><ReceiptText size={20} /> Payment links</div>
              <button className="secondary-link" onClick={() => copyMiraContext(miraDashboardPrompt, "dashboard-mira")}>
                {copied === "dashboard-mira" ? "Prompt copied" : "Copy Mira summary"} <Copy size={16} />
              </button>
            </div>
            <div className="invoice-list">
              {invoices.map((invoice) => (
                <article key={invoice.id}>
                  <div>
                    <strong>{invoice.description}</strong>
                    <span>
                      {invoice.id}
                      {invoice.memo ? ` / ${invoice.memo}` : ""} / {new Date(invoice.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="invoice-amount">
                    <strong>{invoice.amount} {invoice.receiveToken}</strong>
                    <span className={`status ${isInvoiceExpired(invoice) ? "expired" : invoice.status}`}>
                      {isInvoiceExpired(invoice) ? "expired" : invoice.status}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button onClick={() => copyPaymentLink(invoice)} title="Copy payment link">{copied === invoice.id ? <Check size={17} /> : <Copy size={17} />}</button>
                    <button onClick={() => shareTelegramPaymentLink(invoice)} title="Copy Telegram Mini App link">{copied === `telegram:${invoice.id}` ? <Check size={17} /> : <Send size={17} />}</button>
                    <button onClick={() => { setActiveInvoiceId(invoice.id); setIsSharedCheckout(false); setPaymentStatus("idle"); setView("pay"); }} title="Open payment"><ArrowRight size={17} /></button>
                    {invoice.status !== "paid" && <button onClick={() => deleteInvoice(invoice.id)} title="Delete pending invoice"><Trash2 size={17} /></button>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {view === "agents" && (
        <>
          <section className="pay-header">
            <div className="eyebrow"><Activity size={16} /> Agentic payment operations</div>
            <h2>Automate coordination, keep signatures human.</h2>
            <p>
              Collections Agent creates due invoices. Route Guardian compares Omniston routes. Risk Guard
              flags unsafe conditions. Every fund movement still requires wallet approval.
            </p>
          </section>

          <section className="agent-status-grid">
            <article>
              <CalendarClock size={21} />
              <span>Invoice Agent</span>
              <strong>{schedules.filter((schedule) => schedule.active).length} active schedules</strong>
              <small>Auto-creates invoice links when a schedule is due. It never pays automatically.</small>
            </article>
            <article className={routeSignal === "favorable" ? "agent-good" : ""}>
              <Gauge size={21} />
              <span>Route Guardian</span>
              <strong>{routeSignal === "favorable" ? "Favorable route" : routeSignal === "expired" ? "Expired link" : routeSignal === "waiting" ? "Waiting for quote" : "Monitoring"}</strong>
              <small>Compares live Omniston routes with ForgeLens memory.</small>
            </article>
            <article className={routeSignal === "risk" ? "agent-warning" : ""}>
              <ShieldAlert size={21} />
              <span>Risk Guard</span>
              <strong>{routeSignal === "risk" ? "Review required" : "No active warning"}</strong>
              <small>Flags high slippage and blocks silent execution.</small>
            </article>
          </section>

          <section className="grid">
            <div className="panel form-panel">
              <div className="panel-title"><CalendarClock size={20} /> Auto-create recurring invoices</div>
              <label>Description<input value={scheduleForm.description} onChange={(event) => setScheduleForm({ ...scheduleForm, description: event.target.value })} /></label>
              <div className="form-grid">
                <label>Merchant receives<input inputMode="decimal" value={scheduleForm.amount} onChange={(event) => setScheduleForm({ ...scheduleForm, amount: event.target.value })} /></label>
                <label>Receive token<select value={scheduleForm.receiveToken} onChange={(event) => setScheduleForm({ ...scheduleForm, receiveToken: normalizeSettlementToken(event.target.value) })}>{Object.values(settlementTokens).map((token) => <option key={token.symbol} value={token.symbol}>{token.label}</option>)}</select></label>
              </div>
              <div className="form-grid">
                <label>Cadence<select value={scheduleForm.cadence} onChange={(event) => setScheduleForm({ ...scheduleForm, cadence: event.target.value as PaymentSchedule["cadence"] })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
              </div>
              <label>First run<input type="datetime-local" value={scheduleForm.nextRunAt} onChange={(event) => setScheduleForm({ ...scheduleForm, nextRunAt: event.target.value })} /></label>
              <label>Merchant wallet<input placeholder={walletAddress || "Connect wallet or paste address"} value={scheduleForm.merchantAddress} onChange={(event) => setScheduleForm({ ...scheduleForm, merchantAddress: event.target.value })} /></label>
              <button className="primary-action" onClick={createSchedule}><CalendarClock size={18} /> Activate invoice agent</button>
              {paymentError && <p className="error-text">{paymentError}</p>}
            </div>

            <div className="panel">
              <div className="panel-title"><Bot size={20} /> Mira operations handoff</div>
              <textarea readOnly value={miraAgentPrompt} />
              <button
                className="secondary-action"
                onClick={async () => {
                  await navigator.clipboard.writeText(miraAgentPrompt);
                  setCopied("agent-memory");
                  setTimeout(() => setCopied(""), 1500);
                }}
              >
                {copied === "agent-memory" ? <Check size={18} /> : <Copy size={18} />}
                {copied === "agent-memory" ? "Copied" : "Copy agent summary"}
              </button>
              <button className="primary-action" onClick={() => copyMiraContext(miraAgentPrompt, "agent-mira")}>
                {copied === "agent-mira" ? "Prompt copied" : "Copy Mira prompt"} <Copy size={17} />
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title"><CalendarClock size={20} /> Recurring invoice schedules</div>
            {schedules.length === 0 ? (
              <p className="muted">Create a schedule to activate automatic invoice creation. Customers still approve every payment.</p>
            ) : (
              <div className="schedule-list">
                {schedules.map((schedule) => (
                  <article key={schedule.id}>
                    <div><strong>{schedule.description}</strong><span>{schedule.id} / {schedule.cadence}</span></div>
                    <div><strong>{schedule.amount} {normalizeSettlementToken(schedule.receiveToken)}</strong><span>Next: {new Date(schedule.nextRunAt).toLocaleString()}</span></div>
                    <div className="row-actions">
                      <button onClick={() => toggleSchedule(schedule.id)} title={schedule.active ? "Pause schedule" : "Resume schedule"}>{schedule.active ? <Pause size={17} /> : <Play size={17} />}</button>
                      <button onClick={() => runScheduleNow(schedule)} title="Create invoice now"><ArrowRight size={17} /></button>
                      <button onClick={() => deleteSchedule(schedule.id)} title="Delete schedule"><Trash2 size={17} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-title"><Activity size={20} /> Agent activity</div>
            {agentActivity.length === 0 ? (
              <p className="muted">Automated decisions and warnings will appear here.</p>
            ) : (
              <div className="activity-list">
                {agentActivity.map((activity) => (
                  <article className={`activity-${activity.severity}`} key={activity.id}>
                    <div><strong>{activity.agent}</strong><span>{new Date(activity.createdAt).toLocaleString()}</span></div>
                    <div><strong>{activity.title}</strong><span>{activity.detail}</span></div>
                    {activity.invoiceId && <button onClick={() => { setActiveInvoiceId(activity.invoiceId!); setView("pay"); }}><ArrowRight size={17} /></button>}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {view === "forgelens" && (
        <>
          <section className="pay-header">
            <div className="eyebrow"><Gauge size={16} /> ForgeLens payment intelligence</div>
            <h2>Every route becomes useful memory.</h2>
            <p>
              ForgeLens captures live Omniston quote observations and completed settlements, then prepares
              a concise memory handoff for Mira.
            </p>
          </section>

          <section className="stats">
            <article><span>Live observations</span><strong>{quoteRecords.length}</strong></article>
            <article><span>Paid settlements</span><strong>{paidRecords.length}</strong></article>
            <article><span>Total settled</span><strong>{totalSettledUsdt.toFixed(2)} USDT</strong></article>
            <article><span>Average USDT per TON</span><strong>{averageRate ? averageRate.toFixed(3) : "-"}</strong></article>
          </section>

          <section className="grid analytics-grid">
            <div className="panel">
              <div className="panel-title"><BarChart3 size={20} /> Observed route performance</div>
              {quoteRecords.length === 0 ? (
                <p className="muted">Open a payment link to begin capturing live Omniston quotes.</p>
              ) : (
                <div className="rate-chart">
                  {quoteRecords.slice(0, 12).reverse().map((record) => {
                    const rate = record.outputUsdt / record.inputTon;
                    const maxRate = Math.max(...quoteRecords.map((item) => item.outputUsdt / item.inputTon));
                    return (
                      <div className="rate-column" key={record.id} title={`${rate.toFixed(4)} USDT per TON`}>
                        <div style={{ height: `${Math.max(16, (rate / maxRate) * 100)}%` }} />
                        <span>{rate.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="analytics-note">
                <strong>{bestObserved ? `${(bestObserved.outputUsdt / bestObserved.inputTon).toFixed(4)} USDT / TON` : "-"}</strong>
                <span>Best observed live rate</span>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title"><Bot size={20} /> Mira memory handoff</div>
              <textarea readOnly value={miraMemoryPrompt} />
              <button
                className="secondary-action"
                onClick={async () => {
                  await navigator.clipboard.writeText(miraMemoryPrompt);
                  setCopied("memory");
                  setTimeout(() => setCopied(""), 1500);
                }}
              >
                {copied === "memory" ? <Check size={18} /> : <Copy size={18} />}
                {copied === "memory" ? "Copied" : "Copy memory summary"}
              </button>
              <button className="primary-action" onClick={() => copyMiraContext(miraMemoryPrompt, "memory-mira")}>
                {copied === "memory-mira" ? "Prompt copied" : "Copy Mira prompt"} <Copy size={17} />
              </button>
            </div>
          </section>

          <section className="grid strategy-grid">
            <div className="panel strategy-panel">
              <div className="panel-title"><Sparkles size={20} /> ForgeLens Strategy Agent</div>
              <p>
                Turn paid invoices into a beginner-friendly treasury plan. Mira can explain whether to keep
                funds in USDT, watch for a better STON.fi route, or prepare a tiny wallet-approved TON swap.
              </p>
              <div className="strategy-steps">
                <article><strong>1</strong><span>Review settled USDT and route history</span></article>
                <article><strong>2</strong><span>Suggest a conservative TON treasury action</span></article>
                <article><strong>3</strong><span>Require wallet approval before any transaction</span></article>
              </div>
            </div>

            <div className="panel">
              <div className="panel-title"><Bot size={20} /> Mira strategy handoff</div>
              <textarea readOnly value={miraStrategyPrompt} />
              <button
                className="primary-action"
                onClick={() => copyMiraContext(miraStrategyPrompt, "strategy-mira")}
              >
                {copied === "strategy-mira" ? "Prompt copied" : "Copy Mira strategy prompt"} <Copy size={17} />
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title"><History size={20} /> Settlement memory</div>
            {paidRecords.length === 0 ? (
              <p className="muted">Completed on-chain PayMorph payments will appear here.</p>
            ) : (
              <div className="memory-table">
                {paidRecords.map((record) => (
                  <article key={record.id}>
                    <div><strong>{record.invoiceId}</strong><span>{new Date(record.observedAt).toLocaleString()}</span></div>
                    <div><strong>{record.inputTon.toFixed(6)} TON</strong><span>Customer paid</span></div>
                    <div><strong>{record.outputUsdt.toFixed(4)} USDT</strong><span>Merchant received</span></div>
                    <div><strong>{record.slippagePercent.toFixed(2)}%</strong><span>Recommended slippage</span></div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {view === "create" && (
        <section className="workspace">
          <div className="workspace-copy">
            <button className="back-button" onClick={() => setView("dashboard")}><ArrowLeft size={17} /> Dashboard</button>
            <div className="eyebrow"><Link2 size={16} /> Merchant payment request</div>
            <h2>Create a tiny payment invoice</h2>
            <p>Start with a tiny mainnet amount. The customer pays TON; PayMorph routes to USDT/USDC through Omniston or sends TON directly.</p>
            <div className="mira-card">
              <Bot size={22} />
              <div><strong>Create with Mira</strong><span>{`Ask: "Create a 0.01 ${form.receiveToken} PayMorph request."`}</span></div>
              <button onClick={() => copyMiraContext(miraCreatePrompt, "create-mira")}>
                {copied === "create-mira" ? "Prompt copied" : "Copy Mira prompt"}
              </button>
            </div>
          </div>
          <div className="panel form-panel">
            <label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="form-grid">
              <label>Merchant receives<input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
              <label>
                Receive token
                <select
                  value={form.receiveToken}
                  onChange={(event) => setForm({ ...form, receiveToken: normalizeSettlementToken(event.target.value) })}
                >
                  {Object.values(settlementTokens).map((token) => (
                    <option key={token.symbol} value={token.symbol}>{token.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>Memo / reference<input value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} /></label>
              <label>Payment link expires<input type="datetime-local" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></label>
            </div>
            <label>Merchant wallet<input placeholder={walletAddress || "Connect merchant wallet or paste address"} value={form.merchantAddress} onChange={(event) => setForm({ ...form, merchantAddress: event.target.value })} /></label>
            <button className="primary-action" onClick={createInvoice}><Link2 size={18} /> Create live payment link</button>
            {paymentError && <p className="error-text">{paymentError}</p>}
          </div>
        </section>
      )}

      {view === "pay" && activeInvoice && (
        <>
          <section className="pay-header">
            {isSharedCheckout ? (
              <div className="checkout-brand"><img src="/paymorph-logo.png" alt="" /> PayMorph checkout</div>
            ) : (
              <button className="back-button" onClick={() => setView("dashboard")}><ArrowLeft size={17} /> Dashboard</button>
            )}
            <div className="eyebrow"><ShieldCheck size={16} /> Live mainnet · wallet-approved payment</div>
            <h2>{activeInvoice.description}</h2>
            <div className="requested-amount">
              <span>Merchant receives</span>
              <strong>{activeInvoice.amount} {activeInvoice.receiveToken}</strong>
              <small>To {shortAddress(activeInvoice.merchantAddress)}</small>
              {(activeInvoice.memo || activeInvoice.expiresAt) && (
                <div className="invoice-meta">
                  {activeInvoice.memo && <span>Reference: {activeInvoice.memo}</span>}
                  {activeInvoice.expiresAt && (
                    <span className={activeInvoiceExpired ? "meta-expired" : ""}>
                      {activeInvoiceExpired ? "Expired" : "Expires"}: {new Date(activeInvoice.expiresAt).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="invoice-share-actions">
              <button onClick={() => copyPaymentLink(activeInvoice)}>
                {copied === activeInvoice.id ? <Check size={17} /> : <Copy size={17} />}
                {copied === activeInvoice.id ? "Web link copied" : "Copy web link"}
              </button>
              <button onClick={() => shareTelegramPaymentLink(activeInvoice)}>
                {copied === `telegram:${activeInvoice.id}` ? <Check size={17} /> : <Send size={17} />}
                {copied === `telegram:${activeInvoice.id}` ? "Telegram link copied" : "Copy Telegram link"}
              </button>
              <button onClick={() => copyMiraContext(miraPrompt, "pay-header-mira")}>
                {copied === "pay-header-mira" ? <Check size={17} /> : <Bot size={17} />}
                {copied === "pay-header-mira" ? "Mira prompt copied" : "Copy Mira prompt"}
              </button>
            </div>
          </section>

          <section className="grid">
            {isMerchantShareMode ? (
              <div className="panel merchant-share-panel">
                <div className="panel-title"><Link2 size={20} /> Share this payment link</div>
                <p className="muted">
                  You created the invoice. Do not approve payment from this screen unless you are testing as the payer.
                  Send the checkout link to the customer; the customer pays TON and gas, while this merchant wallet receives {activeInvoice.receiveToken}.
                </p>
                <div className="checkout-qr">
                  <div className="qr-frame">
                    <img src={qrCodeUrl(buildPaymentLink(activeInvoice))} alt="Payment checkout QR code" />
                  </div>
                  <div>
                    <strong><QrCode size={18} /> Scan to open checkout</strong>
                    <span>{activeInvoice.memo ? `Reference: ${activeInvoice.memo}` : activeInvoice.id}</span>
                    {activeInvoice.expiresAt && (
                      <span className={activeInvoiceExpired ? "meta-expired" : ""}>
                        {activeInvoiceExpired ? "Expired" : "Expires"} {new Date(activeInvoice.expiresAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="merchant-share-actions">
                  <button className="primary-action" onClick={() => copyPaymentLink(activeInvoice)}>
                    {copied === activeInvoice.id ? <Check size={18} /> : <Copy size={18} />}
                    {copied === activeInvoice.id ? "Web checkout copied" : "Copy web checkout"}
                  </button>
                  <button className="secondary-action" onClick={() => shareTelegramPaymentLink(activeInvoice)}>
                    {copied === `telegram:${activeInvoice.id}` ? <Check size={18} /> : <Send size={18} />}
                    {copied === `telegram:${activeInvoice.id}` ? "Telegram checkout copied" : "Copy Telegram checkout"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="panel">
                <div className="panel-title"><Wallet size={20} /> Pay with TON</div>
                <div className="token-picker"><button className="token-active">TON</button></div>
                <div className="quote-total">
                  <span>{isDirectTonPayment ? "You pay exactly" : "You pay approximately"}</span>
                  <strong>{quotedTonAmount ? `${quotedTonAmount} TON` : "Waiting for live quote"}</strong>
                  <small>
                    {isDirectTonPayment
                      ? "Direct wallet-approved TON transfer. No Omniston route is needed."
                      : quoteStatus === "live"
                      ? `Live mainnet quote from ${quote?.resolverName}`
                      : quoteStatus === "loading"
                        ? "Requesting a fixed-output quote from Omniston..."
                        : quoteError || "Live route currently unavailable."}
                  </small>
                </div>
                <button className="primary-action" disabled={!isConnectionRestored || activeInvoiceStatus === "paid" || activeInvoiceExpired || (!isDirectTonPayment && !quote) || ["building", "awaiting-signature", "tracking"].includes(paymentStatus)} onClick={beginPayment}>
                  <Wallet size={18} />
                  {!isConnectionRestored ? "Loading wallet..." : activeInvoiceStatus === "paid" ? "Payment completed" : activeInvoiceExpired ? "Payment link expired" : paymentStatus === "building" ? "Building transaction..." : paymentStatus === "awaiting-signature" ? "Approve in wallet..." : paymentStatus === "tracking" ? "Tracking on-chain..." : "Connect and approve payment"}
                </button>
                {paymentError && <p className="error-text">{paymentError}</p>}
                {outgoingTxHash && <p className="success-text">Outgoing transaction: {outgoingTxHash}</p>}
              </div>
            )}

            <div className="panel">
              <div className="panel-title"><BarChart3 size={20} /> Smart route</div>
              <div className="winner">
                <span>{activeInvoiceStatus === "paid" ? activePaidRecord?.resolver || (isDirectTonPayment ? "Direct TON transfer" : "STON.fi Omniston") : isDirectTonPayment ? "Direct TON transfer" : quote ? quote.resolverName : "Omniston mainnet"}</span>
                <strong>{activeInvoiceStatus === "paid" ? "Settled" : activeInvoiceExpired ? "Expired" : isDirectTonPayment ? "Direct" : quoteStatus === "live" ? "Live quote" : quoteStatus}</strong>
              </div>
              <div className={`route-signal signal-${routeSignal}`}>
                {routeSignal === "settled" ? "Route Guardian: payment settled" : routeSignal === "direct" ? "Route Guardian: direct TON transfer" : routeSignal === "expired" ? "Route Guardian: expired link" : routeSignal === "favorable" ? "Route Guardian: favorable vs history" : routeSignal === "risk" ? "Risk Guard: review before signing" : routeSignal === "waiting" ? "Route Guardian: waiting" : "Route Guardian: normal conditions"}
              </div>
              <div className="metrics">
                <div><span>Merchant receives</span><strong>{isDirectTonPayment ? activeInvoice.amount : activeInvoiceStatus === "paid" ? activePaidRecord?.outputUsdt.toFixed(4) || activeInvoice.amount : quote ? unitsToDecimal(quote.outputUnits, activeSettlementToken.decimals, 6) : "-"} {activeInvoice.receiveToken}</strong></div>
                <div><span>{isDirectTonPayment ? "Transfer mode" : "Recommended slippage"}</span><strong>{isDirectTonPayment ? "Direct" : activeInvoiceStatus === "paid" ? activePaidRecord ? `${activePaidRecord.slippagePercent.toFixed(2)}%` : "recorded" : slippagePercent === null ? "-" : `${slippagePercent.toFixed(2)}%`}</strong></div>
                <div><span>{isDirectTonPayment ? "Wallet approval" : "Routes"}</span><strong>{isDirectTonPayment ? "Required" : activeInvoiceStatus === "paid" ? activePaidRecord?.routeCount || "recorded" : routeCount || "-"}</strong></div>
              </div>
              <p>{activeInvoiceStatus === "paid" ? isDirectTonPayment ? "Direct TON transfer submitted by the payer wallet and recorded by PayMorph." : "Settlement confirmed: PayMorph marked this invoice paid after Omniston reported the trade as fully filled." : activeInvoiceExpired ? "This checkout link is expired. Ask the merchant for a fresh PayMorph link." : isDirectTonPayment ? "Direct TON invoice: the merchant receives TON, so no STON.fi swap route is needed." : quote ? `Fixed-output quote: the merchant receives the requested ${activeInvoice.receiveToken} amount after fees.` : "Waiting for a real Omniston route."}</p>
              <button className="secondary-link" onClick={() => copyMiraContext(miraPrompt, "route-mira")}>
                {copied === "route-mira" ? "Prompt copied" : activeInvoiceStatus === "paid" ? "Copy Mira receipt" : "Copy Mira explanation"} <Copy size={16} />
              </button>
            </div>
          </section>

          <section className="grid">
            <div className="panel">
              <div className="panel-title"><FileText size={20} /> Mira context</div>
              <textarea readOnly value={miraPrompt} />
              <button className="secondary-action" onClick={copyMiraPrompt}>{copied === "mira" ? <Check size={18} /> : <Copy size={18} />}{copied === "mira" ? "Copied" : "Copy live context"}</button>
            </div>
            <div className="panel">
              <div className="panel-title"><Bot size={20} /> Ask Mira</div>
              <p className="muted">Copy the prompt, then switch to Mira and paste it when you are ready.</p>
              <div className="question-list">
                {["Explain this live route and its fees", "Is this slippage reasonable?", "What should I verify before signing?", "Write a reminder for this invoice"].map((question) => <div key={question}>{question}</div>)}
              </div>
              <button className="primary-action" onClick={() => copyMiraContext(miraPrompt, "pay-mira")}>
                {copied === "pay-mira" ? "Prompt copied" : "Copy Mira prompt"} <Copy size={17} />
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
