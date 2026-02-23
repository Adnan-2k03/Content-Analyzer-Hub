import { db } from "../../db";
import { qaMessages } from "@shared/schema";
import { eq } from "drizzle-orm";

// Minimal chat storage shim using existing qaMessages table to satisfy integrations.
export interface IChatStorage {
  getConversation(id: number): Promise<any | undefined>;
  getAllConversations(): Promise<any[]>;
  createConversation(title: string): Promise<any>;
  deleteConversation(id: number): Promise<void>;
  getMessagesByConversation(conversationId: number): Promise<any[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<any>;
}

export const chatStorage: IChatStorage = {
  async getConversation(_id: number) {
    // Not implemented; return undefined
    return undefined;
  },

  async getAllConversations() {
    // Not used in current setup
    return [];
  },

  async createConversation(_title: string) {
    // Not implemented
    return { id: 0, title: "" };
  },

  async deleteConversation(_id: number) {
    // No-op
  },

  async getMessagesByConversation(conversationId: number) {
    return db.select().from(qaMessages).where(eq(qaMessages.contentId, conversationId)).orderBy(qaMessages.createdAt);
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const [message] = await db.insert(qaMessages).values({ contentId: conversationId, role, content }).returning();
    return message;
  },
};

