import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./index";
import { users, userRequests } from "./schema";
import type { DB } from "./schema";

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