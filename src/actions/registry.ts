import type { Action } from "./types.js";

export class ActionRegistry {
  private map = new Map<string, Action>();

  register(a: Action): void {
    if (this.map.has(a.name)) {
      throw new Error(`Action already registered: ${a.name}`);
    }
    this.map.set(a.name, a);
  }
  get(name: string): Action | undefined {
    return this.map.get(name);
  }
  list(): Action[] {
    return [...this.map.values()];
  }
}
