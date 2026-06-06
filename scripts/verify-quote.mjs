import { Omniston } from "@ston-fi/omniston-sdk";

const omniston = new Omniston({ apiUrl: "wss://omni-ws.ston.fi" });

const subscription = omniston
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
    amount: { $case: "outputUnits", value: process.argv[2] || "1000000" },
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
      console.log(event.$case);
      if (event.$case === "quoteUpdated") {
        console.log(
          JSON.stringify({
            resolver: event.value.resolverName,
            inputUnits: event.value.inputUnits,
            outputUnits: event.value.outputUnits,
            quoteId: event.value.quoteId,
          }),
        );
        subscription.unsubscribe();
        omniston.transport.close();
      }
    },
    error: (error) => {
      console.error(error);
      omniston.transport.close();
      process.exitCode = 1;
    },
  });

setTimeout(() => {
  console.log("timeout");
  subscription.unsubscribe();
  omniston.transport.close();
}, 15000);
