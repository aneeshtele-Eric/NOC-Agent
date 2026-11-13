import * as XLSX from 'xlsx';
import { db, recomputeAllSiteTwins, setMeta } from './db.ts';

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 90000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function makeSafeUtcIso(year: number, monthIndex: number, day: number, hour = 0, minute = 0, second = 0): string | null {
  if (year < 1990 || year > 2100 || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const d = new Date(Date.UTC(year, monthIndex, day, hour, minute, second));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== monthIndex ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d.toISOString();
}

function detectPreferDayFirst(rows: Array<Record<string, unknown>>): boolean {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  const limit = Math.min(rows.length, 500);
  for (let i = 0; i < limit; i++) {
    for (const val of Object.values(rows[i])) {
      if (typeof val !== 'string') continue;
      const m = val.trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s|$)/);
      if (!m) continue;
      const p1 = Number(m[1]);
      const p2 = Number(m[2]);
      if (p1 > 12 && p2 <= 12) dayFirstEvidence++;
      else if (p2 > 12 && p1 <= 12) monthFirstEvidence++;
    }
  }
  if (monthFirstEvidence > 0 && dayFirstEvidence === 0) return false;
  return true;
}

export function parseFlexibleDateIso(val: unknown, preferDayFirst = true): string | null {
  if (val === undefined || val === null) return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    const yr = val.getUTCFullYear();
    return yr >= 1990 && yr <= 2100 ? val.toISOString() : null;
  }
  if (typeof val === 'number') {
    return excelSerialToIso(val);
  }
  const s = String(val).trim();
  if (!s) return null;

  // Numeric Excel serial stored as string (e.g. "46295.5")
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serialIso = excelSerialToIso(Number(s));
    if (serialIso) return serialIso;
  }

  // 1. ISO-style YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD with optional time & optional offset
  const isoMatch = s.match(
    /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:\s*(AM|PM))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?$/i
  );
  if (isoMatch) {
    const [, yStr, mStr, dStr, hStr, minStr, secStr, , ampm, tz] = isoMatch;
    if (tz) {
      const normalized = s.includes('T') ? s : s.replace(' ', 'T');
      const d = new Date(normalized);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    let hour = hStr ? Number(hStr) : 0;
    const minute = minStr ? Number(minStr) : 0;
    const second = secStr ? Number(secStr) : 0;
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'PM' && hour < 12) hour += 12;
      if (upper === 'AM' && hour === 12) hour = 0;
    }
    const iso = makeSafeUtcIso(Number(yStr), Number(mStr) - 1, Number(dStr), hour, minute, second);
    if (iso) return iso;
  }

  // 2. Numeric DD/MM/YYYY or MM/DD/YYYY (supports /, -, .) with optional time
  const dmyMatch = s.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i
  );
  if (dmyMatch) {
    const [, p1Str, p2Str, yStr, hStr, minStr, secStr, ampm] = dmyMatch;
    const p1 = Number(p1Str);
    const p2 = Number(p2Str);
    let year = Number(yStr);
    if (yStr.length === 2) year += year >= 70 ? 1900 : 2000;

    let day = preferDayFirst ? p1 : p2;
    let month = preferDayFirst ? p2 : p1;
    if (month > 12 && day <= 12) {
      const tmp = day;
      day = month;
      month = tmp;
    }

    let hour = hStr ? Number(hStr) : 0;
    const minute = minStr ? Number(minStr) : 0;
    const second = secStr ? Number(secStr) : 0;
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'PM' && hour < 12) hour += 12;
      if (upper === 'AM' && hour === 12) hour = 0;
    }
    const iso = makeSafeUtcIso(year, month - 1, day, hour, minute, second);
    if (iso) return iso;
  }

  // 3. Named month format: e.g. "14-Oct-2026 09:30" or "14 Oct 2026"
  const namedDmy = s.match(
    /^(\d{1,2})[\s\/-]+([A-Za-z]+)[\s\/-]+(\d{2,4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i
  );
  if (namedDmy) {
    const [, dStr, monStr, yStr, hStr, minStr, secStr, ampm] = namedDmy;
    const monthIdx = MONTH_MAP[monStr.toLowerCase()];
    if (monthIdx !== undefined) {
      let year = Number(yStr);
      if (yStr.length === 2) year += year >= 70 ? 1900 : 2000;
      let hour = hStr ? Number(hStr) : 0;
      const minute = minStr ? Number(minStr) : 0;
      const second = secStr ? Number(secStr) : 0;
      if (ampm) {
        const upper = ampm.toUpperCase();
        if (upper === 'PM' && hour < 12) hour += 12;
        if (upper === 'AM' && hour === 12) hour = 0;
      }
      const iso = makeSafeUtcIso(year, monthIdx, Number(dStr), hour, minute, second);
      if (iso) return iso;
    }
  }

  // 4. Fallback native parse for RFC/ISO timestamps with explicit timezone or month names
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() >= 1990 && parsed.getUTCFullYear() <= 2100) {
    return parsed.toISOString();
  }
  return null;
}

function createRowAccessor(rawRow: Record<string, unknown>, preferDayFirst = true) {
  const entries: Array<[string, unknown]> = [];
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(rawRow)) {
    const nk = normalizeKey(k);
    map.set(nk, v);
    entries.push([nk, v]);
  }
  const get = (...candidates: string[]): unknown => {
    for (const c of candidates) {
      const val = map.get(normalizeKey(c));
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
    // Partial header match fallback (e.g. "SI Start Time (UTC)" -> "sistarttimeutc")
    for (const c of candidates) {
      const nc = normalizeKey(c);
      if (nc.length < 5) continue;
      for (const [nk, val] of entries) {
        if ((nk.startsWith(nc) || nk.includes(nc)) && val !== undefined && val !== null && String(val).trim() !== '') {
          return val;
        }
      }
    }
    return undefined;
  };
  const getStr = (fallback: string, ...candidates: string[]): string => {
    const val = get(...candidates);
    return val !== undefined ? String(val).trim() : fallback;
  };
  const getNum = (fallback: number, ...candidates: string[]): number => {
    const val = get(...candidates);
    if (val === undefined) return fallback;
    const parsed = Number(String(val).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const getBool = (...candidates: string[]): number => {
    const val = get(...candidates);
    if (val === undefined) return 0;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'number') return val > 0 ? 1 : 0;
    const s = String(val).trim().toLowerCase();
    return ['yes', 'true', '1', 'y', 'required', 'present', 'active'].includes(s) ? 1 : 0;
  };
  const getDateIso = (fallbackIso: string | null, ...candidates: string[]): { iso: string | null; usedFallback: boolean } => {
    const val = get(...candidates);
    if (val === undefined) return { iso: fallbackIso, usedFallback: true };
    const parsed = parseFlexibleDateIso(val, preferDayFirst);
    if (parsed) return { iso: parsed, usedFallback: false };
    return { iso: fallbackIso, usedFallback: true };
  };

  return { get, getStr, getNum, getBool, getDateIso };
}

function normalizeSeverity(raw: string): 'P1-Critical' | 'P2-High' | 'P3-Medium' | 'P4-Low' {
  const s = raw.toLowerCase();
  if (s.includes('p1') || s.includes('crit') || s === '1' || s.includes('sev1')) return 'P1-Critical';
  if (s.includes('p2') || s.includes('high') || s === '2' || s.includes('sev2') || s.includes('maj')) return 'P2-High';
  if (s.includes('p4') || s.includes('low') || s === '4' || s.includes('sev4')) return 'P4-Low';
  return 'P3-Medium';
}

function normalizeIncidentStatus(raw: string): 'Open' | 'In Progress' | 'Resolved' {
  const s = raw.toLowerCase();
  if (s.includes('res') || s.includes('clos') || s.includes('comp') || s.includes('fix')) return 'Resolved';
  if (s.includes('prog') || s.includes('assign') || s.includes('disp') || s.includes('ack')) return 'In Progress';
  return 'Open';
}

function normalizeProblemStatus(raw: string): 'Open' | 'Investigating' | 'Closed' {
  const s = raw.toLowerCase();
  if (s.includes('clos') || s.includes('res') || s.includes('fix') || s.includes('verif')) return 'Closed';
  if (s.includes('inv') || s.includes('prog') || s.includes('rca')) return 'Investigating';
  return 'Open';
}

function normalizeSiteRole(raw: string, hasParent: boolean): 'Hub' | 'Child' | 'Standalone' {
  const s = raw.toLowerCase();
  if (s.includes('hub') || s.includes('agg') || s.includes('core')) return 'Hub';
  if (s.includes('child') || s.includes('spoke') || s.includes('dep') || hasParent) return 'Child';
  return 'Standalone';
}

export type DatasetKind = 'sites' | 'incidents' | 'problems';

export interface ImportSummary {
  dataset: DatasetKind;
  fileName: string;
  mode: 'replace' | 'merge';
  importedRows: number;
  skippedRows: number;
  minDate?: string;
  maxDate?: string;
  fallbackDatesCount?: number;
}

export function importExcelBuffer(
  dataset: DatasetKind,
  buffer: Buffer,
  fileName: string,
  mode: 'replace' | 'merge'
): ImportSummary {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`No worksheet found in ${fileName}`);
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });

  if (rows.length === 0) {
    throw new Error(`Worksheet "${sheetName}" in ${fileName} is empty.`);
  }

  const preferDayFirst = detectPreferDayFirst(rows);
  const nowIso = new Date().toISOString();
  let imported = 0;
  let skipped = 0;
  let fallbackDatesCount = 0;
  let minDateSeen: string | undefined;
  let maxDateSeen: string | undefined;

  if (dataset === 'sites') {
    const tx = db.transaction(() => {
      if (mode === 'replace') {
        db.prepare('DELETE FROM sites').run();
      }
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO sites (
          site_id, site_name, uk_region, latitude, longitude, dno_provider,
          power_type, battery_backup_hours, has_generator, cooling_solution,
          site_role, parent_hub_id, child_count, climbing_required, access_notes,
          vendor_hardware, twin_status, open_incident_count, total_incident_count, last_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'Nominal', 0, 0, ?)
      `);

      for (let i = 0; i < rows.length; i++) {
        const acc = createRowAccessor(rows[i], preferDayFirst);
        const siteId = acc.getStr('', 'site_id', 'siteid', 'site_code', 'id', 'cell_id', 'node_id');
        if (!siteId) {
          skipped++;
          continue;
        }
        const siteName = acc.getStr(siteId, 'site_name', 'sitename', 'name', 'location_name', 'town');
        const ukRegion = acc.getStr('UK National', 'uk_region', 'region', 'area', 'territory');
        const latRaw = acc.get('latitude', 'lat');
        const lonRaw = acc.get('longitude', 'lon', 'lng', 'long');
        const lat = latRaw !== undefined && Number.isFinite(Number(latRaw)) ? Number(latRaw) : null;
        const lon = lonRaw !== undefined && Number.isFinite(Number(lonRaw)) ? Number(lonRaw) : null;
        const dno = acc.getStr('UK Power Networks', 'dno_provider', 'dno', 'power_provider', 'utility', 'electricity_provider');
        const powerType = acc.getStr('AC Mains + DC Rectifier', 'power_type', 'power_supply', 'power_architecture');
        const batteryHours = acc.getNum(4, 'battery_backup_hours', 'battery_hours', 'battery_autonomy', 'battery_backup', 'battery');
        const hasGen = acc.getBool('has_generator', 'generator', 'generator_backup', 'diesel_generator', 'backup_generator');
        const cooling = acc.getStr('Direct Free Cooling', 'cooling_solution', 'cooling', 'hvac', 'cooling_type');
        const parentHubRaw = acc.getStr('', 'parent_hub_id', 'hub_site_id', 'parent_site', 'hub_id', 'parent_hub', 'transmission_hub');
        const parentHub = parentHubRaw && parentHubRaw.toLowerCase() !== 'none' && parentHubRaw !== '-' ? parentHubRaw : null;
        const roleRaw = acc.getStr('', 'site_role', 'transmission_role', 'role', 'site_type', 'topology_role', 'hub_or_child');
        const siteRole = normalizeSiteRole(roleRaw, Boolean(parentHub));
        const climbing = acc.getBool('climbing_required', 'climbing', 'tower_climb', 'rigging_required');
        const accessNotes = acc.getStr('Standard compound access', 'access_notes', 'access', 'site_access', 'notes');
        const vendor = acc.getStr('Ericsson RAN 6630', 'vendor_hardware', 'vendor', 'hardware_vendor', 'equipment_vendor', 'ran_vendor');

        stmt.run(
          siteId,
          siteName,
          ukRegion,
          lat,
          lon,
          dno,
          powerType,
          batteryHours,
          hasGen,
          cooling,
          siteRole,
          parentHub,
          climbing,
          accessNotes,
          vendor,
          nowIso
        );
        imported++;
      }
    });
    tx();
    setMeta('sites_source', `${fileName} (${imported} rows)`);
  } else if (dataset === 'incidents') {
    const tx = db.transaction(() => {
      if (mode === 'replace') {
        db.prepare('DELETE FROM incidents').run();
      }
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO incidents (
          incident_id, site_id, title, category, severity, status, symptom_summary,
          sla_deadline, opened_at, resolved_at, mttr_minutes, root_cause,
          linked_problem_id, triage_recommendation, assigned_team
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < rows.length; i++) {
        const acc = createRowAccessor(rows[i], preferDayFirst);
        const incidentId = acc.getStr(`INC-XLS-${i + 1}`, 'incident_id', 'ticket_id', 'id', 'inc_id', 'ticket_number', 'si_id', 'si_number');
        const siteId = acc.getStr('', 'site_id', 'siteid', 'site_code', 'node_id');
        if (!siteId) {
          skipped++;
          continue;
        }
        const category = acc.getStr('Network Fault', 'category', 'fault_category', 'domain', 'incident_type', 'type');
        const title = acc.getStr(`${category} on ${siteId}`, 'title', 'summary', 'short_description', 'incident_title', 'alarm_name');
        const severity = normalizeSeverity(acc.getStr('P2-High', 'severity', 'priority', 'sev', 'impact'));
        const status = normalizeIncidentStatus(acc.getStr('Open', 'status', 'state', 'ticket_status'));
        const symptom = acc.getStr(title, 'symptom_summary', 'symptoms', 'description', 'symptom', 'alarm_details', 'details');

        const openedRes = acc.getDateIso(
          nowIso,
          'si_start_time',
          'sistarttime',
          'si_start',
          'si_start_date',
          'sistartdate',
          'si_start_datetime',
          'opened_at',
          'created_at',
          'created_date',
          'created_on',
          'created',
          'open_time',
          'open_date',
          'opened_date',
          'opened',
          'start_time',
          'start_date',
          'incident_start_time',
          'incident_start',
          'fault_start_time',
          'fault_start',
          'raised_at',
          'raised_date',
          'reported_at',
          'date'
        );
        const openedAt = openedRes.iso || nowIso;
        if (openedRes.usedFallback) fallbackDatesCount++;

        const defaultSla = new Date(new Date(openedAt).getTime() + 4 * 3600_000).toISOString();
        const slaRes = acc.getDateIso(defaultSla, 'sla_deadline', 'sla_due', 'sla_target', 'due_date', 'sla');
        const slaDeadline = slaRes.iso || defaultSla;

        const resolvedRes = acc.getDateIso(
          null,
          'si_end_time',
          'siendtime',
          'si_end',
          'si_end_date',
          'sienddate',
          'si_end_datetime',
          'resolved_at',
          'resolved_date',
          'resolved_on',
          'resolved',
          'closed_at',
          'closed_date',
          'closed_on',
          'closed',
          'close_time',
          'restored_at',
          'restored_time',
          'restoration_time',
          'restoration_date',
          'end_time',
          'end_date',
          'incident_end_time',
          'incident_end',
          'fault_end_time',
          'fault_end',
          'cleared_at',
          'clear_time',
          'resolution_time'
        );

        const mttrRaw = acc.get('mttr_minutes', 'mttr', 'resolution_minutes', 'duration_minutes', 'restoration_duration');
        let mttr: number | null = mttrRaw !== undefined && Number.isFinite(Number(mttrRaw)) ? Math.round(Number(mttrRaw)) : null;

        let resolvedAt = resolvedRes.iso;
        if (!resolvedAt && status === 'Resolved' && mttr !== null && mttr >= 0) {
          resolvedAt = new Date(new Date(openedAt).getTime() + mttr * 60_000).toISOString();
        }
        if (mttr === null && resolvedAt) {
          const diffMins = Math.round((new Date(resolvedAt).getTime() - new Date(openedAt).getTime()) / 60_000);
          if (diffMins >= 0) mttr = diffMins;
        }

        const openDay = openedAt.slice(0, 10);
        if (!minDateSeen || openDay < minDateSeen) minDateSeen = openDay;
        if (!maxDateSeen || openDay > maxDateSeen) maxDateSeen = openDay;
        if (resolvedAt) {
          const resDay = resolvedAt.slice(0, 10);
          if (!minDateSeen || resDay < minDateSeen) minDateSeen = resDay;
          if (!maxDateSeen || resDay > maxDateSeen) maxDateSeen = resDay;
        }

        const rootCause = acc.getStr('', 'root_cause', 'rca', 'cause', 'resolution_notes') || null;
        const linkedProblem = acc.getStr('', 'linked_problem_id', 'problem_id', 'prb_id') || null;
        const triageRec = acc.getStr('', 'triage_recommendation', 'recommended_action', 'next_action') || null;
        const assignedTeam = acc.getStr('NOC Tier 1', 'assigned_team', 'team', 'assignee', 'dispatch_team') || null;

        stmt.run(
          incidentId,
          siteId,
          title,
          category,
          severity,
          status,
          symptom,
          slaDeadline,
          openedAt,
          resolvedAt,
          mttr,
          rootCause,
          linkedProblem,
          triageRec,
          assignedTeam
        );
        imported++;
      }
    });
    tx();
    setMeta('incidents_source', `${fileName} (${imported} rows)`);
  } else {
    const tx = db.transaction(() => {
      if (mode === 'replace') {
        db.prepare('DELETE FROM problems').run();
      }
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO problems (
          problem_id, site_id, title, category, status, related_incident_count,
          vendor_hardware, five_why_analysis, permanent_fix, strategic_recommendation,
          justification, opened_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < rows.length; i++) {
        const acc = createRowAccessor(rows[i], preferDayFirst);
        const problemId = acc.getStr(`PRB-XLS-${i + 1}`, 'problem_id', 'prb_id', 'ticket_id', 'id');
        const siteId = acc.getStr('', 'site_id', 'siteid', 'site_code', 'primary_site');
        if (!siteId) {
          skipped++;
          continue;
        }
        const category = acc.getStr('Infrastructure Reliability', 'category', 'problem_category', 'domain', 'type');
        const title = acc.getStr(`Problem Investigation: ${siteId}`, 'title', 'summary', 'problem_summary', 'description');
        const status = normalizeProblemStatus(acc.getStr('Open', 'status', 'state', 'problem_status'));
        const relatedCnt = acc.getNum(1, 'related_incident_count', 'incident_count', 'linked_incidents', 'occurrences');
        const vendor = acc.getStr('', 'vendor_hardware', 'vendor', 'hardware', 'equipment');
        const fiveWhy = acc.getStr('', 'five_why_analysis', 'five_why', '5_why', 'rca', 'root_cause_analysis', 'root_cause');
        const permFix = acc.getStr('', 'permanent_fix', 'verified_fix', 'fix', 'resolution') || null;
        const stratRec = acc.getStr('', 'strategic_recommendation', 'recommendation', 'advisory') || null;
        const justification = acc.getStr('', 'justification', 'rationale', 'business_case') || null;
        const openedAt = acc.getDateIso(nowIso, 'opened_at', 'created_at', 'si_start_time', 'date').iso || nowIso;
        const closedAt = status === 'Closed' ? acc.getDateIso(null, 'closed_at', 'resolved_at', 'si_end_time').iso : null;

        stmt.run(
          problemId,
          siteId,
          title,
          category,
          status,
          relatedCnt,
          vendor,
          fiveWhy,
          permFix,
          stratRec,
          justification,
          openedAt,
          closedAt
        );
        imported++;
      }
    });
    tx();
    setMeta('problems_source', `${fileName} (${imported} rows)`);
  }

  setMeta('data_mode', 'excel');
  setMeta('last_updated', nowIso);
  recomputeAllSiteTwins();

  return {
    dataset,
    fileName,
    mode,
    importedRows: imported,
    skippedRows: skipped,
    minDate: minDateSeen,
    maxDate: maxDateSeen,
    fallbackDatesCount,
  };
}

export function exportDatasetToXlsx(dataset: DatasetKind | 'all'): { buffer: Buffer; filename: string } {
  const wb = XLSX.utils.book_new();
  const dateStamp = new Date().toISOString().slice(0, 10);

  if (dataset === 'sites' || dataset === 'all') {
    const sites = db.prepare('SELECT * FROM sites ORDER BY site_id ASC').all();
    const ws = XLSX.utils.json_to_sheet(sites);
    XLSX.utils.book_append_sheet(wb, ws, 'Sites_Digital_Twins');
  }

  if (dataset === 'incidents' || dataset === 'all') {
    const incidents = db.prepare('SELECT * FROM incidents ORDER BY opened_at DESC').all();
    const ws = XLSX.utils.json_to_sheet(incidents);
    XLSX.utils.book_append_sheet(wb, ws, 'Incidents');
  }

  if (dataset === 'problems' || dataset === 'all') {
    const problems = db.prepare('SELECT * FROM problems ORDER BY opened_at DESC').all();
    const ws = XLSX.utils.json_to_sheet(problems);
    XLSX.utils.book_append_sheet(wb, ws, 'Problems');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const filename =
    dataset === 'all'
      ? `telecom_noc_full_export_${dateStamp}.xlsx`
      : `telecom_${dataset}_export_${dateStamp}.xlsx`;

  return { buffer, filename };
}
