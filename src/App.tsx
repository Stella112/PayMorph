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
  ExternalLink,
  FileText,
  Gauge,
  History,
  Send,
  Link2,
  Plus,
  Play,
  ReceiptText,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Pause,
  Wallet,
} from "lucide-react";
import {
  buildTonPaymentTransaction,
  fetchFreshTonToUsdtQuote,
  hexBocToBase64,
  normalizeTonAddress,
  trackTonSwap,
  unitsToDecimal,
  useLiveTonToUsdtQuote,
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

export default function App() {
  const [invoices, setInvoices] = useState<Invoice[]>(loadInvoices);
  const [forgeLensRecords, setForgeLensRecords] = useState<ForgeLensRecord[]>(loadForgeLensRecords);
  const [schedules, setSchedules] = useState<PaymentSchedule[]>(loadSchedules);
  const [agentActivity, setAgentActivity] = useState<AgentActivity[]>(loadAgentActivity);
  const [view, setView] = useState<"dashboard" | "agents" | "forgelens" | "create" | "pay">("dashboard");
  const [activeInvoiceId, setActiveInvoiceId] = useState(seedInvoice.id);
  const [copied, setCopied] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<
    "idle" | "building" | "awaiting-signature" | "tracking" | "paid" | "failed"
  >("idle");
  const [paymentError, setPaymentError] = useState("");
  const [outgoingTxHash, setOutgoingTxHash] = useState("");
  const [form, setForm] = useState({
    description: "Tiny PayMorph test",
    amount: "0.01",
    merchantAddress: "",
  });
  const [scheduleForm, setScheduleForm] = useState({
    description: "Weekly design retainer",
    amount: "10",
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
      receiveToken: "USDT",
      merchantAddress: schedule.merchantAddress,
      createdAt: now.toISOString(),
      status: "pending" as const,
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
        detail: `${schedule.amount} USDT invoice created for ${schedule.description}. Next ${schedule.cadence} run scheduled automatically.`,
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
        receiveToken: "USDT",
        merchantAddress: telegramLaunch.merchant,
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      setInvoices((current) =>
        current.some((invoice) => invoice.id === importedInvoice.id)
          ? current
          : [importedInvoice, ...current],
      );
      setActiveInvoiceId(importedInvoice.id);
      setView("pay");
      return;
    }

    const invoiceId = params.get("pay");
    if (invoiceId) {
      const linkedInvoice = invoices.find((invoice) => invoice.id === invoiceId);
      if (!linkedInvoice && params.get("amount") && params.get("merchant")) {
        const importedInvoice: Invoice = {
          id: invoiceId,
          description: params.get("description") || "PayMorph payment",
          amount: params.get("amount") || "0",
          receiveToken: "USDT",
          merchantAddress: params.get("merchant") || "",
          createdAt: new Date().toISOString(),
          status: "pending",
        };
        setInvoices((current) => [importedInvoice, ...current]);
      }
      setActiveInvoiceId(invoiceId);
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
  const { quote, status: quoteStatus, error: quoteError } = useLiveTonToUsdtQuote(
    activeInvoice?.amount || "0",
    Boolean(activeInvoice && view === "pay" && activeInvoice.status !== "paid"),
  );
  const quotedTonAmount = quote ? unitsToDecimal(quote.inputUnits, 9, 6) : null;
  const swapData = quote?.settlementData.$case === "swap" ? quote.settlementData.value : null;
  const slippagePercent = swapData ? swapData.recommendedSlippagePips / 10000 : null;
  const routeCount = swapData?.routes.length || 0;
  const miraPrompt = quote
    ? `Mira, explain this live PayMorph mainnet payment in beginner-friendly language.

Reference context: ${MIRA_CONTEXT_URL}

Invoice: ${activeInvoice.id}
Merchant receives: ${unitsToDecimal(quote.outputUnits, 6, 6)} USDT
Customer pays: ${quotedTonAmount} TON
Resolver: ${quote.resolverName}
Recommended slippage: ${slippagePercent?.toFixed(2)}%
Routes: ${routeCount}

Explain the conversion, wallet approval, network fees, and what the payer should verify before signing.`
    : `Mira, explain how a PayMorph fixed-output TON-to-USDT payment works while the live quote loads.

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
          outputUsdt: Number(unitsToDecimal(quote.outputUnits, 6, 6)),
          slippagePercent: slippagePercent || 0,
          routeCount,
        },
        ...current,
      ].slice(0, 60);
    });
  }, [quote?.quoteId, quote?.inputUnits, quote?.outputUnits, routeCount, slippagePercent, view]);

  function createInvoice() {
    if (!form.merchantAddress && !rawWalletAddress) {
      setPaymentError("Connect the merchant wallet or paste its TON address.");
      return;
    }
    const merchantAddress = normalizeTonAddress(form.merchantAddress || rawWalletAddress);
    const invoice: Invoice = {
      id: `PM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      description: form.description,
      amount: form.amount,
      receiveToken: "USDT",
      merchantAddress,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setInvoices((current) => [invoice, ...current]);
    setActiveInvoiceId(invoice.id);
    setPaymentStatus("idle");
    setPaymentError("");
    setView("pay");
  }

  function createSchedule() {
    const merchantAddress = normalizeTonAddress(scheduleForm.merchantAddress || rawWalletAddress);
    const amount = Number(scheduleForm.amount);
    const nextRun = new Date(scheduleForm.nextRunAt);
    if (!scheduleForm.description.trim()) {
      setPaymentError("Add a description for this recurring collection.");
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
      merchantAddress,
      cadence: scheduleForm.cadence,
      nextRunAt: nextRun.toISOString(),
      active: true,
    };
    setSchedules((current) => [schedule, ...current]);
    logAgentActivity({
      agent: "Collections Agent",
      severity: "info",
      title: "Payment schedule activated",
      detail: `${schedule.amount} USDT will be requested ${schedule.cadence}. First run: ${new Date(schedule.nextRunAt).toLocaleString()}.`,
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

  async function copyPaymentLink(invoice: Invoice) {
    const params = new URLSearchParams({
      pay: invoice.id,
      amount: invoice.amount,
      merchant: invoice.merchantAddress,
      description: invoice.description,
    });
    const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
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
    if (!rawWalletAddress || !wallet) {
      setPaymentError("Connect a TON mainnet wallet first.");
      return;
    }
    if (wallet.account.chain !== "-239") {
      setPaymentError("PayMorph live settlement currently requires a TON mainnet wallet.");
      return;
    }
    if (!quote) {
      setPaymentError("Wait for a live Omniston quote before approving.");
      return;
    }
    if (!activeInvoice.merchantAddress || activeInvoice.merchantAddress.includes("Connect")) {
      setPaymentError("Create a new invoice with a valid merchant TON wallet.");
      return;
    }

    try {
      setPaymentStatus("building");
      const freshQuote = await fetchFreshTonToUsdtQuote(omniston, activeInvoice.amount);
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
                outputUsdt: Number(unitsToDecimal(freshQuote.outputUnits, 6, 6)),
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
    !quote
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

I want a beginner-friendly TON payment link where the merchant receives USDT and the customer pays TON through STON.fi Omniston.

Draft a tiny test invoice first:
- Description: ${form.description}
- Merchant receives: ${form.amount} USDT

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
          <span className="brand-mark">P</span>
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
              <div className="eyebrow"><Sparkles size={16} /> Any token in. Your preferred token out.</div>
              <h1>Payment links that morph with the customer.</h1>
              <p>Merchants request USDT. Customers pay TON. STON.fi Omniston finds and settles the live mainnet route.</p>
              <button className="primary-action hero-action" onClick={() => setView("create")}>
                <Plus size={18} /> Create payment link
              </button>
            </div>
            <div className="hero-stat">
              <span>Settlement engine</span>
              <strong>Live Omniston mainnet</strong>
              <small>Every payment requires wallet approval</small>
            </div>
          </section>

          <section className="stats">
            <article><span>Total invoices</span><strong>{invoices.length}</strong></article>
            <article><span>Paid on-chain</span><strong>{invoices.filter((invoice) => invoice.status === "paid").length}</strong></article>
            <article><span>Pending</span><strong>{invoices.filter((invoice) => invoice.status === "pending").length}</strong></article>
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
                  <div><strong>{invoice.description}</strong><span>{invoice.id} / {new Date(invoice.createdAt).toLocaleString()}</span></div>
                  <div className="invoice-amount"><strong>{invoice.amount} {invoice.receiveToken}</strong><span className={`status ${invoice.status}`}>{invoice.status}</span></div>
                  <div className="row-actions">
                    <button onClick={() => copyPaymentLink(invoice)} title="Copy payment link">{copied === invoice.id ? <Check size={17} /> : <Copy size={17} />}</button>
                    <button onClick={() => shareTelegramPaymentLink(invoice)} title="Copy Telegram Mini App link">{copied === `telegram:${invoice.id}` ? <Check size={17} /> : <Send size={17} />}</button>
                    <button onClick={() => { setActiveInvoiceId(invoice.id); setPaymentStatus("idle"); setView("pay"); }} title="Open payment"><ArrowRight size={17} /></button>
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
              <span>Collections Agent</span>
              <strong>{schedules.filter((schedule) => schedule.active).length} active schedules</strong>
              <small>Creates invoices when PayMorph is opened and a schedule is due.</small>
            </article>
            <article className={routeSignal === "favorable" ? "agent-good" : ""}>
              <Gauge size={21} />
              <span>Route Guardian</span>
              <strong>{routeSignal === "favorable" ? "Favorable route" : routeSignal === "waiting" ? "Waiting for quote" : "Monitoring"}</strong>
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
              <div className="panel-title"><CalendarClock size={20} /> New recurring collection</div>
              <label>Description<input value={scheduleForm.description} onChange={(event) => setScheduleForm({ ...scheduleForm, description: event.target.value })} /></label>
              <div className="form-grid">
                <label>Amount in USDT<input inputMode="decimal" value={scheduleForm.amount} onChange={(event) => setScheduleForm({ ...scheduleForm, amount: event.target.value })} /></label>
                <label>Cadence<select value={scheduleForm.cadence} onChange={(event) => setScheduleForm({ ...scheduleForm, cadence: event.target.value as PaymentSchedule["cadence"] })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
              </div>
              <label>First run<input type="datetime-local" value={scheduleForm.nextRunAt} onChange={(event) => setScheduleForm({ ...scheduleForm, nextRunAt: event.target.value })} /></label>
              <label>Merchant wallet<input placeholder={walletAddress || "Connect wallet or paste address"} value={scheduleForm.merchantAddress} onChange={(event) => setScheduleForm({ ...scheduleForm, merchantAddress: event.target.value })} /></label>
              <button className="primary-action" onClick={createSchedule}><CalendarClock size={18} /> Activate Collections Agent</button>
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
            <div className="panel-title"><CalendarClock size={20} /> Payment schedules</div>
            {schedules.length === 0 ? (
              <p className="muted">Create a schedule to activate Collections Agent.</p>
            ) : (
              <div className="schedule-list">
                {schedules.map((schedule) => (
                  <article key={schedule.id}>
                    <div><strong>{schedule.description}</strong><span>{schedule.id} / {schedule.cadence}</span></div>
                    <div><strong>{schedule.amount} USDT</strong><span>Next: {new Date(schedule.nextRunAt).toLocaleString()}</span></div>
                    <div className="row-actions">
                      <button onClick={() => toggleSchedule(schedule.id)} title={schedule.active ? "Pause schedule" : "Resume schedule"}>{schedule.active ? <Pause size={17} /> : <Play size={17} />}</button>
                      <button onClick={() => runScheduleNow(schedule)} title="Run now"><ArrowRight size={17} /></button>
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
            <h2>Create a tiny USDT invoice</h2>
            <p>Start with a tiny mainnet amount. The customer will pay TON and Omniston will settle USDT to your wallet.</p>
            <div className="mira-card">
              <Bot size={22} />
              <div><strong>Create with Mira</strong><span>Ask: "Create a 0.01 USDT PayMorph request."</span></div>
              <button onClick={() => copyMiraContext(miraCreatePrompt, "create-mira")}>
                {copied === "create-mira" ? "Prompt copied" : "Copy Mira prompt"}
              </button>
            </div>
          </div>
          <div className="panel form-panel">
            <label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="form-grid">
              <label>Merchant receives<input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
              <label>Receive token<select value="USDT" disabled><option>USDT</option></select></label>
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
            <button className="back-button" onClick={() => setView("dashboard")}><ArrowLeft size={17} /> Dashboard</button>
            <div className="eyebrow"><ShieldCheck size={16} /> Live mainnet · wallet-approved payment</div>
            <h2>{activeInvoice.description}</h2>
            <div className="requested-amount"><span>Merchant receives</span><strong>{activeInvoice.amount} USDT</strong><small>To {shortAddress(activeInvoice.merchantAddress)}</small></div>
          </section>

          <section className="grid">
            <div className="panel">
              <div className="panel-title"><Wallet size={20} /> Pay with TON</div>
              <div className="token-picker"><button className="token-active">TON</button></div>
              <div className="quote-total">
                <span>You pay approximately</span>
                <strong>{quotedTonAmount ? `${quotedTonAmount} TON` : "Waiting for live quote"}</strong>
                <small>
                  {quoteStatus === "live"
                    ? `Live mainnet quote from ${quote?.resolverName}`
                    : quoteStatus === "loading"
                      ? "Requesting a fixed-output quote from Omniston..."
                      : quoteError || "Live route currently unavailable."}
                </small>
              </div>
              <button className="primary-action" disabled={!isConnectionRestored || activeInvoice.status === "paid" || !quote || ["building", "awaiting-signature", "tracking"].includes(paymentStatus)} onClick={beginPayment}>
                <Wallet size={18} />
                {!isConnectionRestored ? "Loading wallet..." : activeInvoice.status === "paid" ? "Payment completed" : paymentStatus === "building" ? "Building transaction..." : paymentStatus === "awaiting-signature" ? "Approve in wallet..." : paymentStatus === "tracking" ? "Tracking on-chain..." : "Connect and approve payment"}
              </button>
              {paymentError && <p className="error-text">{paymentError}</p>}
              {outgoingTxHash && <p className="success-text">Outgoing transaction: {outgoingTxHash}</p>}
            </div>

            <div className="panel">
              <div className="panel-title"><BarChart3 size={20} /> Smart route</div>
              <div className="winner"><span>{quote ? quote.resolverName : "Omniston mainnet"}</span><strong>{quoteStatus === "live" ? "Live quote" : quoteStatus}</strong></div>
              <div className={`route-signal signal-${routeSignal}`}>
                {routeSignal === "favorable" ? "Route Guardian: favorable vs history" : routeSignal === "risk" ? "Risk Guard: review before signing" : routeSignal === "waiting" ? "Route Guardian: waiting" : "Route Guardian: normal conditions"}
              </div>
              <div className="metrics">
                <div><span>Merchant receives</span><strong>{quote ? unitsToDecimal(quote.outputUnits, 6, 6) : "-"} USDT</strong></div>
                <div><span>Recommended slippage</span><strong>{slippagePercent === null ? "-" : `${slippagePercent.toFixed(2)}%`}</strong></div>
                <div><span>Routes</span><strong>{routeCount || "-"}</strong></div>
              </div>
              <p>{quote ? "Fixed-output quote: the merchant receives the requested USDT amount after fees." : "Waiting for a real Omniston route."}</p>
              <button className="secondary-link" onClick={() => copyMiraContext(miraPrompt, "route-mira")}>
                {copied === "route-mira" ? "Prompt copied" : "Copy Mira explanation"} <Copy size={16} />
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
