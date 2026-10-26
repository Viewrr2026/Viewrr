type Entry = {
  visibility: number;
  autoplay: boolean;
  pausedByUser: boolean;
  onActive: (active: boolean) => void;
};

/** Owns playback across feed cards, including cards added by pagination. */
export function createFeedPlaybackCoordinator() {
  const entries = new Map<symbol, Entry>();
  let active: symbol | null = null;
  let manual: symbol | null = null;
  let pageVisible = true;

  function reconcile() {
    let next: symbol | null = null;
    const requested = manual && entries.get(manual);
    if (!requested || requested.visibility <= 0) manual = null;
    if (pageVisible) {
      if (manual) next = manual;
      else {
        let bestVisibility = 0.6;
        // Keep the current player when visibility is tied, avoiding flicker.
        const current = active && entries.get(active);
        if (current?.autoplay && !current.pausedByUser && current.visibility >= bestVisibility) {
          next = active;
          bestVisibility = current.visibility;
        }
        entries.forEach((entry, id) => {
          if (entry.autoplay && !entry.pausedByUser && entry.visibility >= 0.6 &&
              (next === null || entry.visibility > bestVisibility)) {
            next = id;
            bestVisibility = entry.visibility;
          }
        });
      }
    }
    if (next === active) return;
    const previous = active;
    active = next;
    // Stop the previous video synchronously before starting another.
    if (previous) entries.get(previous)?.onActive(false);
    if (next) entries.get(next)?.onActive(true);
  }

  return {
    setPageVisible(visible: boolean) {
      pageVisible = visible;
      if (!visible) manual = null;
      reconcile();
    },
    register(onActive: Entry["onActive"]) {
      const id = Symbol("feed-video");
      const entry: Entry = { visibility: 0, autoplay: false, pausedByUser: false, onActive };
      entries.set(id, entry);
      return {
        setVisibility(visibility: number) {
          entry.visibility = visibility;
          reconcile();
        },
        setAutoplay(allowed: boolean) {
          entry.autoplay = allowed;
          reconcile();
        },
        play() {
          if (!pageVisible || entry.visibility <= 0) return false;
          entry.pausedByUser = false;
          manual = id;
          reconcile();
          return active === id;
        },
        pause() {
          entry.pausedByUser = true;
          if (manual === id) manual = null;
          reconcile();
        },
        remove() {
          if (active === id) {
            active = null;
            onActive(false);
          }
          if (manual === id) manual = null;
          entries.delete(id);
          reconcile();
        },
      };
    },
  };
}

export const feedPlayback = createFeedPlaybackCoordinator();
