export function buildPaymentMiraLink(
  invoiceId: string,
  action: "explain" | "remind" | "summary",
) {
  const payload = `paymorph_${action}_${invoiceId}`;
  return `https://t.me/mira?start=${encodeURIComponent(payload)}`;
}
