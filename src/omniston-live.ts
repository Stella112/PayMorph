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

const tonAsset = {
  chain: {
    $case: "ton" as const,
    value: { kind: { $case: "native" as const, value: {} } },
  },
};

const usdtAsset = {
  chain: {
    $case: "ton" as const,
    value: { kind: { $case: "jetton" as const, value: USDT_MASTER } },
  },
};

const tonAddress = (value: string) => ({
  chain: { $case: "ton" as const, value },
});

function decimalToUnits(value: string, decimals: number) {
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

export function useLiveTonToUsdtQuote(outputAmount: string, enabled: boolean) {
  const client = useOmniston();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "no-quote" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setQuote(null);
    setError("");
    if (!enabled || !Number(outputAmount)) {
      setStatus("idle");
      return;
    }

    setStatus("loading");
    const subscription = client
      .requestForQuote({
        inputAsset: tonAsset,
        outputAsset: usdtAsset,
        amount: { $case: "outputUnits", value: decimalToUnits(outputAmount, 6) },
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
  }, [client, enabled, outputAmount]);

  return { quote, status, error };
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

