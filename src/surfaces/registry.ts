import { logger } from "../logger.js";
import type { OutgoingMessage } from "../core/types.js";
import type { Surface } from "./types.js";

export class SurfaceRegistry {
  private surfaces = new Map<string, Surface>();

  add(s: Surface): void {
    this.surfaces.set(s.name, s);
  }
  get(name: string): Surface | undefined {
    return this.surfaces.get(name);
  }
  async startAll(): Promise<void> {
    for (const s of this.surfaces.values()) await s.start();
  }
  async stopAll(): Promise<void> {
    for (const s of this.surfaces.values()) {
      try {
        await s.stop();
      } catch (err) {
        logger.error(`surface ${s.name} stop failed`, err);
      }
    }
  }
  async deliver(msg: OutgoingMessage): Promise<void> {
    const target = this.surfaces.get(msg.surface);
    if (target) {
      await target.send(msg.userId, msg.text);
      return;
    }
    for (const s of this.surfaces.values()) {
      try {
        await s.send(msg.userId, msg.text);
        logger.info("broadcast delivery", { surface: s.name });
      } catch (err) {
        logger.error(`broadcast to ${s.name} failed`, err);
      }
    }
  }
}
