import React, { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  RefreshCw,
  Search,
  AlertTriangle,
  Plus,
  ExternalLink,
} from 'lucide-react';
import type {
  ProblemManagementAIResult,
  ProblemTicket,
  RepeatOffender,
} from '../types/noc';
import { apiFetch, formatShortDate } from '../utils/format';

interface ProblemManagementViewProps {
  initialSiteId: string | null;
  onInspectSite: (siteId: string) => void;
  onDataMutated: () => void;
}

export const ProblemManagementView: React.FC<ProblemManagementViewProps> = ({
  initialSiteId,
  onInspectSite,
  onDataMutated,
}) => {
  const [subTab, setSubTab] = useState<'repeat' | 'tickets'>('repeat');
  const [repeatOffenders, setRepeatOffenders] = useState<RepeatOffender[]>([]);
  const [problems, setProblems] = useState<ProblemTicket[]>([]);
  const [problemStatusFilter, setProblemStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [targetSiteId, setTargetSiteId] = useState<string | null>(initialSiteId);
  const [targetProblem, setTargetProblem] = useState<ProblemTicket | null>(null);

  const [aiResult, setAiResult] = useState<ProblemManagementAIResult | null>(null);
  const [runningAi, setRunningAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingTicket, setSavingTicket] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [repRes, probRes] = await Promise.all([
        apiFetch<{ items: RepeatOffender[] }>('/api/problems/repeat-offenders'),
        apiFetch<{ items: ProblemTicket[] }>(
          `/api/problems?status=${encodeURIComponent(problemStatusFilter)}&search=${encodeURIComponent(search)}`
        ),
      ]);
      setRepeatOffenders(repRes.items);
      setProblems(probRes.items);
      if (!targetSiteId && !targetProblem && repRes.items.length > 0) {
        setTargetSiteId(repRes.items[0].site_id);
      }
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [problemStatusFilter, search]);

  useEffect(() => {
    if (initialSiteId) {
      setTargetSiteId(initialSiteId);
      setTargetProblem(null);
      setSubTab('repeat');
    }
  }, [initialSiteId]);

  const handleRunProblemAgent = async (siteId?: string, problem?: ProblemTicket) => {
    const resolvedSiteId = problem?.site_id || siteId || targetSiteId;
    if (!resolvedSiteId) return;

    setTargetSiteId(resolvedSiteId);
    setTargetProblem(problem || null);
    setRunningAi(true);
    setError(null);
    setSaveMessage(null);

    try {
      const res = await apiFetch<{ result: ProblemManagementAIResult }>('/api/agents/problem-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: resolvedSiteId,
          problem_id: problem?.problem_id,
        }),
      });
      setAiResult(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Problem Management Agent failed');
    } finally {
      setRunningAi(false);
    }
  };

  useEffect(() => {
    const resolvedSiteId = targetProblem?.site_id || targetSiteId;
    if (!resolvedSiteId) return;

    let cancelled = false;
    const primaryEntityId = targetProblem?.problem_id || resolvedSiteId;

    const hydrateOrAnalyze = async () => {
      setError(null);
      try {
        let saved = await apiFetch<{ result: ProblemManagementAIResult | null }>(
          `/api/problems/analysis/${encodeURIComponent(primaryEntityId)}`
        );
        if (!saved.result && targetProblem?.problem_id && resolvedSiteId) {
          saved = await apiFetch<{ result: ProblemManagementAIResult | null }>(
            `/api/problems/analysis/${encodeURIComponent(resolvedSiteId)}`
          );
        }
        if (cancelled) return;

        if (saved.result) {
          setAiResult(saved.result);
          return;
        }

        // Automatically run Gemini Problem Management Agent in background if no saved 5-Why exists yet
        setAiResult(null);
        setRunningAi(true);
        const res = await apiFetch<{ result: ProblemManagementAIResult }>('/api/agents/problem-management', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site_id: resolvedSiteId,
            problem_id: targetProblem?.problem_id,
          }),
        });
        if (!cancelled) {
          setAiResult(res.result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Problem Management Agent failed');
        }
      } finally {
        if (!cancelled) {
          setRunningAi(false);
        }
      }
    };

    void hydrateOrAnalyze();
    return () => {
      cancelled = true;
    };
  }, [targetSiteId, targetProblem?.problem_id]);

  const handleSaveAsProblemTicket = async () => {
    if (!aiResult || !targetSiteId) return;
    setSavingTicket(true);
    setSaveMessage(null);
    setError(null);
    try {
      const topRec = aiResult.strategicRecommendations[0];
      const fiveWhyText = [
        `1. ${aiResult.fiveWhyChain.why1}`,
        `2. ${aiResult.fiveWhyChain.why2}`,
        `3. ${aiResult.fiveWhyChain.why3}`,
        `4. ${aiResult.fiveWhyChain.why4}`,
        `5. ${aiResult.fiveWhyChain.why5}`,
      ].join(' -> ');

      if (targetProblem) {
        await apiFetch(`/api/problems/${encodeURIComponent(targetProblem.problem_id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'Investigating',
            five_why_analysis: fiveWhyText,
            permanent_fix: aiResult.proposedPermanentFix,
            strategic_recommendation: topRec?.action || '',
            justification: topRec?.explicitJustification || '',
          }),
        });
        setSaveMessage(`Updated ${targetProblem.problem_id} with AI 5-Why & strategic advisory.`);
      } else {
        const res = await apiFetch<{ problem: ProblemTicket }>('/api/problems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site_id: targetSiteId,
            title: aiResult.rootCauseStatement.slice(0, 120),
            category: topRec?.category || 'Infrastructure Reliability',
            status: 'Investigating',
            five_why_analysis: fiveWhyText,
            permanent_fix: aiResult.proposedPermanentFix,
            strategic_recommendation: topRec?.action || '',
            justification: topRec?.explicitJustification || '',
          }),
        });
        setTargetProblem(res.problem);
        setSaveMessage(`Created ${res.problem.problem_id} and linked to ${targetSiteId}.`);
      }
      await loadData();
      onDataMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save problem ticket');
    } finally {
      setSavingTicket(false);
    }
  };

  const handleCloseProblem = async (problemId: string, fixText: string) => {
    setSavingTicket(true);
    setError(null);
    try {
      await apiFetch(`/api/problems/${encodeURIComponent(problemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Closed',
          permanent_fix: fixText || 'Verified permanent engineering fix deployed.',
        }),
      });
      await loadData();
      onDataMutated();
      setSaveMessage(`${problemId} marked Closed with verified permanent fix.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close problem ticket');
    } finally {
      setSavingTicket(false);
    }
  };

  const selectedOffender = repeatOffenders.find((r) => r.site_id === targetSiteId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Panel: Repeat Offenders & Problem Tickets */}
      <div className="lg:col-span-5 flex flex-col rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden lg:h-[calc(100vh-140px)]">
        <div className="space-y-3 border-b border-[#1B263B] bg-[#0F172A]/60 p-4">
          <div className="flex items-center gap-1 rounded-md bg-[#070B14] p-1 border border-[#1B263B]">
            <button
              type="button"
              onClick={() => setSubTab('repeat')}
              className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === 'repeat' ? 'bg-[#162032] text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Repeat Offenders ({repeatOffenders.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('tickets')}
              className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === 'tickets' ? 'bg-[#162032] text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Problem Tickets ({problems.length})
            </button>
          </div>

          {subTab === 'tickets' && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search problem ID, site..."
                  className="w-full rounded-md border border-[#273549] bg-[#070B14] py-1.5 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <select
                value={problemStatusFilter}
                onChange={(e) => setProblemStatusFilter(e.target.value)}
                className="rounded-md border border-[#273549] bg-[#070B14] px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="All">All Statuses</option>
                <option value="Open">Open</option>
                <option value="Investigating">Investigating</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 divide-y divide-[#172236] overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded bg-[#111C30] animate-pulse" />
              ))}
            </div>
          ) : subTab === 'repeat' ? (
            repeatOffenders.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No repeat-offender sites detected yet.
              </div>
            ) : (
              repeatOffenders.map((site) => {
                const isSelected = site.site_id === targetSiteId && !targetProblem;
                return (
                  <div
                    key={site.site_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setTargetSiteId(site.site_id);
                      setTargetProblem(null);
                      setAiResult(null);
                      setSaveMessage(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setTargetSiteId(site.site_id);
                        setTargetProblem(null);
                        setAiResult(null);
                        setSaveMessage(null);
                      }
                    }}
                    className={`w-full cursor-pointer text-left px-4 py-3 transition-colors ${
                      isSelected ? 'bg-[#111C30]' : 'hover:bg-[#0E1627]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectSite(site.site_id);
                        }}
                        className="font-mono font-semibold text-cyan-400 hover:underline"
                        title="Open site telemetry & detailed recommendations popup"
                      >
                        {site.site_id}
                      </button>
                      <span className="font-mono text-amber-400 font-semibold tabular-nums">
                        {site.incident_count} incidents
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-300 truncate">
                      {site.site_name} · {site.uk_region}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums">
                      {site.site_role}
                      {site.child_count > 0 ? ` (${site.child_count} child)` : ''} · {site.top_category} ·{' '}
                      {site.avg_mttr_minutes}m avg MTTR
                    </div>
                    {site.strategic_recommendation && (
                      <div className="mt-1.5 flex items-start justify-between gap-2 text-[11px]">
                        <span className="leading-snug text-emerald-300/90 line-clamp-2">
                          Rec: {site.strategic_recommendation}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectSite(site.site_id);
                          }}
                          className="shrink-0 font-mono text-[10px] text-cyan-400 hover:underline"
                        >
                          Site Popup →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : problems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No problem tickets match the filter.
            </div>
          ) : (
            problems.map((prob) => {
              const isSelected = targetProblem?.problem_id === prob.problem_id;
              return (
                <div
                  key={prob.problem_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setTargetProblem(prob);
                    setTargetSiteId(prob.site_id);
                    setAiResult(null);
                    setSaveMessage(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setTargetProblem(prob);
                      setTargetSiteId(prob.site_id);
                      setAiResult(null);
                      setSaveMessage(null);
                    }
                  }}
                  className={`w-full cursor-pointer text-left px-4 py-3 transition-colors ${
                    isSelected ? 'bg-[#111C30]' : 'hover:bg-[#0E1627]'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className={isSelected ? 'text-cyan-300 font-medium' : 'text-slate-300'}>
                      {prob.problem_id} ·{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectSite(prob.site_id);
                        }}
                        className="text-cyan-400 hover:underline font-semibold"
                        title="Open site telemetry & detailed recommendations popup"
                      >
                        {prob.site_id}
                      </button>
                    </span>
                    <span
                      className={
                        prob.status === 'Closed'
                          ? 'text-emerald-400'
                          : prob.status === 'Investigating'
                            ? 'text-cyan-400'
                            : 'text-amber-400'
                      }
                    >
                      {prob.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-100 line-clamp-2">{prob.title}</div>
                  {prob.strategic_recommendation && (
                    <div className="mt-1 flex items-start justify-between gap-2 text-[11px]">
                      <span className="leading-snug text-emerald-300/90 line-clamp-2">
                        Rec: {prob.strategic_recommendation}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectSite(prob.site_id);
                        }}
                        className="shrink-0 font-mono text-[10px] text-cyan-400 hover:underline"
                      >
                        Site Popup →
                      </button>
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-slate-400">
                    {prob.category} · {prob.related_incident_count} correlated incidents
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right 5-Why & Strategic Advisory Workbench */}
      <div className="lg:col-span-7 space-y-5">
        {!targetSiteId && !targetProblem ? (
          <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-12 text-center text-sm text-slate-400">
            Select a repeat-offender site or problem ticket to launch 5-Why Root Cause Analysis.
          </div>
        ) : (
          <>
            {/* Context Header */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
                    {targetProblem && (
                      <>
                        <span className="text-cyan-400 font-semibold">{targetProblem.problem_id}</span>
                        <span aria-hidden="true">·</span>
                        <span>Status: {targetProblem.status}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectSite(targetSiteId!)}
                      className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-semibold"
                    >
                      <span>{targetSiteId}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    {selectedOffender && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{selectedOffender.uk_region}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-400">{selectedOffender.incident_count} total incidents</span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-1.5 text-lg font-semibold text-slate-100">
                    {targetProblem ? targetProblem.title : `Repeat-Offender Pattern: ${selectedOffender?.site_name || targetSiteId}`}
                  </h2>
                  {selectedOffender && (
                    <p className="mt-1.5 text-xs text-slate-400 font-mono tabular-nums">
                      Role: {selectedOffender.site_role}
                      {selectedOffender.child_count > 0 ? ` (Supports ${selectedOffender.child_count} child sites)` : ''} ·
                      DNO: {selectedOffender.dno_provider} · {selectedOffender.battery_backup_hours}h Batt ·{' '}
                      {selectedOffender.has_generator ? 'Gen Installed' : 'No Generator'} · {selectedOffender.cooling_solution}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={runningAi}
                  onClick={() => handleRunProblemAgent(targetSiteId || undefined, targetProblem || undefined)}
                  className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {runningAi ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {runningAi
                      ? 'Analyzing Root Cause...'
                      : aiResult
                        ? 'Re-run 5-Why & Advisory'
                        : 'Run 5-Why & Strategic Advisory'}
                  </span>
                </button>
              </div>

              {targetProblem && (
                <div className="mt-4 space-y-3 border-t border-[#1B263B] pt-4 text-xs">
                  <div>
                    <div className="font-medium text-slate-300">Recorded 5-Why Analysis</div>
                    <div className="mt-1 text-slate-400 leading-relaxed">
                      {targetProblem.five_why_analysis || 'No 5-Why logged yet.'}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <div className="font-medium text-slate-300">Strategic Recommendation</div>
                      <div className="mt-1 text-slate-200">{targetProblem.strategic_recommendation || '—'}</div>
                      {targetProblem.justification && (
                        <div className="mt-0.5 text-slate-400">{targetProblem.justification}</div>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-slate-300">Verified Permanent Fix</div>
                      <div className="mt-1 text-emerald-300">{targetProblem.permanent_fix || 'Pending engineering implementation'}</div>
                      <div className="mt-1 text-slate-500">Opened {formatShortDate(targetProblem.opened_at)}</div>
                    </div>
                  </div>
                  {targetProblem.status !== 'Closed' && (
                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={savingTicket}
                        onClick={() =>
                          handleCloseProblem(
                            targetProblem.problem_id,
                            aiResult?.proposedPermanentFix || targetProblem.permanent_fix || targetProblem.strategic_recommendation || ''
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/40 transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Verify &amp; Close Problem Ticket</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {saveMessage && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{saveMessage}</span>
              </div>
            )}

            {/* AI Problem Management 5-Why & Strategic Advisory Output */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1B263B] pb-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    Intelligent Problem Management Agent Output
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {targetSiteId && (
                    <button
                      type="button"
                      onClick={() => onInspectSite(targetSiteId)}
                      className="inline-flex items-center gap-1 rounded border border-[#273549] bg-[#070B14] px-2.5 py-1 font-mono text-[11px] font-medium text-cyan-400 hover:border-cyan-500/50 transition-colors"
                    >
                      <span>Site Details: {targetSiteId}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                  {aiResult && (
                    <button
                      type="button"
                      disabled={savingTicket}
                      onClick={handleSaveAsProblemTicket}
                      className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-950/30 px-3 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-900/40 transition-colors whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>{targetProblem ? 'Update Problem Ticket' : 'Create Problem Ticket'}</span>
                    </button>
                  )}
                </div>
              </div>

              {runningAi && !aiResult ? (
                <div className="mt-4 space-y-3">
                  {(selectedOffender?.strategic_recommendation || targetProblem?.strategic_recommendation) && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-emerald-300">
                          Preliminary Strategic Recommendation (Generating full 5-Why &amp; justifications...)
                        </span>
                        {targetSiteId && (
                          <button
                            type="button"
                            onClick={() => onInspectSite(targetSiteId)}
                            className="font-mono text-[11px] text-cyan-400 hover:underline"
                          >
                            Inspect {targetSiteId} →
                          </button>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-100">
                        {targetProblem?.strategic_recommendation || selectedOffender?.strategic_recommendation}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                    <span>
                      Gemini Problem Management Agent is correlating site incidents, tracing the 5-Why causal chain, and
                      building capex/reliability justifications...
                    </span>
                  </div>
                </div>
              ) : !aiResult ? (
                <div className="mt-4 space-y-3">
                  {(selectedOffender?.strategic_recommendation || targetProblem?.strategic_recommendation) && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-emerald-300">Strategic Problem Recommendation</span>
                        {targetSiteId && (
                          <button
                            type="button"
                            onClick={() => onInspectSite(targetSiteId)}
                            className="font-mono text-[11px] text-cyan-400 hover:underline"
                          >
                            Inspect {targetSiteId} →
                          </button>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-100">
                        {targetProblem?.strategic_recommendation || selectedOffender?.strategic_recommendation}
                      </div>
                    </div>
                  )}
                  <div className="py-4 text-center text-xs text-slate-400">
                    Click <strong className="text-slate-200">Run 5-Why &amp; Strategic Advisory</strong> to generate the
                    complete 5-Why causal chain and evidence-backed justifications.
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-5 text-xs">
                  {/* Root Cause Statement */}
                  <div className="rounded-md border border-[#1B263B] bg-[#070B14] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-cyan-400">Verified Root Cause Statement</span>
                      {targetSiteId && (
                        <button
                          type="button"
                          onClick={() => onInspectSite(targetSiteId)}
                          className="font-mono text-[11px] text-cyan-400 hover:underline"
                        >
                          Open {targetSiteId} Full Profile →
                        </button>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-100">{aiResult.rootCauseStatement}</div>
                    <div className="mt-2 text-slate-300">
                      <span className="font-medium text-emerald-400">Proposed Permanent Fix: </span>
                      {aiResult.proposedPermanentFix}
                    </div>
                  </div>

                  {/* 5-Why Chain */}
                  <div>
                    <div className="mb-2 font-medium text-slate-200">5-Why Causal Chain</div>
                    <div className="space-y-2">
                      {[
                        aiResult.fiveWhyChain.why1,
                        aiResult.fiveWhyChain.why2,
                        aiResult.fiveWhyChain.why3,
                        aiResult.fiveWhyChain.why4,
                        aiResult.fiveWhyChain.why5,
                      ].map((step, idx) => (
                        <div key={idx} className="flex items-start gap-3 rounded border border-[#1B263B] bg-[#070B14] px-3 py-2">
                          <span className="font-mono font-semibold text-cyan-400 shrink-0">Why {idx + 1}</span>
                          <span className="text-slate-200">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Strategic Recommendations with Explicit Justification */}
                  <div>
                    <div className="mb-2 font-medium text-slate-200">
                      Strategic Engineering Recommendations &amp; Justifications
                    </div>
                    <div className="space-y-2.5">
                      {aiResult.strategicRecommendations.map((rec, idx) => (
                        <div key={idx} className="rounded-md border border-[#1B263B] bg-[#070B14] p-3.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-100">
                              {rec.category} — {rec.action}
                            </span>
                            <span
                              className={`font-mono font-semibold shrink-0 ${
                                rec.priority === 'Critical'
                                  ? 'text-red-400'
                                  : rec.priority === 'High'
                                    ? 'text-amber-400'
                                    : 'text-cyan-400'
                              }`}
                            >
                              {rec.priority}
                            </span>
                          </div>
                          <p className="mt-1.5 text-slate-300">
                            <span className="text-slate-400 font-medium">Justification: </span>
                            {rec.explicitJustification}
                          </p>
                          <p className="mt-1 text-emerald-400 font-mono text-[11px]">
                            Expected Impact: {rec.estimatedImpact}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-[#1B263B] pt-3 text-slate-400">
                    <span className="font-medium text-slate-300">Vendor Hardware Note: </span>
                    {aiResult.vendorReliabilityNote}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
