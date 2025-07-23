import { and, eq, gte, sql, desc } from "drizzle-orm";
import { db } from "./index";
import { users, userRequests, chats, messages } from "./schema";
import type { DB } from "./schema";
import type { Message } from "ai";

// Rate limiting configuration
const DAILY_REQUEST_LIMIT = 50; // Allow 50 requests per day for regular users

/**
 * Get the number of requests a user has made today
 */
export async function getUserRequestCountToday(userId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(userRequests)
    .where(
      and(
        eq(userRequests.userId, userId),
        gte(userRequests.requestDate, today)
      )
    );

  return result[0]?.count ?? 0;
}

/**
 * Add a new request record for a user
 */
export async function addUserRequest(
  userId: string,
  endpoint: string
): Promise<DB.UserRequest> {
  const result = await db
    .insert(userRequests)
    .values({
      userId,
      endpoint,
    })
    .returning();

  return result[0]!;
}

/**
 * Check if a user is an admin
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const result = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result[0]?.isAdmin ?? false;
}

/**
 * Check if a user can make a request (rate limiting logic)
 */
export async function canUserMakeRequest(userId: string): Promise<{
  allowed: boolean;
  reason?: string;
  requestsToday: number;
  limit: number;
}> {
  // Check if user is admin first
  const isAdmin = await isUserAdmin(userId);
  
  if (isAdmin) {
    return {
      allowed: true,
      requestsToday: 0, // Admins don't count towards limit
      limit: Infinity,
    };
  }

  // Check regular user's request count
  const requestsToday = await getUserRequestCountToday(userId);
  
  if (requestsToday >= DAILY_REQUEST_LIMIT) {
    return {
      allowed: false,
      reason: `Daily limit of ${DAILY_REQUEST_LIMIT} requests exceeded. You have made ${requestsToday} requests today.`,
      requestsToday,
      limit: DAILY_REQUEST_LIMIT,
    };
  }

  return {
    allowed: true,
    requestsToday,
    limit: DAILY_REQUEST_LIMIT,
  };
}

/**
 * Create or update a chat with all its messages
 * If the chat exists, it will delete all existing messages and replace them
 * If the chat doesn't exist, it will create a new one
 */
export async function upsertChat(opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: Message[];
}): Promise<DB.Chat> {
  const { userId, chatId, title, messages: messageList } = opts;

  // First, check if the chat exists and belongs to the user
  const existingChat = await db
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);

  if (existingChat.length > 0 && existingChat[0]!.userId !== userId) {
    throw new Error("Chat does not belong to the logged in user");
  }

  // Use a transaction to ensure data consistency
  return await db.transaction(async (tx) => {
    // Upsert the chat
    const chat = await tx
      .insert(chats)
      .values({
        id: chatId,
        userId,
        title,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: chats.id,
        set: {
          title,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Delete all existing messages for this chat
    await tx.delete(messages).where(eq(messages.chatId, chatId));

    // Insert all new messages
    if (messageList.length > 0) {
      const messageValues = messageList.map((message, index) => ({
        chatId,
        role: message.role,
        parts: message.parts,
        order: index,
      }));

      await tx.insert(messages).values(messageValues);
    }

    return chat[0]!;
  });
}

/**
 * Get a chat by ID with all its messages
 */
export async function getChat(chatId: string, userId: string): Promise<{
  chat: DB.Chat;
  messages: Message[];
} | null> {
  // Get the chat and verify it belongs to the user
  const chatResult = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);

  if (chatResult.length === 0) {
    return null;
  }

  // Get all messages for the chat, ordered by their order field
  const messagesResult = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.order);

  // Convert the database messages back to Message format
  const messageList: Message[] = messagesResult.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant",
    parts: msg.parts as Message["parts"],
    content: "",
  }));

  return {
    chat: chatResult[0]!,
    messages: messageList,
  };
}

/**
 * Get all chats for a user (without messages)
 */
export async function getChats(userId: string): Promise<DB.Chat[]> {
  const result = await db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt));

  return result;
}