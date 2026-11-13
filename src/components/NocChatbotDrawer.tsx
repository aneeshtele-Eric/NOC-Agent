import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Maximize2,
  MessageSquare,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { NocAgentRole, NocChatMessage, NocChatModelMode } from '../types/noc';
import { apiFetch, formatShortDate } from '../utils/format';

interface NocChatbotDrawerProps {
  messages: NocChatMessage[];
  onMessagesChange: React.Dispatch<React.SetStateAction<NocChatMessage[]>>;
  agentRole: NocAgentRole;
  onAgentRoleChange: (role: NocAgentRole) => void;
  modelMode: NocChatModelMode;
  onModelModeChange: (mode: NocChatModelMode) => void;
  onExpandToFull: () => void;
}

const ROLE_OPTIONS: Array<{ id: NocAgentRole; label: string }> = [
  { id: 'coordinator', label: 'Coordinator' },
  { id: 'triage', label: 'Incident Triage' },
  { id: 'digital_twin', label: 'Digital Twin' },
  { id: 'problem_management', label: 'Problem Advisor' },
];

const QUICK_PROMPTS = [
  'Which open incidents are closest to SLA breach and what is the next action?',
  'Summarize active problem recommendations for repeat-offender hubs.',
  'Identify hubs without generator backup facing power risks.',
  'Give me a briefing on top priority dispatches across UK regions.',
];

export const NocChatbotDrawer: React.FC<NocChatbotDrawerProps> = ({
  messages,
  onMessagesChange,
  agentRole,
  onAgentRoleChange,
  modelMode,
  onModelModeChange,
  onExpandToFull,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages, sending]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: NocChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      agentRole,
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    const historyPayload = messages.map((m) => ({ role: m.role, text: m.text }));
    onMessagesChange((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await apiFetch<{ answer: string; model?: string }>('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentRole,
          modelMode,
          history: historyPayload,
          message: trimmed,
        }),
      });

      const modelMsg: NocChatMessage = {
        id: `msg-${Date.now()}-m`,
        role: 'model',
        agentRole,
        text: res.answer,
        timestamp: new Date().toISOString(),
        modelUsed: res.model,
      };
      onMessagesChange((prev) => [...prev, modelMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to communicate with Gemini API.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open Gemini NOC AI Chatbot"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2.5 rounded-lg border border-cyan-500/40 bg-[#0B111E] px-4 py-2.5 text-slate-100 shadow-xl shadow-black/70 hover:border-cyan-400 hover:bg-[#0F172A] transition-colors"
      >
        <MessageSquare className="h-4 w-4 text-cyan-400" />
        <span className="font-display text-xs font-semibold tracking-tight whitespace-nowrap">
          Gemini NOC AI
        </span>
        {messages.length > 0 && (
          <>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-[11px] text-cyan-300 tabular-nums">
              {messages.length}
            </span>
          </>
        )}
      </button>
    );
  }

  return (
    <section
      aria-label="Gemini NOC AI Chatbot"
      className="fixed bottom-5 right-5 z-50 flex h-[600px] max-h-[82vh] w-[calc(100vw-2rem)] sm:w-[440px] flex-col rounded-lg border border-[#24324B] bg-[#0B111E] shadow-2xl shadow-black/80 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[#1B263B] bg-[#070B14] px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#273549] bg-[#0B111E] text-cyan-400">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
              Gemini NOC Chatbot
            </h2>
            <div className="font-mono text-[11px] text-slate-400 truncate">
              Live Telemetry · Multi-Turn
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onExpandToFull();
            }}
            title="Open full NOC Agent Chat"
            aria-label="Expand to full NOC Agent Chat"
            className="rounded-md p-1.5 text-slate-400 hover:bg-[#0F172A] hover:text-cyan-300 transition-colors"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              onMessagesChange([]);
              setError(null);
            }}
            disabled={messages.length === 0}
            title="Clear conversation"
            aria-label="Clear conversation"
            className="rounded-md p-1.5 text-slate-400 hover:bg-[#0F172A] hover:text-slate-200 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            title="Minimize chatbot"
            aria-label="Minimize chatbot"
            className="rounded-md p-1.5 text-slate-400 hover:bg-[#0F172A] hover:text-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Role & Model Mode Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-[#1B263B] bg-[#070B14] px-3 py-2">
        <select
          value={agentRole}
          onChange={(e) => onAgentRoleChange(e.target.value as NocAgentRole)}
          aria-label="Chatbot Agent Role"
          className="min-w-0 flex-1 rounded-md border border-[#273549] bg-[#0B111E] px-2.5 py-1 text-xs font-medium text-slate-100 focus:border-cyan-500 focus:outline-none"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              Role: {r.label}
            </option>
          ))}
        </select>

        <div
          role="group"
          aria-label="Gemini Model Mode"
          className="inline-flex rounded-md border border-[#273549] bg-[#0B111E] p-0.5 shrink-0"
        >
          <button
            type="button"
            onClick={() => onModelModeChange('standard')}
            className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
              modelMode === 'standard'
                ? 'bg-cyan-600 text-white font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => onModelModeChange('fast')}
            className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
              modelMode === 'fast'
                ? 'bg-cyan-600 text-white font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Fast
          </button>
        </div>
      </div>

      {/* Scrollable Thread */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {messages.length === 0 ? (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-[#1B263B] bg-[#070B14] p-3 text-xs text-slate-300 leading-relaxed">
              Connected to Gemini via server API with live SQLite NOC telemetry. Ask about active incidents, next actions, problems, or mention any Site, Incident, or Problem ID.
            </div>
            <div className="space-y-2">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendMessage(q)}
                  className="block w-full text-left rounded-md border border-[#1B263B] bg-[#070B14] px-3 py-2 text-xs text-slate-300 hover:border-cyan-500/50 hover:text-slate-100 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const roleLabel = ROLE_OPTIONS.find((r) => r.id === msg.agentRole)?.label ?? 'Coordinator';
            return (
              <div key={msg.id} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#273549] bg-[#070B14] text-cyan-400">
                    <Bot className="h-3 w-3" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-cyan-950/50 border border-cyan-500/30 text-slate-100'
                      : 'bg-[#070B14] border border-[#1B263B] text-slate-200'
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-slate-400">
                    <span className={isUser ? 'text-cyan-300 font-medium' : 'text-slate-300 font-medium'}>
                      {isUser ? 'Operator' : roleLabel}
                    </span>
                    {!isUser && msg.modelUsed && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-cyan-400">{msg.modelUsed}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatShortDate(msg.timestamp)}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                </div>

                {isUser && (
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#273549] bg-slate-800 text-slate-200">
                    <User className="h-3 w-3" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {sending && (
          <div className="flex gap-2 justify-start">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#273549] bg-[#070B14] text-cyan-400">
              <Bot className="h-3 w-3" />
            </div>
            <div className="rounded-lg border border-[#1B263B] bg-[#070B14] px-3 py-2 text-xs text-slate-400">
              Querying Gemini API &amp; live telemetry...
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="border-t border-[#1B263B] bg-[#070B14] p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Gemini about incidents, sites, problems..."
            className="flex-1 min-w-0 rounded-md border border-[#273549] bg-[#0B111E] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>
        </div>
      </form>
    </section>
  );
};
