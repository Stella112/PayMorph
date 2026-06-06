import { Omniston } from "@ston-fi/omniston-sdk";

const omniston = new Omniston({ apiUrl: "wss://omni-ws.ston.fi" });
const walletAddress = process.argv[2] || process.env.PAYMORPH_TEST_ADDRESS;
const outputUnits = process.argv[3] || "10000";
const tonAddress = (value) => ({ chain: { $case: "ton", value } });

if (!walletAddress) {
  console.error(
    "Usage: npm run verify:transaction -- <mainnet-wallet-address> [output-usdt-units]",
  );
  process.exit(2);
}

let finished = false;
let subscription;
const finish = (exitCode = 0) => {
  if (finished) return;
  finished = true;
  subscription?.unsubscribe();
  omniston.transport.close();
  process.exitCode = exitCode;
};

subscription = omniston
  .requestForQuote({
    inputAsset: {
      chain: { $case: "ton", value: { kind: { $case: "native", value: {} } } },
    },
    outputAsset: {
      chain: {
        $case: "ton",
        value: {
          kind: {
            $case: "jetton",
            value: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
          },
        },
      },
    },
    amount: { $case: "outputUnits", value: outputUnits },
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
    next: async (event) => {
      if (event.$case !== "quoteUpdated" || finished) return;
      try {
        const transaction = await omniston.tonBuildSwap({
          quoteId: event.value.quoteId,
          transferSrcAddress: tonAddress(walletAddress),
          traderDstAddress: tonAddress(walletAddress),
          gasExcessAddress: tonAddress(walletAddress),
          refundSrcAddress: tonAddress(walletAddress),
          useRecommendedSlippage: true,
        });

        console.log(
          JSON.stringify({
            resolver: event.value.resolverName,
            quoteId: event.value.quoteId,
            messageCount: transaction.messages.length,
            firstTarget: transaction.messages[0]?.targetAddress,
            firstAmount: transaction.messages[0]?.sendAmount,
            hasPayload: Boolean(transaction.messages[0]?.payload),
          }),
        );
        finish();
      } catch (error) {
        console.error(error);
        finish(1);
      }
    },
    error: (error) => {
      console.error(error);
      finish(1);
    },
  });

setTimeout(() => {
  if (!finished) {
    console.error("Timed out before Omniston built the transaction.");
    finish(1);
  }
}, 20_000);
