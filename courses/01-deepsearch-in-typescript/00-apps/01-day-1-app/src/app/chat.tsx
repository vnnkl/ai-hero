"use client";

import { useState, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ChatMessage } from "~/components/chat-message";
import { SignInModal } from "~/components/sign-in-modal";
import { isNewChatCreated } from "~/utils";
import type { Message } from "ai";
import { StickToBottom } from "use-stick-to-bottom";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
  chatId: string;
  isNewChat: boolean;
  initialMessages?: Message[];
}

export const ChatPage = ({ userName, isAuthenticated, chatId, isNewChat, initialMessages }: ChatProps) => {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const router = useRouter();
  const { messages, input, handleInputChange, handleSubmit, isLoading, data } =
    useChat({
      initialMessages,
      body: {
        chatId,
        isNewChat,
      },
    });

  console.log(messages);

  // Handle new chat creation - redirect to the new chat URL
  useEffect(() => {
    const lastDataItem = data?.[data.length - 1];

    if (lastDataItem && isNewChatCreated(lastDataItem)) {
      router.push(`?id=${lastDataItem.chatId}`);
    }
  }, [data, router]);

  const handleFormSubmit = (e: React.FormEvent) => {
    if (!isAuthenticated) {
      e.preventDefault();
      setShowSignInModal(true);
      return;
    }
    handleSubmit(e);
  };

    return (
    <>
      <div className="flex flex-1 flex-col relative">
        {/* Messages area with fixed height */}
        <div className="flex-1 overflow-hidden">
          <StickToBottom
            className="h-full mx-auto w-full max-w-[65ch] relative [&>div]:scrollbar-thin [&>div]:scrollbar-track-gray-800 [&>div]:scrollbar-thumb-gray-600 [&>div]:hover:scrollbar-thumb-gray-500"
            resize="smooth"
            initial="smooth"
            role="log"
            aria-label="Chat messages"
          >
            <StickToBottom.Content className="flex flex-col gap-4 p-4 bg-gray-950 min-h-full justify-end">
              {messages.map((message, index) => {
                return (
                  <ChatMessage
                    key={index}
                    message={message}
                    userName={userName}
                  />
                );
              })}
            </StickToBottom.Content>
          </StickToBottom>
        </div>

        {/* Input fixed at bottom */}
        <div className="border-t border-gray-700 bg-gray-950">
          <form onSubmit={handleFormSubmit} className="mx-auto max-w-[65ch] p-4">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder={isAuthenticated ? "Say something..." : "Sign in to start chatting..."}
                autoFocus={isAuthenticated}
                aria-label="Chat input"
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <SignInModal 
        isOpen={showSignInModal} 
        onClose={() => setShowSignInModal(false)} 
      />
    </>
  );
};
