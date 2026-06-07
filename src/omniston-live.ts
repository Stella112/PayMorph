import { useEffect, useState } from "react";
import {
  Omniston,
  type Quote,
  type SwapProgress,
  type TonTransaction,
  useOmniston,
} from "@ston-fi/omniston-sdk-react";

export const omniston = new Omniston({
  apiUrl: "wss://omni-ws.ston.fi",
});

const USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const USDC_MASTER = "EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728";

export type SettlementToken = "USDT" | "USDC" | "TON";

export const settlementTokens: Record<
  SettlementToken,
  { symbol: SettlementToken; label: string; decimals: number; master?: string; route: "omniston" | "direct" }
> = {
  USDT: {
    symbol: "USDT",
    label: "USDT",
    decimals: 6,
    master: USDT_MASTER,
    route: "omniston",
  },
  USDC: {
    symbol: "USDC",
    label: "USDC",
    decimals: 6,
    master: USDC_MASTER,
    route: "omniston",
  },
  TON: {
    symbol: "TON",
    label: "TON",
    decimals: 9,
    route: "direct",
  },
};

export function normalizeSettlementToken(value?: string): SettlementToken {
  if (value === "USDC" || value === "TON") return value;
  return "USDT";
}

const tonAsset = {
  chain: {
    $case: "ton" as const,
    value: { kind: { $case: "native" as const, value: {} } },
  },
};

function jettonAsset(master: string) {
  return {
    chain: {
      $case: "ton" as const,
      value: { kind: { $case: "jetton" as const, value: master } },
    },
  };
}

function outputAssetFor(token: SettlementToken) {
  const tokenInfo = settlementTokens[token];
  if (!tokenInfo.master) throw new Error(`${tokenInfo.symbol} does not use Omniston output routing.`);
  return jettonAsset(tokenInfo.master);
}

export function getSettlementToken(token: string) {
  return settlementTokens[normalizeSettlementToken(token)];
}

export function isSupportedSettlementToken(token: string) {
  return token === "USDT" || token === "USDC" || token === "TON";
}

export const tonAddress = (value: string) => ({
  chain: { $case: "ton" as const, value: normalizeTonAddress(value) },
});

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function normalizeTonAddress(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(":")) return trimmed;

  try {
    const bytes = base64UrlToBytes(trimmed);
    if (bytes.length !== 36) return trimmed;

    const workchain = bytes[1] === 255 ? -1 : bytes[1];
    const hash = Array.from(bytes.slice(2, 34))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return `${workchain}:${hash}`;
  } catch {
    return trimmed;
  }
}

export function hexBocToBase64(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^[\da-f]+$/i.test(trimmed) || trimmed.length % 2 !== 0) return trimmed;

  const bytes = trimmed.match(/.{2}/g) || [];
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(Number.parseInt(byte, 16));
  return btoa(binary);
}

export function decimalToUnits(value: string, decimals: number) {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const normalizedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return `${whole || "0"}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0";
}

export function unitsToDecimal(value: string, decimals: number, precision = 4) {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).slice(0, precision).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function useLiveTonToTokenQuote(outputAmount: string, outputToken: string, enabled: boolean) {
  const client = useOmniston();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "no-quote" | "error">("idle");
  const [error, setError] = useState("");
  const token = getSettlementToken(outputToken);

  useEffect(() => {
    setQuote(null);
    setError("");
    if (token.route === "direct") {
      setStatus("idle");
      return;
    }
    if (!enabled || !Number(outputAmount)) {
      setStatus("idle");
      return;
    }

    setStatus("loading");
    const subscription = client
      .requestForQuote({
        inputAsset: tonAsset,
        outputAsset: outputAssetFor(token.symbol),
        amount: { $case: "outputUnits", value: decimalToUnits(outputAmount, token.decimals) },
        settlementParams: [
          {
            params: {
              $case: "swap",
              value: {
                maxPriceSlippagePips: 5000,
                maxRoutes: 4,
                allowRiskyRoutes: false,
                flexibleIntegratorFee: true,
              },
            },
          },
        ],
      })
      .subscribe({
        next: (event) => {
          if (event.$case === "quoteUpdated") {
            setQuote(event.value);
            setStatus("live");
          } else if (event.$case === "noQuote") {
            setQuote(null);
            setStatus("no-quote");
          }
        },
        error: (reason) => {
          setError(reason.message);
          setStatus("error");
        },
      });

    return () => subscription.unsubscribe();
  }, [client, enabled, outputAmount, token.symbol]);

  return { quote, status, error };
}

export function useLiveTonToUsdtQuote(outputAmount: string, enabled: boolean) {
  return useLiveTonToTokenQuote(outputAmount, "USDT", enabled);
}

export function fetchFreshTonToTokenQuote(client: Omniston, outputAmount: string, outputToken: string) {
  const token = getSettlementToken(outputToken);
  if (token.route === "direct") {
    return Promise.reject(new Error(`${token.symbol} payments are direct wallet transfers, not Omniston swaps.`));
  }
  return new Promise<Quote>((resolve, reject) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | undefined;
    let timeout: number;
    const finish = (result: { quote?: Quote; error?: Error }) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      window.clearTimeout(timeout);
      if (result.quote) resolve(result.quote);
      else reject(result.error || new Error("Omniston did not return a fresh quote."));
    };
    timeout = window.setTimeout(
      () => finish({ error: new Error("Timed out while refreshing the Omniston route.") }),
      12_000,
    );

    subscription = client
      .requestForQuote({
        inputAsset: tonAsset,
        outputAsset: outputAssetFor(token.symbol),
        amount: { $case: "outputUnits", value: decimalToUnits(outputAmount, token.decimals) },
        settlementParams: [
          {
            params: {
              $case: "swap",
              value: {
                maxPriceSlippagePips: 5000,
                maxRoutes: 4,
                allowRiskyRoutes: false,
                flexibleIntegratorFee: true,
              },
            },
          },
        ],
      })
      .subscribe({
        next: (event) => {
          if (event.$case === "quoteUpdated") finish({ quote: event.value });
          if (event.$case === "noQuote") finish({ error: new Error("Omniston did not find a fresh route.") });
        },
        error: (reason) => finish({ error: reason }),
      });
  });
}

export function fetchFreshTonToUsdtQuote(client: Omniston, outputAmount: string) {
  return fetchFreshTonToTokenQuote(client, outputAmount, "USDT");
}

export async function buildTonPaymentTransaction(
  client: Omniston,
  quoteId: string,
  payerAddress: string,
  merchantAddress: string,
): Promise<TonTransaction> {
  return client.tonBuildSwap({
    quoteId,
    transferSrcAddress: tonAddress(payerAddress),
    traderDstAddress: tonAddress(merchantAddress),
    gasExcessAddress: tonAddress(payerAddress),
    refundSrcAddress: tonAddress(payerAddress),
    useRecommendedSlippage: true,
  });
}

export function trackTonSwap(
  client: Omniston,
  quoteId: string,
  payerAddress: string,
  signedBoc: string,
  onProgress: (progress: SwapProgress) => void,
  onError: (message: string) => void,
) {
  return client
    .swapTrack({
      quoteId,
      traderAddress: tonAddress(payerAddress),
      outgoingTxQuery: signedBoc,
    })
    .subscribe({
      next: (event) => {
        if (event.$case === "progress") onProgress(event.value);
      },
      error: (reason) => onError(reason.message),
    });
}
