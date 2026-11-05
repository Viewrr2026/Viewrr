import { useRef, useState } from "react";
import { ApiError } from "@/api/errors";

export function useFormAction() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof ApiError
          ? (error.serverMessage ?? error.userMessage)
          : error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}
