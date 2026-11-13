import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { db } from './db.ts';
import type {
  Incident,
  NocAgentRole,
  NocChatModelMode,
  ProblemManagementAIResult,
  ProblemTicket,
  Site,
  TriageAIResult,
  TwinSynthesisAIResult,
} from '../src/types/noc.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function saveAgentAnalysis(
  agentType: 'digital_twin' | 'incident_triage' | 'problem_management',
  entityId: string,
  summary: string,
  payload: unknown
): void {
  db.prepare(`
    INSERT INTO agent_analyses (agent_type, entity_id, summary, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(agentType, entityId, summary, JSON.stringify(payload), new Date().toISOString());
}

export async function runDigitalTwinAgent(siteId: string): Promise<TwinSynthesisAIResult> {
  const site = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(siteId) as Site | undefined;
  if (!site) {
    throw new Error(`Site ${siteId} not found.`);
  }

  const childSites = db
    .prepare('SELECT site_id, site_name, twin_status, open_incident_count FROM sites WHERE parent_hub_id = ?')
    .all(siteId) as Array<Pick<Site, 'site_id' | 'site_name' | 'twin_status' | 'open_incident_count'>>;

  const parentHub = site.parent_hub_id
    ? (db.prepare('SELECT site_id, site_name, twin_status FROM sites WHERE site_id = ?').get(site.parent_hub_id) as
        | Pick<Site, 'site_id' | 'site_name' | 'twin_status'>
        | undefined)
    : undefined;

  const recentIncidents = db
    .prepare(
      'SELECT incident_id, title, category, severity, status, opened_at, mttr_minutes, root_cause FROM incidents WHERE site_id = ? ORDER BY opened_at DESC LIMIT 20'
    )
    .all(siteId) as Incident[];

  const problems = db
    .prepare('SELECT problem_id, title, category, status, permanent_fix, strategic_recommendation FROM problems WHERE site_id = ? ORDER BY opened_at DESC LIMIT 10')
    .all(siteId) as ProblemTicket[];

  const ai = getGeminiClient();

  const prompt = `Analyze the complete Digital Twin profile for UK telecom site ${site.site_id}.

SITE INFRASTRUCTURE & TELEMETRY:
- Site Name: ${site.site_name}
- UK Region: ${site.uk_region}
- DNO Power Provider: ${site.dno_provider}
- Power Architecture: ${site.power_type}
- Battery Backup Autonomy: ${site.battery_backup_hours} hours
- Generator Backup Installed: ${site.has_generator ? 'Yes' : 'No'}
- Cooling Solution: ${site.cooling_solution}
- Transmission Role: ${site.site_role}
- Dependent Child Sites (${childSites.length}): ${JSON.stringify(childSites)}
- Parent Hub: ${parentHub ? `${parentHub.site_id} (${parentHub.site_name}, status: ${parentHub.twin_status})` : 'None'}
- Climbing Required: ${site.climbing_required ? 'Yes' : 'No'}
- Access Notes: ${site.access_notes}
- Vendor Hardware: ${site.vendor_hardware}
- Current Computed Twin Status: ${site.twin_status} (${site.open_incident_count} open / ${site.total_incident_count} total incidents)

RECENT INCIDENT HISTORY (${recentIncidents.length} most recent):
${JSON.stringify(recentIncidents)}

LINKED PROBLEM RECORDS (${problems.length}):
${JSON.stringify(problems)}

Provide a precise, factual operational synthesis of this site's Digital Twin state, structural resiliency gaps, transmission blast radius, and preventive engineering actions.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are the Digital Twin Agent for a UK Telecom NOC. Synthesize static site infrastructure telemetry with dynamic incident and problem history. Be concise, quantitative, and strictly grounded in the provided site record.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          riskLevel: { type: Type.STRING, enum: ['Low', 'Elevated', 'High', 'Critical'] },
          operationalSummary: { type: Type.STRING },
          resiliencyGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          transmissionImpact: { type: Type.STRING },
          recommendedPreventiveActions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['riskLevel', 'operationalSummary', 'resiliencyGaps', 'transmissionImpact', 'recommendedPreventiveActions'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as TwinSynthesisAIResult;
  saveAgentAnalysis('digital_twin', siteId, parsed.operationalSummary, parsed);
  return parsed;
}

export async function runIncidentTriageAgent(incidentId: string): Promise<TriageAIResult> {
  const incident = db.prepare('SELECT * FROM incidents WHERE incident_id = ?').get(incidentId) as Incident | undefined;
  if (!incident) {
    throw new Error(`Incident ${incidentId} not found.`);
  }

  const site = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(incident.site_id) as Site | undefined;
  const childCount = site
    ? ((db.prepare('SELECT COUNT(*) as c FROM sites WHERE parent_hub_id = ?').get(site.site_id) as { c: number }).c ?? 0)
    : 0;
  const pastIncidents = db
    .prepare(
      'SELECT incident_id, title, category, severity, status, mttr_minutes, root_cause FROM incidents WHERE site_id = ? AND incident_id != ? ORDER BY opened_at DESC LIMIT 10'
    )
    .all(incident.site_id, incidentId) as Incident[];
  const openProblems = db
    .prepare('SELECT problem_id, title, status, permanent_fix FROM problems WHERE site_id = ? ORDER BY opened_at DESC LIMIT 5')
    .all(incident.site_id) as ProblemTicket[];

  const minsToSla = Math.round((new Date(incident.sla_deadline).getTime() - Date.now()) / 60_000);

  const ai = getGeminiClient();

  const prompt = `Triage active telecom incident ${incident.incident_id} immediately.

ACTIVE INCIDENT:
- Incident ID: ${incident.incident_id}
- Title: ${incident.title}
- Category: ${incident.category}
- Severity: ${incident.severity}
- Status: ${incident.status}
- Symptom Summary: ${incident.symptom_summary}
- Opened At: ${incident.opened_at}
- SLA Deadline: ${incident.sla_deadline} (${minsToSla} minutes remaining; negative means already breached)
- Assigned Team: ${incident.assigned_team || 'Unassigned'}

SITE DIGITAL TWIN CONTEXT:
${site ? JSON.stringify({ ...site, dependent_child_sites: childCount }) : 'Site record missing — treat as unverified macro site'}

RECENT SITE INCIDENT HISTORY (${pastIncidents.length}):
${JSON.stringify(pastIncidents)}

SITE PROBLEM RECORDS (${openProblems.length}):
${JSON.stringify(openProblems)}

Deliver concrete, immediate NOC triage guidance: exact dispatch action, SLA urgency window, climbing/access requirements, DNO escalation check, and child-site blast radius impact.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are the Incident Triage Agent (Operational Copilot) for a UK Telecom NOC. Give decisive, actionable dispatch recommendations grounded in SLA countdown minutes, climbing requirements, battery autonomy, DNO provider, and transmission hub/child dependencies.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          urgencyTier: {
            type: Type.STRING,
            enum: ['Immediate Breach Risk', 'High Priority', 'Standard Dispatch', 'Monitor'],
          },
          slaAssessment: { type: Type.STRING },
          immediateNextAction: { type: Type.STRING },
          dispatchChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
          climbingAndAccessAdvisory: { type: Type.STRING },
          dnoEscalationNeeded: { type: Type.BOOLEAN },
          dnoEscalationReason: { type: Type.STRING },
          blastRadiusImpact: { type: Type.STRING },
          suggestedTeam: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: [
          'urgencyTier',
          'slaAssessment',
          'immediateNextAction',
          'dispatchChecklist',
          'climbingAndAccessAdvisory',
          'dnoEscalationNeeded',
          'dnoEscalationReason',
          'blastRadiusImpact',
          'suggestedTeam',
          'rationale',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as TriageAIResult;

  db.prepare('UPDATE incidents SET triage_recommendation = ? WHERE incident_id = ?').run(
    parsed.immediateNextAction,
    incidentId
  );
  saveAgentAnalysis('incident_triage', incidentId, parsed.immediateNextAction, parsed);

  return parsed;
}

export async function runIncidentTriageChat(
  incidentId: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  question: string
): Promise<string> {
  const incident = db.prepare('SELECT * FROM incidents WHERE incident_id = ?').get(incidentId) as Incident | undefined;
  if (!incident) {
    throw new Error(`Incident ${incidentId} not found.`);
  }
  const site = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(incident.site_id) as Site | undefined;
  const childSites = site
    ? (db.prepare('SELECT site_id, site_name, twin_status FROM sites WHERE parent_hub_id = ?').all(site.site_id) as Site[])
    : [];
  const pastIncidents = db
    .prepare('SELECT incident_id, title, category, severity, status, root_cause, mttr_minutes FROM incidents WHERE site_id = ? ORDER BY opened_at DESC LIMIT 8')
    .all(incident.site_id);

  const minsToSla = Math.round((new Date(incident.sla_deadline).getTime() - Date.now()) / 60_000);

  const ai = getGeminiClient();
  const chatHistoryText = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Incident Manager' : 'Triage Agent'}: ${m.text}`)
    .join('\n');

  const prompt = `INCIDENT CONTEXT:
${JSON.stringify(incident)}
Minutes until SLA deadline: ${minsToSla}

SITE DIGITAL TWIN:
${JSON.stringify(site)}
Dependent Child Sites (${childSites.length}): ${JSON.stringify(childSites)}
Recent History: ${JSON.stringify(pastIncidents)}

CONVERSATION SO FAR:
${chatHistoryText || '(New conversation)'}

Incident Manager Question: ${question}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are the UK Telecom NOC Incident Triage Copilot. Answer the Incident Manager directly, concisely, and operationally using exact facts from the incident and site digital twin (battery hours, DNO provider, climbing requirement, child site count, SLA deadline). Use clear plain prose or bullet points.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  return (response.text ?? 'Unable to generate triage response.').trim();
}

export async function runProblemManagementAgent(params: {
  siteId?: string;
  problemId?: string;
}): Promise<ProblemManagementAIResult> {
  let siteId = params.siteId;
  let problem: ProblemTicket | undefined;

  if (params.problemId) {
    problem = db.prepare('SELECT * FROM problems WHERE problem_id = ?').get(params.problemId) as ProblemTicket | undefined;
    if (problem && !siteId) {
      siteId = problem.site_id;
    }
  }

  if (!siteId) {
    throw new Error('Either siteId or problemId is required.');
  }

  const site = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(siteId) as Site | undefined;
  if (!site) {
    throw new Error(`Site ${siteId} not found.`);
  }

  const childSites = db
    .prepare('SELECT site_id, site_name, twin_status FROM sites WHERE parent_hub_id = ?')
    .all(siteId) as Array<Pick<Site, 'site_id' | 'site_name' | 'twin_status'>>;

  const incidents = db
    .prepare(
      'SELECT incident_id, title, category, severity, status, symptom_summary, opened_at, resolved_at, mttr_minutes, root_cause FROM incidents WHERE site_id = ? ORDER BY opened_at DESC LIMIT 30'
    )
    .all(siteId) as Incident[];

  const relatedProblems = db
    .prepare('SELECT problem_id, title, category, status, five_why_analysis, permanent_fix FROM problems WHERE site_id = ? ORDER BY opened_at DESC LIMIT 8')
    .all(siteId) as ProblemTicket[];

  const ai = getGeminiClient();

  const prompt = `Conduct a deep 5-Why Root Cause Analysis and Strategic Infrastructure Advisory for repeat-offender telecom site ${site.site_id}.

SITE DIGITAL TWIN TELEMETRY:
- Site ID: ${site.site_id} (${site.site_name})
- Region: ${site.uk_region}
- DNO Provider: ${site.dno_provider}
- Power Type: ${site.power_type}
- Battery Autonomy: ${site.battery_backup_hours} hours
- Generator Present: ${site.has_generator ? 'Yes' : 'No'}
- Cooling Solution: ${site.cooling_solution}
- Transmission Role: ${site.site_role}
- Dependent Child Sites Supported: ${childSites.length} (${childSites.map((c) => c.site_id).join(', ') || 'None'})
- Climbing Required: ${site.climbing_required ? 'Yes' : 'No'}
- Vendor Hardware: ${site.vendor_hardware}

${problem ? `TARGET PROBLEM TICKET:\n${JSON.stringify(problem)}\n` : ''}
CORRELATED INCIDENT LOGS (${incidents.length} records):
${JSON.stringify(incidents)}

EXISTING PROBLEM TICKETS FOR SITE:
${JSON.stringify(relatedProblems)}

Instructions:
1. Build a rigorous 5-Why chain grounded in the actual symptom and root cause patterns above.
2. Provide a proposed permanent engineering fix.
3. Generate strategic capex/operational recommendations (e.g., upgrading battery resiliency / generator backup if this is a hub supporting child sites, direct free cooling retrofits if thermal faults appear, or vendor hardware reliability reviews if RAN/optical failures repeat), each with an explicit, evidence-backed justification citing exact site attributes and incident counts.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are the Intelligent Problem Management Agent for a UK Telecom NOC. Perform structured 5-Why root cause analysis and deliver fact-based strategic engineering recommendations with explicit justifications tied to transmission hub criticality, child site counts, DNO reliability, cooling, and vendor hardware history.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fiveWhyChain: {
            type: Type.OBJECT,
            properties: {
              why1: { type: Type.STRING },
              why2: { type: Type.STRING },
              why3: { type: Type.STRING },
              why4: { type: Type.STRING },
              why5: { type: Type.STRING },
            },
            required: ['why1', 'why2', 'why3', 'why4', 'why5'],
          },
          rootCauseStatement: { type: Type.STRING },
          proposedPermanentFix: { type: Type.STRING },
          strategicRecommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                action: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ['Critical', 'High', 'Medium'] },
                explicitJustification: { type: Type.STRING },
                estimatedImpact: { type: Type.STRING },
              },
              required: ['category', 'action', 'priority', 'explicitJustification', 'estimatedImpact'],
            },
          },
          vendorReliabilityNote: { type: Type.STRING },
        },
        required: [
          'fiveWhyChain',
          'rootCauseStatement',
          'proposedPermanentFix',
          'strategicRecommendations',
          'vendorReliabilityNote',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as ProblemManagementAIResult;
  const entityKey = params.problemId ?? siteId;
  saveAgentAnalysis('problem_management', entityKey, parsed.rootCauseStatement, parsed);
  return parsed;
}

const ROLE_SYSTEM_INSTRUCTIONS: Record<NocAgentRole, string> = {
  coordinator:
    'You are the Autonomous UK Telecom NOC Multi-Agent Coordinator. You synthesize insights across the Digital Twin Agent, Incident Triage Agent, and Problem Management Agent. Always cite exact Site IDs, Incident IDs, Problem IDs, SLA deadlines, DNO providers, and child-site blast radius from the live telemetry context.',
  triage:
    'You are the Incident Triage Agent (Operational Copilot) for a UK Telecom NOC. Prioritize active SLA deadlines, dispatch checklists, climbing/access requirements, DNO escalations, and immediate field restoration actions.',
  digital_twin:
    'You are the Digital Twin Agent (Master Data & State Manager) for 4,700 UK telecom sites. Focus on site static attributes (DNO power, battery autonomy, generator backup, cooling solution, hub/child topology) combined with dynamic incident and problem history.',
  problem_management:
    'You are the Intelligent Problem Management Agent (Root Cause & Strategic Advisory). Focus on repeat offenders, 5-Why root cause chains, vendor hardware reliability, and fact-based capex/engineering recommendations with explicit justifications.',
};

export async function runMultiAgentChat(params: {
  agentRole: NocAgentRole;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  message: string;
  modelMode?: NocChatModelMode;
}): Promise<{ answer: string; model: string }> {
  const ai = getGeminiClient();
  const model = params.modelMode === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

  // Gather live NOC telemetry context from SQLite
  const totals = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM sites) as totalSites,
        (SELECT COUNT(*) FROM sites WHERE twin_status = 'Critical') as criticalSites,
        (SELECT COUNT(*) FROM sites WHERE twin_status = 'Degraded') as degradedSites,
        (SELECT COUNT(*) FROM incidents WHERE status IN ('Open', 'In Progress')) as openIncidents,
        (SELECT COUNT(*) FROM problems WHERE status != 'Closed') as openProblems
    `)
    .get() as Record<string, number>;

  const urgentOpen = db
    .prepare(`
      SELECT i.incident_id, i.site_id, i.title, i.severity, i.status, i.category, i.sla_deadline,
             i.triage_recommendation,
             s.uk_region, s.dno_provider, s.battery_backup_hours, s.has_generator, s.site_role, s.child_count, s.climbing_required
      FROM incidents i
      LEFT JOIN sites s ON i.site_id = s.site_id
      WHERE i.status IN ('Open', 'In Progress')
      ORDER BY i.sla_deadline ASC
      LIMIT 8
    `)
    .all();

  const openProblems = db
    .prepare(`
      SELECT p.problem_id, p.site_id, p.title, p.category, p.status, p.related_incident_count,
             p.strategic_recommendation, p.permanent_fix,
             s.site_name, s.uk_region, s.site_role, s.child_count
      FROM problems p
      LEFT JOIN sites s ON p.site_id = s.site_id
      WHERE p.status != 'Closed'
      ORDER BY p.related_incident_count DESC, p.opened_at DESC
      LIMIT 8
    `)
    .all();

  const topRepeatOffenders = db
    .prepare(`
      SELECT s.site_id, s.site_name, s.uk_region, s.dno_provider, s.site_role, s.child_count,
             s.battery_backup_hours, s.has_generator, s.cooling_solution, COUNT(i.incident_id) as incident_count
      FROM sites s
      INNER JOIN incidents i ON i.site_id = s.site_id
      GROUP BY s.site_id
      ORDER BY incident_count DESC, s.child_count DESC
      LIMIT 6
    `)
    .all();

  // Check if user mentioned specific Site IDs, Incident IDs, or Problem IDs
  const mentionedIds = Array.from(
    new Set((params.message.match(/\b(?:UK-[A-Z0-9-]+|INC-[A-Z0-9-]+|PRB-[A-Z0-9-]+)\b/gi) ?? []).map((s) => s.toUpperCase()))
  );

  const entityLookup: Record<string, unknown> = {};
  for (const id of mentionedIds.slice(0, 4)) {
    if (id.startsWith('UK-')) {
      const site = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(id);
      const siteIncidents = db
        .prepare('SELECT incident_id, title, severity, status, sla_deadline, root_cause, triage_recommendation FROM incidents WHERE site_id = ? ORDER BY opened_at DESC LIMIT 8')
        .all(id);
      const siteProblems = db
        .prepare('SELECT problem_id, title, status, strategic_recommendation, permanent_fix FROM problems WHERE site_id = ? ORDER BY opened_at DESC LIMIT 5')
        .all(id);
      if (site) entityLookup[id] = { site, recentIncidents: siteIncidents, problems: siteProblems };
    } else if (id.startsWith('INC-')) {
      const inc = db.prepare('SELECT * FROM incidents WHERE incident_id = ?').get(id) as Incident | undefined;
      const site = inc ? db.prepare('SELECT * FROM sites WHERE site_id = ?').get(inc.site_id) : null;
      if (inc) entityLookup[id] = { incident: inc, site };
    } else if (id.startsWith('PRB-')) {
      const prb = db.prepare('SELECT * FROM problems WHERE problem_id = ?').get(id) as ProblemTicket | undefined;
      const site = prb ? db.prepare('SELECT * FROM sites WHERE site_id = ?').get(prb.site_id) : null;
      if (prb) entityLookup[id] = { problem: prb, site };
    }
  }

  const liveContextBlock = `LIVE SQLITE NOC TELEMETRY SNAPSHOT (Current UTC: ${new Date().toISOString()}):
Totals: ${JSON.stringify(totals)}
Top Urgent Open Incidents: ${JSON.stringify(urgentOpen)}
Active Open Problems & Recommendations: ${JSON.stringify(openProblems)}
Top Repeat Offenders: ${JSON.stringify(topRepeatOffenders)}
${Object.keys(entityLookup).length > 0 ? `Referenced Entities: ${JSON.stringify(entityLookup)}` : ''}`;

  const sdkHistory = (params.history ?? []).slice(-14).map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const systemInstruction = `${ROLE_SYSTEM_INSTRUCTIONS[params.agentRole]}\n\nAlways ground answers in the live SQLite NOC telemetry snapshot provided with each user turn. Be concise, operational, and explicit about Site IDs, SLA deadlines, DNOs, next actions, recommendations, and hub/child blast-radius impacts.`;

  const chat = ai.chats.create({
    model,
    history: sdkHistory,
    config:
      model === 'gemini-4-hydrogen'
        ? {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          }
        : {
            systemInstruction,
          },
  });

  const response = await chat.sendMessage({
    message: `${liveContextBlock}\n\nNOC Operator Message: ${params.message}`,
  });

  return {
    answer: (response.text ?? 'Unable to generate NOC agent response.').trim(),
    model,
  };
}


