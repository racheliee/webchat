"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Spinner } from "@heroui/spinner";

export type Message = {
  id: string;
  username: string;
  avatar?: string;
  html_url?: string;
  body: string;
  createdAt: string;
};

export const Chat = () => {
  const [user, setUser] = useState<{
    username: string;
    avatar: string;
    github_url: string;
  } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const websocketRef = React.useRef<WebSocket | null>(null);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fetchSessionAndConnectWebSocket = async () => {
      try {
        // Fetch session data
        const res = await fetch(
          `${
            process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080"
          }/auth/session`,
          {
            credentials: "include",
          }
        );

        if (!res.ok) {
          throw new Error("Failed to fetch session");
        }

        const data = await res.json();

        if (data?.username) {
          setUser(data);
          setError(false);

          // Initialize WebSocket
          websocketRef.current = new WebSocket(
            process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://localhost:8080/ws"
          );

          websocketRef.current.onopen = () => {
            console.log("WebSocket connection established");
          };

          websocketRef.current.onmessage = (event) => {
            const newMessage: Message = JSON.parse(event.data);
            // Add new message to the END of the array
            setMessages((prev) => [...prev, newMessage]);
          };

          websocketRef.current.onerror = (error) => {
            console.error("WebSocket error:", error);
          };

          // Cleanup
          return () => websocketRef.current?.close();
        } else {
          throw new Error("User not authenticated");
        }
      } catch (err) {
        console.error("Failed to fetch session or connect WebSocket", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchSessionAndConnectWebSocket();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />;
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col">
        <p className="text-xl font-bold">Authentication failed *:(</p>
        <button onClick={() => (window.location.href = "/")}>
          Back to Home →
        </button>
      </div>
    );
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const message: Omit<Message, "id" | "createdAt"> = {
      username: user.username,
      avatar: user.avatar,
      html_url: user.github_url,
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
    <div className="h-screen w-full flex flex-col bg-white">
      {/* Chat Messages */}
      <div className="flex-1 w-full overflow-y-auto p-4 pb-20">
        <div className="flex flex-col w-full flex-grow">
          {messages.map((message) => (
            <MessageComponent
              key={message.id}
              message={message}
              isCurrentUser={user.username === message.username}
            />
          ))}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={sendMessage}
        className="w-full p-4 bg-white border-t fixed bottom-0"
      >
        <div className="flex items-center">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(
                e.target.scrollHeight,
                150
              )}px`;
            }}
            placeholder="Type your message..."
            className="flex-1 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-gray-700 resize-none overflow-auto"
            style={{ minHeight: "40px", maxHeight: "150px" }}
          />
          <button
            type="submit"
            className="ml-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};

interface MessageProps {
  message: Message;
  isCurrentUser: boolean;
}

const MessageComponent = ({ message, isCurrentUser }: MessageProps) => (
  <div
    className={`flex flex-grow relative mx-4 mt-2 mb-3 w-full ${
      isCurrentUser ? "items-end" : "items-start"
    }`}
  >
    {message?.avatar && !isCurrentUser && (
      <div className="w-12 h-12 overflow-hidden flex-shrink-0 rounded">
        <a
          href={message.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <Image
            width={50}
            height={50}
            src={message.avatar}
            alt={message.username}
            className="rounded-full"
          />
        </a>
      </div>
    )}

    <div
      className={`flex w-full flex-col ${isCurrentUser ? "items-end" : "items-start"}`}
    >
      <span className="font-semibold mx-2.5 my-0.5">{message.username}</span>
      <span
        className={`flex-grow rounded-md mx-2 p-3 break-all whitespace-pre-wrap max-w-[300px] sm:max-w-[500px] md:max-w-[700px] ${
          isCurrentUser
            ? "bg-[#363739] justify-start text-[#FAF9F6] border-[#FAF9F6] border-1"
            : "bg-[#FAF9F6] justify-end text-[#363739] border"
        }`}
      >
        {message.body}
      </span>
    </div>

    {message?.avatar && isCurrentUser && (
      <div className="w-12 h-12 overflow-hidden flex-shrink-0 rounded me-8">
        <a
          href={message.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <Image
            width={50}
            height={50}
            src={message.avatar}
            alt={message.username}
            className="rounded-full"
          />
        </a>
      </div>
    )}
  </div>
);
