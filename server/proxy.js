/**
 * Azure DevOps Proxy Server
 * 
 * CONFIGURATION SETUP (choose one method):
 * 
 * Method 1: Environment Variables (recommended for CI/CD)
 * --------------------------------------------------------
 * Set these before starting the proxy:
 * 
 * PowerShell:
 *   $env:AZDO_ORG_URL='https://dev.azure.com/yourOrgName'
 *   $env:AZDO_PAT='your-personal-access-token'
 *   $env:AZDO_PROJECT='YourProjectName'
 *   npm run start:proxy
 * 
 * Bash:
 *   export AZDO_ORG_URL='https://dev.azure.com/yourOrgName'
 *   export AZDO_PAT='your-personal-access-token'
 *   export AZDO_PROJECT='YourProjectName'
 *   npm run start:proxy
 * 
 * Method 2: Config File (recommended for local development)
 * ----------------------------------------------------------
 * Create a file named azdo.config.json in the PROJECT ROOT directory
 * (same directory as package.json):
 * 
 *   {
 *     "organizationUrl": "https://dev.azure.com/yourOrgName",
 *     "personalAccessToken": "your-personal-access-token",
 *     "project": "YourProjectName",
 *     "apiVersion": "6.0"
 *   }
 * 
 * IMPORTANT: Add azdo.config.json to .gitignore to avoid committing your PAT!
 * 
 * The server searches for config in this order:
 * 1. POST request body (for one-off testing only)
 * 2. Environment variables (AZDO_ORG_URL, AZDO_PAT, AZDO_PROJECT)
 * 3. azdo.config.json in project root
 * 4. azdo.config.json in server/ subdirectory
 * 
 * To verify your setup, call: GET http://localhost:4000/api/azdo-config
 * This endpoint shows whether credentials are loaded (without exposing your PAT).
 */

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import https from 'https';

const app = express();
app.use(cors());
app.use(express.json());

// load .env if present
dotenv.config();

function jiraAuthHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) return null;
  const base64 = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${base64}`;
}

function requireJiraEnv(res) {
  const baseUrl = process.env.JIRA_BASE_URL;
  const auth = jiraAuthHeader();
  if (!baseUrl || !auth) {
    res.status(500).json({
      error: "Missing Jira env vars. Need JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN",
    });
    return null;
  }
  return { baseUrl, auth };
}



// Create HTTPS agent that ignores certificate validation for Azure DevOps hosted instances
// This is needed when the server certificate doesn't match the hostname
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

const DEFAULT_API_VERSION = process.env.VITE_AZDO_API_VERSION || process.env.AZDO_API_VERSION || '6.0';

function loadConfigFromFile() {
  // Searches for azdo.config.json in multiple locations:
  // 1. Custom path set via AZDO_CONFIG_PATH env var
  // 2. Project root (one level up from server/ directory) — RECOMMENDED LOCATION
  // 3. server/ directory (where this proxy.js file lives)
  // 4. Current working directory when npm run start:proxy is executed
  // 5. Current working directory + server/ subdirectory
  //
  // Example azdo.config.json (place in project root, same directory as package.json):
  // {
  //   "organizationUrl": "https://dev.azure.com/yourOrgName",
  //   "personalAccessToken": "your-personal-access-token",
  //   "project": "YourProjectName",
  //   "apiVersion": "6.0"
  // }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.AZDO_CONFIG_PATH,
    path.join(__dirname, '..', 'azdo.config.json'),        // project root (RECOMMENDED)
    path.join(__dirname, 'azdo.config.json'),              // server/ directory
    path.join(process.cwd(), 'azdo.config.json'),          // cwd
    path.join(process.cwd(), 'server', 'azdo.config.json'), // cwd/server
  ].filter(Boolean);
  
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const j = JSON.parse(raw);
        console.log('✓ Loaded AZDO config from:', p);
        return {
          orgUrl: j.organizationUrl || j.orgUrl || j.AZDO_ORG_URL || j.VITE_AZDO_ORG_URL,
          pat: j.personalAccessToken || j.pat || j.AZDO_PAT || j.VITE_AZDO_PAT,
          apiVersion: j.apiVersion || j.AZDO_API_VERSION || DEFAULT_API_VERSION,
          project: j.project || j.projectName || j.projectKey || j.projectFilter || null,
        };
      }
    } catch (e) {
      console.warn('⚠ Failed to read AZDO config from', p, ':', e && e.message);
    }
  }
  console.log('ℹ No azdo.config.json found. Checked:', candidates.slice(1).join(', '));
  return null;
}

function resolveAzdoConfig() {
  // Priority order:
  // 1. Environment variables (checked first)
  // 2. azdo.config.json file (fallback)
  // 3. Return null values if neither is available
  
  const fromEnv = {
    orgUrl: process.env.VITE_AZDO_ORG_URL || process.env.AZDO_ORG_URL || process.env.AZDO_ORGURL || process.env.AZDO_ORG || null,
    pat: process.env.VITE_AZDO_PAT || process.env.AZDO_PAT || process.env.AZDO_PERSONAL_ACCESS_TOKEN || null,
    apiVersion: process.env.VITE_AZDO_API_VERSION || process.env.AZDO_API_VERSION || DEFAULT_API_VERSION,
    project: process.env.AZDO_PROJECT || process.env.VITE_AZDO_PROJECT || null,
  };
  
  if (fromEnv.orgUrl && fromEnv.pat) {
    console.log('✓ Using AZDO config from environment variables');
    return { ...fromEnv, source: 'env' };
  }
  
  const fromFile = loadConfigFromFile();
  if (fromFile && fromFile.orgUrl && fromFile.pat) {
    return { ...fromFile, source: 'file' };
  }
  
  // If partial config found, prefer env values for missing parts
  console.warn('⚠ Missing AZDO credentials. Set AZDO_ORG_URL and AZDO_PAT env vars or create azdo.config.json');
  return {
    orgUrl: fromEnv.orgUrl || (fromFile && fromFile.orgUrl) || null,
    pat: fromEnv.pat || (fromFile && fromFile.pat) || null,
    apiVersion: fromEnv.apiVersion || (fromFile && fromFile.apiVersion) || DEFAULT_API_VERSION,
    project: fromEnv.project || (fromFile && fromFile.project) || null,
    source: (fromEnv.orgUrl || fromEnv.pat) ? 'env-partial' : (fromFile && (fromFile.orgUrl || fromFile.pat)) ? 'file-partial' : 'none',
  };
}

function makeAuth(pat) {
  if (!pat) return null;
  return `Basic ${Buffer.from(':' + pat).toString('base64')}`;
}

app.post('/api/sprint-progress', async (req, res) => {
  try {
    // Allow credentials in request body for quick local testing (only use if provided)
    const bodyCreds = req.body && (req.body.organizationUrl || req.body.personalAccessToken || req.body.orgUrl || req.body.pat)
      ? {
          orgUrl: req.body.organizationUrl || req.body.orgUrl,
          pat: req.body.personalAccessToken || req.body.pat,
          apiVersion: req.body.apiVersion,
          project: req.body.project || req.body.projectName || req.body.projectFilter || null,
        }
      : null;

    const cfg = bodyCreds || resolveAzdoConfig();
    const ORG_URL = cfg.orgUrl;
    const PAT = cfg.pat;
    const API_VERSION = cfg.apiVersion || DEFAULT_API_VERSION;

    if (!ORG_URL || !PAT) {
      return res.status(400).json({
        error: 'Missing organizationUrl or personalAccessToken. Set env AZDO_ORG_URL and AZDO_PAT, create azdo.config.json at project root, or POST { "organizationUrl": "https://dev.azure.com/yourOrg", "personalAccessToken": "<pat>" } to this endpoint for local testing.',
        config: {
          orgUrl: ORG_URL || null,
          apiVersion: API_VERSION,
          project: cfg.project || null,
          source: cfg && cfg.source ? cfg.source : 'none',
        }
      });
    }

    const { groupBy = 'AreaPath', completedStates = ['Done','Closed','Resolved','Completed'] } = req.body || {};

    // Determine project name: prefer explicit body.project, then resolved config.project
    const projectFromBody = (req.body && (req.body.project || req.body.projectFilter || req.body.projectName)) || null;
    const PROJECT = projectFromBody || cfg.project || null;

    // Build WIQL query. Using @CurrentIteration requires a project (team) context, so we target the project-scoped WIQL endpoint.
    const baseQuery = "SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = @CurrentIteration";
    const wiql = { query: baseQuery };

    // Build project-scoped WIQL endpoint if project provided; otherwise use org-level (likely to fail for @CurrentIteration)
    const baseOrg = ORG_URL.replace(/\/$/, '');
    const wiqlUrl = PROJECT
      ? `${baseOrg}/${encodeURIComponent(PROJECT)}/_apis/wit/wiql?api-version=${API_VERSION}`
      : `${baseOrg}/_apis/wit/wiql?api-version=${API_VERSION}`;

    const wiqlRes = await fetch(wiqlUrl, {
      method: 'POST',
      headers: { Authorization: makeAuth(PAT), 'Content-Type': 'application/json' },
      body: JSON.stringify(wiql),
      agent: httpsAgent,
    });
    if (!wiqlRes.ok) {
      const txt = await wiqlRes.text();
      console.error('WIQL request failed', { url: wiqlUrl, project: PROJECT, status: wiqlRes.status, body: wiql, response: txt });
      const errMsg = PROJECT
        ? `WIQL failed for project '${PROJECT}': ${wiqlRes.status} ${txt}`
        : `WIQL failed (no project specified): ${wiqlRes.status} ${txt}`;
      return res.status(500).json({ error: errMsg });
    }
    const wiqlJson = await wiqlRes.json();
    const ids = (wiqlJson.workItems || []).map((w) => w.id).filter(Boolean);
    if (!ids || ids.length === 0) return res.json({ groups: [] });

    const batchSize = 200;
    const all = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const fields = ['System.Id','System.Title','System.State','System.AreaPath','System.TeamProject','Microsoft.VSTS.Scheduling.StoryPoints'];
      const url = `${ORG_URL.replace(/\/$/, '')}/_apis/wit/workitems?ids=${batch.join(',')}&fields=${fields.join(',')}&api-version=${API_VERSION}`;
      const r = await fetch(url, { headers: { Authorization: makeAuth(PAT) }, agent: httpsAgent });
      if (!r.ok) {
        const t = await r.text();
        return res.status(500).json({ error: `Workitems fetch failed: ${r.status} ${t}` });
      }
      const j = await r.json();
      if (j.value && Array.isArray(j.value)) all.push(...j.value);
    }

    // aggregate groups
    const completedSet = new Set((completedStates || []).map((s) => s.toString().toLowerCase()));
    const map = new Map();
    all.forEach((w) => {
      const f = w.fields || {};
      const key = groupBy === 'Project' ? (f['System.TeamProject'] || 'Unknown') : (f['System.AreaPath'] || 'Unknown');
      if (!map.has(key)) map.set(key, { items: [], totalSP: 0, completedSP: 0, completedCount: 0 });
      const g = map.get(key);
      const sp = parseFloat(f['Microsoft.VSTS.Scheduling.StoryPoints']) || 0;
      g.items.push(w.id);
      g.totalSP += sp;
      if (completedSet.has((f['System.State'] || '').toString().toLowerCase())) {
        g.completedSP += sp;
        g.completedCount += 1;
      }
    });
    const groups = Array.from(map.entries()).map(([k, v]) => ({ key: k, itemsCount: v.items.length, completedCount: v.completedCount, totalSP: v.totalSP, completedSP: v.completedSP, percent: v.totalSP > 0 ? Math.min(100, (v.completedSP / v.totalSP) * 100) : 0 }));
    groups.sort((a, b) => b.totalSP - a.totalSP);
    return res.json({ groups });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
});

// Safe config endpoint — shows whether AZDO config is available (does NOT expose PAT)
app.get('/api/azdo-config', (req, res) => {
  try {
    const cfg = resolveAzdoConfig();
    const has = !!(cfg && cfg.orgUrl && cfg.pat);
    const maskedOrg = cfg && cfg.orgUrl ? cfg.orgUrl : null;
    return res.json({ hasCredentials: has, orgUrl: maskedOrg, apiVersion: cfg.apiVersion || DEFAULT_API_VERSION, project: cfg.project || null, source: cfg.source || 'none' });
  } catch (err) {
    console.error('azdo-config error', err && err.message);
    return res.status(500).json({ error: 'Failed to read config' });
  }
});

// Jira API endpoints
app.post('/api/jira/issues', async (req, res) => {
  try {
    const jiraConfig = requireJiraEnv(res);
    if (!jiraConfig) return;

    const { jql = '', fields = 'summary,status,assignee,reporter,created,updated,duedate,priority,issuetype,project,resolution,customfield_10010,customfield_10002,fixVersions,timeoriginalestimate,customfield_10007,customfield_10008,customfield_10009,customfield_10011,customfield_10012,customfield_10013,customfield_10014,customfield_10016,customfield_10017', startAt = 0, maxResults = 100 } = req.body;

    // If no JQL provided, use a broad query to get all projects
    const finalJql = jql || 'project in (DND,CSFR,AISITS,ACI,CSR,AFMS,AFSDWAM,BROAD,BMS,CADEP,CCTA,CTONGO,CABO,CPM,CS000344,CFT,CS00300,CS00304,CS00332,INSETT,CSAU,IRROA,SMSI,CS00386,CSDRECONC,CS00398A,CS00398B,CNBIL408,CS00415PT,CSB,CS00429,CS00434,CBAHESF,CS441SAPD,COGP,TRFCSPRM,CCPI,DRM,DWHP,NXCLR,ECBS,FAA,FSM,BSWAP21,ISE,INTTAX,MOS,MDP,MCA,OGSN,OTPCA,PIR,PIRSOW,PEWS,PS,RC,RF,RB,SSP,SRFCSS,SETINPFILE,SSLM,SD,SIR,SPROJ,SRDUAT,STLU,SI,T2S,TT,TP,T0ORS,UP,UPB,UPNTOLD,WFNDS,WBILL,XPRES,XPONGO,QO00443)';

    console.log('Proxy POST /api/jira/issues:', { jql: finalJql, startAt, maxResults });

    const url = `${jiraConfig.baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(finalJql)}&fields=${encodeURIComponent(fields)}&startAt=${startAt}&maxResults=${maxResults}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': jiraConfig.auth,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Jira API error response:', errorText);
      return res.status(response.status).json({ error: `Jira API error: ${response.status}`, details: errorText });
    }

    const data = await response.json();
    // Return full pagination metadata to frontend
    res.json({
      issues: data.issues,
      total: data.total,
      startAt: data.startAt,
      maxResults: data.maxResults
    });
  } catch (error) {
    console.error('Jira API error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Keep GET for backward compatibility (temporary)
app.get('/api/jira/issues', async (req, res) => {
  try {
    const jiraConfig = requireJiraEnv(res);
    if (!jiraConfig) return;
    
    const { jql = '', fields = 'summary,status,assignee,reporter,created,updated,duedate,priority,issuetype,project,resolution,customfield_10010,customfield_10002,fixVersions,timeoriginalestimate,customfield_10007,customfield_10008,customfield_10009,customfield_10011,customfield_10012,customfield_10013,customfield_10014,customfield_10016,customfield_10017', startAt = 0, maxResults = 100 } = req.query;
    
    // If no JQL provided, use a broad query to get all projects
    const finalJql = jql || 'project in (DND,CSFR,AISITS,ACI,CSR,AFMS,AFSDWAM,BROAD,BMS,CADEP,CCTA,CTONGO,CABO,CPM,CS000344,CFT,CS00300,CS00304,CS00332,INSETT,CSAU,IRROA,SMSI,CS00386,CSDRECONC,CS00398A,CS00398B,CNBIL408,CS00415PT,CSB,CS00429,CS00434,CBAHESF,CS441SAPD,COGP,TRFCSPRM,CCPI,DRM,DWHP,NXCLR,ECBS,FAA,FSM,BSWAP21,ISE,INTTAX,MOS,MDP,MCA,OGSN,OTPCA,PIR,PIRSOW,PEWS,PS,RC,RF,RB,SSP,SRFCSS,SETINPFILE,SSLM,SD,SIR,SPROJ,SRDUAT,STLU,SI,T2S,TT,TP,T0ORS,UP,UPB,UPNTOLD,WFNDS,WBILL,XPRES,XPONGO,QO00443)';
    
    const url = `${jiraConfig.baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(finalJql)}&fields=${encodeURIComponent(fields)}&startAt=${startAt}&maxResults=${maxResults}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': jiraConfig.auth,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Jira API error: ${response.status}`, details: errorText });
    }
    
    const data = await response.json();
    // Return full pagination metadata to frontend (matching POST route)
    res.json({
      issues: data.issues || [],
      total: data.total ?? 0,
      startAt: data.startAt ?? Number(startAt),
      maxResults: data.maxResults ?? Number(maxResults)
    });
  } catch (error) {
    console.error('Jira API error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get all projects
app.get('/api/jira/projects', async (req, res) => {
  try {
    const jiraConfig = requireJiraEnv(res);
    if (!jiraConfig) return;
    
    const url = `${jiraConfig.baseUrl}/rest/api/3/project`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': jiraConfig.auth,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Jira API error: ${response.status}`, details: errorText });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Jira API error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get sprints for a board
app.get('/api/jira/sprints/:boardId', async (req, res) => {
  try {
    const jiraConfig = requireJiraEnv(res);
    if (!jiraConfig) return;
    
    const { boardId } = req.params;
    const { state = 'active,future' } = req.query;
    
    const url = `${jiraConfig.baseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=${state}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': jiraConfig.auth,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Jira API error: ${response.status}`, details: errorText });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Jira API error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get all boards
app.get('/api/jira/boards', async (req, res) => {
  try {
    const jiraConfig = requireJiraEnv(res);
    if (!jiraConfig) return;
    
    const { projectKeyOrId } = req.query;
    const url = projectKeyOrId 
      ? `${jiraConfig.baseUrl}/rest/agile/1.0/board?projectKeyOrId=${projectKeyOrId}`
      : `${jiraConfig.baseUrl}/rest/agile/1.0/board`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': jiraConfig.auth,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Jira API error: ${response.status}`, details: errorText });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Jira API error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Safe config endpoint — shows whether Jira config is available (does NOT expose credentials)
app.get('/api/jira-config', (req, res) => {
  try {
    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const hasConfig = !!(baseUrl && email && process.env.JIRA_API_TOKEN);
    
    return res.json({ 
      hasCredentials: hasConfig, 
      baseUrl: baseUrl || null,
      email: email ? email.replace(/(.{2}).*(@.*)/, '$1***$2') : null,
      source: 'env'
    });
  } catch (err) {
    console.error('jira-config error', err && err.message);
    return res.status(500).json({ error: 'Failed to read config' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Proxy server listening on ${port}`));
