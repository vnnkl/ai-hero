import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
} from "ai";
import { auth } from "~/server/auth";
import { model } from "~/models";
import { z } from "zod";
import { searchSerper } from "~/serper";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages } = body;

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