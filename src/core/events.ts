export type JarvisEventKind =
  | "turn_start"
  | "thinking"
  | "tool_run"
  | "tool_held"
  | "tool_rejected"
  | "turn_end"
  | "error";

export type JarvisEvent = {
  kind: JarvisEventKind;
  /** Human-readable one-liner for the activity stream. */
  text: string;
  /** ISO timestamp. */
  at: string;
  /** Which surface the turn came in on. */
  surface?: string;
  data?: unknown;
};

type Listener = (e: JarvisEvent) => void;

/**
 * A tiny per-user pub/sub the brain publishes turn progress to and the web
 * console subscribes to over SSE. In-process only; fine for a single-user,
 * single-process service.
 */
export class JarvisBus {
  private listeners = new Map<string, Set<Listener>>();

  publish(userId: string, event: JarvisEvent): void {
    const set = this.listeners.get(userId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch {
        /* a bad listener must not break a turn */
      }
    }
  }

  subscribe(userId: string, fn: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }
}
