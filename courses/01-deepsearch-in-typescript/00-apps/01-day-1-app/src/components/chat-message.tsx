import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";
import { Search, Loader2 } from "lucide-react";

export type MessagePart = NonNullable<Message["parts"]>[number];

interface ChatMessageProps {
  message: Message;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const ToolInvocation = ({ part }: { part: MessagePart }) => {
  if (part.type !== "tool-invocation") return null;

  const { toolInvocation } = part;

  if (toolInvocation.state === "partial-call") {
    return (
      <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-950/30 p-3">
        <div className="flex items-center gap-2 text-blue-400">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm font-medium">Calling {toolInvocation.toolName}...</span>
        </div>
      </div>
    );
  }

  if (toolInvocation.state === "call") {
    return (
      <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-950/30 p-3">
        <div className="flex items-center gap-2 text-yellow-400">
          <Search className="size-4" />
          <span className="text-sm font-medium">
            Searching: &ldquo;{(toolInvocation.args as { query: string }).query}&rdquo;
          </span>
        </div>
      </div>
    );
  }

  if (toolInvocation.state === "result") {
    const results = Array.isArray(toolInvocation.result) ? toolInvocation.result : [];
    
    return (
      <div className="mb-4 rounded-lg border border-green-500/30 bg-green-950/30 p-3">
        <div className="flex items-center gap-2 text-green-400 mb-2">
          <Search className="size-4" />
          <span className="text-sm font-medium">
            Found {results.length} results for &ldquo;{(toolInvocation.args as { query: string }).query}&rdquo;
          </span>
        </div>
        <div className="space-y-2">
          {results.slice(0, 3).map((result: { title: string; link: string; snippet: string }, index: number) => (
            <div key={index} className="text-xs text-gray-400">
              <a 
                href={result.link} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                {result.title}
              </a>
              <p className="mt-1 text-gray-500 line-clamp-2">{result.snippet}</p>
            </div>
          ))}
          {results.length > 3 && (
            <p className="text-xs text-gray-500">
              ...and {results.length - 3} more results
            </p>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export const ChatMessage = ({ message, userName }: ChatMessageProps) => {
  const isAI = message.role === "assistant";

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 min-h-0 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
        style={{ backgroundColor: isAI ? 'rgb(31 41 55)' : 'rgb(17 24 39)' }}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        <div className="prose prose-invert max-w-none prose-pre:bg-gray-700 prose-code:bg-gray-700 prose-code:text-gray-300 prose-p:text-gray-300 prose-li:text-gray-300 prose-ul:text-gray-300 prose-ol:text-gray-300">
          {/* Handle parts array if it exists, otherwise fall back to content */}
          {message.parts ? (
            message.parts.map((part, index) => {
              if (part.type === "text") {
                return <Markdown key={index}>{part.text}</Markdown>;
              }
              
              if (part.type === "tool-invocation") {
                return <ToolInvocation key={index} part={part} />;
              }

              // For now, ignore other part types as specified in requirements
              return null;
            })
          ) : (
            // Fallback to existing behavior for messages without parts
            <Markdown>{message.content}</Markdown>
          )}
        </div>
      </div>
    </div>
  );
};
