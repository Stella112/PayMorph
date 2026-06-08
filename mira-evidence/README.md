# PayMorph Mira Evidence

This folder contains an exported Telegram chat from the PayMorph Ops group.

The export shows Mira being used as the PayMorph operations assistant for:

- PayMorph product context and updates
- Route and invoice explanations
- Beginner payment safety questions
- Recurring invoice explanations
- ForgeLens and treasury strategy prompts

Chat export:

- [paymorph-ops-mira-chat.html](./paymorph-ops-mira-chat.html)

## Readable Evidence Summary

GitHub shows exported `.html` files as source code, so the most important evidence is summarized below in readable form. The full export is still included in this folder.

### 1. Mira Was Given PayMorph Product Context

User prompt:

> @mira PayMorph has been updated.
>
> New receiver-token behavior:
> - Merchants can choose to receive USDT, USDC, or TON.
> - Customers pay from a TON wallet.
> - USDT and USDC invoices use STON.fi Omniston fixed-output routes from TON to the selected receive token.
> - TON invoices are direct wallet-approved TON transfers; no Omniston route is needed.
>
> Use this context:
> https://paymorph.vercel.app/mira-context.txt

Mira response summary:

> Mira confirmed the new PayMorph model and explained the three invoice types:
> USDT invoices route TON to USDT through STON.fi Omniston, USDC invoices route TON to USDC through STON.fi Omniston, and TON invoices use a direct wallet transfer with no swap.

### 2. Mira Explained Invoice Operations

User prompt:

> Mira, summarize my PayMorph payment operations.
>
> Total invoices: 1
> Pending invoices: 1
> Paid invoices: 0
> Active schedules: 1
> ForgeLens quote observations: 0
> Completed on-chain payments: 0

Mira response summary:

> Mira identified pending invoices, active schedules, and what the merchant should verify before asking customers to pay.

### 3. Mira Answered Beginner Payment Questions

User asked beginner questions including:

> Explain this PayMorph invoice like I am new to TON payments.
>
> What should a customer verify before approving this PayMorph payment?
>
> Why does the customer pay TON while the merchant receives USDC or USDT?
>
> What does STON.fi Omniston do in this payment?

Mira response summary:

> Mira explained the payment flow in beginner-friendly language, including wallet approval, non-custodial safety, slippage, and the role of STON.fi Omniston.

### 4. Mira Explained Recurring Invoice Agents

User prompt:

> Explain how PayMorph recurring invoices work without auto-charging the customer.

Mira response summary:

> Mira explained that the Collections Agent creates recurring payment links when due, but never auto-charges the customer. Each real payment still requires manual wallet approval.

### 5. Mira Provided ForgeLens / Treasury Strategy

User prompt:

> Suggest a simple beginner treasury strategy after I receive USDT or USDC payments.

Mira response summary:

> Mira gave a conservative beginner strategy for received stablecoins, including holding stablecoins first, considering STON.fi liquidity/yield only after understanding risk, and keeping all actions wallet-approved.

## Public Context Used By Mira

- https://paymorph.vercel.app/mira-context.txt
- https://paymorph.vercel.app/llms.txt
