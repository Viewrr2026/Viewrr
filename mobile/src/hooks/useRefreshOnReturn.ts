import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

/** Initial loading belongs to useAsyncResource. Refresh after a child screen closes. */
export function useRefreshOnReturn(refresh: () => void) {
  const visited = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (visited.current) refresh();
      visited.current = true;
    }, [refresh]),
  );
}
