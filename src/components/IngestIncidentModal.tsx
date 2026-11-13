import React, { useEffect, useState } from 'react';
import { X, AlertTriangle, ArrowRight } from 'lucide-react';
import type { Incident, Site } from '../types/noc';
import { apiFetch } from '../utils/format';

interface IngestIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (created: Incident) => void;
  defaultSiteId?: string;
}

export const IngestIncidentModal: React.FC<IngestIncidentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultSiteId,
}) => {
  const [siteQuery, setSiteQuery] = useState(defaultSiteId || '');
  const [siteOptions, setSiteOptions] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(defaultSiteId || '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Power & Battery');
  const [severity, setSeverity] = useState<'P1-Critical' | 'P2-High' | 'P3-Medium' | 'P4-Low'>('P1-Critical');
  const [slaHours, setSlaHours] = useState('2');
  const [assignedTeam, setAssignedTeam] = useState('NOC Tier 1 Triage');
  const [symptomSummary, setSymptomSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (defaultSiteId) {
      setSelectedSiteId(defaultSiteId);
      setSiteQuery(defaultSiteId);
    }
    let active = true;
    apiFetch<{ items: Site[] }>(`/api/sites?limit=25&search=${encodeURIComponent(siteQuery)}`)
      .then((res) => {
        if (active) {
          setSiteOptions(res.items);
          if (!selectedSiteId && res.items.length > 0) {
            setSelectedSiteId(res.items[0].site_id);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen, siteQuery, defaultSiteId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSiteId || !title.trim() || !symptomSummary.trim()) {
      setError('Please select a site and enter an incident title and symptom summary.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ incident: Incident }>('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: selectedSiteId,
          title: title.trim(),
          category,
          severity,
          sla_hours: Number(slaHours) || 2,
          assigned_team: assignedTeam,
          symptom_summary: symptomSummary.trim(),
        }),
      });
      setTitle('');
      setSymptomSummary('');
      onSuccess(res.incident);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ingest incident.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-lg border border-[#24324B] bg-[#0B111E] text-slate-100">
        <div className="flex items-center justify-between border-b border-[#1B263B] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Ingest New Incident</h2>
            <p className="text-xs text-slate-400">
              Logging an incident persists to SQLite and updates the site Digital Twin state.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Search Site</label>
              <input
                type="text"
                value={siteQuery}
                onChange={(e) => setSiteQuery(e.target.value)}
                placeholder="Filter by Site ID or town..."
                className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Target Site ID</label>
              <select
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 font-mono text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
              >
                {siteOptions.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {s.site_id} — {s.site_name} ({s.site_role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">Incident Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Mains Power Failure & Rectifier Undervoltage Alarm"
              className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
              >
                <option value="Power & Battery">Power & Battery</option>
                <option value="Transmission & Backhaul">Transmission & Backhaul</option>
                <option value="Cooling & HVAC">Cooling & HVAC</option>
                <option value="RAN Hardware">RAN Hardware</option>
                <option value="DNO Grid Outage">DNO Grid Outage</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as typeof severity)}
                className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
              >
                <option value="P1-Critical">P1-Critical</option>
                <option value="P2-High">P2-High</option>
                <option value="P3-Medium">P3-Medium</option>
                <option value="P4-Low">P4-Low</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">SLA Window (hrs)</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={slaHours}
                onChange={(e) => setSlaHours(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 font-mono text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">Assigned Queue</label>
            <input
              type="text"
              value={assignedTeam}
              onChange={(e) => setAssignedTeam(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">Alarm & Symptom Summary</label>
            <textarea
              required
              rows={3}
              value={symptomSummary}
              onChange={(e) => setSymptomSummary(e.target.value)}
              placeholder="Describe observed alarms, voltage/temp telemetry, and impacted carriers..."
              className="w-full rounded-md border border-slate-700 bg-[#070B14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#1B263B] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <span>{submitting ? 'Ingesting...' : 'Log Incident & Sync Twin'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
