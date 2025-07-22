import { streamText, type StreamTextResult } from "ai";
import { model } from "~/model";
import { SystemContext } from "./system-context";

export function answerQuestion(
  ctx: SystemContext,
  opts: {
    isFinal?: boolean;
    langfuseTraceId?: string;
    onFinish: Parameters<typeof streamText>[0]["onFinish"];
  },
): StreamTextResult<{}, string> {
  const { isFinal = false, langfuseTraceId, onFinish } = opts;

  return streamText({
    model,
    system: `You are a helpful AI assistant that answers questions based on the information gathered from web searches and scraped content.

When answering:
1. Be thorough but concise
2. Always cite your sources using markdown links
3. If you're unsure about something, say so
4. Format URLs as markdown links using [title](url)
5. Never include raw URLs

${isFinal ? "Note: We may not have all the information needed to answer the question completely. Please provide your best attempt at an answer based on the available information." : ""}`,
    prompt: `Message History:
${ctx.getMessageHistory()}

Based on the following context, please answer the question:

${ctx.getQueryHistory()}

${ctx.getScrapeHistory()}`,
    experimental_telemetry: langfuseTraceId
      ? {
          isEnabled: true,
          functionId: "answer-question",
          metadata: {
            langfuseTraceId,
          },
        }
      : undefined,
    onFinish,
  });
}
