export type Role = "user" | "assistant" | "system";

export type Message = {
  id: string;
  conversationId: string;
  role: Role;
  surface: string;
  content: string;
  createdAt: Date;
};

export type Memory = {
  id: string;
  userId: string;
  content: string;
  source: string;
  keywords: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
};
