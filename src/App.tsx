import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ShieldAlert,
  Radio,
  Wrench,
  FileSpreadsheet,
  Plus,
  Download,
  Menu,
  X,
  MessageSquare,
} from 'lucide-react';
import type { Incident, NocAgentRole, NocChatMessage, NocChatModelMode, OverviewStats } from './types/noc';
import { apiFetch } from './utils/format';
import { OverviewView } from './components/OverviewView';
import { IncidentTriageView } from './components/IncidentTriageView';
import { SiteDigitalTwinsView } from './components/SiteDigitalTwinsView';
import { ProblemManagementView } from './components/ProblemManagementView';
import { ExcelDataHubView } from './components/ExcelDataHubView';
import { NocAgentChatView } from './components/NocAgentChatView';
import { NocChatbotDrawer } from './components/NocChatbotDrawer';
import { IngestIncidentModal } from './components/IngestIncidentModal';
import { SiteDetailsModal } from './components/SiteDetailsModal';

type NavTab = 'overview' | 'triage' | 'twins' | 'problems' | 'chat' | 'excel';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Command Overview', icon: LayoutDashboard },
  { id: 'triage', label: 'Incident Triage', icon: ShieldAlert },
  { id: 'twins', label: 'Site Digital Twins', icon: Radio },
  { id: 'problems', label: 'Problem Management', icon: Wrench },
  { id: 'chat', label: 'NOC Agent Chat', icon: MessageSquare },
  { id: 'excel', label: 'Excel Data Hub', icon: FileSpreadsheet },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [problemSiteId, setProblemSiteId] = useState<string | null>(null);
  const [popupSiteId, setPopupSiteId] = useState<string | null>(null);

  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestDefaultSite, setIngestDefaultSite] = useState<string | undefined>(undefined);

  const [chatMessages, setChatMessages] = useState<NocChatMessage[]>([]);
  const [chatAgentRole, setChatAgentRole] = useState<NocAgentRole>('coordinator');
  const [chatModelMode, setChatModelMode] = useState<NocChatModelMode>('standard');

  const refreshOverview = async () => {
    setLoadingOverview(true);
    try {
      const data = await apiFetch<OverviewStats>('/api/overview');
      setOverview(data);
    } catch {
      // handled in view
    } finally {
      setLoadingOverview(false);
    }
  };

  useEffect(() => {
    refreshOverview();
  }, []);

  const handleOpenIncident = (incidentId: string) => {
    setSelectedIncidentId(incidentId);
    setActiveTab('triage');
    setMobileMenuOpen(false);
  };

  const handleOpenSite = (siteId: string) => {
    setSelectedSiteId(siteId);
    setActiveTab('twins');
    setMobileMenuOpen(false);
  };

  const handleOpenProblemSite = (siteId: string) => {
    setProblemSiteId(siteId);
    setActiveTab('problems');
    setMobileMenuOpen(false);
  };

  const handleInspectSitePopup = (siteId: string) => {
    setPopupSiteId(siteId);
  };

  const handleIngestSuccess = (created: Incident) => {
    setIngestOpen(false);
    setIngestDefaultSite(undefined);
    refreshOverview();
    setSelectedIncidentId(created.incident_id);
    setActiveTab('triage');
  };

  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Command Overview';

  return (
    <div className="min-h-screen noc-telemetry-canvas text-slate-100 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-[#1B263B] bg-[#070B14]">
        <div className="flex h-14 items-center border-b border-[#1B263B] px-5">
          <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            UK Telecom NOC
          </span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0F172A] text-cyan-400 border border-[#24324B]'
                    : 'border border-transparent text-slate-400 hover:bg-[#0B111E] hover:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </span>
                {item.id === 'triage' && overview && (
                  <span className="font-mono text-xs text-amber-400 tabular-nums">
                    {overview.totals.openIncidents}
                  </span>
                )}
                {item.id === 'problems' && overview && (
                  <span className="font-mono text-xs text-slate-400 tabular-nums">
                    {overview.totals.openProblems}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#1B263B] bg-[#060A12] p-4 text-xs text-slate-400 space-y-1.5">
          <div className="font-medium text-slate-200">Autonomous NOC Agents</div>
          <div>01. Digital Twin State Manager</div>
          <div>02. Incident Triage Copilot</div>
          <div>03. Problem 5-Why &amp; Advisory</div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="fixed inset-0 bg-black/75" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-50 flex w-64 flex-col border-r border-[#1B263B] bg-[#070B14]">
            <div className="flex h-14 items-center justify-between border-b border-[#1B263B] px-5">
              <span className="font-display text-base font-bold text-slate-100">UK Telecom NOC</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-100"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${
                      active ? 'bg-[#0F172A] text-cyan-400 border border-[#24324B]' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col lg:pl-64 min-w-0">
        {/* Top Bar Contract: Breadcrumb on Left + At Most 2 Single-Line Actions on Right */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-[#1B263B] bg-[#070B14]/95 px-4 sm:px-6 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-md p-2 text-slate-400 hover:bg-[#0F172A] hover:text-slate-100 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">NOC Telemetry</span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-100 truncate">{activeNavLabel}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <a
              href="/api/excel/export/all"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-[#273549] bg-[#0B111E] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:bg-[#0F172A] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Excel</span>
            </a>
            <button
              type="button"
              onClick={() => {
                setIngestDefaultSite(undefined);
                setIngestOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Ingest Incident</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          {activeTab === 'overview' && (
            <OverviewView
              data={overview}
              loading={loadingOverview}
              onOpenIncident={handleOpenIncident}
              onInspectSite={handleInspectSitePopup}
              onOpenProblemSite={handleOpenProblemSite}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onRefreshOverview={refreshOverview}
            />
          )}

          {activeTab === 'triage' && (
            <IncidentTriageView
              selectedIncidentId={selectedIncidentId}
              onSelectIncident={setSelectedIncidentId}
              onInspectSite={handleInspectSitePopup}
              onDataMutated={refreshOverview}
            />
          )}

          {activeTab === 'twins' && (
            <SiteDigitalTwinsView
              selectedSiteId={selectedSiteId}
              onSelectSite={setSelectedSiteId}
              onInspectSite={handleInspectSitePopup}
              onOpenIncident={handleOpenIncident}
              onIngestForSite={(siteId) => {
                setIngestDefaultSite(siteId);
                setIngestOpen(true);
              }}
              onRunProblemForSite={handleOpenProblemSite}
            />
          )}

          {activeTab === 'problems' && (
            <ProblemManagementView
              initialSiteId={problemSiteId}
              onInspectSite={handleInspectSitePopup}
              onDataMutated={refreshOverview}
            />
          )}

          {activeTab === 'chat' && (
            <NocAgentChatView
              messages={chatMessages}
              onMessagesChange={setChatMessages}
              agentRole={chatAgentRole}
              onAgentRoleChange={setChatAgentRole}
              modelMode={chatModelMode}
              onModelModeChange={setChatModelMode}
            />
          )}

          {activeTab === 'excel' && <ExcelDataHubView onDataMutated={refreshOverview} />}
        </main>
      </div>

      {activeTab !== 'chat' && (
        <NocChatbotDrawer
          messages={chatMessages}
          onMessagesChange={setChatMessages}
          agentRole={chatAgentRole}
          onAgentRoleChange={setChatAgentRole}
          modelMode={chatModelMode}
          onModelModeChange={setChatModelMode}
          onExpandToFull={() => setActiveTab('chat')}
        />
      )}

      <IngestIncidentModal
        isOpen={ingestOpen}
        onClose={() => setIngestOpen(false)}
        onSuccess={handleIngestSuccess}
        defaultSiteId={ingestDefaultSite}
      />

      <SiteDetailsModal
        siteId={popupSiteId}
        onClose={() => setPopupSiteId(null)}
        onSwitchSite={(nextSiteId) => setPopupSiteId(nextSiteId)}
        onOpenIncident={handleOpenIncident}
        onOpenInDigitalTwins={handleOpenSite}
        onOpenInProblemManagement={handleOpenProblemSite}
        onIngestForSite={(siteId) => {
          setIngestDefaultSite(siteId);
          setIngestOpen(true);
        }}
      />
    </div>
  );
}
