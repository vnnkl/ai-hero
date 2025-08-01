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
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { bulkCrawlWebsites } from "~/scraper";
import { cacheWithRedis } from "~/server/redis/redis";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

// Create cached version of scrapePages tool
const scrapePages = cacheWithRedis(
  "scrapePages",
  async (urls: string[]) => {
    return await bulkCrawlWebsites({ urls });
  },
);

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
    chatId: string;
    isNewChat: boolean;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages, chatId, isNewChat } = body;

      // Generate a chat title from the first user message
      const firstUserMessage = messages.find(msg => msg.role === 'user');
      let chatTitle = 'New Chat';
      
      if (firstUserMessage) {
        // Try to get text from parts array first (new format)
        if (firstUserMessage.parts && firstUserMessage.parts.length > 0) {
          const textPart = firstUserMessage.parts.find(part => part.type === 'text');
          if (textPart && textPart.text) {
            chatTitle = textPart.text.slice(0, 50).trim() + (textPart.text.length > 50 ? '...' : '');
          }
        }
        // Fallback to content field (legacy format)
        else if (firstUserMessage.content && typeof firstUserMessage.content === 'string') {
          chatTitle = firstUserMessage.content.slice(0, 50).trim() + (firstUserMessage.content.length > 50 ? '...' : '');
        }
      }

      // Create the chat in the database before starting the stream
      // This protects against broken streams, timeouts, or cancellations
      await upsertChat({
        userId: session.user.id,
        chatId,
        title: chatTitle,
        messages,
      });

      // If this is a new chat, send the new chat ID to the frontend
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId,
        });
      }

      // Create Langfuse trace for this chat session
      const trace = langfuse.trace({
        sessionId: chatId,
        name: "chat",
        userId: session.user.id,
      });

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
                    date: result.date || null,
                  }));
                },
              },
              scrapePages: {
                parameters: z.object({
                  urls: z.array(z.string()).describe("Array of URLs to scrape for full content"),
                }),
                execute: async ({ urls }) => {
                  const result = await scrapePages(urls);
                  
                  const mappedResults = result.results.map(({ url, result: crawlResult }) => ({
                    url,
                    content: crawlResult.success ? crawlResult.data : `Error: ${crawlResult.error}`,
                    success: crawlResult.success,
                  }));
                  
                  if (result.success) {
                    return {
                      success: true,
                      data: mappedResults,
                    };
                  } else {
                    return {
                      success: false,
                      error: result.error,
                      data: mappedResults,
                    };
                  }
                },
              },
          },
        system: `You are a helpful research assistant with access to real-time web search and web scraping capabilities. 

CURRENT DATE AND TIME: ${new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })} ${new Date().toLocaleTimeString('en-US', { timeZone: 'Europe/Paris', hour12: false })} CET

MANDATORY BEHAVIOR:
1. You MUST use the searchWeb tool for ANY question that could benefit from current information, facts, or data
2. You MUST provide complete, comprehensive answers - never give partial responses
3. You MUST include inline citations with clickable links for ALL factual claims
4. You MUST search multiple times if needed to gather sufficient information

AVAILABLE TOOLS:
1. searchWeb - Search the web for recent information and get snippets
2. scrapePages - Get the full content of specific web pages in markdown format

WHEN TO USE scrapePages:
- When search snippets don't provide enough detail for a comprehensive answer
- When you need to read the full content of articles, documentation, or papers
- When search results reference specific pages that need detailed examination
- When dealing with complex topics that require in-depth analysis of source material

HOW TO USE scrapePages:
- After getting search results, identify the most relevant URLs
- Use scrapePages with an array of URLs to get full content
- Always respect robots.txt - the tool will automatically check and skip disallowed pages
- Handle both successful scrapes and errors gracefully in your response

CITATION FORMAT:
- Use markdown links: [descriptive text](URL) 
- Cite sources inline within sentences, not just at the end
- Every factual claim needs a source link
- Example: "According to recent studies [OpenAI's latest research](https://example.com), AI models are improving rapidly."

SEARCH STRATEGY:
- Search first to identify relevant sources
- For time-sensitive information (news, weather, sports, stock prices, etc.), include date-specific terms in your queries
- Use the publication dates from search results to prioritize the most recent information
- Use scrapePages to get full content when needed for detailed analysis
- If the initial search doesn't provide enough detail, search again with different terms
- Always aim to provide thorough, well-researched responses

DATE-AWARE SEARCHING:
- When users ask for "recent", "latest", "current", or "up-to-date" information, include the current year/month in your search queries
- Always check the publication dates in search results and prioritize newer sources
- Mention the freshness of information in your responses (e.g., "According to a recent article from [date]...")

Remember: Incomplete answers without proper citations are unacceptable. Always search and always cite. Use scrapePages when you need more detail than search snippets provide.`,
        messages,
        maxSteps: 10,
        experimental_telemetry: {
          isEnabled: true,
          functionId: `agent`,
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
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

            // Flush the trace to Langfuse
            await langfuse.flushAsync();
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