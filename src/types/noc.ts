export type SiteRole = 'Hub' | 'Child' | 'Standalone';
export type TwinStatus = 'Nominal' | 'Degraded' | 'Critical';
export type IncidentSeverity = 'P1-Critical' | 'P2-High' | 'P3-Medium' | 'P4-Low';
export type IncidentStatus = 'Open' | 'In Progress' | 'Resolved';
export type ProblemStatus = 'Open' | 'Investigating' | 'Closed';

export interface Site {
  site_id: string;
  site_name: string;
  uk_region: string;
  latitude: number | null;
  longitude: number | null;
  dno_provider: string;
  power_type: string;
  battery_backup_hours: number;
  has_generator: boolean;
  cooling_solution: string;
  site_role: SiteRole;
  parent_hub_id: string | null;
  child_count: number;
  climbing_required: boolean;
  access_notes: string;
  vendor_hardware: string;
  twin_status: TwinStatus;
  open_incident_count: number;
  total_incident_count: number;
  last_updated_at: string;
}

export interface Incident {
  incident_id: string;
  site_id: string;
  title: string;
  category: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  symptom_summary: string;
  sla_deadline: string;
  opened_at: string;
  resolved_at: string | null;
  mttr_minutes: number | null;
  root_cause: string | null;
  linked_problem_id: string | null;
  triage_recommendation: string | null;
  assigned_team: string | null;
  // Joined fields for list displays
  site_name?: string;
  uk_region?: string;
  dno_provider?: string;
  site_role?: SiteRole;
  child_count?: number;
  climbing_required?: boolean;
  twin_status?: TwinStatus;
}

export interface ProblemTicket {
  problem_id: string;
  site_id: string;
  title: string;
  category: string;
  status: ProblemStatus;
  related_incident_count: number;
  vendor_hardware: string;
  five_why_analysis: string;
  permanent_fix: string | null;
  strategic_recommendation: string | null;
  justification: string | null;
  opened_at: string;
  closed_at: string | null;
  // Joined fields
  site_name?: string;
  uk_region?: string;
  site_role?: SiteRole;
  child_count?: number;
}

export interface RepeatOffender {
  site_id: string;
  site_name: string;
  uk_region: string;
  dno_provider: string;
  site_role: SiteRole;
  child_count: number;
  battery_backup_hours: number;
  has_generator: boolean;
  cooling_solution: string;
  vendor_hardware: string;
  twin_status: TwinStatus;
  incident_count: number;
  open_incidents: number;
  avg_mttr_minutes: number;
  top_category: string;
  open_problem_id: string | null;
  strategic_recommendation: string | null;
}

export interface AgentAnalysisRecord {
  id: number;
  agent_type: 'digital_twin' | 'incident_triage' | 'problem_management';
  entity_id: string;
  summary: string;
  payload_json: string;
  created_at: string;
}

export interface TriageAIResult {
  urgencyTier: 'Immediate Breach Risk' | 'High Priority' | 'Standard Dispatch' | 'Monitor';
  slaAssessment: string;
  immediateNextAction: string;
  dispatchChecklist: string[];
  climbingAndAccessAdvisory: string;
  dnoEscalationNeeded: boolean;
  dnoEscalationReason: string;
  blastRadiusImpact: string;
  suggestedTeam: string;
  rationale: string;
}

export interface TwinSynthesisAIResult {
  riskLevel: 'Low' | 'Elevated' | 'High' | 'Critical';
  operationalSummary: string;
  resiliencyGaps: string[];
  transmissionImpact: string;
  recommendedPreventiveActions: string[];
}

export interface ProblemManagementAIResult {
  fiveWhyChain: {
    why1: string;
    why2: string;
    why3: string;
    why4: string;
    why5: string;
  };
  rootCauseStatement: string;
  proposedPermanentFix: string;
  strategicRecommendations: Array<{
    category: string;
    action: string;
    priority: 'Critical' | 'High' | 'Medium';
    explicitJustification: string;
    estimatedImpact: string;
  }>;
  vendorReliabilityNote: string;
}

export interface TrendBucket {
  hourLabel: string;
  isoHour: string;
  opened: number;
  resolved: number;
  highSeverity: number;
}

export interface OverviewStats {
  totals: {
    totalSites: number;
    nominalSites: number;
    degradedSites: number;
    criticalSites: number;
    totalIncidents: number;
    openIncidents: number;
    resolvedIncidents: number;
    slaBreachOrImminent: number;
    totalProblems: number;
    openProblems: number;
    closedProblems: number;
    hubSites: number;
  };
  dataSource: {
    mode: 'sample' | 'excel';
    lastUpdated: string;
    sitesSource: string;
    incidentsSource: string;
    problemsSource: string;
  };
  urgentIncidents: Incident[];
  regionalBreakdown: Array<{
    region: string;
    siteCount: number;
    openIncidents: number;
    criticalSites: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    count: number;
    openCount: number;
  }>;
  repeatOffenders: RepeatOffender[];
  hourlyTrend24h: TrendBucket[];
  trend72h: TrendBucket[];
  dataBounds?: {
    minDate: string;
    maxDate: string;
  };
}

export interface TrendRangeResponse {
  startDate: string;
  endDate: string;
  minDate: string;
  maxDate: string;
  granularityLabel: string;
  totalCreated: number;
  totalResolved: number;
  totalHighSeverity: number;
  buckets: TrendBucket[];
}

export type NocAgentRole = 'coordinator' | 'triage' | 'digital_twin' | 'problem_management';
export type NocChatModelMode = 'standard' | 'fast';

export interface NocChatMessage {
  id: string;
  role: 'user' | 'model';
  agentRole: NocAgentRole;
  text: string;
  timestamp: string;
  modelUsed?: string;
}

export interface ExcelDatasetStatus {
  mode: 'sample' | 'excel';
  lastUpdated: string;
  sites: { count: number; source: string };
  incidents: { count: number; openCount: number; resolvedCount: number; source: string };
  problems: { count: number; openCount: number; closedCount: number; source: string };
}

export interface SiteDetailResponse {
  site: Site;
  parentHub: Pick<Site, 'site_id' | 'site_name' | 'uk_region' | 'twin_status' | 'open_incident_count'> | null;
  childSites: Array<
    Pick<Site, 'site_id' | 'site_name' | 'uk_region' | 'twin_status' | 'open_incident_count' | 'battery_backup_hours'>
  >;
  incidents: Incident[];
  problems: ProblemTicket[];
  analyses: AgentAnalysisRecord[];
  problemAnalysis: AgentAnalysisRecord | null;
  triageAnalyses: Record<string, TriageAIResult>;
  strategicRecommendationSummary: string;
}

