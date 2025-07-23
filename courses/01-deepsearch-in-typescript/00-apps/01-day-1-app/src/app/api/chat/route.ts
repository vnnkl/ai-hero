import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  appendResponseMessages,
} from "ai";
import { auth } from "~/server/auth";
import { model } from "~/models";
import { z } from "zod";
import { searchSerper } from "~/serper";
import { canUserMakeRequest, addUserRequest, upsertChat } from "~/server/db/queries";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Rate limiting check
  const rateLimitCheck = await canUserMakeRequest(session.user.id);
  
  if (!rateLimitCheck.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        message: rateLimitCheck.reason,
        requestsToday: rateLimitCheck.requestsToday,
        limit: rateLimitCheck.limit,
      }),
      { 
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Limit": rateLimitCheck.limit.toString(),
          "X-RateLimit-Remaining": Math.max(0, rateLimitCheck.limit - rateLimitCheck.requestsToday).toString(),
          "X-RateLimit-Reset": new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Reset at midnight
        }
      }
    );
  }

  // Record the request
  await addUserRequest(session.user.id, "/api/chat");

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId?: string;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages, chatId: providedChatId } = body;

      // Generate a new chatId if not provided
      const chatId = providedChatId ?? crypto.randomUUID();

      // Generate a chat title from the first user message
      const firstUserMessage = messages.find(msg => msg.role === 'user');
      const chatTitle = firstUserMessage?.content 
        ? (typeof firstUserMessage.content === 'string' 
            ? firstUserMessage.content.slice(0, 50).trim() + (firstUserMessage.content.length > 50 ? '...' : '')
            : 'New Chat')
        : 'New Chat';

      // Create the chat in the database before starting the stream
      // This protects against broken streams, timeouts, or cancellations
      await upsertChat({
        userId: session.user.id,
        chatId,
        title: chatTitle,
        messages,
      });

      // If this is a new chat (no chatId was provided), send the new chat ID to the frontend
      if (!providedChatId) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId,
        });
      }

      const result = streamText({
        model,
        tools: {
            searchWeb: {
                parameters: z.object({
                  query: z.string().describe("The query to search the web for"),
                }),
                execute: async ({ query }, { abortSignal }) => {
                  const results = await searchSerper(
                    { q: query, num: 10 },
                    abortSignal,
                  );
            
                  return results.organic.map((result) => ({
                    title: result.title,
                    link: result.link,
                    snippet: result.snippet,
                  }));
                },
              },
          },
        system: `You are a helpful research assistant with access to real-time web search capabilities. 

MANDATORY BEHAVIOR:
1. You MUST use the searchWeb tool for ANY question that could benefit from current information, facts, or data
2. You MUST provide complete, comprehensive answers - never give partial responses
3. You MUST include inline citations with clickable links for ALL factual claims
4. You MUST search multiple times if needed to gather sufficient information

CITATION FORMAT:
- Use markdown links: [descriptive text](URL) 
- Cite sources inline within sentences, not just at the end
- Every factual claim needs a source link
- Example: "According to recent studies [OpenAI's latest research](https://example.com), AI models are improving rapidly."

SEARCH STRATEGY:
- Search first, then provide your complete answer
- If the initial search doesn't provide enough detail, search again with different terms
- Always aim to provide thorough, well-researched responses

Remember: Incomplete answers without proper citations are unacceptable. Always search and always cite.`,
        messages,
        maxSteps: 10,
        onFinish: async ({ text, finishReason, usage, response }) => {
          try {
            const responseMessages = response.messages;

            // Merge the original messages with the new response messages
            const updatedMessages = appendResponseMessages({
              messages,
              responseMessages,
            });

            // Save the updated messages to the database
            // This replaces all existing messages in the chat
            await upsertChat({
              userId: session.user.id,
              chatId,
              title: chatTitle,
              messages: updatedMessages,
            });
          } catch (error) {
            console.error('Error saving chat to database:', error);
            // Continue execution even if saving fails - don't break the stream
          }
        },
      });

      console.log(JSON.stringify(result, null, 2));

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
} 