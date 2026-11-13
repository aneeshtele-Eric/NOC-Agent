import React, { useEffect, useState } from 'react';
import { ArrowRight, AlertTriangle, ShieldAlert, Radio, Wrench, Bot, RefreshCw, Calendar } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OverviewStats, TrendRangeResponse } from '../types/noc';
import { apiFetch, formatSlaRemaining } from '../utils/format';

interface OverviewViewProps {
  data: OverviewStats | null;
  loading: boolean;
  onOpenIncident: (incidentId: string) => void;
  onInspectSite: (siteId: string) => void;
  onOpenProblemSite: (siteId: string) => void;
  onNavigateTab: (tab: 'overview' | 'triage' | 'twins' | 'problems' | 'excel' | 'chat') => void;
  onRefreshOverview?: () => void;
}

type TrendPreset = '24h' | '72h' | '7d' | '30d' | 'full' | 'custom';

function shiftIsoDate(isoDay: string, deltaDays: number): string {
  const ms = Date.parse(`${isoDay}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return isoDay;
  return new Date(ms + deltaDays * 86400_000).toISOString().slice(0, 10);
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  data,
  loading,
  onOpenIncident,
  onInspectSite,
  onOpenProblemSite,
  onNavigateTab,
  onRefreshOverview,
}) => {
  const [trendPreset, setTrendPreset] = useState<TrendPreset>('72h');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [customTrend, setCustomTrend] = useState<TrendRangeResponse | null>(null);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const lastDatasetSigRef = React.useRef<string>('');

  const boundsMin = data?.dataBounds?.minDate ?? '';
  const boundsMax = data?.dataBounds?.maxDate ?? new Date().toISOString().slice(0, 10);

  const fetchPresetOrRangeTrend = async (opts: {
    preset?: '24h' | '72h';
    nextStart?: string;
    nextEnd?: string;
    syncDates?: boolean;
  }) => {
    setLoadingTrend(true);
    setTrendError(null);
    try {
      const qs = new URLSearchParams();
      if (opts.preset) {
        qs.set('preset', opts.preset);
      } else if (opts.nextStart && opts.nextEnd) {
        if (opts.nextStart > opts.nextEnd) {
          setTrendError('Start date must be on or before end date.');
          setLoadingTrend(false);
          return;
        }
        qs.set('startDate', opts.nextStart);
        qs.set('endDate', opts.nextEnd);
      }
      const res = await apiFetch<TrendRangeResponse>(`/api/incidents/trend?${qs.toString()}`);
      setCustomTrend(res);
      if (opts.syncDates) {
        setStartDate(res.startDate);
        setEndDate(res.endDate);
      }
    } catch (err) {
      setTrendError(err instanceof Error ? err.message : 'Failed to load incident trend range.');
    } finally {
      setLoadingTrend(false);
    }
  };

  useEffect(() => {
    if (!data?.dataBounds) return;
    const sig = `${data.dataSource.lastUpdated}|${data.totals.totalIncidents}|${data.dataBounds.minDate}|${data.dataBounds.maxDate}`;
    if (lastDatasetSigRef.current === sig) return;
    const isFirstLoad = lastDatasetSigRef.current === '';
    lastDatasetSigRef.current = sig;

    const anchorEnd = data.dataBounds.maxDate;
    const anchorStart = data.dataBounds.minDate;

    if (isFirstLoad || trendPreset === '72h') {
      setStartDate(shiftIsoDate(anchorEnd, -2));
      setEndDate(anchorEnd);
      setCustomTrend(null);
      return;
    }
    if (trendPreset === '24h') {
      setStartDate(anchorEnd);
      setEndDate(anchorEnd);
      setCustomTrend(null);
      return;
    }
    if (trendPreset === '7d') {
      const s = shiftIsoDate(anchorEnd, -6);
      setStartDate(s);
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ nextStart: s, nextEnd: anchorEnd });
      return;
    }
    if (trendPreset === '30d') {
      const s = shiftIsoDate(anchorEnd, -29);
      setStartDate(s);
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ nextStart: s, nextEnd: anchorEnd });
      return;
    }
    if (trendPreset === 'full') {
      setStartDate(anchorStart);
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ nextStart: anchorStart, nextEnd: anchorEnd });
      return;
    }
    if (trendPreset === 'custom' && startDate && endDate) {
      void fetchPresetOrRangeTrend({ nextStart: startDate, nextEnd: endDate });
    }
  }, [data?.dataSource.lastUpdated, data?.totals.totalIncidents, data?.dataBounds?.minDate, data?.dataBounds?.maxDate]);

  const handleSelectPreset = (preset: Exclude<TrendPreset, 'custom'>) => {
    setTrendPreset(preset);
    setTrendError(null);
    const anchorEnd = boundsMax || new Date().toISOString().slice(0, 10);
    if (preset === '24h') {
      setStartDate(anchorEnd);
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ preset: '24h', syncDates: true });
      return;
    }
    if (preset === '72h') {
      setStartDate(shiftIsoDate(anchorEnd, -2));
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ preset: '72h', syncDates: true });
      return;
    }
    if (preset === '7d') {
      const s = shiftIsoDate(anchorEnd, -6);
      setStartDate(s);
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ nextStart: s, nextEnd: anchorEnd });
      return;
    }
    if (preset === '30d') {
      const s = shiftIsoDate(anchorEnd, -29);
      setStartDate(s);
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ nextStart: s, nextEnd: anchorEnd });
      return;
    }
    if (preset === 'full') {
      const s = boundsMin || shiftIsoDate(anchorEnd, -89);
      setStartDate(s);
      setEndDate(anchorEnd);
      void fetchPresetOrRangeTrend({ nextStart: s, nextEnd: anchorEnd });
    }
  };

  const handleApplyDateRange = (e: React.FormEvent) => {
    e.preventDefault();
    setTrendPreset('custom');
    void fetchPresetOrRangeTrend({ nextStart: startDate, nextEnd: endDate });
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-lg border border-[#1B263B] bg-[#0B111E] animate-pulse" />
          ))}
        </div>
        <div className="h-80 rounded-lg border border-[#1B263B] bg-[#0B111E] animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-8 text-center text-sm text-slate-400">
        Unable to load NOC overview telemetry. Check server connection and retry.
      </div>
    );
  }

  const { totals, dataSource, urgentIncidents, regionalBreakdown, repeatOffenders, hourlyTrend24h, trend72h } = data;
  const usingRemoteRange = customTrend !== null;
  const activeTrendData = usingRemoteRange
    ? customTrend.buckets
    : trendPreset === '24h'
      ? (hourlyTrend24h ?? [])
      : (trend72h ?? hourlyTrend24h ?? []);

  const totalOpened = usingRemoteRange
    ? customTrend.totalCreated
    : activeTrendData.reduce((sum, pt) => sum + pt.opened, 0);
  const totalResolved = usingRemoteRange
    ? customTrend.totalResolved
    : activeTrendData.reduce((sum, pt) => sum + pt.resolved, 0);
  const totalHighSev = usingRemoteRange
    ? customTrend.totalHighSeverity
    : activeTrendData.reduce((sum, pt) => sum + pt.highSeverity, 0);

  const activeGranularityLabel = usingRemoteRange
    ? customTrend.granularityLabel
    : trendPreset === '24h'
      ? '1-hour buckets (UTC)'
      : '2-hour buckets (UTC)';

  const xInterval =
    activeTrendData.length > 24
      ? Math.max(1, Math.floor(activeTrendData.length / 8))
      : activeTrendData.length > 12
        ? 2
        : 0;

  const handleBatchTriage = async () => {
    setBatchRunning(true);
    try {
      await apiFetch('/api/agents/triage-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      onRefreshOverview?.();
    } catch {
      // handled gracefully
    } finally {
      setBatchRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Data Source & Operational Context Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1B263B] pb-3.5">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span className="font-medium text-slate-200">
            {dataSource.mode === 'excel' ? 'Active Dataset: Uploaded Excel Workbooks' : 'Active Dataset: Built-in UK Telecom Sample'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{totals.totalSites.toLocaleString()} sites</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{totals.totalIncidents.toLocaleString()} incidents</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{totals.totalProblems.toLocaleString()} problems</span>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTab('excel')}
          className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
        >
          Manage Excel Workbooks →
        </button>
      </div>

      {/* 4-Column KPI Telemetry Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onNavigateTab('triage')}
          className="text-left rounded-lg border border-[#1B263B] bg-[#0B111E] p-5 hover:border-[#2D3F5E] hover:bg-[#0E1627] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Active Open Incidents</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
            {totals.openIncidents.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-400 tabular-nums">
            <span className="text-red-400 font-medium">{totals.slaBreachOrImminent} SLA imminent (&le;2h)</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{totals.resolvedIncidents.toLocaleString()} resolved</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('twins')}
          className="text-left rounded-lg border border-[#1B263B] bg-[#0B111E] p-5 hover:border-[#2D3F5E] hover:bg-[#0E1627] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Site Digital Twins</span>
            <Radio className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
            {totals.totalSites.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-400 tabular-nums">
            <span className="text-red-400 font-medium">{totals.criticalSites} Critical</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="text-amber-400 font-medium">{totals.degradedSites} Degraded</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="text-emerald-400">{totals.nominalSites} Nominal</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('problems')}
          className="text-left rounded-lg border border-[#1B263B] bg-[#0B111E] p-5 hover:border-[#2D3F5E] hover:bg-[#0E1627] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Problem Investigations</span>
            <Wrench className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
            {totals.openProblems.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-400 tabular-nums">
            <span>Open RCA tickets</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="text-emerald-400">{totals.closedProblems} verified fixes</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('twins')}
          className="text-left rounded-lg border border-[#1B263B] bg-[#0B111E] p-5 hover:border-[#2D3F5E] hover:bg-[#0E1627] transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Transmission Aggregation Hubs</span>
            <ShieldAlert className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
            {totals.hubSites.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            High-blast-radius parent hubs monitored
          </div>
        </button>
      </div>

      {/* Incident Telemetry Trend with Preset + Custom Start/End Date Range Selector */}
      <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1B263B] pb-3.5">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Incident Telemetry Trend</h2>
            <p className="text-xs text-slate-400">
              Created counted by <span className="text-slate-200 font-medium">SI Start Time</span> · Resolved counted by{' '}
              <span className="text-slate-200 font-medium">SI End Time</span> · {activeGranularityLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
              <div className="flex items-center gap-2 text-slate-200">
                <span className="inline-block h-2 w-4 rounded-sm bg-cyan-400" />
                <span>Created ({totalOpened})</span>
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="inline-block h-2 w-4 rounded-sm bg-emerald-400" />
                <span>Resolved ({totalResolved})</span>
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <span className="inline-block h-2 w-4 rounded-sm bg-amber-400" />
                <span>P1/P2 ({totalHighSev})</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-md border border-[#1B263B] bg-[#070B14] p-1 text-xs">
              {(
                [
                  { id: '24h', label: '24 Hours' },
                  { id: '72h', label: 'Last 3 Days' },
                  { id: '7d', label: '7 Days' },
                  { id: '30d', label: '30 Days' },
                  { id: 'full', label: 'All Data' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectPreset(opt.id)}
                  className={`rounded px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    trendPreset === opt.id ? 'bg-[#162032] text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Date Range Selection Bar */}
        <form
          onSubmit={handleApplyDateRange}
          className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#172236] bg-[#070B14] px-3.5 py-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-300 font-medium">
              <Calendar className="h-3.5 w-3.5 text-cyan-400" />
              <span>Date Range</span>
            </div>

            <label className="flex items-center gap-2 text-slate-400">
              <span>Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setStartDate(val);
                  if (val && endDate && val <= endDate) {
                    setTrendPreset('custom');
                    void fetchPresetOrRangeTrend({ nextStart: val, nextEnd: endDate });
                  }
                }}
                className="rounded border border-[#273549] bg-[#0B111E] px-2.5 py-1 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
              />
            </label>

            <label className="flex items-center gap-2 text-slate-400">
              <span>End Date</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setEndDate(val);
                  if (startDate && val && startDate <= val) {
                    setTrendPreset('custom');
                    void fetchPresetOrRangeTrend({ nextStart: startDate, nextEnd: val });
                  }
                }}
                className="rounded border border-[#273549] bg-[#0B111E] px-2.5 py-1 font-mono text-xs text-slate-100 focus:border-cyan-500 focus:outline-none [color-scheme:dark]"
              />
            </label>

            <button
              type="submit"
              disabled={loadingTrend || !startDate || !endDate}
              className="inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-1 font-medium text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loadingTrend && <RefreshCw className="h-3 w-3 animate-spin" />}
              <span>Apply Range</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-400 tabular-nums">
            {boundsMin && (
              <span>
                Available SI Window: {boundsMin} to {boundsMax}
              </span>
            )}
            {trendError && <span className="text-red-400">{trendError}</span>}
          </div>
        </form>

        <div className="mt-3.5 h-64 w-full rounded-md border border-[#172236] bg-[#070B14] p-3">
          {loadingTrend && activeTrendData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              Querying SI Start Time &amp; SI End Time telemetry...
            </div>
          ) : activeTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                key={`${trendPreset}-${startDate}-${endDate}-${activeTrendData.length}`}
                data={activeTrendData}
                margin={{ top: 8, right: 16, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#172236" vertical={false} />
                <XAxis
                  dataKey="hourLabel"
                  stroke="#64748B"
                  tick={{ fill: '#94A3B8', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  tickLine={false}
                  interval={xInterval}
                />
                <YAxis
                  allowDecimals={false}
                  stroke="#64748B"
                  tick={{ fill: '#94A3B8', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0B111E',
                    border: '1px solid #273549',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#F1F5F9',
                  }}
                  labelStyle={{
                    color: '#94A3B8',
                    fontFamily: 'JetBrains Mono, monospace',
                    marginBottom: '4px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="opened"
                  name="Created (SI Start Time)"
                  stroke="#22D3EE"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: '#22D3EE', stroke: '#05080F', strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="resolved"
                  name="Resolved (SI End Time)"
                  stroke="#34D399"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: '#34D399', stroke: '#05080F', strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="highSeverity"
                  name="P1/P2 High-Severity"
                  stroke="#FBBF24"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: '#FBBF24', stroke: '#05080F', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              No incidents recorded in the selected SI Start/End date range.
            </div>
          )}
        </div>
      </div>

      {/* Main Split: Urgent SLA Triage Queue + Regional Health */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Urgent SLA Queue with AI Next Actions */}
        <div className="xl:col-span-8 rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1B263B] bg-[#0F172A]/60 px-5 py-3.5">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Priority SLA Triage Queue &amp; AI Next Actions</h2>
              <p className="text-xs text-slate-400">
                Active incidents ordered by SLA deadline — click any Site ID for full telemetry &amp; AI recommendations
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={batchRunning}
                onClick={handleBatchTriage}
                className="inline-flex items-center gap-1.5 rounded border border-[#273549] bg-[#070B14] px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-cyan-500/50 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {batchRunning ? (
                  <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />
                ) : (
                  <Bot className="h-3 w-3 text-cyan-400" />
                )}
                <span>{batchRunning ? 'Running AI Triage...' : 'Refresh AI Actions'}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('triage')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Open Triage Copilot</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1B263B] bg-[#070B14] text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Incident / Site</th>
                  <th className="px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-4 py-2.5 font-medium">AI Recommended Next Action</th>
                  <th className="px-4 py-2.5 font-medium text-right">SLA Countdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#172236]">
                {urgentIncidents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No active open incidents in queue.
                    </td>
                  </tr>
                ) : (
                  urgentIncidents.map((inc) => {
                    const sla = formatSlaRemaining(inc.sla_deadline, inc.status);
                    return (
                      <tr
                        key={inc.incident_id}
                        onClick={() => onOpenIncident(inc.incident_id)}
                        className="cursor-pointer hover:bg-[#111C30] transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-100 truncate max-w-[220px]">{inc.title}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                            <span>{inc.incident_id}</span>
                            <span aria-hidden="true"> · </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onInspectSite(inc.site_id);
                              }}
                              className="text-cyan-400 hover:underline font-medium"
                              title="Open site telemetry & detailed recommendations popup"
                            >
                              {inc.site_id}
                            </button>
                            {inc.child_count && inc.child_count > 0 ? (
                              <span className="text-amber-400"> · {inc.child_count} child</span>
                            ) : null}
                            {inc.climbing_required ? <span className="text-cyan-300"> · Climb</span> : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`font-mono font-medium ${
                              inc.severity === 'P1-Critical'
                                ? 'text-red-400'
                                : inc.severity === 'P2-High'
                                  ? 'text-amber-400'
                                  : 'text-slate-300'
                            }`}
                          >
                            {inc.severity}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-200 max-w-[290px]">
                          <div className="line-clamp-2 text-[11.5px] leading-snug text-cyan-200/95">
                            {inc.triage_recommendation ||
                              `Analyze ${inc.site_id} telemetry & dispatch field team before SLA breach`}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              sla.tier === 'breached' || sla.tier === 'imminent'
                                ? 'text-red-400'
                                : sla.tier === 'warning'
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                            }`}
                          >
                            {sla.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Regional Health Breakdown */}
        <div className="xl:col-span-4 rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden">
          <div className="border-b border-[#1B263B] bg-[#0F172A]/60 px-5 py-3.5">
            <h2 className="text-base font-semibold text-slate-100">UK Regional Telemetry</h2>
            <p className="text-xs text-slate-400">Active faults and critical twins by region</p>
          </div>
          <div className="divide-y divide-[#172236]">
            {regionalBreakdown.map((reg) => {
              const pctCritical = reg.siteCount > 0 ? Math.min(100, Math.round((reg.openIncidents / reg.siteCount) * 100)) : 0;
              return (
                <div key={reg.region} className="px-5 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">{reg.region}</span>
                    <span className="font-mono text-slate-400 tabular-nums">
                      {reg.openIncidents} open · {reg.siteCount} sites
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#172236]">
                    <div
                      className={`h-full rounded-full ${
                        reg.criticalSites > 0 ? 'bg-red-500' : reg.openIncidents > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.max(4, pctCritical * 3)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Repeat Offender Hubs Requiring Problem Management */}
      <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1B263B] bg-[#0F172A]/60 px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Top Repeat-Offender Sites</h2>
            <p className="text-xs text-slate-400">
              High-frequency fault sites prioritized for 5-Why Problem Management &amp; strategic upgrades
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('problems')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Open Problem Agent</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#1B263B] bg-[#070B14] text-slate-400">
                <th className="px-4 py-2.5 font-medium">Site Twin</th>
                <th className="px-4 py-2.5 font-medium">Role &amp; Power Profile</th>
                <th className="px-4 py-2.5 font-medium">AI Strategic Problem Recommendation</th>
                <th className="px-4 py-2.5 font-medium text-right">Incidents</th>
                <th className="px-4 py-2.5 font-medium text-right">Avg MTTR</th>
                <th className="px-4 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#172236]">
              {repeatOffenders.map((site) => (
                <tr key={site.site_id} className="hover:bg-[#111C30] transition-colors">
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => onInspectSite(site.site_id)}
                      className="text-left font-mono font-medium text-cyan-400 hover:underline"
                    >
                      {site.site_id}
                    </button>
                    <div className="text-slate-300">{site.site_name} · {site.uk_region}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">
                    <div>
                      {site.site_role}
                      {site.child_count > 0 ? (
                        <span className="text-amber-400"> · {site.child_count} child sites</span>
                      ) : null}
                    </div>
                    <div className="text-slate-400 font-mono text-[11px] tabular-nums">
                      {site.dno_provider} · {site.battery_backup_hours}h batt · {site.has_generator ? 'Gen' : 'No Gen'}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 max-w-[320px]">
                    <div className="text-[11.5px] leading-snug text-emerald-300/95">
                      {site.strategic_recommendation}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Dominant fault: {site.top_category}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-100 tabular-nums">
                    {site.incident_count}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300 tabular-nums">
                    {site.avg_mttr_minutes}m
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenProblemSite(site.site_id)}
                      className="rounded border border-[#273549] bg-[#070B14] px-2.5 py-1 text-xs font-medium text-cyan-400 hover:border-cyan-500/60 hover:bg-cyan-950/30 transition-colors whitespace-nowrap"
                    >
                      Open 5-Why
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
