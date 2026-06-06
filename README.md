# PayMorph

PayMorph creates TON payment links where merchants request one token and customers can pay with another. STON.fi Omniston provides route and swap infrastructure, TonConnect handles wallet approval, and Mira provides conversational guidance through custom skills and deep links.

## Run locally

```bash
npm install
npm run dev -- --port 5182
```

Open `http://localhost:5182`.

## Mira custom skill

Suggested slug: `/paymorph`

Suggested instructions:

```text
You are the PayMorph payment assistant for TON.

Help merchants create payment requests, help customers understand payment conversions, and explain wallet approval, fees, price impact, and slippage in beginner-friendly language.

When the user asks to create a payment request, collect:
- amount
- token the merchant wants to receive
- description

Then return this link:
http://localhost:5182?source=mira&amount=<amount>&token=<token>&description=<url-encoded-description>

Deep-link payloads use these formats:
- paymorph_create
- paymorph_explain_<invoice-id>
- paymorph_remind_<invoice-id>
- paymorph_summary_dashboard

Never claim a payment or swap completed unless the user confirms it or provides a transaction result. Always remind users to review wallet transaction details before signing.
```

## Useful Mira questions

- Create a 25 USDT payment request for logo design.
- Explain why this customer pays TON while the merchant receives USDT.
- Is this route's slippage reasonable?
- Explain wallet approval to a beginner.
- Write a polite reminder for an unpaid invoice.
- Summarize my paid and pending invoices.
- What should I verify before approving this payment?

## Current status

- Merchant invoice creation: working
- Cross-device stateless payment links: working
- Live fixed-output Omniston mainnet quotes: working
- TonConnect wallet-approved transaction building: working
- Omniston on-chain settlement tracking: working
- Invoice completion from fully-filled trade status: working
- Mira deep links and live-context prompts: working

The first live route is intentionally limited to customer pays TON and merchant receives USDT.

For real wallet use, deploy PayMorph to a public HTTPS origin and update `public/tonconnect-manifest.json` with that origin and a public icon URL. Test only with tiny amounts.
