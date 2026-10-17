import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AgentChat } from "@/components/chat/agent-chat";
import { CHAT_AGENTS, isChatAgent } from "@/lib/agents/catalog";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { agent: string } }) {
  return { title: isChatAgent(params.agent) ? `${CHAT_AGENTS[params.agent].name} — chat` : "Chat" };
}

/** Chat with an agent (DARWIN, RUBIN, EV, MIKE). JARVIS keeps its own voice-first console. */
export default function AgentChatPage({ params }: { params: { agent: string } }) {
  if (!isChatAgent(params.agent)) notFound();
  return (
    <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#0b1324" }} />}>
      <AgentChat key={params.agent} agent={CHAT_AGENTS[params.agent]} />
    </Suspense>
  );
}
