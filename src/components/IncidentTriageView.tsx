import React, { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Send,
  Search,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import type {
  AgentAnalysisRecord,
  Incident,
  ProblemTicket,
  Site,
  TriageAIResult,
} from '../types/noc';
import { apiFetch, formatShortDate, formatSlaRemaining } from '../utils/format';

interface IncidentTriageViewProps {
  selectedIncidentId: string | null;
  onSelectIncident: (incidentId: string) => void;
  onInspectSite: (siteId: string) => void;
  onDataMutated: () => void;
}

interface IncidentContextResponse {
  incident: Incident;
  site: Site | null;
  childSites: Array<{ site_id: string; site_name: string; twin_status: string }>;
  pastIncidents: Incident[];
  siteProblems: ProblemTicket[];
  analyses: AgentAnalysisRecord[];
}

export const IncidentTriageView: React.FC<IncidentTriageViewProps> = ({
  selectedIncidentId,
  onSelectIncident,
  onInspectSite,
  onDataMutated,
}) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'Active' | 'Open' | 'In Progress' | 'Resolved' | 'All'>('Active');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [search, setSearch] = useState('');

  const [context, setContext] = useState<IncidentContextResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  const [triageResult, setTriageResult] = useState<TriageAIResult | null>(null);
  const [runningTriage, setRunningTriage] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  const [updatingStatus, setUpdatingStatus] = useState(false);

  const loadQueue = async () => {
    setLoadingList(true);
    try {
      const qs = new URLSearchParams({
        status: statusFilter,
        severity: severityFilter,
        search,
        limit: '60',
      });
      const res = await apiFetch<{ items: Incident[]; total: number }>(`/api/incidents?${qs.toString()}`);
      setIncidents(res.items);
      setTotal(res.total);
      if (!selectedIncidentId && res.items.length > 0) {
        onSelectIncident(res.items[0].incident_id);
      }
    } catch {
      // handled cleanly
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, [statusFilter, severityFilter, search]);

  const triggerTriageForId = async (incId: string) => {
    setRunningTriage(true);
    setAgentError(null);
    try {
      const res = await apiFetch<{ result: TriageAIResult }>('/api/agents/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incId }),
      });
      setTriageResult(res.result);
      loadQueue();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Triage Agent call failed.');
    } finally {
      setRunningTriage(false);
    }
  };

  const loadIncidentContext = async (incId: string) => {
    setLoadingContext(true);
    setAgentError(null);
    setChatHistory([]);
    try {
      const res = await apiFetch<IncidentContextResponse>(`/api/incidents/${encodeURIComponent(incId)}`);
      setContext(res);
      if (res.analyses && res.analyses.length > 0) {
        try {
          setTriageResult(JSON.parse(res.analyses[0].payload_json) as TriageAIResult);
        } catch {
          setTriageResult(null);
        }
      } else {
        setTriageResult(null);
        if (res.incident.status !== 'Resolved') {
          void triggerTriageForId(incId);
        }
      }
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Failed to load incident context');
    } finally {
      setLoadingContext(false);
    }
  };

  useEffect(() => {
    if (selectedIncidentId) {
      loadIncidentContext(selectedIncidentId);
    }
  }, [selectedIncidentId]);

  const handleRunTriageAgent = async () => {
    if (!context) return;
    await triggerTriageForId(context.incident.incident_id);
  };

  const handleUpdateIncident = async (patch: { status?: 'Open' | 'In Progress' | 'Resolved'; assigned_team?: string }) => {
    if (!context) return;
    setUpdatingStatus(true);
    try {
      await apiFetch(`/api/incidents/${encodeURIComponent(context.incident.incident_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await loadIncidentContext(context.incident.incident_id);
      await loadQueue();
      onDataMutated();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Failed to update incident');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!context || !chatInput.trim() || sendingChat) return;
    const question = chatInput.trim();
    const nextHistory = [...chatHistory, { role: 'user' as const, text: question }];
    setChatHistory(nextHistory);
    setChatInput('');
    setSendingChat(true);
    setAgentError(null);
    try {
      const res = await apiFetch<{ answer: string }>('/api/agents/triage/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_id: context.incident.incident_id,
          history: chatHistory,
          question,
        }),
      });
      setChatHistory([...nextHistory, { role: 'model', text: res.answer }]);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Copilot chat failed');
    } finally {
      setSendingChat(false);
    }
  };

  const activeInc = context?.incident;
  const activeSite = context?.site;
  const activeSla = activeInc ? formatSlaRemaining(activeInc.sla_deadline, activeInc.status) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Queue Panel */}
      <div className="lg:col-span-4 flex flex-col rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden lg:h-[calc(100vh-140px)]">
        <div className="space-y-3 border-b border-[#1B263B] bg-[#0F172A]/60 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Incident Queue</h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">{total.toLocaleString()} tickets</span>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, site, symptom..."
              className="w-full rounded-md border border-[#273549] bg-[#070B14] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md bg-[#070B14] p-1 border border-[#1B263B]">
            {(['Active', 'Open', 'In Progress', 'Resolved', 'All'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  statusFilter === tab
                    ? 'bg-[#162032] text-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="w-full rounded-md border border-[#273549] bg-[#070B14] px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="All">All Severities</option>
            <option value="P1-Critical">P1-Critical</option>
            <option value="P2-High">P2-High</option>
            <option value="P3-Medium">P3-Medium</option>
            <option value="P4-Low">P4-Low</option>
          </select>
        </div>

        <div className="flex-1 divide-y divide-[#172236] overflow-y-auto">
          {loadingList ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded bg-[#111C30] animate-pulse" />
              ))}
            </div>
          ) : incidents.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No incidents match the current filters.
            </div>
          ) : (
            incidents.map((inc) => {
              const sla = formatSlaRemaining(inc.sla_deadline, inc.status);
              const isSelected = inc.incident_id === selectedIncidentId;
              return (
                <div
                  key={inc.incident_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectIncident(inc.incident_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectIncident(inc.incident_id);
                    }
                  }}
                  className={`w-full cursor-pointer text-left px-4 py-3 transition-colors ${
                    isSelected ? 'bg-[#111C30]' : 'hover:bg-[#0E1627]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                    <span className={isSelected ? 'text-cyan-300 font-semibold' : 'text-slate-400'}>
                      {inc.incident_id} ·{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectSite(inc.site_id);
                        }}
                        className="text-cyan-400 hover:underline font-semibold"
                        title="Open site telemetry & detailed recommendations popup"
                      >
                        {inc.site_id}
                      </button>
                    </span>
                    <span
                      className={
                        sla.tier === 'resolved'
                          ? 'text-emerald-400'
                          : sla.tier === 'breached' || sla.tier === 'imminent'
                            ? 'text-red-400 font-semibold'
                            : sla.tier === 'warning'
                              ? 'text-amber-400'
                              : 'text-slate-400'
                      }
                    >
                      {sla.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-100 truncate">{inc.title}</div>
                  {inc.triage_recommendation && (
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-cyan-300/90 truncate">Next: {inc.triage_recommendation}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectSite(inc.site_id);
                        }}
                        className="shrink-0 font-mono text-[10px] text-cyan-400 hover:underline"
                      >
                        Site Info →
                      </button>
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    <span
                      className={
                        inc.severity === 'P1-Critical'
                          ? 'text-red-400'
                          : inc.severity === 'P2-High'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                      }
                    >
                      {inc.severity}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{inc.status}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{inc.uk_region || 'UK'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Triage Workbench */}
      <div className="lg:col-span-8 space-y-5">
        {loadingContext ? (
          <div className="h-96 rounded-lg border border-[#1B263B] bg-[#0B111E] animate-pulse" />
        ) : !activeInc ? (
          <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-12 text-center text-sm text-slate-400">
            Select an incident from the queue to open the Incident Triage Copilot.
          </div>
        ) : (
          <>
            {/* Ticket Header & Operational Controls */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400 tabular-nums">
                    <span className="text-cyan-400 font-semibold">{activeInc.incident_id}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        activeInc.severity === 'P1-Critical'
                          ? 'text-red-400 font-semibold'
                          : activeInc.severity === 'P2-High'
                            ? 'text-amber-400 font-semibold'
                            : 'text-slate-300'
                      }
                    >
                      {activeInc.severity}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{activeInc.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>Status: {activeInc.status}</span>
                  </div>
                  <h2 className="mt-1.5 text-lg font-semibold text-slate-100">{activeInc.title}</h2>
                  <p className="mt-2 text-sm text-slate-300 leading-relaxed">{activeInc.symptom_summary}</p>
                </div>

                {activeSla && (
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-slate-400">SLA Deadline</div>
                    <div
                      className={`font-mono text-lg font-semibold tabular-nums ${
                        activeSla.tier === 'resolved'
                          ? 'text-emerald-400'
                          : activeSla.tier === 'breached' || activeSla.tier === 'imminent'
                            ? 'text-red-400'
                            : activeSla.tier === 'warning'
                              ? 'text-amber-400'
                              : 'text-slate-100'
                      }`}
                    >
                      {activeSla.label}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                      Due {formatShortDate(activeInc.sla_deadline)}
                    </div>
                  </div>
                )}
              </div>

              {/* Site Digital Twin Context Strip */}
              {activeSite && (
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#1B263B] pt-4 sm:grid-cols-4 text-xs">
                  <div>
                    <div className="text-slate-400">Site Digital Twin</div>
                    <button
                      type="button"
                      onClick={() => onInspectSite(activeSite.site_id)}
                      className="mt-0.5 inline-flex items-center gap-1 font-mono font-medium text-cyan-400 hover:underline"
                    >
                      <span>{activeSite.site_id}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <div className="text-[11px] text-slate-400 truncate">{activeSite.site_name}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Power &amp; DNO</div>
                    <div className="mt-0.5 font-medium text-slate-200">{activeSite.dno_provider}</div>
                    <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {activeSite.battery_backup_hours}h battery · {activeSite.has_generator ? 'Gen Yes' : 'No Gen'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Transmission Topology</div>
                    <div className="mt-0.5 font-medium text-slate-200">
                      {activeSite.site_role}
                      {context.childSites.length > 0 ? (
                        <span className="text-amber-400"> ({context.childSites.length} child sites)</span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{activeSite.cooling_solution}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Access &amp; Rigging</div>
                    <div
                      className={`mt-0.5 font-medium ${
                        activeSite.climbing_required ? 'text-amber-400' : 'text-slate-200'
                      }`}
                    >
                      {activeSite.climbing_required ? 'Climbing Required' : 'Ground / Rooftop'}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate" title={activeSite.access_notes}>
                      {activeSite.access_notes}
                    </div>
                  </div>
                </div>
              )}

              {/* Action Bar */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#1B263B] pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() =>
                      handleUpdateIncident({ status: 'In Progress', assigned_team: 'Field Engineer Dispatch' })
                    }
                    className="rounded-md border border-[#273549] bg-[#070B14] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#111C30] transition-colors whitespace-nowrap"
                  >
                    Assign Field Engineer
                  </button>
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() =>
                      handleUpdateIncident({
                        status: 'In Progress',
                        assigned_team: `DNO Escalation (${activeSite?.dno_provider || 'Utility'})`,
                      })
                    }
                    className="rounded-md border border-[#273549] bg-[#070B14] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#111C30] transition-colors whitespace-nowrap"
                  >
                    Escalate to DNO
                  </button>
                  {activeInc.status !== 'Resolved' ? (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => handleUpdateIncident({ status: 'Resolved' })}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 transition-colors whitespace-nowrap"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Mark Resolved</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => handleUpdateIncident({ status: 'Open' })}
                      className="rounded-md border border-[#273549] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#111C30] transition-colors whitespace-nowrap"
                    >
                      Reopen Ticket
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  disabled={runningTriage}
                  onClick={handleRunTriageAgent}
                  className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {runningTriage ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                  <span>{runningTriage ? 'Analyzing Telemetry...' : triageResult ? 'Re-run Triage Agent' : 'Run Triage Agent'}</span>
                </button>
              </div>
            </div>

            {agentError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{agentError}</span>
              </div>
            )}

            {/* Incident Triage Agent Output */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1B263B] pb-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Incident Triage Agent Recommendation</h3>
                </div>
                <div className="flex items-center gap-3">
                  {triageResult && (
                    <span
                      className={`font-mono text-xs font-semibold ${
                        triageResult.urgencyTier === 'Immediate Breach Risk'
                          ? 'text-red-400'
                          : triageResult.urgencyTier === 'High Priority'
                            ? 'text-amber-400'
                            : 'text-cyan-400'
                      }`}
                    >
                      {triageResult.urgencyTier}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onInspectSite(activeInc.site_id)}
                    className="inline-flex items-center gap-1 rounded border border-[#273549] bg-[#070B14] px-2.5 py-1 font-mono text-[11px] font-medium text-cyan-400 hover:border-cyan-500/50 transition-colors"
                  >
                    <span>Site Details: {activeInc.site_id}</span>
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {runningTriage && !triageResult ? (
                <div className="mt-4 space-y-3">
                  {activeInc.triage_recommendation && (
                    <div className="rounded-md border border-cyan-500/30 bg-cyan-950/20 p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-cyan-300">Immediate Next Action (Enriching full AI checklist...)</span>
                        <button
                          type="button"
                          onClick={() => onInspectSite(activeInc.site_id)}
                          className="font-mono text-[11px] text-cyan-400 hover:underline"
                        >
                          Inspect {activeInc.site_id} →
                        </button>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-100">{activeInc.triage_recommendation}</div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                    <span>Gemini Triage Agent is analyzing site Digital Twin telemetry, SLA window, and dispatch steps...</span>
                  </div>
                </div>
              ) : !triageResult ? (
                <div className="mt-4 space-y-3">
                  {activeInc.triage_recommendation ? (
                    <div className="rounded-md border border-cyan-500/30 bg-cyan-950/20 p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-cyan-300">Recommended Next Action</span>
                        <button
                          type="button"
                          onClick={() => onInspectSite(activeInc.site_id)}
                          className="font-mono text-[11px] text-cyan-400 hover:underline"
                        >
                          Inspect {activeInc.site_id} →
                        </button>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-100">{activeInc.triage_recommendation}</div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-slate-400">
                      Click <strong className="text-slate-200">Run Triage Agent</strong> to cross-reference SLA deadlines,
                      climbing/access constraints, DNO status, and site Digital Twin blast radius.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-4 text-xs">
                  <div className="rounded-md border border-cyan-500/30 bg-cyan-950/20 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-cyan-300">Recommended Immediate Action</span>
                      <button
                        type="button"
                        onClick={() => onInspectSite(activeInc.site_id)}
                        className="font-mono text-[11px] text-cyan-400 hover:underline"
                      >
                        Open {activeInc.site_id} Telemetry &amp; Recs →
                      </button>
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-100">{triageResult.immediateNextAction}</div>
                    <div className="mt-1.5 text-slate-300">{triageResult.slaAssessment}</div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <div className="font-medium text-slate-300 mb-1.5">Dispatch Checklist</div>
                      <ul className="space-y-1.5 text-slate-300">
                        {triageResult.dispatchChecklist.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="font-mono text-cyan-400 tabular-nums">{idx + 1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <div className="font-medium text-slate-300">Climbing &amp; Access Advisory</div>
                        <div className="mt-0.5 text-slate-400">{triageResult.climbingAndAccessAdvisory}</div>
                      </div>
                      <div>
                        <div className="font-medium text-slate-300">Transmission Blast Radius</div>
                        <div className="mt-0.5 text-slate-400">{triageResult.blastRadiusImpact}</div>
                      </div>
                      <div>
                        <div className="font-medium text-slate-300">
                          DNO Escalation: {triageResult.dnoEscalationNeeded ? 'Required' : 'Not Required'}
                        </div>
                        <div className="mt-0.5 text-slate-400">{triageResult.dnoEscalationReason}</div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[#1B263B] pt-3 text-slate-400">
                    <span className="font-medium text-slate-300">Agent Rationale: </span>
                    {triageResult.rationale} · Suggested Team:{' '}
                    <span className="text-slate-200">{triageResult.suggestedTeam}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive Triage Copilot Q&A */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <h3 className="text-sm font-semibold text-slate-100">Triage Copilot Q&amp;A</h3>
              <p className="text-xs text-slate-400">
                Ask follow-up questions about site access, child-site failover, or past restoration fixes.
              </p>

              {chatHistory.length > 0 && (
                <div className="mt-3 max-h-60 space-y-2.5 overflow-y-auto border-y border-[#1B263B] py-3">
                  {chatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`rounded-md px-3 py-2 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'ml-8 bg-[#162032] text-slate-100'
                          : 'mr-8 border border-[#1B263B] bg-[#070B14] text-slate-200'
                      }`}
                    >
                      <div className="mb-0.5 font-mono text-[10px] text-slate-400">
                        {msg.role === 'user' ? 'Incident Manager' : 'Incident Triage Agent'}
                      </div>
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleSendChat} className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="e.g., Does this hub have enough battery backup until a mobile generator arrives?"
                  className="flex-1 rounded-md border border-[#273549] bg-[#070B14] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sendingChat || !chatInput.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#162032] border border-[#273549] px-3.5 py-2 text-xs font-medium text-slate-100 hover:border-cyan-500/50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{sendingChat ? 'Sending...' : 'Ask Copilot'}</span>
                </button>
              </form>
            </div>

            {/* Site Historical Context */}
            {context.pastIncidents.length > 0 && (
              <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden">
                <div className="flex items-center justify-between border-b border-[#1B263B] bg-[#0F172A]/60 px-5 py-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    Prior Incidents on {activeInc.site_id} ({context.pastIncidents.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => onInspectSite(activeInc.site_id)}
                    className="font-mono text-[11px] text-cyan-400 hover:underline"
                  >
                    Full Site Popup →
                  </button>
                </div>
                <div className="divide-y divide-[#172236]">
                  {context.pastIncidents.slice(0, 5).map((past) => (
                    <div key={past.incident_id} className="flex items-center justify-between gap-4 px-5 py-2.5 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-200 truncate">{past.title}</div>
                        <div className="text-slate-400 truncate">
                          {past.root_cause || past.symptom_summary}
                        </div>
                      </div>
                      <div className="text-right font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                        <div>{past.status}</div>
                        <div>{past.mttr_minutes ? `${past.mttr_minutes}m MTTR` : formatShortDate(past.opened_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
