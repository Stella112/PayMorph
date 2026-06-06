import { useEffect, useState } from "react";
import { useOmniston } from "@ston-fi/omniston-sdk-react";
import { TonConnectButton, useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Gauge,
  History,
  Send,
  Link2,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { buildPaymentMiraLink } from "./omniston";
import {
  buildTonPaymentTransaction,
  trackTonSwap,
  unitsToDecimal,
  useLiveTonToUsdtQuote,
} from "./omniston-live";
import type { ForgeLensRecord, Invoice } from "./types";
import {
  buildTelegramPaymentStartParam,
  parsePayMorphStartParam,
  readTelegramStartParam,
} from "./telegram";

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "";

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

function shortAddress(address: string) {
  if (!address || address.length < 15) return address || "Not connected";
  return `${address.slice(0, 7)}...${address.slice(-6)}`;
}

export default function App() {
  const [invoices, setInvoices] = useState<Invoice[]>(loadInvoices);
  const [forgeLensRecords, setForgeLensRecords] = useState<ForgeLensRecord[]>(loadForgeLensRecords);
  const [view, setView] = useState<"dashboard" | "forgelens" | "create" | "pay">("dashboard");
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

  const [tonConnectUI] = useTonConnectUI();
  const walletAddress = useTonAddress();
  const wallet = useTonWallet();
  const omniston = useOmniston();

  useEffect(() => {
    localStorage.setItem("paymorph-invoices-v2", JSON.stringify(invoices));
  }, [invoices]);

  useEffect(() => {
    localStorage.setItem("paymorph-forgelens-v1", JSON.stringify(forgeLensRecords));
  }, [forgeLensRecords]);

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

Invoice: ${activeInvoice.id}
Merchant receives: ${unitsToDecimal(quote.outputUnits, 6, 6)} USDT
Customer pays: ${quotedTonAmount} TON
Resolver: ${quote.resolverName}
Recommended slippage: ${slippagePercent?.toFixed(2)}%
Routes: ${routeCount}

Explain the conversion, wallet approval, network fees, and what the payer should verify before signing.`
    : "Mira, explain how a PayMorph fixed-output TON-to-USDT payment works while the live quote loads.";

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
    if (!form.merchantAddress && !walletAddress) {
      setPaymentError("Connect the merchant wallet or paste its TON address.");
      return;
    }
    const invoice: Invoice = {
      id: `PM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      description: form.description,
      amount: form.amount,
      receiveToken: "USDT",
      merchantAddress: form.merchantAddress || walletAddress,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setInvoices((current) => [invoice, ...current]);
    setActiveInvoiceId(invoice.id);
    setPaymentStatus("idle");
    setPaymentError("");
    setView("pay");
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

  async function beginPayment() {
    setPaymentError("");
    setOutgoingTxHash("");

    if (!tonConnectUI.connected) {
      tonConnectUI.openModal();
      return;
    }
    if (!walletAddress || !wallet) {
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
      const transaction = await buildTonPaymentTransaction(
        omniston,
        quote.quoteId,
        walletAddress,
        activeInvoice.merchantAddress,
      );

      setPaymentStatus("awaiting-signature");
      const signed = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        network: "-239",
        messages: transaction.messages.map((message) => ({
          address: message.targetAddress,
          amount: message.sendAmount,
          payload: message.payload,
          stateInit: message.jettonWalletStateInit,
        })),
      });

      setPaymentStatus("tracking");
      const tracker = trackTonSwap(
        omniston,
        quote.quoteId,
        walletAddress,
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
                resolver: quote.resolverName,
                inputTon: Number(quotedTonAmount || 0),
                outputUsdt: Number(unitsToDecimal(quote.outputUnits, 6, 6)),
                slippagePercent: slippagePercent || 0,
                routeCount,
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
      setPaymentError(reason instanceof Error ? reason.message : String(reason));
    }
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
  const miraMemoryPrompt = `Mira, remember this PayMorph ForgeLens performance summary.

Live quote observations: ${quoteRecords.length}
Completed on-chain payments: ${paidRecords.length}
Average observed TON to USDT rate: ${averageRate ? averageRate.toFixed(4) : "No history yet"}
Best observed rate: ${bestObserved ? (bestObserved.outputUsdt / bestObserved.inputTon).toFixed(4) : "No history yet"}
Total USDT settled: ${paidRecords.reduce((sum, record) => sum + record.outputUsdt, 0).toFixed(4)}

Use this memory when I ask about future PayMorph routes. Explain whether new quotes are better or worse than my history.`;

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
          <button className={view === "forgelens" ? "nav-active" : ""} onClick={() => setView("forgelens")}>
            ForgeLens
          </button>
          <button className={view === "create" ? "nav-active" : ""} onClick={() => setView("create")}>
            Create
          </button>
        </nav>
        <TonConnectButton />
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
              <a className="secondary-link" href={buildPaymentMiraLink("dashboard", "summary")} target="_blank">
                Ask Mira for summary <ExternalLink size={16} />
              </a>
            </div>
            <div className="invoice-list">
              {invoices.map((invoice) => (
                <article key={invoice.id}>
                  <div><strong>{invoice.description}</strong><span>{invoice.id} · {new Date(invoice.createdAt).toLocaleString()}</span></div>
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
              <a className="primary-action" href={buildPaymentMiraLink("forgelens", "summary")} target="_blank">
                Continue in Mira <ExternalLink size={17} />
              </a>
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
              <a href="https://t.me/mira?start=paymorph_create" target="_blank">Open Mira</a>
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
              <button className="primary-action" disabled={activeInvoice.status === "paid" || !quote || ["building", "awaiting-signature", "tracking"].includes(paymentStatus)} onClick={beginPayment}>
                <Wallet size={18} />
                {activeInvoice.status === "paid" ? "Payment completed" : paymentStatus === "building" ? "Building transaction..." : paymentStatus === "awaiting-signature" ? "Approve in wallet..." : paymentStatus === "tracking" ? "Tracking on-chain..." : "Connect and approve payment"}
              </button>
              {paymentError && <p className="error-text">{paymentError}</p>}
              {outgoingTxHash && <p className="success-text">Outgoing transaction: {outgoingTxHash}</p>}
            </div>

            <div className="panel">
              <div className="panel-title"><BarChart3 size={20} /> Smart route</div>
              <div className="winner"><span>{quote ? quote.resolverName : "Omniston mainnet"}</span><strong>{quoteStatus === "live" ? "Live quote" : quoteStatus}</strong></div>
              <div className="metrics">
                <div><span>Merchant receives</span><strong>{quote ? unitsToDecimal(quote.outputUnits, 6, 6) : "-"} USDT</strong></div>
                <div><span>Recommended slippage</span><strong>{slippagePercent === null ? "-" : `${slippagePercent.toFixed(2)}%`}</strong></div>
                <div><span>Routes</span><strong>{routeCount || "-"}</strong></div>
              </div>
              <p>{quote ? "Fixed-output quote: the merchant receives the requested USDT amount after fees." : "Waiting for a real Omniston route."}</p>
              <a className="secondary-link" href={buildPaymentMiraLink(activeInvoice.id, "explain")} target="_blank">Ask Mira to explain <ExternalLink size={16} /></a>
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
              <div className="question-list">
                {["Explain this live route and its fees", "Is this slippage reasonable?", "What should I verify before signing?", "Write a reminder for this invoice"].map((question) => <div key={question}>{question}</div>)}
              </div>
              <a className="primary-action" href={buildPaymentMiraLink(activeInvoice.id, "explain")} target="_blank">Continue in Mira <ExternalLink size={17} /></a>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
