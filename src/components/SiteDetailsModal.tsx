import React, { useEffect, useState } from 'react';
import {
  X,
  Radio,
  Bot,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Plus,
  Wrench,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import type {
  ProblemManagementAIResult,
  SiteDetailResponse,
  TriageAIResult,
  TwinSynthesisAIResult,
} from '../types/noc';
import { apiFetch, formatShortDate, formatSlaRemaining } from '../utils/format';

interface SiteDetailsModalProps {
  siteId: string | null;
  onClose: () => void;
  onSwitchSite: (siteId: string) => void;
  onOpenIncident: (incidentId: string) => void;
  onOpenInDigitalTwins: (siteId: string) => void;
  onOpenInProblemManagement: (siteId: string) => void;
  onIngestForSite: (siteId: string) => void;
}

export const SiteDetailsModal: React.FC<SiteDetailsModalProps> = ({
  siteId,
  onClose,
  onSwitchSite,
  onOpenIncident,
  onOpenInDigitalTwins,
  onOpenInProblemManagement,
  onIngestForSite,
}) => {
  const [detail, setDetail] = useState<SiteDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [twinSynthesis, setTwinSynthesis] = useState<TwinSynthesisAIResult | null>(null);
  const [runningTwin, setRunningTwin] = useState(false);

  const [problemResult, setProblemResult] = useState<ProblemManagementAIResult | null>(null);
  const [runningProblem, setRunningProblem] = useState(false);

  const [runningTriageId, setRunningTriageId] = useState<string | null>(null);
  const [triageMap, setTriageMap] = useState<Record<string, TriageAIResult>>({});

  useEffect(() => {
    if (!siteId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [siteId, onClose]);

  useEffect(() => {
    if (!siteId) {
      setDetail(null);
      setTwinSynthesis(null);
      setProblemResult(null);
      setTriageMap({});
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTwinSynthesis(null);
    setProblemResult(null);
    setTriageMap({});

    apiFetch<SiteDetailResponse>(`/api/sites/${encodeURIComponent(siteId)}`)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        setTriageMap(res.triageAnalyses ?? {});

        if (res.analyses && res.analyses.length > 0) {
          try {
            setTwinSynthesis(JSON.parse(res.analyses[0].payload_json) as TwinSynthesisAIResult);
          } catch {
            setTwinSynthesis(null);
          }
        } else {
          // Auto-synthesize Digital Twin resiliency profile in background if not yet cached
          setRunningTwin(true);
          apiFetch<{ result: TwinSynthesisAIResult }>('/api/agents/digital-twin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site_id: res.site.site_id }),
          })
            .then((aiRes) => {
              if (!cancelled) setTwinSynthesis(aiRes.result);
            })
            .catch(() => {
              // Keep graceful fallback
            })
            .finally(() => {
              if (!cancelled) setRunningTwin(false);
            });
        }

        if (res.problemAnalysis?.payload_json) {
          try {
            setProblemResult(JSON.parse(res.problemAnalysis.payload_json) as ProblemManagementAIResult);
          } catch {
            setProblemResult(null);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load site telemetry details.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [siteId]);

  if (!siteId) return null;

  const handleRunTwin = async () => {
    if (!detail) return;
    setRunningTwin(true);
    setError(null);
    try {
      const res = await apiFetch<{ result: TwinSynthesisAIResult }>('/api/agents/digital-twin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: detail.site.site_id }),
      });
      setTwinSynthesis(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Digital Twin synthesis failed.');
    } finally {
      setRunningTwin(false);
    }
  };

  const handleRunProblemAdvisory = async () => {
    if (!detail) return;
    setRunningProblem(true);
    setError(null);
    try {
      const primaryProb = detail.problems.find((p) => p.status !== 'Closed') || detail.problems[0];
      const res = await apiFetch<{ result: ProblemManagementAIResult }>('/api/agents/problem-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: detail.site.site_id,
          problem_id: primaryProb?.problem_id,
        }),
      });
      setProblemResult(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Problem Management analysis failed.');
    } finally {
      setRunningProblem(false);
    }
  };

  const handleRunIncidentTriage = async (incidentId: string) => {
    setRunningTriageId(incidentId);
    setError(null);
    try {
      const res = await apiFetch<{ result: TriageAIResult }>('/api/agents/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incidentId }),
      });
      setTriageMap((prev) => ({ ...prev, [incidentId]: res.result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incident Triage failed.');
    } finally {
      setRunningTriageId(null);
    }
  };

  const site = detail?.site;
  const activeIncidents = (detail?.incidents ?? []).filter((i) => i.status !== 'Resolved');
  const recentResolved = (detail?.incidents ?? []).filter((i) => i.status === 'Resolved').slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Site Telemetry Details for ${siteId}`}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#24324B] bg-[#0B111E] text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1B263B] bg-[#0F172A] px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400 tabular-nums">
              <Radio className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <span className="font-semibold text-cyan-400">{siteId}</span>
              {site && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{site.uk_region}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold ${
                      site.twin_status === 'Critical'
                        ? 'text-red-400'
                        : site.twin_status === 'Degraded'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                    }`}
                  >
                    Twin State: {site.twin_status}
                  </span>
                  {site.latitude !== null && site.longitude !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {site.latitude}, {site.longitude}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-100 truncate">
              {site ? `${site.site_name} — Site Telemetry & AI Recommendations` : `Loading ${siteId}...`}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {site && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onIngestForSite(site.site_id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-[#273549] bg-[#0B111E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Log Incident</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenInProblemManagement(site.site_id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-[#273549] bg-[#0B111E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors whitespace-nowrap"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>Problem 5-Why</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenInDigitalTwins(site.site_id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-900/40 transition-colors whitespace-nowrap"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Digital Twin View</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[#273549] p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
              aria-label="Close site details modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="space-y-4">
              <div className="h-28 rounded-lg border border-[#1B263B] bg-[#070B14] animate-pulse" />
              <div className="h-48 rounded-lg border border-[#1B263B] bg-[#070B14] animate-pulse" />
              <div className="h-48 rounded-lg border border-[#1B263B] bg-[#070B14] animate-pulse" />
            </div>
          ) : error && !detail ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          ) : detail && site ? (
            <>
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-2.5 text-xs text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
              )}

              {/* 1. Complete Site Infrastructure Telemetry Matrix */}
              <div className="rounded-lg border border-[#1B263B] bg-[#070B14] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#172236] pb-2.5">
                  <h3 className="text-sm font-semibold text-slate-100">Site Infrastructure &amp; Topology Telemetry</h3>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Synchronized {formatShortDate(site.last_updated_at)}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                  <div>
                    <div className="text-slate-400">DNO Power Provider</div>
                    <div className="mt-0.5 font-medium text-slate-100">{site.dno_provider}</div>
                    <div className="text-[11px] text-slate-400">{site.power_type}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Backup Power Autonomy</div>
                    <div className="mt-0.5 font-mono font-medium text-slate-100 tabular-nums">
                      {site.battery_backup_hours}h Battery Reserve
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Generator: {site.has_generator ? 'Installed (Auto-Start)' : 'None Installed'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Cooling &amp; Radio Hardware</div>
                    <div className="mt-0.5 font-medium text-slate-100">{site.cooling_solution}</div>
                    <div className="text-[11px] text-slate-400">{site.vendor_hardware}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Transmission Role</div>
                    <div className="mt-0.5 font-medium text-slate-100">
                      {site.site_role}
                      {detail.childSites.length > 0 ? (
                        <span className="text-amber-400"> · {detail.childSites.length} dependent child sites</span>
                      ) : null}
                    </div>
                    {detail.parentHub ? (
                      <button
                        type="button"
                        onClick={() => onSwitchSite(detail.parentHub!.site_id)}
                        className="mt-0.5 font-mono text-[11px] text-cyan-400 hover:underline"
                      >
                        Parent Hub: {detail.parentHub.site_id} ({detail.parentHub.twin_status})
                      </button>
                    ) : (
                      <div className="text-[11px] text-slate-500">Top-tier / independent backhaul</div>
                    )}
                  </div>
                  <div>
                    <div className="text-slate-400">Field Access &amp; Rigging</div>
                    <div className={`mt-0.5 font-medium ${site.climbing_required ? 'text-amber-400' : 'text-slate-100'}`}>
                      {site.climbing_required ? 'Climbing / Rigging Required' : 'Ground / Standard Access'}
                    </div>
                    <div className="text-[11px] text-slate-400">{site.access_notes}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Incident &amp; Problem Counters</div>
                    <div className="mt-0.5 font-mono font-medium text-slate-100 tabular-nums">
                      {site.open_incident_count} open · {site.total_incident_count} total incidents
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                      {detail.problems.length} linked problem records
                    </div>
                  </div>
                </div>

                {detail.childSites.length > 0 && (
                  <div className="mt-4 border-t border-[#172236] pt-3">
                    <div className="mb-2 text-[11px] font-medium text-slate-400">
                      Dependent Child Sites ({detail.childSites.length}) — click any node to inspect
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detail.childSites.map((child) => (
                        <button
                          key={child.site_id}
                          type="button"
                          onClick={() => onSwitchSite(child.site_id)}
                          className="rounded border border-[#1B263B] bg-[#0B111E] px-2.5 py-1 text-left font-mono text-[11px] hover:border-cyan-500/50 transition-colors"
                        >
                          <span className="text-cyan-400">{child.site_id}</span>
                          <span className="text-slate-500"> · </span>
                          <span
                            className={
                              child.twin_status === 'Critical'
                                ? 'text-red-400'
                                : child.twin_status === 'Degraded'
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                            }
                          >
                            {child.twin_status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Incident Space: Active Next Steps & Dispatch Recommendations */}
              <div className="rounded-lg border border-[#1B263B] bg-[#070B14] p-4">
                <div className="mb-3 flex items-center justify-between border-b border-[#172236] pb-2.5">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      Active Incident Next Steps &amp; Triage Recommendations ({activeIncidents.length})
                    </h3>
                  </div>
                </div>

                {activeIncidents.length === 0 ? (
                  <div className="py-3 text-xs text-emerald-400 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>No active open incidents on {site.site_id}. All site alarms currently cleared.</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeIncidents.map((inc) => {
                      const sla = formatSlaRemaining(inc.sla_deadline, inc.status);
                      const fullTriage = triageMap[inc.incident_id];
                      const isAnalyzing = runningTriageId === inc.incident_id;
                      return (
                        <div key={inc.incident_id} className="rounded-md border border-[#1B263B] bg-[#0B111E] p-3.5 text-xs">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onOpenIncident(inc.incident_id);
                                  }}
                                  className="font-semibold text-cyan-400 hover:underline"
                                >
                                  {inc.incident_id}
                                </button>
                                <span className="text-slate-500">·</span>
                                <span
                                  className={
                                    inc.severity === 'P1-Critical'
                                      ? 'text-red-400 font-semibold'
                                      : inc.severity === 'P2-High'
                                        ? 'text-amber-400 font-semibold'
                                        : 'text-slate-300'
                                  }
                                >
                                  {inc.severity}
                                </span>
                                <span className="text-slate-500">·</span>
                                <span className="text-slate-300">{inc.status}</span>
                                <span className="text-slate-500">·</span>
                                <span
                                  className={
                                    sla.tier === 'breached' || sla.tier === 'imminent'
                                      ? 'text-red-400 font-semibold'
                                      : sla.tier === 'warning'
                                        ? 'text-amber-400'
                                        : 'text-emerald-400'
                                  }
                                >
                                  SLA: {sla.label}
                                </span>
                              </div>
                              <div className="mt-1 text-sm font-medium text-slate-100">{inc.title}</div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={isAnalyzing}
                                onClick={() => handleRunIncidentTriage(inc.incident_id)}
                                className="inline-flex items-center gap-1.5 rounded border border-[#273549] bg-[#070B14] px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:border-cyan-500/50 disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                <RefreshCw className={`h-3 w-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                                <span>{fullTriage ? 'Refresh Triage' : 'Generate Full Triage'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onOpenIncident(inc.incident_id);
                                }}
                                className="rounded bg-cyan-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-500 transition-colors whitespace-nowrap"
                              >
                                Open Triage Copilot
                              </button>
                            </div>
                          </div>

                          <div className="mt-2.5 rounded border border-cyan-500/30 bg-cyan-950/20 px-3 py-2">
                            <div className="text-[11px] font-medium text-cyan-300">Recommended Next Action</div>
                            <div className="mt-0.5 text-slate-100 font-medium">
                              {fullTriage?.immediateNextAction ||
                                inc.triage_recommendation ||
                                `Dispatch ${inc.category} field engineer to ${site.site_id} prior to SLA deadline.`}
                            </div>
                            {fullTriage && (
                              <div className="mt-2 space-y-1.5 border-t border-cyan-500/20 pt-2 text-[11.5px] text-slate-300">
                                <div>
                                  <span className="font-medium text-slate-200">SLA Assessment: </span>
                                  {fullTriage.slaAssessment}
                                </div>
                                <div>
                                  <span className="font-medium text-slate-200">Access &amp; Blast Radius: </span>
                                  {fullTriage.climbingAndAccessAdvisory} · {fullTriage.blastRadiusImpact}
                                </div>
                                {fullTriage.dispatchChecklist?.length > 0 && (
                                  <ul className="mt-1 space-y-0.5 text-slate-300">
                                    {fullTriage.dispatchChecklist.map((step, idx) => (
                                      <li key={idx}>
                                        <span className="font-mono text-cyan-400">{idx + 1}. </span>
                                        {step}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. Problem Space: Strategic Engineering Recommendations & 5-Why Analysis */}
              <div className="rounded-lg border border-[#1B263B] bg-[#070B14] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#172236] pb-2.5">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      Problem Management &amp; Strategic Infrastructure Recommendations
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={runningProblem}
                    onClick={handleRunProblemAdvisory}
                    className="inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <RefreshCw className={`h-3 w-3 ${runningProblem ? 'animate-spin' : ''}`} />
                    <span>{runningProblem ? 'Running 5-Why...' : problemResult ? 'Re-run 5-Why Advisory' : 'Run Full 5-Why Advisory'}</span>
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-3">
                    <div className="font-medium text-emerald-300">Site Strategic Recommendation</div>
                    <div className="mt-1 text-sm font-medium text-slate-100">{detail.strategicRecommendationSummary}</div>
                  </div>

                  {problemResult && (
                    <div className="space-y-3 rounded-md border border-[#1B263B] bg-[#0B111E] p-3.5">
                      <div>
                        <div className="font-medium text-cyan-400">AI Root Cause Statement</div>
                        <div className="mt-0.5 text-slate-100">{problemResult.rootCauseStatement}</div>
                        <div className="mt-1.5 text-emerald-300">
                          <span className="font-medium">Proposed Permanent Fix: </span>
                          {problemResult.proposedPermanentFix}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {problemResult.strategicRecommendations.map((rec, idx) => (
                          <div key={idx} className="rounded border border-[#1B263B] bg-[#070B14] p-2.5">
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
                            <p className="mt-1 text-slate-300">{rec.explicitJustification}</p>
                            <p className="mt-1 font-mono text-[11px] text-emerald-400">Impact: {rec.estimatedImpact}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detail.problems.length > 0 && (
                    <div className="divide-y divide-[#172236] rounded-md border border-[#1B263B] bg-[#0B111E]">
                      {detail.problems.map((prob) => (
                        <div key={prob.problem_id} className="p-3">
                          <div className="flex items-center justify-between font-mono text-[11px]">
                            <span className="text-cyan-400 font-medium">
                              {prob.problem_id} · {prob.category}
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
                          <div className="mt-1 font-medium text-slate-100">{prob.title}</div>
                          {prob.strategic_recommendation && (
                            <div className="mt-1 text-emerald-300/95">
                              Recommendation: {prob.strategic_recommendation}
                            </div>
                          )}
                          {prob.permanent_fix && (
                            <div className="mt-0.5 text-slate-300">Permanent Fix: {prob.permanent_fix}</div>
                          )}
                          {prob.five_why_analysis && (
                            <div className="mt-1 text-slate-400 leading-relaxed">{prob.five_why_analysis}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Digital Twin AI Resiliency Assessment */}
              <div className="rounded-lg border border-[#1B263B] bg-[#070B14] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#172236] pb-2.5">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-slate-100">Digital Twin Resiliency &amp; Preventive Actions</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {twinSynthesis && (
                      <span
                        className={`font-mono text-xs font-semibold ${
                          twinSynthesis.riskLevel === 'Critical'
                            ? 'text-red-400'
                            : twinSynthesis.riskLevel === 'High'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }`}
                      >
                        Risk: {twinSynthesis.riskLevel}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={runningTwin}
                      onClick={handleRunTwin}
                      className="inline-flex items-center gap-1.5 rounded border border-[#273549] bg-[#0B111E] px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-cyan-500/50 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      <RefreshCw className={`h-3 w-3 ${runningTwin ? 'animate-spin' : ''}`} />
                      <span>{runningTwin ? 'Synthesizing...' : twinSynthesis ? 'Re-synthesize' : 'Synthesize Twin'}</span>
                    </button>
                  </div>
                </div>

                {runningTwin && !twinSynthesis ? (
                  <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                    <span>Gemini Digital Twin Agent is synthesizing infrastructure telemetry and preventive recommendations...</span>
                  </div>
                ) : twinSynthesis ? (
                  <div className="space-y-3 text-xs">
                    <p className="text-slate-200 leading-relaxed">{twinSynthesis.operationalSummary}</p>
                    <div className="rounded border border-[#1B263B] bg-[#0B111E] p-3">
                      <div className="font-medium text-slate-300">Transmission Blast Radius</div>
                      <div className="mt-0.5 text-slate-400">{twinSynthesis.transmissionImpact}</div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-1 font-medium text-amber-400">Identified Resiliency Gaps</div>
                        <ul className="space-y-1 text-slate-300">
                          {twinSynthesis.resiliencyGaps.map((g, i) => (
                            <li key={i}>• {g}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-1 font-medium text-cyan-400">Recommended Preventive Actions</div>
                        <ul className="space-y-1 text-slate-300">
                          {twinSynthesis.recommendedPreventiveActions.map((a, i) => (
                            <li key={i}>• {a}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-3 text-xs text-slate-400">
                    Click <strong className="text-slate-200">Synthesize Twin</strong> to generate AI resiliency recommendations.
                  </div>
                )}
              </div>

              {/* 5. Recent Historical Restorations */}
              {recentResolved.length > 0 && (
                <div className="rounded-lg border border-[#1B263B] bg-[#070B14] p-4">
                  <div className="mb-2.5 text-xs font-semibold text-slate-200">
                    Recent Historical Restorations ({recentResolved.length})
                  </div>
                  <div className="divide-y divide-[#172236]">
                    {recentResolved.map((past) => (
                      <div key={past.incident_id} className="flex items-center justify-between gap-4 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] text-slate-400">
                            {past.incident_id} · {past.category} · {past.severity}
                          </div>
                          <div className="font-medium text-slate-200 truncate">{past.title}</div>
                          {past.root_cause && <div className="text-slate-400 truncate">RCA: {past.root_cause}</div>}
                        </div>
                        <div className="text-right font-mono text-[11px] text-emerald-400 tabular-nums shrink-0">
                          {past.mttr_minutes ? `${past.mttr_minutes}m MTTR` : 'Resolved'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
