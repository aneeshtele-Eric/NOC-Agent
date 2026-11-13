import React, { useEffect, useState } from 'react';
import {
  Bot,
  Search,
  Radio,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Plus,
  ExternalLink,
} from 'lucide-react';
import type {
  AgentAnalysisRecord,
  Incident,
  ProblemTicket,
  Site,
  TwinSynthesisAIResult,
} from '../types/noc';
import { apiFetch, formatShortDate } from '../utils/format';

interface SiteDigitalTwinsViewProps {
  selectedSiteId: string | null;
  onSelectSite: (siteId: string) => void;
  onInspectSite: (siteId: string) => void;
  onOpenIncident: (incidentId: string) => void;
  onIngestForSite: (siteId: string) => void;
  onRunProblemForSite: (siteId: string) => void;
}

interface SiteDetailResponse {
  site: Site;
  parentHub: Pick<Site, 'site_id' | 'site_name' | 'uk_region' | 'twin_status' | 'open_incident_count'> | null;
  childSites: Array<Pick<Site, 'site_id' | 'site_name' | 'uk_region' | 'twin_status' | 'open_incident_count' | 'battery_backup_hours'>>;
  incidents: Incident[];
  problems: ProblemTicket[];
  analyses: AgentAnalysisRecord[];
}

export const SiteDigitalTwinsView: React.FC<SiteDigitalTwinsViewProps> = ({
  selectedSiteId,
  onSelectSite,
  onInspectSite,
  onOpenIncident,
  onIngestForSite,
  onRunProblemForSite,
}) => {
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(true);

  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [regions, setRegions] = useState<string[]>([]);

  const [detail, setDetail] = useState<SiteDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [twinSynthesis, setTwinSynthesis] = useState<TwinSynthesisAIResult | null>(null);
  const [runningAgent, setRunningAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ regions: string[] }>('/api/filters')
      .then((res) => setRegions(res.regions))
      .catch(() => {});
  }, []);

  const loadSites = async () => {
    setLoadingList(true);
    try {
      const qs = new URLSearchParams({
        search,
        region: regionFilter,
        role: roleFilter,
        status: statusFilter,
        page: String(page),
        limit: '35',
      });
      const res = await apiFetch<{ items: Site[]; total: number }>(`/api/sites?${qs.toString()}`);
      setSites(res.items);
      setTotal(res.total);
      if (!selectedSiteId && res.items.length > 0) {
        onSelectSite(res.items[0].site_id);
      }
    } catch {
      // ignore
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadSites();
  }, [search, regionFilter, roleFilter, statusFilter, page]);

  useEffect(() => {
    if (!selectedSiteId) return;
    setLoadingDetail(true);
    setAgentError(null);
    apiFetch<SiteDetailResponse>(`/api/sites/${encodeURIComponent(selectedSiteId)}`)
      .then((res) => {
        setDetail(res);
        if (res.analyses && res.analyses.length > 0) {
          try {
            setTwinSynthesis(JSON.parse(res.analyses[0].payload_json) as TwinSynthesisAIResult);
          } catch {
            setTwinSynthesis(null);
          }
        } else {
          setTwinSynthesis(null);
        }
      })
      .catch((err) => {
        setAgentError(err instanceof Error ? err.message : 'Failed to load site twin');
      })
      .finally(() => setLoadingDetail(false));
  }, [selectedSiteId]);

  const handleSynthesizeTwin = async () => {
    if (!detail) return;
    setRunningAgent(true);
    setAgentError(null);
    try {
      const res = await apiFetch<{ result: TwinSynthesisAIResult }>('/api/agents/digital-twin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: detail.site.site_id }),
      });
      setTwinSynthesis(res.result);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Digital Twin Agent synthesis failed');
    } finally {
      setRunningAgent(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 35));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left Site Registry */}
      <div className="lg:col-span-5 flex flex-col rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden lg:h-[calc(100vh-140px)]">
        <div className="space-y-3 border-b border-[#1B263B] bg-[#0F172A]/60 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Site Digital Twin Registry</h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">{total.toLocaleString()} sites</span>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Search Site ID, town, DNO, vendor..."
              className="w-full rounded-md border border-[#273549] bg-[#070B14] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <select
              value={regionFilter}
              onChange={(e) => {
                setPage(1);
                setRegionFilter(e.target.value);
              }}
              className="rounded-md border border-[#273549] bg-[#070B14] px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="All">All Regions</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <select
              value={roleFilter}
              onChange={(e) => {
                setPage(1);
                setRoleFilter(e.target.value);
              }}
              className="rounded-md border border-[#273549] bg-[#070B14] px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="All">All Roles</option>
              <option value="Hub">Hub Sites</option>
              <option value="Child">Child Sites</option>
              <option value="Standalone">Standalone</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value);
              }}
              className="rounded-md border border-[#273549] bg-[#070B14] px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="All">All States</option>
              <option value="Critical">Critical</option>
              <option value="Degraded">Degraded</option>
              <option value="Nominal">Nominal</option>
            </select>
          </div>
        </div>

        <div className="flex-1 divide-y divide-[#172236] overflow-y-auto">
          {loadingList ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-14 rounded bg-[#111C30] animate-pulse" />
              ))}
            </div>
          ) : sites.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No sites match your filter criteria.
            </div>
          ) : (
            sites.map((site) => {
              const isSelected = site.site_id === selectedSiteId;
              return (
                <button
                  key={site.site_id}
                  type="button"
                  onClick={() => {
                    onSelectSite(site.site_id);
                    onInspectSite(site.site_id);
                  }}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    isSelected ? 'bg-[#111C30]' : 'hover:bg-[#0E1627]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-mono font-medium ${isSelected ? 'text-cyan-400' : 'text-slate-100'}`}>
                      {site.site_id}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-medium ${
                        site.twin_status === 'Critical'
                          ? 'text-red-400'
                          : site.twin_status === 'Degraded'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {site.twin_status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-300 truncate">
                    {site.site_name} · {site.uk_region}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                    {site.site_role}
                    {site.child_count > 0 ? ` (${site.child_count} child)` : ''} · {site.dno_provider} ·{' '}
                    {site.open_incident_count} open / {site.total_incident_count} total
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-[#1B263B] bg-[#070B14] px-4 py-2.5 text-xs text-slate-400">
          <span className="font-mono tabular-nums">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-[#273549] p-1 hover:bg-[#111C30] disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-[#273549] p-1 hover:bg-[#111C30] disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Right Digital Twin Inspector */}
      <div className="lg:col-span-7 space-y-5">
        {loadingDetail ? (
          <div className="h-96 rounded-lg border border-[#1B263B] bg-[#0B111E] animate-pulse" />
        ) : !detail ? (
          <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-12 text-center text-sm text-slate-400">
            Select a site from the registry to inspect its Digital Twin profile and open full recommendations.
          </div>
        ) : (
          <>
            {/* Site Twin Header & Static Infrastructure */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                    <Radio className="h-3.5 w-3.5 text-cyan-400" />
                    <button
                      type="button"
                      onClick={() => onInspectSite(detail.site.site_id)}
                      className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-semibold"
                    >
                      <span>{detail.site.site_id}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <span aria-hidden="true">·</span>
                    <span>{detail.site.uk_region}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold ${
                        detail.site.twin_status === 'Critical'
                          ? 'text-red-400'
                          : detail.site.twin_status === 'Degraded'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      Twin State: {detail.site.twin_status}
                    </span>
                  </div>
                  <h2 className="mt-1 text-lg font-semibold text-slate-100">{detail.site.site_name}</h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Last synchronized: {formatShortDate(detail.site.last_updated_at)}
                    {detail.site.latitude !== null && detail.site.longitude !== null
                      ? ` · Coordinates: ${detail.site.latitude}, ${detail.site.longitude}`
                      : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onInspectSite(detail.site.site_id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-950/30 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-900/40 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Popup Details &amp; Recs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onIngestForSite(detail.site.site_id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#273549] bg-[#070B14] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#111C30] transition-colors whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Log Incident</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunProblemForSite(detail.site.site_id)}
                    className="rounded-md border border-[#273549] bg-[#070B14] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#111C30] transition-colors whitespace-nowrap"
                  >
                    Problem 5-Why
                  </button>
                  <button
                    type="button"
                    disabled={runningAgent}
                    onClick={handleSynthesizeTwin}
                    className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {runningAgent ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Bot className="h-3.5 w-3.5" />
                    )}
                    <span>{runningAgent ? 'Synthesizing...' : 'Synthesize Twin Profile'}</span>
                  </button>
                </div>
              </div>

              {/* Infrastructure Matrix */}
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[#1B263B] pt-4 sm:grid-cols-3 text-xs">
                <div>
                  <div className="text-slate-400">DNO Power Provider</div>
                  <div className="mt-0.5 font-medium text-slate-100">{detail.site.dno_provider}</div>
                  <div className="text-[11px] text-slate-400">{detail.site.power_type}</div>
                </div>
                <div>
                  <div className="text-slate-400">Backup Resiliency</div>
                  <div className="mt-0.5 font-mono font-medium text-slate-100 tabular-nums">
                    {detail.site.battery_backup_hours}h Battery Autonomy
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Generator: {detail.site.has_generator ? 'Installed (Auto-Start)' : 'None Installed'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Thermal &amp; Cooling</div>
                  <div className="mt-0.5 font-medium text-slate-100">{detail.site.cooling_solution}</div>
                  <div className="text-[11px] text-slate-400">{detail.site.vendor_hardware}</div>
                </div>
                <div>
                  <div className="text-slate-400">Transmission Role</div>
                  <div className="mt-0.5 font-medium text-slate-100">
                    {detail.site.site_role}
                    {detail.childSites.length > 0 ? ` (${detail.childSites.length} child nodes)` : ''}
                  </div>
                  {detail.parentHub && (
                    <button
                      type="button"
                      onClick={() => onInspectSite(detail.parentHub!.site_id)}
                      className="text-[11px] font-mono text-cyan-400 hover:underline"
                    >
                      Parent Hub: {detail.parentHub.site_id}
                    </button>
                  )}
                </div>
                <div>
                  <div className="text-slate-400">Field Access &amp; Climbing</div>
                  <div className={`mt-0.5 font-medium ${detail.site.climbing_required ? 'text-amber-400' : 'text-slate-100'}`}>
                    {detail.site.climbing_required ? 'Rigging / Climbing Required' : 'Standard Ground Access'}
                  </div>
                  <div className="text-[11px] text-slate-400">{detail.site.access_notes}</div>
                </div>
                <div>
                  <div className="text-slate-400">Dynamic Incident Totals</div>
                  <div className="mt-0.5 font-mono font-medium text-slate-100 tabular-nums">
                    {detail.site.open_incident_count} open · {detail.site.total_incident_count} historical
                  </div>
                  <div className="text-[11px] text-slate-400">{detail.problems.length} linked problem records</div>
                </div>
              </div>
            </div>

            {agentError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{agentError}</span>
              </div>
            )}

            {/* Digital Twin Agent Synthesis */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <div className="flex items-center justify-between border-b border-[#1B263B] pb-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Digital Twin Agent Profile Assessment</h3>
                </div>
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
              </div>

              {!twinSynthesis ? (
                <div className="py-5 text-center text-xs text-slate-400">
                  Click <strong className="text-slate-200">Synthesize Twin Profile</strong> to evaluate this site&apos;s
                  resiliency gaps, transmission blast radius, and hardware reliability history.
                </div>
              ) : (
                <div className="mt-4 space-y-4 text-xs">
                  <p className="text-sm text-slate-200 leading-relaxed">{twinSynthesis.operationalSummary}</p>
                  <div className="rounded-md border border-[#1B263B] bg-[#070B14] p-3">
                    <div className="font-medium text-slate-300">Transmission Blast Radius</div>
                    <div className="mt-1 text-slate-400">{twinSynthesis.transmissionImpact}</div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <div className="font-medium text-amber-400 mb-1.5">Identified Resiliency Gaps</div>
                      <ul className="space-y-1 text-slate-300">
                        {twinSynthesis.resiliencyGaps.map((g, i) => (
                          <li key={i}>• {g}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="font-medium text-cyan-400 mb-1.5">Recommended Preventive Actions</div>
                      <ul className="space-y-1 text-slate-300">
                        {twinSynthesis.recommendedPreventiveActions.map((a, i) => (
                          <li key={i}>• {a}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Child Sites Topology (if Hub) */}
            {detail.childSites.length > 0 && (
              <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden">
                <div className="border-b border-[#1B263B] bg-[#0F172A]/60 px-5 py-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    Dependent Transmission Child Sites ({detail.childSites.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 divide-y divide-[#172236] sm:grid-cols-2 sm:divide-y-0 sm:gap-px sm:bg-[#172236]">
                  {detail.childSites.map((child) => (
                    <button
                      key={child.site_id}
                      type="button"
                      onClick={() => onInspectSite(child.site_id)}
                      className="flex items-center justify-between bg-[#0B111E] px-4 py-2.5 text-left text-xs hover:bg-[#111C30] transition-colors"
                    >
                      <div>
                        <div className="font-mono font-medium text-cyan-400">{child.site_id}</div>
                        <div className="text-slate-300">{child.site_name}</div>
                      </div>
                      <div className="text-right font-mono text-[11px] tabular-nums">
                        <div
                          className={
                            child.twin_status === 'Critical'
                              ? 'text-red-400'
                              : child.twin_status === 'Degraded'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                          }
                        >
                          {child.twin_status}
                        </div>
                        <div className="text-slate-500">{child.battery_backup_hours}h batt</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Dynamic Incident & Problem History */}
            <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden">
              <div className="border-b border-[#1B263B] bg-[#0F172A]/60 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  Site Incident &amp; Restoration Log ({detail.incidents.length})
                </h3>
              </div>
              <div className="divide-y divide-[#172236]">
                {detail.incidents.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    Healthy baseline site — zero historical incidents recorded.
                  </div>
                ) : (
                  detail.incidents.slice(0, 12).map((inc) => (
                    <button
                      key={inc.incident_id}
                      type="button"
                      onClick={() => onOpenIncident(inc.incident_id)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-2.5 text-left text-xs hover:bg-[#111C30] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                          <span className="text-cyan-400">{inc.incident_id}</span>
                          <span aria-hidden="true">·</span>
                          <span>{inc.severity}</span>
                          <span aria-hidden="true">·</span>
                          <span>{inc.category}</span>
                        </div>
                        <div className="mt-0.5 font-medium text-slate-200 truncate">{inc.title}</div>
                        {inc.root_cause && (
                          <div className="text-slate-400 truncate">RCA: {inc.root_cause}</div>
                        )}
                      </div>
                      <div className="text-right font-mono text-[11px] tabular-nums shrink-0">
                        <div
                          className={
                            inc.status === 'Resolved' ? 'text-emerald-400' : 'text-amber-400 font-semibold'
                          }
                        >
                          {inc.status}
                        </div>
                        <div className="text-slate-500">
                          {inc.mttr_minutes ? `${inc.mttr_minutes}m MTTR` : formatShortDate(inc.opened_at)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
