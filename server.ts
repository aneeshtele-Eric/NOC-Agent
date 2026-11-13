import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  db,
  getMeta,
  initDatabase,
  recomputeSiteTwinState,
  seedRealisticSampleData,
} from './server/db.ts';
import { exportDatasetToXlsx, importExcelBuffer, type DatasetKind } from './server/excel.ts';
import {
  runDigitalTwinAgent,
  runIncidentTriageAgent,
  runIncidentTriageChat,
  runMultiAgentChat,
  runProblemManagementAgent,
} from './server/agents.ts';
import type { NocAgentRole, NocChatModelMode } from './src/types/noc.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function formatApiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('GEMINI_API_KEY') || msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
    return { status: 403, message: `${msg} Please check GEMINI_API_KEY in Settings > Secrets.` };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return { status: 429, message: 'Gemini API rate limit or quota reached. Please retry shortly or check your plan in Settings > Secrets.' };
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    return { status: 404, message: `Gemini model unavailable: ${msg}` };
  }
  return { status: 500, message: msg };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/filters', (_req, res) => {
  const regions = (db.prepare('SELECT DISTINCT uk_region FROM sites ORDER BY uk_region ASC').all() as Array<{ uk_region: string }>).map(
    (r) => r.uk_region
  );
  const dnos = (db.prepare('SELECT DISTINCT dno_provider FROM sites ORDER BY dno_provider ASC').all() as Array<{ dno_provider: string }>).map(
    (r) => r.dno_provider
  );
  const categories = (db.prepare('SELECT DISTINCT category FROM incidents ORDER BY category ASC').all() as Array<{ category: string }>).map(
    (r) => r.category
  );
  res.json({ regions, dnos, categories });
});

app.get('/api/overview', (_req, res) => {
  const siteCounts = db
    .prepare(`
      SELECT
        COUNT(*) as totalSites,
        SUM(CASE WHEN twin_status = 'Nominal' THEN 1 ELSE 0 END) as nominalSites,
        SUM(CASE WHEN twin_status = 'Degraded' THEN 1 ELSE 0 END) as degradedSites,
        SUM(CASE WHEN twin_status = 'Critical' THEN 1 ELSE 0 END) as criticalSites,
        SUM(CASE WHEN site_role = 'Hub' THEN 1 ELSE 0 END) as hubSites
      FROM sites
    `)
    .get() as Record<string, number>;

  const incCounts = db
    .prepare(`
      SELECT
        COUNT(*) as totalIncidents,
        SUM(CASE WHEN status IN ('Open', 'In Progress') THEN 1 ELSE 0 END) as openIncidents,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) as resolvedIncidents
      FROM incidents
    `)
    .get() as Record<string, number>;

  const imminentCutoff = new Date(Date.now() + 2 * 3600_000).toISOString();
  const slaRow = db
    .prepare(`
      SELECT COUNT(*) as cnt
      FROM incidents
      WHERE status IN ('Open', 'In Progress') AND sla_deadline <= ?
    `)
    .get(imminentCutoff) as { cnt: number };

  const probCounts = db
    .prepare(`
      SELECT
        COUNT(*) as totalProblems,
        SUM(CASE WHEN status != 'Closed' THEN 1 ELSE 0 END) as openProblems,
        SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) as closedProblems
      FROM problems
    `)
    .get() as Record<string, number>;

  const urgentIncidents = db
    .prepare(`
      SELECT
        i.*,
        s.site_name, s.uk_region, s.dno_provider, s.site_role, s.child_count, s.climbing_required, s.twin_status
      FROM incidents i
      LEFT JOIN sites s ON i.site_id = s.site_id
      WHERE i.status IN ('Open', 'In Progress')
      ORDER BY i.sla_deadline ASC
      LIMIT 12
    `)
    .all();

  const regionalBreakdown = db
    .prepare(`
      SELECT
        s.uk_region as region,
        COUNT(*) as siteCount,
        SUM(s.open_incident_count) as openIncidents,
        SUM(CASE WHEN s.twin_status = 'Critical' THEN 1 ELSE 0 END) as criticalSites
      FROM sites s
      GROUP BY s.uk_region
      ORDER BY openIncidents DESC, siteCount DESC
    `)
    .all();

  const categoryBreakdown = db
    .prepare(`
      SELECT
        category,
        COUNT(*) as count,
        SUM(CASE WHEN status IN ('Open', 'In Progress') THEN 1 ELSE 0 END) as openCount
      FROM incidents
      GROUP BY category
      ORDER BY count DESC
      LIMIT 8
    `)
    .all();

  const repeatOffendersRaw = db
    .prepare(`
      SELECT
        s.site_id, s.site_name, s.uk_region, s.dno_provider, s.site_role, s.child_count,
        s.battery_backup_hours, s.has_generator, s.cooling_solution, s.vendor_hardware, s.twin_status,
        COUNT(i.incident_id) as incident_count,
        SUM(CASE WHEN i.status IN ('Open', 'In Progress') THEN 1 ELSE 0 END) as open_incidents,
        COALESCE(ROUND(AVG(i.mttr_minutes)), 0) as avg_mttr_minutes,
        (
          SELECT i2.category FROM incidents i2
          WHERE i2.site_id = s.site_id
          GROUP BY i2.category
          ORDER BY COUNT(*) DESC LIMIT 1
        ) as top_category,
        (
          SELECT p.problem_id FROM problems p
          WHERE p.site_id = s.site_id AND p.status != 'Closed'
          ORDER BY p.opened_at DESC LIMIT 1
        ) as open_problem_id,
        (
          SELECT p.strategic_recommendation FROM problems p
          WHERE p.site_id = s.site_id AND p.strategic_recommendation IS NOT NULL AND p.strategic_recommendation != ''
          ORDER BY p.opened_at DESC LIMIT 1
        ) as problem_rec,
        (
          SELECT a.summary FROM agent_analyses a
          WHERE a.agent_type = 'problem_management' AND a.entity_id = s.site_id
          ORDER BY a.created_at DESC LIMIT 1
        ) as ai_prob_summary
      FROM sites s
      INNER JOIN incidents i ON i.site_id = s.site_id
      GROUP BY s.site_id
      HAVING incident_count >= 3
      ORDER BY incident_count DESC, s.child_count DESC
      LIMIT 8
    `)
    .all() as Array<Record<string, unknown>>;

  const repeatOffenders = repeatOffendersRaw.map((r) => {
    const fallbackRec =
      r.top_category === 'Power & Battery' || r.top_category === 'DNO Grid Outage'
        ? `Upgrade battery resiliency (${r.battery_backup_hours}h) & ${r.has_generator ? 'ATS starter' : 'install backup generator'}${Number(r.child_count) > 0 ? ` — hub supports ${r.child_count} child sites` : ''}`
        : r.top_category === 'Cooling & HVAC'
          ? `Install Direct Free Cooling retrofit to replace ${r.cooling_solution} and eliminate thermal trips`
          : r.top_category === 'RAN Hardware'
            ? `Conduct ${r.vendor_hardware} reliability review & batch-swap masthead optics`
            : `Deploy dual-path transmission diversity & brace hub microwave link (${r.child_count} child sites)`;
    return {
      ...r,
      has_generator: Boolean(r.has_generator),
      strategic_recommendation: (r.problem_rec as string) || (r.ai_prob_summary as string) || fallbackRec,
    };
  });

  const bounds = getIncidentDateBounds();
  const anchorHourStart = new Date(bounds.maxMs);
  anchorHourStart.setUTCMinutes(0, 0, 0);
  const endWindowMs = anchorHourStart.getTime() + 3600_000;
  const start24hMs = endWindowMs - 24 * 3600_000;
  const start72hMs = endWindowMs - 72 * 3600_000;

  const trend24hResult = computeIncidentTrendBuckets({
    startMs: start24hMs,
    endExclusiveMs: endWindowMs,
    stepMs: 3600_000,
    formatMode: 'hour',
    granularityLabel: '1-hour buckets (UTC)',
  });

  const trend72hResult = computeIncidentTrendBuckets({
    startMs: start72hMs,
    endExclusiveMs: endWindowMs,
    stepMs: 2 * 3600_000,
    formatMode: '2hour',
    granularityLabel: '2-hour buckets (UTC)',
  });

  res.json({
    totals: {
      totalSites: siteCounts.totalSites ?? 0,
      nominalSites: siteCounts.nominalSites ?? 0,
      degradedSites: siteCounts.degradedSites ?? 0,
      criticalSites: siteCounts.criticalSites ?? 0,
      totalIncidents: incCounts.totalIncidents ?? 0,
      openIncidents: incCounts.openIncidents ?? 0,
      resolvedIncidents: incCounts.resolvedIncidents ?? 0,
      slaBreachOrImminent: slaRow.cnt ?? 0,
      totalProblems: probCounts.totalProblems ?? 0,
      openProblems: probCounts.openProblems ?? 0,
      closedProblems: probCounts.closedProblems ?? 0,
      hubSites: siteCounts.hubSites ?? 0,
    },
    dataSource: {
      mode: getMeta('data_mode', 'sample') as 'sample' | 'excel',
      lastUpdated: getMeta('last_updated', new Date().toISOString()),
      sitesSource: getMeta('sites_source', 'Built-in Sample'),
      incidentsSource: getMeta('incidents_source', 'Built-in Sample'),
      problemsSource: getMeta('problems_source', 'Built-in Sample'),
    },
    urgentIncidents,
    regionalBreakdown,
    categoryBreakdown,
    repeatOffenders,
    hourlyTrend24h: trend24hResult.buckets,
    trend72h: trend72hResult.buckets,
    dataBounds: {
      minDate: bounds.minDate,
      maxDate: bounds.maxDate,
    },
  });
});

function getIncidentDateBounds() {
  const nowMs = Date.now();
  const row = db
    .prepare(
      `SELECT
         MIN(opened_at) as minOpened,
         MIN(resolved_at) as minResolved,
         MAX(opened_at) as maxOpened,
         MAX(resolved_at) as maxResolved
       FROM incidents`
    )
    .get() as {
    minOpened: string | null;
    minResolved: string | null;
    maxOpened: string | null;
    maxResolved: string | null;
  };

  const minCandidates = [row.minOpened, row.minResolved]
    .filter((v): v is string => Boolean(v))
    .map((v) => Date.parse(v))
    .filter((ms) => Number.isFinite(ms));
  const maxCandidates = [row.maxOpened, row.maxResolved]
    .filter((v): v is string => Boolean(v))
    .map((v) => Date.parse(v))
    .filter((ms) => Number.isFinite(ms));

  const minMs = minCandidates.length > 0 ? Math.min(...minCandidates) : nowMs - 30 * 86400_000;
  const maxMs = maxCandidates.length > 0 ? Math.max(...maxCandidates) : nowMs;
  return {
    minMs,
    maxMs,
    minDate: new Date(minMs).toISOString().slice(0, 10),
    maxDate: new Date(maxMs).toISOString().slice(0, 10),
  };
}

function computeIncidentTrendBuckets(params: {
  startMs: number;
  endExclusiveMs: number;
  stepMs: number;
  formatMode: 'hour' | '2hour' | 'day' | 'week';
  granularityLabel: string;
}) {
  const { startMs, endExclusiveMs, stepMs, formatMode, granularityLabel } = params;
  const spanMs = Math.max(stepMs, endExclusiveMs - startMs);
  const spanDays = spanMs / 86400_000;
  const bucketCount = Math.max(1, Math.ceil(spanMs / stepMs));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const crossesYear =
    new Date(startMs).getUTCFullYear() !== new Date(endExclusiveMs - 1).getUTCFullYear();

  const buckets = Array.from({ length: bucketCount }, (_, idx) => {
    const bStart = startMs + idx * stepMs;
    const d = new Date(bStart);
    const dayLabel = `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
    const hrLabel = `${String(d.getUTCHours()).padStart(2, '0')}:00`;
    let hourLabel = crossesYear ? `${dayLabel} '${String(d.getUTCFullYear()).slice(-2)}` : dayLabel;
    if (formatMode === 'hour') {
      hourLabel = spanDays <= 1.05 ? hrLabel : `${dayLabel} ${hrLabel}`;
    } else if (formatMode === '2hour') {
      hourLabel = `${dayLabel} ${hrLabel}`;
    } else if (formatMode === 'week') {
      hourLabel = `${dayLabel} '${String(d.getUTCFullYear()).slice(-2)}`;
    }
    return {
      hourLabel,
      isoHour: d.toISOString(),
      opened: 0,
      resolved: 0,
      highSeverity: 0,
    };
  });

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endExclusiveMs).toISOString();

  const rows = db
    .prepare(
      `SELECT opened_at, resolved_at, severity
       FROM incidents
       WHERE (opened_at >= ? AND opened_at < ?)
          OR (resolved_at IS NOT NULL AND resolved_at >= ? AND resolved_at < ?)`
    )
    .all(startIso, endIso, startIso, endIso) as Array<{
    opened_at: string;
    resolved_at: string | null;
    severity: string;
  }>;

  let totalCreated = 0;
  let totalResolved = 0;
  let totalHighSeverity = 0;

  for (const row of rows) {
    const openMs = Date.parse(row.opened_at);
    const isHigh = row.severity === 'P1-Critical' || row.severity === 'P2-High';
    if (Number.isFinite(openMs) && openMs >= startMs && openMs < endExclusiveMs) {
      const idx = Math.floor((openMs - startMs) / stepMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].opened += 1;
        totalCreated += 1;
        if (isHigh) {
          buckets[idx].highSeverity += 1;
          totalHighSeverity += 1;
        }
      }
    }

    if (row.resolved_at) {
      const resMs = Date.parse(row.resolved_at);
      if (Number.isFinite(resMs) && resMs >= startMs && resMs < endExclusiveMs) {
        const idx = Math.floor((resMs - startMs) / stepMs);
        if (idx >= 0 && idx < bucketCount) {
          buckets[idx].resolved += 1;
          totalResolved += 1;
        }
      }
    }
  }

  return {
    granularityLabel,
    totalCreated,
    totalResolved,
    totalHighSeverity,
    buckets,
  };
}

app.get('/api/incidents/trend', (req, res) => {
  const bounds = getIncidentDateBounds();
  const preset = String(req.query.preset ?? '').trim();
  const rawStart = String(req.query.startDate ?? '').trim();
  const rawEnd = String(req.query.endDate ?? '').trim();

  if (preset === '24h' || preset === '72h') {
    const anchorHourStart = new Date(bounds.maxMs);
    anchorHourStart.setUTCMinutes(0, 0, 0);
    const endExclusiveMs = anchorHourStart.getTime() + 3600_000;
    const hours = preset === '24h' ? 24 : 72;
    const stepMs = preset === '24h' ? 3600_000 : 2 * 3600_000;
    const startMs = endExclusiveMs - hours * 3600_000;

    const computed = computeIncidentTrendBuckets({
      startMs,
      endExclusiveMs,
      stepMs,
      formatMode: preset === '24h' ? 'hour' : '2hour',
      granularityLabel: preset === '24h' ? '1-hour buckets (UTC)' : '2-hour buckets (UTC)',
    });

    return res.json({
      startDate: new Date(startMs).toISOString().slice(0, 10),
      endDate: new Date(endExclusiveMs - 1).toISOString().slice(0, 10),
      minDate: bounds.minDate,
      maxDate: bounds.maxDate,
      ...computed,
    });
  }

  const endStr = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? rawEnd : bounds.maxDate;
  const parsedEndDayMs = Date.parse(`${endStr}T00:00:00.000Z`);
  const safeEndDayMs = Number.isFinite(parsedEndDayMs)
    ? parsedEndDayMs
    : Date.parse(`${bounds.maxDate}T00:00:00.000Z`);

  const defaultStartStr = new Date(safeEndDayMs - 2 * 86400_000).toISOString().slice(0, 10);
  const startStr = /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : defaultStartStr;
  const parsedStartDayMs = Date.parse(`${startStr}T00:00:00.000Z`);
  let startMs = Number.isFinite(parsedStartDayMs) ? parsedStartDayMs : safeEndDayMs - 2 * 86400_000;
  const endExclusiveMs = safeEndDayMs + 86400_000;

  if (startMs >= endExclusiveMs) {
    startMs = safeEndDayMs;
  }

  const spanDays = (endExclusiveMs - startMs) / 86400_000;
  let stepMs = 86400_000;
  let granularityLabel = 'Daily buckets (UTC)';
  let formatMode: 'hour' | '2hour' | 'day' | 'week' = 'day';

  if (spanDays <= 1.5) {
    stepMs = 3600_000;
    granularityLabel = '1-hour buckets (UTC)';
    formatMode = 'hour';
  } else if (spanDays <= 4) {
    stepMs = 2 * 3600_000;
    granularityLabel = '2-hour buckets (UTC)';
    formatMode = '2hour';
  } else if (spanDays <= 185) {
    stepMs = 86400_000;
    granularityLabel = 'Daily buckets (UTC)';
    formatMode = 'day';
  } else {
    stepMs = 7 * 86400_000;
    granularityLabel = 'Weekly buckets (UTC)';
    formatMode = 'week';
  }

  const computed = computeIncidentTrendBuckets({
    startMs,
    endExclusiveMs,
    stepMs,
    formatMode,
    granularityLabel,
  });

  res.json({
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date(endExclusiveMs - 1).toISOString().slice(0, 10),
    minDate: bounds.minDate,
    maxDate: bounds.maxDate,
    ...computed,
  });
});

app.get('/api/sites', (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const region = String(req.query.region ?? '').trim();
  const dno = String(req.query.dno ?? '').trim();
  const role = String(req.query.role ?? '').trim();
  const status = String(req.query.status ?? '').trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 40)));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (search) {
    where.push('(site_id LIKE ? OR site_name LIKE ? OR vendor_hardware LIKE ? OR dno_provider LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (region && region !== 'All') {
    where.push('uk_region = ?');
    params.push(region);
  }
  if (dno && dno !== 'All') {
    where.push('dno_provider = ?');
    params.push(dno);
  }
  if (role && role !== 'All') {
    where.push('site_role = ?');
    params.push(role);
  }
  if (status && status !== 'All') {
    where.push('twin_status = ?');
    params.push(status);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM sites ${whereSql}`).get(...params) as { cnt: number };

  const items = (
    db
      .prepare(
        `SELECT * FROM sites ${whereSql}
       ORDER BY
         CASE twin_status WHEN 'Critical' THEN 0 WHEN 'Degraded' THEN 1 ELSE 2 END,
         open_incident_count DESC,
         child_count DESC,
         site_id ASC
       LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>
  ).map((r) => ({
    ...r,
    has_generator: Boolean(r.has_generator),
    climbing_required: Boolean(r.climbing_required),
  }));

  res.json({ items, total: totalRow.cnt, page, limit });
});

app.get('/api/sites/:siteId', (req, res) => {
  const { siteId } = req.params;
  const siteRow = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(siteId) as Record<string, unknown> | undefined;
  if (!siteRow) {
    return res.status(404).json({ error: `Site ${siteId} not found.` });
  }
  const site = {
    ...siteRow,
    has_generator: Boolean(siteRow.has_generator),
    climbing_required: Boolean(siteRow.climbing_required),
  };

  const parentHub = siteRow.parent_hub_id
    ? db
        .prepare('SELECT site_id, site_name, uk_region, twin_status, open_incident_count FROM sites WHERE site_id = ?')
        .get(siteRow.parent_hub_id)
    : null;

  const childSites = db
    .prepare(
      'SELECT site_id, site_name, uk_region, twin_status, open_incident_count, battery_backup_hours FROM sites WHERE parent_hub_id = ? ORDER BY site_id ASC'
    )
    .all(siteId);

  const incidents = db
    .prepare('SELECT * FROM incidents WHERE site_id = ? ORDER BY opened_at DESC LIMIT 50')
    .all(siteId) as Array<Record<string, unknown>>;

  const problems = db
    .prepare('SELECT * FROM problems WHERE site_id = ? ORDER BY opened_at DESC LIMIT 20')
    .all(siteId) as Array<Record<string, unknown>>;

  const analyses = db
    .prepare("SELECT * FROM agent_analyses WHERE agent_type = 'digital_twin' AND entity_id = ? ORDER BY created_at DESC LIMIT 3")
    .all(siteId);

  const problemIds = problems.map((p) => String(p.problem_id));
  const entityCandidates = [siteId, ...problemIds];
  const placeholders = entityCandidates.map(() => '?').join(',');
  const problemAnalysis = db
    .prepare(
      `SELECT * FROM agent_analyses WHERE agent_type = 'problem_management' AND entity_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`
    )
    .get(...entityCandidates) as Record<string, unknown> | undefined;

  const incidentIds = incidents.slice(0, 15).map((i) => String(i.incident_id));
  const triageAnalyses: Record<string, unknown> = {};
  if (incidentIds.length > 0) {
    const incPlaceholders = incidentIds.map(() => '?').join(',');
    const triageRows = db
      .prepare(
        `SELECT entity_id, payload_json FROM agent_analyses WHERE agent_type = 'incident_triage' AND entity_id IN (${incPlaceholders}) ORDER BY created_at DESC`
      )
      .all(...incidentIds) as Array<{ entity_id: string; payload_json: string }>;
    for (const row of triageRows) {
      if (!triageAnalyses[row.entity_id]) {
        try {
          triageAnalyses[row.entity_id] = JSON.parse(row.payload_json);
        } catch {
          // skip malformed
        }
      }
    }
  }

  const topCatRow = db
    .prepare('SELECT category FROM incidents WHERE site_id = ? GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1')
    .get(siteId) as { category?: string } | undefined;
  const topCat = topCatRow?.category ?? 'Transmission & Backhaul';
  const openProbRec = problems.find((p) => p.strategic_recommendation)?.strategic_recommendation as string | undefined;
  const fallbackRec =
    topCat === 'Power & Battery' || topCat === 'DNO Grid Outage'
      ? `Upgrade battery resiliency (${siteRow.battery_backup_hours}h) & ${siteRow.has_generator ? 'ATS starter' : 'install backup generator'}${Number(siteRow.child_count) > 0 ? ` — hub supports ${siteRow.child_count} child sites` : ''}`
      : topCat === 'Cooling & HVAC'
        ? `Install Direct Free Cooling retrofit to replace ${siteRow.cooling_solution} and eliminate thermal trips`
        : topCat === 'RAN Hardware'
          ? `Conduct ${siteRow.vendor_hardware} reliability review & batch-swap masthead optics`
          : `Deploy dual-path transmission diversity & brace hub microwave link (${siteRow.child_count} child sites)`;

  res.json({
    site,
    parentHub,
    childSites,
    incidents,
    problems,
    analyses,
    problemAnalysis: problemAnalysis ?? null,
    triageAnalyses,
    strategicRecommendationSummary:
      openProbRec || (problemAnalysis?.summary as string | undefined) || fallbackRec,
  });
});

app.get('/api/incidents', (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const status = String(req.query.status ?? '').trim();
  const severity = String(req.query.severity ?? '').trim();
  const category = String(req.query.category ?? '').trim();
  const region = String(req.query.region ?? '').trim();
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 50)));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (search) {
    where.push('(i.incident_id LIKE ? OR i.site_id LIKE ? OR i.title LIKE ? OR i.symptom_summary LIKE ? OR s.site_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }
  if (status === 'Active') {
    where.push("i.status IN ('Open', 'In Progress')");
  } else if (status && status !== 'All') {
    where.push('i.status = ?');
    params.push(status);
  }
  if (severity && severity !== 'All') {
    where.push('i.severity = ?');
    params.push(severity);
  }
  if (category && category !== 'All') {
    where.push('i.category = ?');
    params.push(category);
  }
  if (region && region !== 'All') {
    where.push('s.uk_region = ?');
    params.push(region);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM incidents i LEFT JOIN sites s ON i.site_id = s.site_id ${whereSql}`)
    .get(...params) as { cnt: number };

  const items = (
    db
      .prepare(`
      SELECT
        i.*,
        s.site_name, s.uk_region, s.dno_provider, s.site_role, s.child_count, s.climbing_required, s.twin_status
      FROM incidents i
      LEFT JOIN sites s ON i.site_id = s.site_id
      ${whereSql}
      ORDER BY
        CASE WHEN i.status IN ('Open', 'In Progress') THEN 0 ELSE 1 END,
        i.sla_deadline ASC,
        i.opened_at DESC
      LIMIT ? OFFSET ?
    `)
      .all(...params, limit, offset) as Array<Record<string, unknown>>
  ).map((r) => ({
    ...r,
    climbing_required: Boolean(r.climbing_required),
  }));

  res.json({ items, total: totalRow.cnt, page, limit });
});

app.get('/api/incidents/:incidentId', (req, res) => {
  const { incidentId } = req.params;
  const incident = db.prepare('SELECT * FROM incidents WHERE incident_id = ?').get(incidentId) as Record<string, unknown> | undefined;
  if (!incident) {
    return res.status(404).json({ error: `Incident ${incidentId} not found.` });
  }

  const siteRow = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(incident.site_id) as Record<string, unknown> | undefined;
  const site = siteRow
    ? {
        ...siteRow,
        has_generator: Boolean(siteRow.has_generator),
        climbing_required: Boolean(siteRow.climbing_required),
      }
    : null;

  const childSites = siteRow
    ? db.prepare('SELECT site_id, site_name, twin_status FROM sites WHERE parent_hub_id = ?').all(siteRow.site_id)
    : [];

  const pastIncidents = db
    .prepare('SELECT * FROM incidents WHERE site_id = ? AND incident_id != ? ORDER BY opened_at DESC LIMIT 12')
    .all(incident.site_id, incidentId);

  const siteProblems = db
    .prepare('SELECT * FROM problems WHERE site_id = ? ORDER BY opened_at DESC LIMIT 6')
    .all(incident.site_id);

  const analyses = db
    .prepare("SELECT * FROM agent_analyses WHERE agent_type = 'incident_triage' AND entity_id = ? ORDER BY created_at DESC LIMIT 3")
    .all(incidentId);

  res.json({ incident, site, childSites, pastIncidents, siteProblems, analyses });
});

app.post('/api/incidents', async (req, res) => {
  try {
    const {
      site_id,
      title,
      category,
      severity,
      symptom_summary,
      sla_hours,
      assigned_team,
    } = req.body as {
      site_id: string;
      title: string;
      category: string;
      severity: string;
      symptom_summary: string;
      sla_hours?: number;
      assigned_team?: string;
    };

    if (!site_id || !title || !symptom_summary) {
      return res.status(400).json({ error: 'site_id, title, and symptom_summary are required.' });
    }

    const siteExists = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(site_id) as Record<string, unknown> | undefined;
    if (!siteExists) {
      return res.status(404).json({ error: `Site ${site_id} does not exist in Digital Twin registry.` });
    }

    const nowMs = Date.now();
    const openedAt = new Date(nowMs).toISOString();
    const slaHrs = Number.isFinite(Number(sla_hours)) && Number(sla_hours) > 0 ? Number(sla_hours) : severity === 'P1-Critical' ? 2 : 4;
    const slaDeadline = new Date(nowMs + slaHrs * 3600_000).toISOString();
    const incidentId = `INC-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 89999))}`;

    const climbingWarn = siteExists.climbing_required ? ' (climbing cert required)' : '';
    const hubWarn = Number(siteExists.child_count ?? 0) > 0 ? `; hub supports ${siteExists.child_count} child sites` : '';
    const initialFallbackRec = `Dispatch field engineer to ${site_id}${climbingWarn}; act before SLA deadline${hubWarn}.`;

    db.prepare(`
      INSERT INTO incidents (
        incident_id, site_id, title, category, severity, status, symptom_summary,
        sla_deadline, opened_at, resolved_at, mttr_minutes, root_cause,
        linked_problem_id, triage_recommendation, assigned_team
      ) VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
    `).run(
      incidentId,
      site_id,
      title.trim(),
      category || 'Power & Battery',
      severity || 'P1-Critical',
      symptom_summary.trim(),
      slaDeadline,
      openedAt,
      initialFallbackRec,
      assigned_team || 'NOC Tier 1 Triage'
    );

    // Digital Twin Agent automatically updates site state on new incident ingestion
    recomputeSiteTwinState(site_id);

    // Automatically invoke Incident Triage Agent in background/inline so recommendation is ready immediately
    try {
      await runIncidentTriageAgent(incidentId);
    } catch {
      // Keep fallback recommendation if Gemini API key is unavailable or rate-limited
    }

    const created = db
      .prepare(`
        SELECT i.*, s.site_name, s.uk_region, s.dno_provider, s.site_role, s.child_count, s.climbing_required, s.twin_status
        FROM incidents i LEFT JOIN sites s ON i.site_id = s.site_id
        WHERE i.incident_id = ?
      `)
      .get(incidentId);

    const updatedSite = db.prepare('SELECT * FROM sites WHERE site_id = ?').get(site_id);

    res.status(201).json({ incident: created, updatedSite });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.patch('/api/incidents/:incidentId', (req, res) => {
  try {
    const { incidentId } = req.params;
    const existing = db.prepare('SELECT * FROM incidents WHERE incident_id = ?').get(incidentId) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ error: `Incident ${incidentId} not found.` });
    }

    const { status, assigned_team, root_cause, triage_recommendation, linked_problem_id } = req.body as {
      status?: 'Open' | 'In Progress' | 'Resolved';
      assigned_team?: string;
      root_cause?: string;
      triage_recommendation?: string;
      linked_problem_id?: string;
    };

    const nextStatus = status ?? (existing.status as string);
    let resolvedAt = existing.resolved_at as string | null;
    let mttrMinutes = existing.mttr_minutes as number | null;

    if (nextStatus === 'Resolved' && !resolvedAt) {
      resolvedAt = new Date().toISOString();
      mttrMinutes = Math.max(1, Math.round((Date.now() - new Date(existing.opened_at as string).getTime()) / 60_000));
    } else if (nextStatus !== 'Resolved') {
      resolvedAt = null;
      mttrMinutes = null;
    }

    db.prepare(`
      UPDATE incidents
      SET status = ?,
          assigned_team = ?,
          root_cause = ?,
          triage_recommendation = ?,
          linked_problem_id = ?,
          resolved_at = ?,
          mttr_minutes = ?
      WHERE incident_id = ?
    `).run(
      nextStatus,
      assigned_team ?? existing.assigned_team,
      root_cause ?? existing.root_cause,
      triage_recommendation ?? existing.triage_recommendation,
      linked_problem_id ?? existing.linked_problem_id,
      resolvedAt,
      mttrMinutes,
      incidentId
    );

    recomputeSiteTwinState(existing.site_id as string);

    const updated = db
      .prepare(`
        SELECT i.*, s.site_name, s.uk_region, s.dno_provider, s.site_role, s.child_count, s.climbing_required, s.twin_status
        FROM incidents i LEFT JOIN sites s ON i.site_id = s.site_id
        WHERE i.incident_id = ?
      `)
      .get(incidentId);

    res.json({ incident: updated });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/problems', (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const status = String(req.query.status ?? '').trim();

  const where: string[] = [];
  const params: unknown[] = [];

  if (search) {
    where.push('(p.problem_id LIKE ? OR p.site_id LIKE ? OR p.title LIKE ? OR p.vendor_hardware LIKE ? OR s.site_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }
  if (status && status !== 'All') {
    where.push('p.status = ?');
    params.push(status);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const items = db
    .prepare(`
      SELECT
        p.*,
        s.site_name, s.uk_region, s.site_role, s.child_count
      FROM problems p
      LEFT JOIN sites s ON p.site_id = s.site_id
      ${whereSql}
      ORDER BY
        CASE p.status WHEN 'Open' THEN 0 WHEN 'Investigating' THEN 1 ELSE 2 END,
        p.related_incident_count DESC,
        p.opened_at DESC
      LIMIT 150
    `)
    .all(...params);

  res.json({ items });
});

app.get('/api/problems/repeat-offenders', (_req, res) => {
  const items = (
    db
      .prepare(`
      SELECT
        s.site_id, s.site_name, s.uk_region, s.dno_provider, s.site_role, s.child_count,
        s.battery_backup_hours, s.has_generator, s.cooling_solution, s.vendor_hardware, s.twin_status,
        COUNT(i.incident_id) as incident_count,
        SUM(CASE WHEN i.status IN ('Open', 'In Progress') THEN 1 ELSE 0 END) as open_incidents,
        COALESCE(ROUND(AVG(i.mttr_minutes)), 0) as avg_mttr_minutes,
        (
          SELECT i2.category FROM incidents i2
          WHERE i2.site_id = s.site_id
          GROUP BY i2.category
          ORDER BY COUNT(*) DESC LIMIT 1
        ) as top_category,
        (
          SELECT p.problem_id FROM problems p
          WHERE p.site_id = s.site_id AND p.status != 'Closed'
          ORDER BY p.opened_at DESC LIMIT 1
        ) as open_problem_id,
        (
          SELECT p.strategic_recommendation FROM problems p
          WHERE p.site_id = s.site_id AND p.strategic_recommendation IS NOT NULL AND p.strategic_recommendation != ''
          ORDER BY p.opened_at DESC LIMIT 1
        ) as problem_rec,
        (
          SELECT a.summary FROM agent_analyses a
          WHERE a.agent_type = 'problem_management' AND a.entity_id = s.site_id
          ORDER BY a.created_at DESC LIMIT 1
        ) as ai_prob_summary
      FROM sites s
      INNER JOIN incidents i ON i.site_id = s.site_id
      GROUP BY s.site_id
      HAVING incident_count >= 2
      ORDER BY incident_count DESC, s.child_count DESC
      LIMIT 25
    `)
      .all() as Array<Record<string, unknown>>
  ).map((r) => {
    const fallbackRec =
      r.top_category === 'Power & Battery' || r.top_category === 'DNO Grid Outage'
        ? `Upgrade battery resiliency (${r.battery_backup_hours}h) & ${r.has_generator ? 'ATS starter' : 'install backup generator'}${Number(r.child_count) > 0 ? ` — hub supports ${r.child_count} child sites` : ''}`
        : r.top_category === 'Cooling & HVAC'
          ? `Install Direct Free Cooling retrofit to replace ${r.cooling_solution} and eliminate thermal trips`
          : r.top_category === 'RAN Hardware'
            ? `Conduct ${r.vendor_hardware} reliability review & batch-swap masthead optics`
            : `Deploy dual-path transmission diversity & brace hub microwave link (${r.child_count} child sites)`;
    return {
      ...r,
      has_generator: Boolean(r.has_generator),
      strategic_recommendation: (r.problem_rec as string) || (r.ai_prob_summary as string) || fallbackRec,
    };
  });

  res.json({ items });
});

app.get('/api/problems/analysis/:entityId', (req, res) => {
  const { entityId } = req.params;
  const row = db
    .prepare("SELECT * FROM agent_analyses WHERE agent_type = 'problem_management' AND entity_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(entityId) as { payload_json?: string } | undefined;
  if (!row?.payload_json) {
    return res.json({ result: null });
  }
  try {
    return res.json({ result: JSON.parse(row.payload_json) });
  } catch {
    return res.json({ result: null });
  }
});

app.post('/api/problems', (req, res) => {
  try {
    const {
      site_id,
      title,
      category,
      five_why_analysis,
      permanent_fix,
      strategic_recommendation,
      justification,
      status,
    } = req.body as {
      site_id: string;
      title: string;
      category: string;
      five_why_analysis: string;
      permanent_fix?: string;
      strategic_recommendation?: string;
      justification?: string;
      status?: 'Open' | 'Investigating' | 'Closed';
    };

    if (!site_id || !title) {
      return res.status(400).json({ error: 'site_id and title are required.' });
    }

    const site = db.prepare('SELECT vendor_hardware, total_incident_count FROM sites WHERE site_id = ?').get(site_id) as
      | { vendor_hardware: string; total_incident_count: number }
      | undefined;

    const problemId = `PRB-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 8999))}`;
    const nowIso = new Date().toISOString();
    const nextStatus = status || 'Investigating';

    db.prepare(`
      INSERT INTO problems (
        problem_id, site_id, title, category, status, related_incident_count,
        vendor_hardware, five_why_analysis, permanent_fix, strategic_recommendation,
        justification, opened_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      problemId,
      site_id,
      title.trim(),
      category || 'Infrastructure Reliability',
      nextStatus,
      site?.total_incident_count ?? 1,
      site?.vendor_hardware ?? '',
      five_why_analysis || '',
      permanent_fix || null,
      strategic_recommendation || null,
      justification || null,
      nowIso,
      nextStatus === 'Closed' ? nowIso : null
    );

    recomputeSiteTwinState(site_id);

    const created = db
      .prepare('SELECT p.*, s.site_name, s.uk_region, s.site_role, s.child_count FROM problems p LEFT JOIN sites s ON p.site_id = s.site_id WHERE p.problem_id = ?')
      .get(problemId);

    res.status(201).json({ problem: created });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.patch('/api/problems/:problemId', (req, res) => {
  try {
    const { problemId } = req.params;
    const existing = db.prepare('SELECT * FROM problems WHERE problem_id = ?').get(problemId) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ error: `Problem ${problemId} not found.` });
    }

    const { status, five_why_analysis, permanent_fix, strategic_recommendation, justification } = req.body as {
      status?: 'Open' | 'Investigating' | 'Closed';
      five_why_analysis?: string;
      permanent_fix?: string;
      strategic_recommendation?: string;
      justification?: string;
    };

    const nextStatus = status ?? (existing.status as string);
    const closedAt = nextStatus === 'Closed' ? (existing.closed_at as string | null) ?? new Date().toISOString() : null;

    db.prepare(`
      UPDATE problems
      SET status = ?,
          five_why_analysis = ?,
          permanent_fix = ?,
          strategic_recommendation = ?,
          justification = ?,
          closed_at = ?
      WHERE problem_id = ?
    `).run(
      nextStatus,
      five_why_analysis ?? existing.five_why_analysis,
      permanent_fix ?? existing.permanent_fix,
      strategic_recommendation ?? existing.strategic_recommendation,
      justification ?? existing.justification,
      closedAt,
      problemId
    );

    recomputeSiteTwinState(existing.site_id as string);

    const updated = db
      .prepare('SELECT p.*, s.site_name, s.uk_region, s.site_role, s.child_count FROM problems p LEFT JOIN sites s ON p.site_id = s.site_id WHERE p.problem_id = ?')
      .get(problemId);

    res.json({ problem: updated });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

// Multi-Agent AI Routes
app.post('/api/agents/digital-twin', async (req, res) => {
  try {
    const { site_id } = req.body as { site_id: string };
    if (!site_id) return res.status(400).json({ error: 'site_id is required.' });
    const result = await runDigitalTwinAgent(site_id);
    res.json({ result });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/agents/triage', async (req, res) => {
  try {
    const { incident_id } = req.body as { incident_id: string };
    if (!incident_id) return res.status(400).json({ error: 'incident_id is required.' });
    const result = await runIncidentTriageAgent(incident_id);
    res.json({ result });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/agents/triage/chat', async (req, res) => {
  try {
    const { incident_id, history, question } = req.body as {
      incident_id: string;
      history: Array<{ role: 'user' | 'model'; text: string }>;
      question: string;
    };
    if (!incident_id || !question) {
      return res.status(400).json({ error: 'incident_id and question are required.' });
    }
    const answer = await runIncidentTriageChat(incident_id, history ?? [], question);
    res.json({ answer });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/agents/problem-management', async (req, res) => {
  try {
    const { site_id, problem_id } = req.body as { site_id?: string; problem_id?: string };
    const result = await runProblemManagementAgent({ siteId: site_id, problemId: problem_id });
    res.json({ result });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/agents/chat', async (req, res) => {
  try {
    const { agentRole, history, message, modelMode } = req.body as {
      agentRole?: NocAgentRole;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      message?: string;
      modelMode?: NocChatModelMode;
    };
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required.' });
    }
    const { answer, model } = await runMultiAgentChat({
      agentRole: agentRole || 'coordinator',
      history: history ?? [],
      message: message.trim(),
      modelMode: modelMode === 'fast' ? 'fast' : 'standard',
    });
    res.json({ answer, model });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/agents/triage-batch', async (req, res) => {
  try {
    const limit = Math.min(8, Math.max(1, Number(req.body?.limit ?? 5)));
    const targets = db
      .prepare(`
        SELECT i.incident_id
        FROM incidents i
        WHERE i.status IN ('Open', 'In Progress')
          AND NOT EXISTS (
            SELECT 1 FROM agent_analyses a
            WHERE a.agent_type = 'incident_triage' AND a.entity_id = i.incident_id
          )
        ORDER BY i.sla_deadline ASC
        LIMIT ?
      `)
      .all(limit) as Array<{ incident_id: string }>;

    let analyzed = 0;
    for (const t of targets) {
      try {
        await runIncidentTriageAgent(t.incident_id);
        analyzed++;
      } catch {
        break;
      }
    }
    res.json({ analyzed, attempted: targets.length });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

// Excel Data Hub Routes
app.get('/api/excel/status', (_req, res) => {
  const sitesCount = (db.prepare('SELECT COUNT(*) as c FROM sites').get() as { c: number }).c;
  const incStats = db
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('Open', 'In Progress') THEN 1 ELSE 0 END) as openCnt,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) as resCnt
      FROM incidents
    `)
    .get() as { total: number; openCnt: number; resCnt: number };
  const probStats = db
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status != 'Closed' THEN 1 ELSE 0 END) as openCnt,
        SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) as closedCnt
      FROM problems
    `)
    .get() as { total: number; openCnt: number; closedCnt: number };

  res.json({
    mode: getMeta('data_mode', 'sample') as 'sample' | 'excel',
    lastUpdated: getMeta('last_updated', new Date().toISOString()),
    sites: { count: sitesCount, source: getMeta('sites_source', 'Built-in Sample') },
    incidents: {
      count: incStats.total ?? 0,
      openCount: incStats.openCnt ?? 0,
      resolvedCount: incStats.resCnt ?? 0,
      source: getMeta('incidents_source', 'Built-in Sample'),
    },
    problems: {
      count: probStats.total ?? 0,
      openCount: probStats.openCnt ?? 0,
      closedCount: probStats.closedCnt ?? 0,
      source: getMeta('problems_source', 'Built-in Sample'),
    },
  });
});

app.post('/api/excel/upload', upload.single('file'), (req, res) => {
  try {
    const dataset = String(req.body.dataset ?? '') as DatasetKind;
    const mode = req.body.mode === 'merge' ? 'merge' : 'replace';

    if (!['sites', 'incidents', 'problems'].includes(dataset)) {
      return res.status(400).json({ error: 'Invalid dataset type. Must be sites, incidents, or problems.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file uploaded.' });
    }

    const summary = importExcelBuffer(dataset, req.file.buffer, req.file.originalname, mode);

    // Kick off non-blocking background Gemini triage for top open incidents lacking AI recommendations
    const openToAnalyze = db
      .prepare(`
        SELECT incident_id FROM incidents
        WHERE status IN ('Open', 'In Progress')
          AND (triage_recommendation IS NULL OR triage_recommendation = '')
        ORDER BY sla_deadline ASC
        LIMIT 5
      `)
      .all() as Array<{ incident_id: string }>;

    if (openToAnalyze.length > 0) {
      void (async () => {
        for (const row of openToAnalyze) {
          try {
            await runIncidentTriageAgent(row.incident_id);
          } catch {
            break;
          }
        }
      })();
    }

    res.json({ summary });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/excel/reset-sample', (_req, res) => {
  try {
    seedRealisticSampleData();
    res.json({ ok: true });
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

app.get('/api/excel/export/:dataset', (req, res) => {
  try {
    const dataset = req.params.dataset as DatasetKind | 'all';
    if (!['sites', 'incidents', 'problems', 'all'].includes(dataset)) {
      return res.status(400).json({ error: 'Invalid export dataset.' });
    }
    const { buffer, filename } = exportDatasetToXlsx(dataset);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Telecom NOC Multi-Agent Platform running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
