"use client"

import { useEffect, useRef, useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Send } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface ChatMessage {
  id: string;
  from: "lab" | "admin";
  author: string;
  text: string;
  time: string;
}

interface Props {
  caseId: string;
  side: "lab" | "admin";
  author: string;
  className?: string;
  heightClass?: string;
}

export function CaseChat({ caseId, side, author, className, heightClass = "h-[420px]" }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial mock message
    setMessages([
      { id: "1", from: "admin", author: "Support", text: "Hello! How can I help you with this case?", time: new Date().toISOString() }
    ]);
  }, [caseId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    
    const msg: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      from: side,
      author,
      text: trimmed,
      time: new Date().toISOString()
    };
    
    setMessages((m) => [...m, msg]);
    setText("");
  };

  return (
    <div className={cn("flex flex-col rounded-lg border border-border bg-card overflow-hidden", className)}>
      <div ref={scrollRef} className={cn("flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20", heightClass)}>
        {messages.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-10">No messages yet. Start the conversation about this case.</p>
        )}
        {messages.map((m) => {
          const mine = m.from === side;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                mine ? "bg-primary text-primary-foreground rounded-br-sm"
                     : "bg-card text-foreground border border-border rounded-bl-sm",
              )}>
                {!mine && <p className="text-[11px] font-medium opacity-80 mb-0.5">{m.author}</p>}
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className={cn("text-[10px] mt-1", mine ? "opacity-80 text-right" : "text-muted-foreground")}>
                  {new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 p-3 border-t border-border bg-card">
        <Input
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <Button onClick={send} size="icon"><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
