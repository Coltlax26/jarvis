export interface Surface {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(userId: string, text: string): Promise<void>;
}
