type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: {
      first_name?: string;
      username?: string;
    };
  };
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function initializeTelegramMiniApp() {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return null;

  webApp.ready();
  webApp.expand();
  webApp.setHeaderColor?.("#061117");
  webApp.setBackgroundColor?.("#061117");
  document.documentElement.dataset.telegram = "true";

  return webApp;
}

export function readTelegramStartParam() {
  const webApp = window.Telegram?.WebApp;
  return (
    webApp?.initDataUnsafe?.start_param ||
    new URLSearchParams(window.location.search).get("tgWebAppStartParam") ||
    ""
  );
}

export function parsePayMorphStartParam(startParam: string) {
  if (!startParam) return null;
  if (startParam === "create") return { action: "create" as const };
  if (startParam === "forgelens") return { action: "forgelens" as const };

  if (startParam.startsWith("pay_")) {
    try {
      const encoded = startParam.slice(4).replace(/-/g, "+").replace(/_/g, "/");
      const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
      const decoded = JSON.parse(atob(padded));
      return {
        action: "pay" as const,
        invoiceId: String(decoded.id),
        amount: String(decoded.amount),
        merchant: String(decoded.merchant),
        description: String(decoded.description || "PayMorph payment"),
        receiveToken: decoded.receiveToken ? String(decoded.receiveToken) : "USDT",
        memo: decoded.memo ? String(decoded.memo) : "",
        expiresAt: decoded.expiresAt ? String(decoded.expiresAt) : "",
      };
    } catch {
      return null;
    }
  }

  return null;
}

export function buildTelegramPaymentStartParam(
  id: string,
  amount: string,
  merchant: string,
  description: string,
  receiveToken = "USDT",
  memo = "",
  expiresAt = "",
) {
  const base64Url = btoa(JSON.stringify({ id, amount, merchant, description, receiveToken, memo, expiresAt }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `pay_${base64Url}`;
}
