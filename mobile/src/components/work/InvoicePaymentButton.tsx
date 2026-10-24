import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Text, View } from "react-native";
import type { PaymentTarget } from "@/api/payments";
import { ApiError } from "@/api/errors";
import { Button } from "@/components/Button";
import { checkPendingInvoice, payInvoice, type CheckoutOutcome } from "@/payments/checkout";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme";

export function InvoicePaymentButton({ target, onChanged }: { target: PaymentTarget; onChanged: () => void }) {
  const { user } = useSession(), { colors } = useTheme();
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [settled, setSettled] = useState(false);
  const running = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  const targetKey = target.kind === "project" ? `project.${target.projectId}` : `cycle.${target.cycleId}`;

  function show(state: CheckoutOutcome | null) {
    setPending(state === "confirming");
    setSettled(state === "paid" || state === "unavailable");
    setMessage(state === "paid" ? "Payment verified. Refreshing your invoice…" :
      state === "confirming" ? "We're checking your payment. Please don't pay again." :
      state === "unavailable" ? "This invoice has a refund or dispute. Refresh its payment history." :
      state === "busy" ? "Another checkout is open. Finish or close it first." : "");
    if (state === "paid" || state === "unavailable") changed.current();
  }

  useFocusEffect(useCallback(() => {
    let mounted = true;
    if (user) void checkPendingInvoice(user.id, target).then(state => { if (mounted) show(state); })
      .catch(() => { if (mounted) { setPending(true); setMessage("We couldn't check your payment. Reconnect and check its status before paying again."); } });
    return () => { mounted = false; };
  }, [user?.id, targetKey]));

  async function run(checkOnly = false) {
    if (!user || running.current || settled) return;
    running.current = true; setBusy(true); setMessage("");
    try {
      show(checkOnly ? await checkPendingInvoice(user.id, target) : await payInvoice(user.id, target));
      changed.current();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.serverMessage ?? error.userMessage : error instanceof Error ? error.message : "Checkout is unavailable. Please try again.");
    } finally { running.current = false; setBusy(false); }
  }

  return <View style={{ gap: 8 }}>
    <Button label={pending ? "Check payment status" : "Pay invoice"} loading={busy} disabled={!user || busy || settled}
      accessibilityHint="Pay securely with Apple Pay or a card." onPress={() => void run(pending)} />
    {!!message && <Text accessibilityRole="alert" style={{ color: colors.mutedForeground }}>{message}</Text>}
  </View>;
}
