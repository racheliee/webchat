"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";

export type Message = {
  id: string;
  username: string;
  avatar?: string;
  body: string;
  createdAt: string;
};

export const Chat = () => {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const websocketRef = React.useRef<WebSocket | null>(null);
  const [input, setInput] = useState<string>("");

  useEffect(() => {
    // Initialize WebSocket connection
    websocketRef.current = new WebSocket(
      process.env.PUBLIC_WEBSOCKET_URL || "ws://localhost:8080/ws"
    );
    const ws = websocketRef.current;

    ws.onopen = () => {
      console.log("WebSocket connection established");
    };

    ws.onmessage = (event) => {
      const newMessage: Message = JSON.parse(event.data);
      setMessages((prev) => [...prev, newMessage]);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    // Cleanup on unmount
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const message: Omit<Message, "id" | "createdAt"> = {
      username: session?.user?.name || "Anonymous",
      avatar: session?.user?.image || undefined,
      body: input.trim(),
    };

    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify(message));
      setInput("");
    } else {
      console.error("WebSocket is not connected.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-100 p-4">
      <div className="w-full max-w-lg bg-white shadow-md rounded-lg overflow-hidden">
        <div className="p-4 h-96 overflow-y-auto">
          {messages.map((message) => (
            <MessageComponent key={message.id} message={message} />
          ))}
        </div>
        <form onSubmit={sendMessage} className="flex items-center border-t p-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-gray-700"
          />
          <button
            type="submit"
            className="ml-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-grey-800"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

interface MessageProps {
  message: Message;
}

const MessageComponent = ({ message }: MessageProps) => {
  const { data: session } = useSession();

  return (
    <div
      className={`flex relative space-x-1 ${
        message.username === session?.user?.name
          ? "flex-row-reverse space-x-reverse"
          : "flex-row"
      }`}
    >
      {message?.avatar && (
        <div className="w-12 h-12 overflow-hidden flex-shrink-0 rounded">
          <Image
            width={50}
            height={50}
            src={message.avatar}
            alt={message.username}
          />
        </div>
      )}
      <span
        className={`inline-flex rounded space-x-2 items-start p-3 text-white ${
          message.username === session?.user?.name
            ? "bg-[#4a9c6d]"
            : "bg-[#363739]"
        } `}
      >
        {message.username !== session?.user?.name && (
          <span className="font-bold">{message.username}:&nbsp;</span>
        )}
        {message.body}
      </span>
    </div>
  );
};