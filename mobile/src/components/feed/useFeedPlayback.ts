import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, type View, type ViewToken } from "react-native";

import type { FeedItem } from "@/api/types";
import { postMedia } from "@/lib/media";

// Measure the actual video below the caption, not just the surrounding card.
const viewabilityConfig = { itemVisiblePercentThreshold: 1, minimumViewTime: 150 };

/** One player per feed, stable while adjacent video cards are equally visible. */
export function useFeedPlayback(enabled: boolean) {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const viewportRef = useRef<View | null>(null);
  const videos = useRef(new Map<number, View>());
  const visibleIds = useRef<number[]>([]);
  const measurement = useRef(0);
  const mounted = useRef(true);

  const measureVideos = useCallback(() => {
    const generation = ++measurement.current;
    const candidates = visibleIds.current.flatMap(id => {
      const view = videos.current.get(id);
      return view ? [{ id, view }] : [];
    });
    if (!mounted.current) return;
    if (!viewportRef.current || candidates.length === 0) {
      setSelectedId(null);
      return;
    }
    viewportRef.current.measureInWindow((_x, top, _width, height) => {
      if (!mounted.current || generation !== measurement.current) return;
      const ratios = new Map<number, number>();
      candidates.forEach(({ id, view }) => view.measureInWindow((_x, y, _width, videoHeight) => {
        if (!mounted.current || generation !== measurement.current) return;
        const visibleHeight = Math.max(0, Math.min(y + videoHeight, top + height) - Math.max(y, top));
        ratios.set(id, videoHeight > 0 ? visibleHeight / videoHeight : 0);
        if (ratios.size !== candidates.length) return;
        setSelectedId(current => {
          let best = current !== null && (ratios.get(current) ?? 0) >= 0.6 ? current : null;
          let bestRatio = best !== null ? ratios.get(best)! : 0.6;
          for (const { id } of candidates) {
            const ratio = ratios.get(id)!;
            if (ratio >= 0.6 && (best === null || ratio > bestRatio)) {
              best = id;
              bestRatio = ratio;
            }
          }
          return best;
        });
      }));
    });
  }, []);

  const registerVideo = useCallback((id: number, view: View | null) => {
    if (view) videos.current.set(id, view);
    else videos.current.delete(id);
    measureVideos();
  }, [measureVideos]);

  useEffect(() => {
    mounted.current = true;
    let currentEffect = true;
    let preferenceChanged = false;
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", value => {
      preferenceChanged = true;
      setReduceMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (currentEffect && !preferenceChanged) setReduceMotion(value);
    }).catch(() => { if (currentEffect && !preferenceChanged) setReduceMotion(false); });
    const appState = AppState.addEventListener("change", state => setForeground(state === "active"));
    return () => {
      currentEffect = false;
      mounted.current = false;
      measurement.current++;
      motion.remove();
      appState.remove();
    };
  }, []);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
    visibleIds.current = viewableItems.filter(token => token.isViewable &&
      postMedia(token.item.post.mediaUrl, token.item.post.mediaType)?.kind === "video")
      .map(token => token.item.post.id);
    setSelectedId(current => current !== null && visibleIds.current.includes(current) ? current : null);
    measureVideos();
  }, [measureVideos]);

  return {
    activePostId: enabled && focused && foreground && reduceMotion === false ? selectedId : null,
    viewabilityConfig,
    onViewableItemsChanged,
    viewportRef,
    registerVideo,
    measureVideos,
  };
}
