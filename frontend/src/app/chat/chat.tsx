"use client";

import React, { useState, useEffect } from "react";
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
  const [user, setUser] = useState<{ username: string; avatar: string; github_url: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const websocketRef = React.useRef<WebSocket | null>(null);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    const fetchSessionAndConnectWebSocket = async () => {
      try {
        // Step 1: Fetch session data
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080"}/auth/session`,
          {
            credentials: "include",
          }
        );

        if (!res.ok) {
          throw new Error("Failed to fetch session");
        }

        const data = await res.json();

        if (data?.username) {
          setUser(data);  // Store session user data
          setError(false);  // Clear any previous errors

          // Step 2: Initialize WebSocket only after session data is available
          websocketRef.current = new WebSocket(
            process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://localhost:8080/ws"
          );

          websocketRef.current.onopen = () => {
            console.log("WebSocket connection established");
          };

          websocketRef.current.onmessage = (event) => {
            const newMessage: Message = JSON.parse(event.data);
            setMessages((prev) => [...prev, newMessage]);
          };

          websocketRef.current.onerror = (error) => {
            console.error("WebSocket error:", error);
          };

          // Cleanup WebSocket on component unmount
          return () => websocketRef.current?.close();
        } else {
          throw new Error("User not authenticated");
        }
      } catch (err) {
        console.error("Failed to fetch session or connect WebSocket", err);
        setError(true);  // Trigger error UI
      } finally {
        setLoading(false);
      }
    };

    fetchSessionAndConnectWebSocket();
  }, []);

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
        <button onClick={() => (window.location.href = "/")}>Back to Home →</button>
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

const MessageComponent = ({ message }: MessageProps) => (
  <div className="flex relative space-x-1">
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
        message.username ? "bg-[#4a9c6d]" : "bg-[#363739]"
      } `}
    >
      <span className="font-bold">{message.username}:&nbsp;</span>
      {message.body}
    </span>
  </div>
);