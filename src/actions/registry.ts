import type { Action } from "./types.js";

export class ActionRegistry {
  private map = new Map<string, Action>();

  register<I>(a: Action<I>): void {
    if (this.map.has(a.name)) {
      throw new Error(`Action already registered: ${a.name}`);
    }
    // Actions are stored type-erased; the gate re-validates input via the
    // action's own zod schema before ever calling run().
    this.map.set(a.name, a as unknown as Action);
  }
  get(name: string): Action | undefined {
    return this.map.get(name);
  }
  list(): Action[] {
    return [...this.map.values()];
  }
}
