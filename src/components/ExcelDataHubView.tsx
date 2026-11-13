import React, { useEffect, useState } from 'react';
import {
  Upload,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  RotateCcw,
} from 'lucide-react';
import type { ExcelDatasetStatus } from '../types/noc';
import { apiFetch, formatShortDate } from '../utils/format';

interface ExcelDataHubViewProps {
  onDataMutated: () => void;
}

interface UploadResult {
  dataset: string;
  fileName: string;
  mode: string;
  importedRows: number;
  skippedRows: number;
  minDate?: string;
  maxDate?: string;
  fallbackDatesCount?: number;
}

export const ExcelDataHubView: React.FC<ExcelDataHubViewProps> = ({ onDataMutated }) => {
  const [status, setStatus] = useState<ExcelDatasetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [uploadingDataset, setUploadingDataset] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ExcelDatasetStatus>('/api/excel/status');
      setStatus(res);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleFileUpload = async (dataset: 'sites' | 'incidents' | 'problems', file: File | undefined) => {
    if (!file) return;
    setUploadingDataset(dataset);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append('dataset', dataset);
      formData.append('mode', importMode);
      formData.append('file', file);

      const res = await fetch('/api/excel/upload', {
        method: 'POST',
        body: formData,
      });
      const json = (await res.json()) as { summary?: UploadResult; error?: string };
      if (!res.ok || !json.summary) {
        throw new Error(json.error || 'Failed to parse Excel workbook.');
      }

      const dateWindowNote =
        json.summary.minDate && json.summary.maxDate
          ? ` SI date span: ${json.summary.minDate} to ${json.summary.maxDate}.`
          : '';
      const fallbackNote =
        json.summary.fallbackDatesCount && json.summary.fallbackDatesCount > 0
          ? ` (${json.summary.fallbackDatesCount} rows lacked a valid SI Start Time and used import timestamp.)`
          : '';

      setFeedback({
        type: 'success',
        text: `Imported ${json.summary.importedRows.toLocaleString()} rows from ${json.summary.fileName} (${json.summary.dataset}) and synchronized all Site Digital Twins.${dateWindowNote}${fallbackNote}`,
      });
      await loadStatus();
      onDataMutated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Excel upload failed.',
      });
    } finally {
      setUploadingDataset(null);
    }
  };

  const handleResetSample = async () => {
    setResetting(true);
    setFeedback(null);
    try {
      await apiFetch('/api/excel/reset-sample', { method: 'POST' });
      setFeedback({
        type: 'success',
        text: 'Restored built-in UK telecom sample dataset (240 sites, 450 incidents, 36 problems).',
      });
      await loadStatus();
      onDataMutated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reset sample dataset.',
      });
    } finally {
      setResetting(false);
    }
  };

  const datasetCards: Array<{
    key: 'sites' | 'incidents' | 'problems';
    title: string;
    expectedFile: string;
    description: string;
    countLabel: string;
    sourceLabel: string;
  }> = [
    {
      key: 'sites',
      title: '1. Site Digital Twin Master',
      expectedFile: 'telecom_site_database.xlsx',
      description:
        'UK telecom sites with DNO power providers, battery autonomy hours, generator backup, cooling solutions, UK regions, and hub/child transmission mappings.',
      countLabel: status ? `${status.sites.count.toLocaleString()} sites in SQLite` : '—',
      sourceLabel: status?.sites.source || '—',
    },
    {
      key: 'incidents',
      title: '2. Incident Records Database',
      expectedFile: 'telecom_incidents_4000_v2.xlsx',
      description:
        'Active open SLA incidents and historical resolved tickets with symptoms, severity, restoration MTTR, and root cause notes.',
      countLabel: status
        ? `${status.incidents.count.toLocaleString()} total (${status.incidents.openCount} open · ${status.incidents.resolvedCount} resolved)`
        : '—',
      sourceLabel: status?.incidents.source || '—',
    },
    {
      key: 'problems',
      title: '3. Problem Management Database',
      expectedFile: 'telecom_problems_database.xlsx',
      description:
        'Open investigations and closed problem records with 5-Why analyses, strategic recommendations, and verified permanent fixes.',
      countLabel: status
        ? `${status.problems.count.toLocaleString()} total (${status.problems.openCount} open · ${status.problems.closedCount} closed)`
        : '—',
      sourceLabel: status?.problems.source || '—',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Status & Import Options Header */}
      <div className="rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Excel Ingestion &amp; SQLite Data Hub</h2>
            <p className="mt-1 text-xs text-slate-400">
              {status?.mode === 'excel'
                ? 'Running on user-uploaded Excel workbooks persisted in server SQLite.'
                : 'Running on built-in UK telecom sample data. Upload your three Excel files below at any time.'}{' '}
              {status ? `Last synced: ${formatShortDate(status.lastUpdated)}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#070B14] p-1 text-xs">
              <button
                type="button"
                onClick={() => setImportMode('replace')}
                className={`rounded px-3 py-1 font-medium transition-colors ${
                  importMode === 'replace' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Replace Table
              </button>
              <button
                type="button"
                onClick={() => setImportMode('merge')}
                className={`rounded px-3 py-1 font-medium transition-colors ${
                  importMode === 'merge' ? 'bg-slate-800 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Merge / Upsert
              </button>
            </div>

            <button
              type="button"
              disabled={resetting}
              onClick={handleResetSample}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#273549] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{resetting ? 'Resetting...' : 'Reset to UK Sample'}</span>
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-xs ${
            feedback.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
              : 'border-red-500/40 bg-red-950/40 text-red-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Three Dataset Upload & Export Cards */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {datasetCards.map((card) => {
          const isUploading = uploadingDataset === card.key;
          return (
            <div key={card.key} className="flex flex-col justify-between rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">{card.title}</h3>
                  <FileSpreadsheet className="h-4 w-4 text-cyan-400 shrink-0" />
                </div>
                <div className="mt-1 font-mono text-[11px] text-cyan-400">{card.expectedFile}</div>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">{card.description}</p>

                <div className="mt-4 border-t border-slate-800 pt-3 text-xs space-y-1">
                  <div className="font-mono text-slate-200 tabular-nums">
                    {loading ? 'Loading...' : card.countLabel}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">Source: {card.sourceLabel}</div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800">
                <label className="flex-1 cursor-pointer inline-flex items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 transition-colors whitespace-nowrap">
                  {isUploading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  <span>{isUploading ? 'Importing...' : 'Upload .xlsx'}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={isUploading}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      handleFileUpload(card.key, file);
                      e.target.value = '';
                    }}
                  />
                </label>

                <a
                  href={`/api/excel/export/${card.key}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#273549] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export</span>
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Full Workbook Export */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[#1B263B] bg-[#0B111E] p-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Export Synchronized Multi-Sheet Workbook</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Downloads a single `.xlsx` workbook containing all SQLite-persisted Site Digital Twins, Incidents, and Problem Tickets.
          </p>
        </div>
        <a
          href="/api/excel/export/all"
          className="inline-flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-950/30 px-4 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-900/40 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          <span>Download Combined NOC Workbook (.xlsx)</span>
        </a>
      </div>
    </div>
  );
};
