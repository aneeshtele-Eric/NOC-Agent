# Google AI Studio Master Prompt & Multi-Agent Architecture
## Project: Autonomous Telecom NOC Multi-Agent Platform

### Overview
This document serves as the master prompt and architectural blueprint to be loaded into **Google AI Studio** and **Google Antigravity** for building your local multi-agent telecom incident and problem management platform.

---

### Local File Dependencies
The platform operates on three primary relational datasets stored locally in your workspace directory:
1. **`telecom_incidents_4000_v2.xlsx`**: 4,000 incident records (3,935 resolved, 65 active open incidents).
2. **`telecom_problems_database.xlsx`**: 268 problem tickets (250 closed with verified permanent fixes, 18 open active investigations).
3. **`telecom_site_database.xlsx`**: 4,700 UK telecom sites covering all incident/problem sites plus healthy baseline sites, complete with DNO power providers, battery/generator telemetry, UK regions, and transmission hub/child mappings.

---

### Multi-Agent Architecture
The system consists of three collaborative agents:

#### 1. Digital Twin Agent (Master Data & State Manager)
* **Role**: Maintains a living digital twin profile for each of the 4,700 sites.
* **Capabilities**: Aggregates site static attributes (DNO provider, battery, generator, cooling solution, transmission hierarchy) with dynamic history (incident logs, RCA, problem records, restoration times).
* **Update Mechanism**: Automatically updates site state whenever a new incident is ingested.

#### 2. Incident Triage Agent (Operational Copilot)
* **Role**: Assists incident managers in real-time triage of active open incidents (65 open tickets).
* **Capabilities**: Analyzes symptom patterns, checks SLA deadlines, queries site digital twins, and recommends immediate next actions (e.g., *“Assign Field Engineer immediately for site visit; climbing required; act within 45 minutes to prevent SLA breach”*).

#### 3. Intelligent Problem Management Agent (Root Cause & Strategic Advisory)
* **Role**: Analyzes underlying network failure patterns after incident resolution.
* **Capabilities**: Identifies repeat offenders, runs 5-Why analysis, correlates incidents to problem tickets, and provides fact-based strategic recommendations with explicit justifications (e.g., *“Upgrade battery resiliency / generator backup because this site is a transmission hub supporting 4 child sites; install direct free cooling; review vendor hardware reliability”*).

---

### Implementation Instructions for Google AI Studio
1. Upload `telecom_incidents_4000_v2.xlsx`, `telecom_problems_database.xlsx`, and `telecom_site_database.xlsx` into your Google AI Studio project files or local directory.
2. Provide this master prompt to initialize the multi-agent system persona.
3. Configure the local Python execution runtime or web app frontend to interface with these Excel databases.
