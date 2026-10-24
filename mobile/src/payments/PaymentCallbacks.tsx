import { useEffect } from "react";
import { Linking } from "react-native";
import { handleURLCallback } from "@stripe/stripe-react-native";
import { PAYMENT_URL_SCHEME } from "@/config/env";

export function PaymentCallbacks() {
  useEffect(() => {
    const handle = async (url: string | null) => {
      if (url?.startsWith(`${PAYMENT_URL_SCHEME}://stripe-redirect`)) {
        try { await handleURLCallback(url); } catch { /* Verification remains server-side. */ }
      }
    };
    void Linking.getInitialURL().then(handle).catch(() => {});
    const listener = Linking.addEventListener("url", event => { void handle(event.url); });
    return () => listener.remove();
  }, []);
  return null;
}
