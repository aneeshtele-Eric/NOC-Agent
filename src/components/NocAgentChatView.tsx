import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, Trash2, AlertTriangle, User } from 'lucide-react';
import type { NocAgentRole, NocChatMessage, NocChatModelMode } from '../types/noc';
import { apiFetch, formatShortDate } from '../utils/format';

interface NocAgentChatViewProps {
  messages: NocChatMessage[];
  onMessagesChange: React.Dispatch<React.SetStateAction<NocChatMessage[]>>;
  agentRole: NocAgentRole;
  onAgentRoleChange: (role: NocAgentRole) => void;
  modelMode: NocChatModelMode;
  onModelModeChange: (mode: NocChatModelMode) => void;
}

const ROLE_OPTIONS: Array<{ id: NocAgentRole; label: string; description: string }> = [
  {
    id: 'coordinator',
    label: 'Multi-Agent Coordinator',
    description: 'Synthesizes Digital Twin, Incident Triage, and Problem Management telemetry.',
  },
  {
    id: 'triage',
    label: 'Incident Triage Copilot',
    description: 'Focuses on active SLA deadlines, field dispatch, climbing, and DNO escalation.',
  },
  {
    id: 'digital_twin',
    label: 'Digital Twin Manager',
    description: 'Focuses on site hardware profiles, battery/generator autonomy, and hub/child trees.',
  },
  {
    id: 'problem_management',
    label: 'Problem Management Advisor',
    description: 'Focuses on repeat offenders, 5-Why root cause chains, and strategic upgrades.',
  },
];

const MODEL_OPTIONS: Array<{ id: NocChatModelMode; label: string }> = [
  { id: 'standard', label: 'Standard · gemini-4-hydrogen' },
  { id: 'fast', label: 'Fast · gemini-3.1-flash-lite' },
];

const QUICK_PROMPTS = [
  'Which active P1 incidents are closest to SLA breach and require climbing?',
  'Identify our top repeat-offender hub sites and recommend resiliency upgrades.',
  'Summarize DNO power risks for hubs without generator backup.',
  'Which open problem investigations affect transmission hubs with child sites?',
];

export const NocAgentChatView: React.FC<NocAgentChatViewProps> = ({
  messages,
  onMessagesChange,
  agentRole,
  onAgentRoleChange,
  modelMode,
  onModelModeChange,
}) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

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
      setError(err instanceof Error ? err.message : 'Failed to reach Gemini NOC Agent.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const currentRoleMeta = ROLE_OPTIONS.find((r) => r.id === agentRole) ?? ROLE_OPTIONS[0];

  return (
    <div className="flex flex-col rounded-lg border border-[#1B263B] bg-[#0B111E] h-[calc(100vh-140px)]">
      {/* Header & Role/Model Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1B263B] px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-cyan-400" />
            <h2 className="font-display text-base font-semibold text-slate-100">NOC Multi-Agent Chat</h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">{currentRoleMeta.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={agentRole}
            onChange={(e) => onAgentRoleChange(e.target.value as NocAgentRole)}
            aria-label="Select NOC Agent Role"
            className="rounded-md border border-[#273549] bg-[#070B14] px-3 py-1.5 text-xs font-medium text-slate-100 focus:border-cyan-500 focus:outline-none"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                Role: {r.label}
              </option>
            ))}
          </select>

          <select
            value={modelMode}
            onChange={(e) => onModelModeChange(e.target.value as NocChatModelMode)}
            aria-label="Select Gemini Model Mode"
            className="rounded-md border border-[#273549] bg-[#070B14] px-3 py-1.5 font-mono text-xs text-cyan-300 focus:border-cyan-500 focus:outline-none"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              onMessagesChange([]);
              setError(null);
            }}
            disabled={messages.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#273549] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear Thread</span>
          </button>
        </div>
      </div>

      {/* Scrollable Thread */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl py-8 space-y-6">
            <div className="text-center">
              <h3 className="font-display text-sm font-semibold text-slate-200">
                Ask across live UK Site Digital Twins, Active Incidents, and Problem Records
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Conversation history is preserved across turns and grounded in live SQLite telemetry via Gemini. Mention specific IDs such as <span className="font-mono text-cyan-400">UK-LSE-HUB-001</span>, <span className="font-mono text-cyan-400">INC-2026-00001</span>, or <span className="font-mono text-cyan-400">PRB-2026-00001</span>.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendMessage(q)}
                  className="text-left rounded-md border border-[#1B263B] bg-[#070B14] p-3 text-xs text-slate-300 hover:border-cyan-500/50 hover:text-slate-100 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const roleLabel =
              ROLE_OPTIONS.find((r) => r.id === msg.agentRole)?.label ?? 'Multi-Agent Coordinator';
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#273549] bg-[#070B14] text-cyan-400">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                )}

                <div
                  className={`max-w-3xl rounded-lg px-4 py-3 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-cyan-950/50 border border-cyan-500/30 text-slate-100'
                      : 'bg-[#070B14] border border-[#1B263B] text-slate-200'
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400">
                    <span className={isUser ? 'text-cyan-300 font-medium' : 'text-slate-300 font-medium'}>
                      {isUser ? 'NOC Operator' : roleLabel}
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
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#273549] bg-slate-800 text-slate-200">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {sending && (
          <div className="flex gap-3 justify-start">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#273549] bg-[#070B14] text-cyan-400">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="rounded-lg border border-[#1B263B] bg-[#070B14] px-4 py-3 text-xs text-slate-400">
              Querying Gemini API and live SQLite telemetry...
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="border-t border-[#1B263B] p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${currentRoleMeta.label}...`}
            className="flex-1 rounded-md border border-[#273549] bg-[#070B14] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>
        </div>
      </form>
    </div>
  );
};

