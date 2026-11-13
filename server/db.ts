import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'noc_platform.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      site_id TEXT PRIMARY KEY,
      site_name TEXT NOT NULL,
      uk_region TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      dno_provider TEXT NOT NULL,
      power_type TEXT NOT NULL DEFAULT 'AC Mains + DC Rectifier',
      battery_backup_hours REAL NOT NULL DEFAULT 4,
      has_generator INTEGER NOT NULL DEFAULT 0,
      cooling_solution TEXT NOT NULL DEFAULT 'Direct Free Cooling',
      site_role TEXT NOT NULL DEFAULT 'Standalone',
      parent_hub_id TEXT,
      child_count INTEGER NOT NULL DEFAULT 0,
      climbing_required INTEGER NOT NULL DEFAULT 0,
      access_notes TEXT NOT NULL DEFAULT '',
      vendor_hardware TEXT NOT NULL DEFAULT 'Ericsson RAN 6630',
      twin_status TEXT NOT NULL DEFAULT 'Nominal',
      open_incident_count INTEGER NOT NULL DEFAULT 0,
      total_incident_count INTEGER NOT NULL DEFAULT 0,
      last_updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sites_region ON sites(uk_region);
    CREATE INDEX IF NOT EXISTS idx_sites_dno ON sites(dno_provider);
    CREATE INDEX IF NOT EXISTS idx_sites_role ON sites(site_role);
    CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(twin_status);
    CREATE INDEX IF NOT EXISTS idx_sites_parent ON sites(parent_hub_id);

    CREATE TABLE IF NOT EXISTS incidents (
      incident_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      symptom_summary TEXT NOT NULL,
      sla_deadline TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      resolved_at TEXT,
      mttr_minutes INTEGER,
      root_cause TEXT,
      linked_problem_id TEXT,
      triage_recommendation TEXT,
      assigned_team TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inc_site ON incidents(site_id);
    CREATE INDEX IF NOT EXISTS idx_inc_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_inc_severity ON incidents(severity);
    CREATE INDEX IF NOT EXISTS idx_inc_sla ON incidents(sla_deadline);
    CREATE INDEX IF NOT EXISTS idx_inc_opened ON incidents(opened_at);

    CREATE TABLE IF NOT EXISTS problems (
      problem_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      related_incident_count INTEGER NOT NULL DEFAULT 0,
      vendor_hardware TEXT NOT NULL DEFAULT '',
      five_why_analysis TEXT NOT NULL DEFAULT '',
      permanent_fix TEXT,
      strategic_recommendation TEXT,
      justification TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_prob_site ON problems(site_id);
    CREATE INDEX IF NOT EXISTS idx_prob_status ON problems(status);

    CREATE TABLE IF NOT EXISTS agent_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_entity ON agent_analyses(agent_type, entity_id);

    CREATE TABLE IF NOT EXISTS dataset_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const siteCountRow = db.prepare('SELECT COUNT(*) as cnt FROM sites').get() as { cnt: number };
  if (siteCountRow.cnt === 0) {
    seedRealisticSampleData();
  } else if (getMeta('data_mode', 'sample') === 'sample') {
    const cutoff72h = new Date(Date.now() - 72 * 3600_000).toISOString();
    const recentCnt = (
      db.prepare('SELECT COUNT(*) as cnt FROM incidents WHERE opened_at >= ?').get(cutoff72h) as { cnt: number }
    ).cnt;
    const missingRecCnt = (
      db.prepare("SELECT COUNT(*) as cnt FROM incidents WHERE status IN ('Open', 'In Progress') AND (triage_recommendation IS NULL OR triage_recommendation = '')").get() as { cnt: number }
    ).cnt;
    if (recentCnt < 110 || missingRecCnt > 0) {
      seedRealisticSampleData();
    }
  }
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO dataset_meta (key, value) VALUES (?, ?)').run(key, value);
}

export function getMeta(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM dataset_meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function recomputeSiteTwinState(siteId: string): void {
  const nowIso = new Date().toISOString();
  const site = db.prepare('SELECT site_id FROM sites WHERE site_id = ?').get(siteId) as { site_id: string } | undefined;
  if (!site) return;

  const incStats = db.prepare(`
    SELECT
      COUNT(*) as total_cnt,
      SUM(CASE WHEN status IN ('Open', 'In Progress') THEN 1 ELSE 0 END) as open_cnt,
      SUM(CASE WHEN status IN ('Open', 'In Progress') AND severity = 'P1-Critical' THEN 1 ELSE 0 END) as open_p1_cnt
    FROM incidents
    WHERE site_id = ?
  `).get(siteId) as { total_cnt: number; open_cnt: number | null; open_p1_cnt: number | null };

  const childStats = db.prepare(`
    SELECT COUNT(*) as child_cnt FROM sites WHERE parent_hub_id = ?
  `).get(siteId) as { child_cnt: number };

  const openProblemStats = db.prepare(`
    SELECT COUNT(*) as open_prob_cnt FROM problems WHERE site_id = ? AND status != 'Closed'
  `).get(siteId) as { open_prob_cnt: number };

  const openCnt = incStats.open_cnt ?? 0;
  const openP1Cnt = incStats.open_p1_cnt ?? 0;
  const totalCnt = incStats.total_cnt ?? 0;
  const childCnt = childStats.child_cnt ?? 0;

  let twinStatus: 'Nominal' | 'Degraded' | 'Critical' = 'Nominal';
  if (openP1Cnt > 0 || openCnt >= 2) {
    twinStatus = 'Critical';
  } else if (openCnt === 1 || openProblemStats.open_prob_cnt > 0) {
    twinStatus = 'Degraded';
  }

  db.prepare(`
    UPDATE sites
    SET child_count = ?,
        open_incident_count = ?,
        total_incident_count = ?,
        twin_status = ?,
        last_updated_at = ?
    WHERE site_id = ?
  `).run(childCnt, openCnt, totalCnt, twinStatus, nowIso, siteId);
}

export function recomputeAllSiteTwins(): void {
  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE sites
      SET child_count = COALESCE((SELECT COUNT(*) FROM sites c WHERE c.parent_hub_id = sites.site_id), 0),
          open_incident_count = COALESCE((SELECT COUNT(*) FROM incidents i WHERE i.site_id = sites.site_id AND i.status IN ('Open', 'In Progress')), 0),
          total_incident_count = COALESCE((SELECT COUNT(*) FROM incidents i WHERE i.site_id = sites.site_id), 0),
          last_updated_at = ?
    `).run(nowIso);

    db.prepare(`
      UPDATE sites
      SET twin_status = CASE
        WHEN open_incident_count >= 2
          OR EXISTS (
            SELECT 1 FROM incidents i
            WHERE i.site_id = sites.site_id
              AND i.status IN ('Open', 'In Progress')
              AND i.severity = 'P1-Critical'
          ) THEN 'Critical'
        WHEN open_incident_count = 1
          OR EXISTS (
            SELECT 1 FROM problems p
            WHERE p.site_id = sites.site_id
              AND p.status != 'Closed'
          ) THEN 'Degraded'
        ELSE 'Nominal'
      END
    `).run();

    // Also refresh related_incident_count on problems where matching site_id/category exists if 0
    db.prepare(`
      UPDATE problems
      SET related_incident_count = CASE
        WHEN related_incident_count > 0 THEN related_incident_count
        ELSE COALESCE((SELECT COUNT(*) FROM incidents i WHERE i.linked_problem_id = problems.problem_id), 1)
      END
    `).run();
  });
  tx();
}

function createPrng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedRealisticSampleData(): void {
  const rand = createPrng(20261112);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  const regions: Array<{
    name: string;
    code: string;
    dno: string;
    lat: number;
    lon: number;
    towns: string[];
  }> = [
    { name: 'London & South East', code: 'LSE', dno: 'UK Power Networks', lat: 51.507, lon: -0.127, towns: ['Croydon', 'Reading', 'Guildford', 'Canary Wharf', 'Stratford', 'Brighton', 'Maidstone', 'Slough'] },
    { name: 'North West', code: 'NWE', dno: 'Electricity North West', lat: 53.48, lon: -2.24, towns: ['Manchester', 'Liverpool', 'Preston', 'Bolton', 'Carlisle', 'Chester', 'Warrington', 'Blackpool'] },
    { name: 'Midlands', code: 'MID', dno: 'National Grid ED', lat: 52.486, lon: -1.89, towns: ['Birmingham', 'Nottingham', 'Leicester', 'Coventry', 'Derby', 'Wolverhampton', 'Stoke', 'Worcester'] },
    { name: 'Scotland', code: 'SCO', dno: 'SSEN', lat: 55.953, lon: -3.188, towns: ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness', 'Stirling', 'Perth', 'Paisley'] },
    { name: 'Yorkshire & Humber', code: 'YRK', dno: 'Northern Powergrid', lat: 53.801, lon: -1.549, towns: ['Leeds', 'Sheffield', 'York', 'Bradford', 'Hull', 'Doncaster', 'Wakefield', 'Harrogate'] },
    { name: 'South West', code: 'SWE', dno: 'National Grid ED', lat: 51.454, lon: -2.587, towns: ['Bristol', 'Exeter', 'Plymouth', 'Bath', 'Gloucester', 'Swindon', 'Taunton', 'Bournemouth'] },
    { name: 'East of England', code: 'EOE', dno: 'UK Power Networks', lat: 52.205, lon: 0.121, towns: ['Cambridge', 'Norwich', 'Ipswich', 'Peterborough', 'Chelmsford', 'Colchester', 'Luton', 'Bedford'] },
    { name: 'Wales', code: 'WAL', dno: 'SP Energy Networks', lat: 51.481, lon: -3.179, towns: ['Cardiff', 'Swansea', 'Newport', 'Wrexham', 'Bangor', 'Aberystwyth', 'Bridgend', 'Carmarthen'] },
  ];

  const vendors = ['Ericsson RAN 6630', 'Nokia AirScale', 'Huawei BTS5900', 'Cisco ASR 920', 'Juniper ACX5448'];
  const coolingOptions = ['Direct Free Cooling', 'Dual Split HVAC', 'Passive Heat Exchanger', 'Hybrid Free-Air + DX'];
  const accessOptions = [
    '24/7 Compound Keycard · Parking on-site',
    'Rooftop permit required · 2-person safety rule',
    'Mast compound · Climbing cert required above 15m',
    'Rural track access · 4x4 vehicle advised',
    'Shared tower site · Landlord escort 08:00-18:00',
  ];

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const clearAndSeed = db.transaction(() => {
    db.prepare('DELETE FROM sites').run();
    db.prepare('DELETE FROM incidents').run();
    db.prepare('DELETE FROM problems').run();
    db.prepare('DELETE FROM agent_analyses').run();

    const insertSite = db.prepare(`
      INSERT INTO sites (
        site_id, site_name, uk_region, latitude, longitude, dno_provider,
        power_type, battery_backup_hours, has_generator, cooling_solution,
        site_role, parent_hub_id, child_count, climbing_required, access_notes,
        vendor_hardware, twin_status, open_incident_count, total_incident_count, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Nominal', 0, 0, ?)
    `);

    const sitesList: Array<{
      site_id: string;
      site_name: string;
      region: string;
      dno: string;
      role: 'Hub' | 'Child' | 'Standalone';
      parentHub: string | null;
      batteryHours: number;
      hasGen: number;
      cooling: string;
      climbing: number;
      vendor: string;
    }> = [];

    // 40 Hub sites
    for (let i = 1; i <= 40; i++) {
      const reg = regions[(i - 1) % regions.length];
      const town = reg.towns[Math.floor((i - 1) / regions.length) % reg.towns.length];
      const siteId = `UK-${reg.code}-HUB-${String(i).padStart(3, '0')}`;
      const siteName = `${town} Core Aggregation Hub ${i}`;
      const batteryHours = i <= 6 ? 2 : pick([4, 6, 8, 12]);
      const hasGen = i <= 6 ? 0 : rand() > 0.35 ? 1 : 0;
      const cooling = i % 5 === 0 ? 'Dual Split HVAC' : pick(coolingOptions);
      const climbing = rand() > 0.45 ? 1 : 0;
      const vendor = pick(vendors);
      const lat = +(reg.lat + (rand() - 0.5) * 0.6).toFixed(4);
      const lon = +(reg.lon + (rand() - 0.5) * 0.6).toFixed(4);

      insertSite.run(
        siteId,
        siteName,
        reg.name,
        lat,
        lon,
        reg.dno,
        hasGen ? 'AC Mains + Auto-Start Diesel Gen' : 'AC Mains + DC Rectifier',
        batteryHours,
        hasGen,
        cooling,
        'Hub',
        null,
        0,
        climbing,
        climbing ? 'Mast compound · Climbing cert required above 15m' : pick(accessOptions),
        vendor,
        nowIso
      );

      sitesList.push({
        site_id: siteId,
        site_name: siteName,
        region: reg.name,
        dno: reg.dno,
        role: 'Hub',
        parentHub: null,
        batteryHours,
        hasGen,
        cooling,
        climbing,
        vendor,
      });
    }

    // 140 Child sites linked to Hubs
    const hubSites = sitesList.filter((s) => s.role === 'Hub');
    for (let i = 1; i <= 140; i++) {
      const parent = hubSites[(i - 1) % hubSites.length];
      const reg = regions.find((r) => r.name === parent.region)!;
      const town = pick(reg.towns);
      const siteId = `UK-${reg.code}-CELL-${String(i + 100).padStart(4, '0')}`;
      const siteName = `${town} Macro Sector ${i}`;
      const batteryHours = pick([2, 3, 4, 6]);
      const hasGen = rand() > 0.85 ? 1 : 0;
      const cooling = pick(coolingOptions);
      const climbing = rand() > 0.3 ? 1 : 0;
      const vendor = pick(vendors);
      const lat = +(reg.lat + (rand() - 0.5) * 0.8).toFixed(4);
      const lon = +(reg.lon + (rand() - 0.5) * 0.8).toFixed(4);

      insertSite.run(
        siteId,
        siteName,
        reg.name,
        lat,
        lon,
        reg.dno,
        'AC Mains + DC Rectifier',
        batteryHours,
        hasGen,
        cooling,
        'Child',
        parent.site_id,
        0,
        climbing,
        climbing ? 'Tower climb required · Harness & RF clearance' : pick(accessOptions),
        vendor,
        nowIso
      );

      sitesList.push({
        site_id: siteId,
        site_name: siteName,
        region: reg.name,
        dno: reg.dno,
        role: 'Child',
        parentHub: parent.site_id,
        batteryHours,
        hasGen,
        cooling,
        climbing,
        vendor,
      });
    }

    // 60 Standalone sites
    for (let i = 1; i <= 60; i++) {
      const reg = regions[(i - 1) % regions.length];
      const town = pick(reg.towns);
      const siteId = `UK-${reg.code}-STD-${String(i + 500).padStart(4, '0')}`;
      const siteName = `${town} Streetworks Node ${i}`;
      const batteryHours = pick([2, 4, 6]);
      const hasGen = rand() > 0.75 ? 1 : 0;
      const cooling = pick(coolingOptions);
      const climbing = rand() > 0.5 ? 1 : 0;
      const vendor = pick(vendors);
      const lat = +(reg.lat + (rand() - 0.5) * 0.8).toFixed(4);
      const lon = +(reg.lon + (rand() - 0.5) * 0.8).toFixed(4);

      insertSite.run(
        siteId,
        siteName,
        reg.name,
        lat,
        lon,
        reg.dno,
        'AC Mains + DC Rectifier',
        batteryHours,
        hasGen,
        cooling,
        'Standalone',
        null,
        0,
        climbing,
        pick(accessOptions),
        vendor,
        nowIso
      );

      sitesList.push({
        site_id: siteId,
        site_name: siteName,
        region: reg.name,
        dno: reg.dno,
        role: 'Standalone',
        parentHub: null,
        batteryHours,
        hasGen,
        cooling,
        climbing,
        vendor,
      });
    }

    const insertProblem = db.prepare(`
      INSERT INTO problems (
        problem_id, site_id, title, category, status, related_incident_count,
        vendor_hardware, five_why_analysis, permanent_fix, strategic_recommendation,
        justification, opened_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const problemTemplates = [
      {
        category: 'Power & Battery',
        title: 'Repeated DC Rectifier Undervoltage & Early Battery Exhaustion',
        fiveWhy: '1. Site lost 4G/5G carrier during brief DNO brownout -> 2. Battery string collapsed in 18 mins instead of 4h -> 3. Two VRLA battery blocks had high internal impedance -> 4. Thermal runaway degraded cells due to elevated cabinet temps -> 5. Missing automated impedance telemetry & direct free cooling.',
        fix: 'Replaced VRLA string with LiFePO4 8h bank and installed remote BMS impedance polling.',
        rec: 'Upgrade battery resiliency and install auto-start generator backup',
        just: 'Transmission hub supports multiple dependent child sites; DNO region experiences frequent winter voltage sags.',
      },
      {
        category: 'Cooling & HVAC',
        title: 'Recurring Cabinet Over-Temperature & BBU Thermal Throttling',
        fiveWhy: '1. Baseband unit rebooted under peak evening traffic -> 2. Internal cabinet temp exceeded 54°C -> 3. Legacy split AC compressor tripped on high head pressure -> 4. Condenser fins fouled with urban particulate -> 5. Reactive quarterly cleaning insufficient for high-heat-load RAN cabinets.',
        fix: 'Retrofitted Direct Free Cooling module with HEPA intake filtration and emergency louver bypass.',
        rec: 'Install Direct Free Cooling to replace legacy split HVAC',
        just: 'Reduces cooling power draw by 68% and eliminates single-point compressor failure during summer peaks.',
      },
      {
        category: 'Transmission & Backhaul',
        title: 'Microwave Link Rain-Fade & Hub Aggregation Flaps',
        fiveWhy: '1. Downstream child sites reported intermittent S1/X2 drops -> 2. 38GHz E-band microwave link dropped RSL by 22dB -> 3. Adaptive coding downshifted below voice/control plane floor -> 4. Antenna alignment drifted 0.8 degrees post-storm -> 5. Mounting bracket torque spec not verified with lock washers.',
        fix: 'Re-aligned dish with heavy-duty anti-twist stabilizer strut and enabled LACP dark-fibre failover.',
        rec: 'Deploy dual-path microwave/fibre diversity and mechanical dish bracing',
        just: 'Hub aggregates critical downstream child traffic; single microwave path outage cascades across regional cluster.',
      },
      {
        category: 'RAN Hardware',
        title: 'RRU Optical SFP Transceiver Intermittent Link Loss',
        fiveWhy: '1. Sector 2 cell outage alarm triggered intermittently -> 2. CPRI link CRC errors spiked above threshold -> 3. Tower-top SFP module overheated above 82°C -> 4. Batch defect in vendor optical transceiver batch -> 5. Procurement lacked extended industrial temp (-40 to +85°C) verification.',
        fix: 'Replaced affected SFP batch across sectors 1-3 with extended-temp industrial optics.',
        rec: 'Conduct vendor hardware reliability review for optical transceivers',
        just: 'Multiple repeat faults traced to identical hardware batch requiring climbing dispatch each occurrence.',
      },
    ];

    // Seed 36 problems (8 Open/Investigating, 28 Closed)
    for (let i = 1; i <= 36; i++) {
      const targetSite = i <= 12 ? hubSites[(i - 1) % hubSites.length] : pick(sitesList);
      const tpl = problemTemplates[(i - 1) % problemTemplates.length];
      const status = i <= 5 ? 'Open' : i <= 8 ? 'Investigating' : 'Closed';
      const probId = `PRB-2026-${String(i).padStart(4, '0')}`;
      const openedAt = new Date(now - (15 + i * 3) * 86400_000).toISOString();
      const closedAt = status === 'Closed' ? new Date(now - i * 86400_000).toISOString() : null;
      const relatedCnt = 4 + Math.floor(rand() * 9);

      insertProblem.run(
        probId,
        targetSite.site_id,
        `${tpl.title} (${targetSite.site_id})`,
        tpl.category,
        status,
        relatedCnt,
        targetSite.vendor,
        tpl.fiveWhy,
        status === 'Closed' ? tpl.fix : null,
        tpl.rec,
        `${tpl.just} (${targetSite.role} site in ${targetSite.region}, DNO: ${targetSite.dno})`,
        openedAt,
        closedAt
      );
    }

    const insertIncident = db.prepare(`
      INSERT INTO incidents (
        incident_id, site_id, title, category, severity, status, symptom_summary,
        sla_deadline, opened_at, resolved_at, mttr_minutes, root_cause,
        linked_problem_id, triage_recommendation, assigned_team
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const openIncidentSpecs = [
      {
        site: hubSites[0],
        title: 'Mains Power Failure & Battery Discharge Below 25%',
        category: 'Power & Battery',
        severity: 'P1-Critical',
        status: 'Open',
        symptom: 'AC mains lost following DNO feeder trip. DC bus voltage dropping (46.8V); 2h VRLA bank estimating 38 mins autonomy remaining.',
        slaOffsetMins: 34,
        team: 'Field Power Rapid Response',
        rec: 'Dispatch mobile diesel generator immediately; escalate feeder trip to DNO within 30 mins to prevent hub & child outage.',
      },
      {
        site: hubSites[1],
        title: 'Hub Aggregation Microwave Link Down — 4 Child Sites Isolated',
        category: 'Transmission & Backhaul',
        severity: 'P1-Critical',
        status: 'In Progress',
        symptom: 'Primary 23GHz microwave link RSL lost (-92 dBm). Tower-top ODU unreachable; downstream child sites showing S1 disconnect.',
        slaOffsetMins: 48,
        team: 'Rigging & Transmission Team',
        rec: 'Deploy 2-person rigging crew (climbing cert required) with spare 23GHz ODU; act within 45 mins to restore 4 child sites.',
      },
      {
        site: hubSites[2],
        title: 'Cabinet Over-Temperature Alarm (56.4°C) & BBU Reboot Loop',
        category: 'Cooling & HVAC',
        severity: 'P1-Critical',
        status: 'Open',
        symptom: 'Dual split HVAC compressor fault E04. Baseband unit cycling due to thermal protection threshold.',
        slaOffsetMins: 62,
        team: 'Field HVAC & RAN',
        rec: 'Assign Field HVAC engineer for emergency cabinet ventilation & condenser reset within 60 mins; verify BBU fan tray.',
      },
      {
        site: hubSites[3],
        title: 'CPRI Optical Link Degradation on Sector 1 & 3',
        category: 'RAN Hardware',
        severity: 'P2-High',
        status: 'Open',
        symptom: 'High BER and intermittent RRU drop on 1800/2100MHz carriers. Tower climb required to inspect masthead SFP.',
        slaOffsetMins: 95,
        team: 'Climber Rigging Crew',
        rec: 'Schedule certified tower climber with extended-temp industrial SFP spares; inspect masthead fibre patch before SLA expiry.',
      },
      {
        site: hubSites[4],
        title: 'Auto-Start Generator Failed to Crank During Grid Sag',
        category: 'Power & Battery',
        severity: 'P1-Critical',
        status: 'Open',
        symptom: 'DNO reported planned feeder switching; ATS failed to start backup diesel generator (starter fault). Site running on battery.',
        slaOffsetMins: 28,
        team: 'Mobile Generator Dispatch',
        rec: 'Immediate emergency tow-generator dispatch & ATS starter bypass; critical hub at risk of battery exhaustion in <30 mins.',
      },
      {
        site: hubSites[5],
        title: 'BGP/MPLS Backhaul Flapping on Aggregation Router',
        category: 'Transmission & Backhaul',
        severity: 'P2-High',
        status: 'In Progress',
        symptom: 'Cisco ASR 920 port Gi0/0/2 flapping every 4 minutes with FCS errors; degraded throughput to 3 child cells.',
        slaOffsetMins: 140,
        team: 'Core IP NOC Tier 2',
        rec: 'Reroute traffic via secondary LACP ring path remotely; dispatch field tech to replace optic/patch lead on Gi0/0/2.',
      },
    ];

    let incSeq = 1;
    // Insert the 6 high-urgency showcase open incidents
    for (const spec of openIncidentSpecs) {
      const incId = `INC-2026-${String(incSeq++).padStart(5, '0')}`;
      const openedAt = new Date(now - 75 * 60_000).toISOString();
      const slaDeadline = new Date(now + spec.slaOffsetMins * 60_000).toISOString();
      insertIncident.run(
        incId,
        spec.site.site_id,
        spec.title,
        spec.category,
        spec.severity,
        spec.status,
        spec.symptom,
        slaDeadline,
        openedAt,
        null,
        null,
        null,
        null,
        spec.rec,
        spec.team
      );
    }

    // Insert 20 additional Open/In Progress incidents across diverse regions & severities
    const activeSymptoms = [
      {
        cat: 'Power & Battery',
        sev: 'P2-High',
        title: 'Rectifier Module 2 Fault — Reduced N+1 Redundancy',
        sym: 'Single rectifier bay offline; DC load at 82% on remaining modules.',
        rec: 'Dispatch field power tech with spare 48V rectifier module; monitor bus load remotely.',
      },
      {
        cat: 'Cooling & HVAC',
        sev: 'P2-High',
        title: 'Free-Air Damper Actuator Stuck Closed',
        sym: 'Cabinet internal temperature rising +8°C above ambient baseline.',
        rec: 'Assign field engineer to manually latch bypass damper and replace actuator motor.',
      },
      {
        cat: 'RAN Hardware',
        sev: 'P3-Medium',
        title: 'VSWR High Alarm on 700MHz Antenna Port B',
        sym: 'Return loss degraded to 11.4dB following overnight gale; climbing inspection needed.',
        rec: 'Assign rigging crew (climbing cert required) to weatherproof & torque jumper connector.',
      },
      {
        cat: 'Transmission & Backhaul',
        sev: 'P2-High',
        title: 'Fibre Tail Attenuation Spike (+9dB)',
        sym: 'OTDR indicates bend loss near street cabinet splice enclosure.',
        rec: 'Dispatch fibre splice engineer to re-dress enclosure tray and verify optical budget.',
      },
      {
        cat: 'DNO Grid Outage',
        sev: 'P1-Critical',
        title: 'Unplanned DNO HV Feeder Fault — On Battery',
        sym: 'Area-wide DNO outage confirmed; battery autonomy window shrinking.',
        rec: 'Confirm DNO ETR immediately; stage portable generator if ETR exceeds battery autonomy.',
      },
    ];

    for (let i = 0; i < 20; i++) {
      const site = sitesList[6 + ((i * 7) % (sitesList.length - 6))];
      const tpl = activeSymptoms[i % activeSymptoms.length];
      const incId = `INC-2026-${String(incSeq++).padStart(5, '0')}`;
      const minsLeft = i < 4 ? -15 + i * 10 : 50 + i * 25;
      const openedAt = new Date(now - (45 + i * 15) * 60_000).toISOString();
      const slaDeadline = new Date(now + minsLeft * 60_000).toISOString();
      insertIncident.run(
        incId,
        site.site_id,
        tpl.title,
        tpl.cat,
        tpl.sev,
        i % 3 === 0 ? 'In Progress' : 'Open',
        tpl.sym,
        slaDeadline,
        openedAt,
        null,
        null,
        null,
        null,
        tpl.rec,
        i % 2 === 0 ? 'Regional Field Ops' : 'NOC Tier 1 Triage'
      );
    }

    // Insert 424 Resolved historical incidents, concentrating repeat-offender patterns on hubs 0..9
    const histTemplates = [
      { cat: 'Power & Battery', title: 'DC Bus Undervoltage During DNO Switchover', sym: 'Transient voltage drop caused BBU reset.', rca: 'Aged battery cells unable to sustain peak load during mains transfer.' },
      { cat: 'Cooling & HVAC', title: 'High Cabinet Temperature Threshold Exceeded', sym: 'Thermal alarm >50°C during afternoon peak.', rca: 'Split AC condenser fouling and blocked intake filter.' },
      { cat: 'Transmission & Backhaul', title: 'Microwave Link Sync Loss / High Latency', sym: 'Packet loss >12% on backhaul trunk.', rca: 'Severe rain fade and minor azimuth drift on 38GHz link.' },
      { cat: 'RAN Hardware', title: 'Sector RRU CPRI Link Down', sym: 'Cell unavailable across 1800MHz band.', rca: 'Degraded optical SFP transceiver at masthead.' },
      { cat: 'DNO Grid Outage', title: 'DNO Local Substation Trip', sym: 'Mains supply interrupted for 95 minutes.', rca: 'External DNO underground cable fault; restored by DNO crew.' },
    ];

    for (let i = 0; i < 424; i++) {
      // Bias first 110 historical incidents toward hubs 0..9 to create strong repeat offenders
      const site = i < 110 ? hubSites[i % 10] : pick(sitesList);
      const tpl = histTemplates[(i + (i < 110 ? site.site_id.charCodeAt(site.site_id.length - 1) : 0)) % histTemplates.length];
      const incId = `INC-2026-${String(incSeq++).padStart(5, '0')}`;
      // Spread 140 resolved incidents across the last 72 hours (3 days) for continuous 24h & 3-day trend telemetry
      const isLast72h = i >= 110 && i < 250;
      const mttr = isLast72h ? 22 + Math.floor(rand() * 85) : 42 + Math.floor(rand() * 240);
      const openedMs = isLast72h
        ? now - Math.floor((0.5 + rand() * 71) * 3600_000)
        : now - (3 + Math.floor(rand() * 120)) * 86400_000 - Math.floor(rand() * 3600_000);
      const resolvedMs = Math.min(now - 5 * 60_000, openedMs + mttr * 60_000);
      const slaMs = openedMs + 240 * 60_000;
      const sev = pick(['P1-Critical', 'P2-High', 'P2-High', 'P3-Medium', 'P4-Low']);
      const linkedPrb = i < 48 ? `PRB-2026-${String((i % 12) + 1).padStart(4, '0')}` : null;

      insertIncident.run(
        incId,
        site.site_id,
        tpl.title,
        tpl.cat,
        sev,
        'Resolved',
        tpl.sym,
        new Date(slaMs).toISOString(),
        new Date(openedMs).toISOString(),
        new Date(resolvedMs).toISOString(),
        mttr,
        tpl.rca,
        linkedPrb,
        'Dispatched field engineer and verified service restoration.',
        'Regional Field Ops'
      );
    }

    setMeta('data_mode', 'sample');
    setMeta('sites_source', 'Built-in UK Telecom Sample (240 sites)');
    setMeta('incidents_source', 'Built-in UK Telecom Sample (450 incidents)');
    setMeta('problems_source', 'Built-in UK Telecom Sample (36 problems)');
    setMeta('last_updated', nowIso);
  });

  clearAndSeed();
  recomputeAllSiteTwins();
}
