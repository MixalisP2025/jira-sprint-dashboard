import { JIRA_CONFIG, buildJQL, getFieldsString } from '../config/jiraConfig.js';

// Use local Express only during DEV; use Vercel Functions in production
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:4001/api'
  : '/api';

export const jiraService = {
  // Helper: dedupe issues by key
  dedupeByKey(items) {
    const map = new Map();
    for (const it of items) {
      const k = it.key || it.Key;
      if (k && !map.has(k)) map.set(k, it);
    }
    return Array.from(map.values());
  },

  // Check if Jira credentials are configured
  async checkConfig() {
    try {
      const response = await fetch(`${API_BASE}/jira-config`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error checking Jira config:', error);
      throw error;
    }
  },

  // Get all projects
  async getProjects() {
    try {
      const response = await fetch(`${API_BASE}/jira/projects`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching projects:', error);
      throw error;
    }
  },

  // Get all boards
  async getBoards(projectKeyOrId = null) {
    try {
      const url = projectKeyOrId 
        ? `${API_BASE}/jira/boards?projectKeyOrId=${projectKeyOrId}`
        : `${API_BASE}/jira/boards`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching boards:', error);
      throw error;
    }
  },

  // Get sprints for a board
  async getSprints(boardId, state = 'active,future') {
    try {
      const response = await fetch(`${API_BASE}/jira/sprints?boardId=${boardId}&state=${encodeURIComponent(state)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching sprints:', error);
      throw error;
    }
  },

  // Get issues with JQL (using GET to match backend) - Updated for new API
  async getIssues(jql = buildJQL(), fields = null, startAt = 0, maxResults = JIRA_CONFIG.pagination.maxResults, nextPageToken = null) {
    try {
      const defaultFields = fields || getFieldsString();

      const params = new URLSearchParams({
        jql,
        fields: defaultFields,
        maxResults: maxResults.toString()
      });

      // Use nextPageToken if provided, otherwise use startAt
      if (nextPageToken) {
        params.append('nextPageToken', nextPageToken);
      } else {
        params.append('startAt', startAt.toString());
      }

      const response = await fetch(`${API_BASE}/jira/issues?${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GET /api/jira/issues error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching issues:', error);
      throw error;
    }
  },

  // Fetch individual worklogs for a set of issue keys (chunked to keep URLs short).
  // Returns { worklogs: [{issueKey, author, authorAccountId, started, seconds}], errors, truncatedKeyList }.
  async getWorklogs(keys = []) {
    const unique = Array.from(new Set((keys || []).filter(Boolean)));
    if (unique.length === 0) return { worklogs: [], errors: [], truncatedKeyList: false, keysRequested: 0 };

    const CHUNK = 150;
    const allWorklogs = [];
    const allErrors = [];
    let truncatedKeyList = false;

    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const params = new URLSearchParams({ keys: chunk.join(',') });
      const response = await fetch(`${API_BASE}/jira/worklogs?${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} fetching worklogs: ${text.slice(0, 200)}`);
      }
      const data = await response.json();
      allWorklogs.push(...(data.worklogs || []));
      if (data.errors?.length) allErrors.push(...data.errors);
      if (data.truncatedKeyList) truncatedKeyList = true;
    }

    return { worklogs: allWorklogs, errors: allErrors, truncatedKeyList, keysRequested: unique.length };
  },

  // Get all issues (handles pagination using Jira "total")
  async getAllIssues(jql = buildJQL(), fields = null) {
    console.log("=== getAllIssues PER-PROJECT START ===");

    const projectKeys = (JIRA_CONFIG.projects || []).slice();
    const allIssues = [];
    const failedProjects = [];
    const successfulProjects = [];

    // OPTIONAL: if you want to apply extra filters passed in, treat them as "base filters"
    // Example: jql = 'statusCategory != Done' OR other filters
    // We strip any "project in (...)" from jql to avoid double project filtering
    const baseJql = (jql || "")
      .replace(/project\s+in\s*\([^)]*\)/gi, "")
      .replace(/\bproject\s*=\s*"[^"]+"/gi, "")
      .trim()
      .replace(/^AND\s+/i, "")
      .replace(/\s+AND$/i, "")
      .trim();

    for (const p of projectKeys) {
      try {
        const projectFilter = `project = "${p}"`;

        // apply config dateRange if present
        const dateFilter =
          JIRA_CONFIG.dateRange?.daysBack
            ? `updated >= -${JIRA_CONFIG.dateRange.daysBack}d` 
            : (JIRA_CONFIG.dateRange?.fromDate
                ? `updated >= "${JIRA_CONFIG.dateRange.fromDate}"` +
                  (JIRA_CONFIG.dateRange?.toDate ? ` AND updated <= "${JIRA_CONFIG.dateRange.toDate}"` : "")
                : "");

        const parts = [projectFilter];
        if (baseJql) parts.push(`(${baseJql})`);
        if (dateFilter) parts.push(`(${dateFilter})`);

        const projectJql = parts.join(" AND ") + " ORDER BY updated DESC";
        console.log("Fetching project:", p, "JQL:", projectJql);

        const issuesForProject = await this.getAllIssuesSingleJql(projectJql, fields);

        // If Jira reports >= 10k, chunk by date windows
        if (issuesForProject.jiraTotal >= 10000) {
          console.warn(`Project ${p} has >= 10k results. Chunking by date windows...`);
          const chunked = await this.getAllIssuesChunkedByDate(p, baseJql, fields);
          allIssues.push(...chunked);
        } else {
          allIssues.push(...issuesForProject.issues);
        }

        // Also fetch backlog items (no sprint) — no date filter so we get everything
        const backlogJql = `${projectFilter} AND sprint is EMPTY ORDER BY updated DESC`;
        console.log("Fetching backlog for project:", p);
        const backlogIssues = await this.getAllIssuesSingleJql(backlogJql, fields);
        allIssues.push(...backlogIssues.issues);
        console.log(`✓ Project ${p}: ${issuesForProject.issues.length} sprint issues + ${backlogIssues.issues.length} backlog items`);

        successfulProjects.push(p);

      } catch (error) {
        console.error(`✗ Failed to fetch project ${p}:`, error.message);
        failedProjects.push({ project: p, error: error.message });
        // Continue with next project instead of failing completely
      }
    }

    const deduped = this.dedupeByKey(allIssues);

    console.log("=== getAllIssues PER-PROJECT END ===", {
      totalProjects: projectKeys.length,
      successful: successfulProjects.length,
      failed: failedProjects.length,
      fetched: allIssues.length,
      deduped: deduped.length,
      failedProjects: failedProjects.map(f => f.project)
    });

    // Log failed projects for debugging
    if (failedProjects.length > 0) {
      console.warn("Failed projects:", failedProjects);
    }

    return { 
      issues: deduped, 
      total: deduped.length, 
      startAt: 0, 
      maxResults: deduped.length,
      metadata: {
        successfulProjects,
        failedProjects,
        totalProjects: projectKeys.length
      }
    };
  },

  // Helper: dedupe issues by key (legacy method - use dedupeByKey instead)
  dedupeIssuesByKey(issues) {
    return this.dedupeByKey(issues);
  },

  // Get all issues for a single JQL (with pagination) - Updated for new API
  async getAllIssuesSingleJql(jql, fields = null) {
    const all = [];
    let nextPageToken = null;
    const maxResults = JIRA_CONFIG.pagination.maxResults;
    let iter = 0;
    const MAX_ITERATIONS = 500; // Increased from 200 to handle more data

    console.log(`Starting pagination for JQL: ${jql.substring(0, 100)}...`);

    while (iter < MAX_ITERATIONS) {
      iter++;
      
      console.log(`Pagination iteration ${iter}, fetched so far: ${all.length} issues`);
      
      const data = await this.getIssues(jql, fields, 0, maxResults, nextPageToken);
      const issues = data.issues || [];

      console.log(`Iteration ${iter}: received ${issues.length} issues, isLast: ${data.isLast}, nextPageToken: ${data.nextPageToken ? 'present' : 'null'}`);

      if (issues.length === 0) {
        console.log('No more issues returned, stopping pagination');
        break;
      }

      all.push(...issues);

      // Check if we have more pages using new API format
      if (data.isLast === true) {
        console.log('Reached last page (isLast=true), stopping pagination');
        break;
      }
      
      // Update nextPageToken for next iteration
      nextPageToken = data.nextPageToken;
      
      // If no nextPageToken and not explicitly not last, we're done
      if (!nextPageToken) {
        console.log('No nextPageToken, stopping pagination');
        break;
      }

      // Increased safety limit to 50k issues
      if (all.length >= 50000) {
        console.warn(`Stopping pagination at ${all.length} issues for safety`);
        break;
      }
    }

    console.log(`Pagination complete: fetched ${all.length} total issues in ${iter} iterations`);

    return { issues: all, jiraTotal: all.length };
  },

  // Get all issues chunked by date (for projects with >10k results)
  async getAllIssuesChunkedByDate(projectKey, baseJql = "", fields = null) {
    const results = [];
    const now = new Date();
    const windowDays = 60; // smaller window reduces risk of hitting 10k per chunk

    // go back 3 years (adjust if needed)
    const start = new Date();
    start.setDate(start.getDate() - 365 * 3);

    let cursor = new Date(start);

    while (cursor < now) {
      const from = new Date(cursor);
      const to = new Date(cursor);
      to.setDate(to.getDate() + windowDays);

      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      const parts = [
        `project = "${projectKey}"`,
        `updated >= "${fromStr}"`,
        `updated < "${toStr}"` 
      ];

      if (baseJql) parts.push(`(${baseJql})`);

      const jql = parts.join(" AND ") + " ORDER BY updated DESC";
      console.log("Chunk JQL:", jql);

      const chunk = await this.getAllIssuesSingleJql(jql, fields);
      results.push(...chunk.issues);

      // If a chunk itself is >= 10k, you MUST reduce windowDays (or split by updated + created)
      if (chunk.jiraTotal >= 10000) {
        console.warn(`Chunk still >=10k for ${projectKey} (${fromStr}..${toStr}). Reduce windowDays further.`);
      }

      cursor = to;
    }

    return results;
  },

  // Transform Jira issues to dashboard format
  transformIssuesToDashboardData(jiraResponse) {
    console.log('=== TRANSFORM JIRA DATA START ===');
    console.log('Input jiraResponse:', jiraResponse);
    
    // Handle both array and {issues: [...]} formats
    const issues = Array.isArray(jiraResponse) ? jiraResponse : (jiraResponse?.issues || []);
    
    console.log(`Transforming ${issues.length} issues from Jira format to dashboard format`);
    
    // NEW: Track unique assignees and their counts
    const assigneeCounts = {};
    const sprintCounts = {};
    
    // NEW: Track sprint dates for Timeline/Gantt chart
    const extractedSprintDates = {};
    
    const transformed = issues.map((issue, index) => {
      const fields = issue.fields || {};
      
      // Extract sprint information with date parsing
      let sprintValue = '';
      const sprintField = fields.customfield_10010 || fields.sprint || [];
      if (Array.isArray(sprintField) && sprintField.length > 0) {
        // Extract sprint name from the sprint object or string
        const sprint = sprintField[sprintField.length - 1]; // Get most recent sprint
        if (typeof sprint === 'string') {
          sprintValue = sprint;
        } else if (sprint?.name) {
          sprintValue = sprint.name;
          
          // NEW: Extract dates from sprint object if available
          if (sprint.startDate && sprint.endDate && !extractedSprintDates[sprint.name]) {
            // Parse ISO dates from Jira sprint object
            const startDate = new Date(sprint.startDate);
            const endDate = new Date(sprint.endDate);
            
            extractedSprintDates[sprint.name] = {
              start: `${startDate.getMonth() + 1}/${startDate.getDate()}/${startDate.getFullYear()}`,
              end: `${endDate.getMonth() + 1}/${endDate.getDate()}/${endDate.getFullYear()}`
            };
          }
        }
        
        // NEW: Also try to parse dates from sprint name (fallback)
        if (sprintValue && !extractedSprintDates[sprintValue]) {
          const dateMatch = sprintValue.match(/(\d{2})-(\d{2})-(\d{2})\s+to\s+(\d{2})-(\d{2})-(\d{2})/);
          if (dateMatch) {
            const [_, startDay, startMonth, startYear, endDay, endMonth, endYear] = dateMatch;
            extractedSprintDates[sprintValue] = {
              start: `${startMonth}/${startDay}/20${startYear}`,
              end: `${endMonth}/${endDay}/20${endYear}`
            };
          }
        }
      }
      
      // Extract assignee
      const rawAssignee = fields.assignee?.displayName ||
                          fields.assignee?.name ||
                          'Unassigned';
      
      // For now, keep as-is to see what format we get
      const assignee = rawAssignee;
      
      // NEW: Count assignees and sprints
      assigneeCounts[assignee] = (assigneeCounts[assignee] || 0) + 1;
      if (sprintValue) {
        sprintCounts[sprintValue] = (sprintCounts[sprintValue] || 0) + 1;
      }
      
      // Extract story points - CRITICAL FIX for double-counting
      // Your Jira has TWO story points fields:
      // - customfield_10054: "Story point estimate" (JSW standard) - USE THIS FIRST
      // - customfield_10050: "Story Points" (custom number field) - FALLBACK
      // We must pick ONE value, not sum or average them!
      
      let storyPoints = 0;
      
      // Helper function to safely parse numbers
      const toNumber = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
        return Number.isFinite(n) ? n : null;
      };
      
      // Priority 1: Story point estimate (JSW standard field)
      const sp54 = toNumber(fields.customfield_10054);
      if (sp54 !== null) {
        storyPoints = sp54;
      }
      // Priority 2: Story Points (custom field)
      else {
        const sp50 = toNumber(fields.customfield_10050);
        if (sp50 !== null) {
          storyPoints = sp50;
        }
        // Priority 3: Fallback to other fields
        else {
          const spFallback = toNumber(fields.storyPoints) ?? toNumber(fields['Story Points']) ?? 0;
          storyPoints = spFallback;
        }
      }
      
      // Debug story points extraction for first 20 items AND log all issues to verify
      if (index < 20) {
        console.log(`Item ${index} [${issue.key}] Story Points extraction:`, {
          assignee: rawAssignee,
          status: fields.status?.name,
          sp50: fields.customfield_10050,
          sp54: fields.customfield_10054,
          used: storyPoints,
          whichFieldUsed: sp54 !== null ? 'customfield_10054 (JSW)' : (toNumber(fields.customfield_10050) !== null ? 'customfield_10050' : 'fallback')
        });
      }
      
      // CRITICAL DEBUG: Log every issue to verify no halving/averaging
      if (storyPoints > 0) {
        console.log(`${issue.key}: sp50=${fields.customfield_10050}, sp54=${fields.customfield_10054}, used=${storyPoints}`);
      }
      
      // Build the transformed object in the format your dashboard expects
      const dashboardItem = {
        // Basic fields
        'Issue Type': fields.issuetype?.name || issue.issueType || '',
        'Key': issue.key || '',
        'Issue key': issue.key || '',
        'Summary': fields.summary || '',
        'Assignee': assignee,
        'D': assignee, // Alternate field name used in your code
        'Project': fields.project?.name || fields.project?.key || '',
        'B': fields.project?.name || fields.project?.key || '', // Alternate field name
        'Reporter': fields.reporter?.displayName || fields.reporter?.name || '',
        'Sprint': sprintValue,
        'G': sprintValue, // Alternate field name
        'Priority': fields.priority?.name || '',
        'Status': fields.status?.name || '',
        'Resolution': fields.resolution?.name || '',
        'Resolved': fields.resolutiondate || '',
        'Resolution Date': fields.resolutiondate || '',
        'Created': fields.created || '',
        'Start date': fields.customfield_10052 || '', // CORRECTED: was 10017
        'Due date': fields.duedate || '',
        'Due Date': fields.duedate || '',
        'Target end': fields.customfield_10059 || '', // CORRECTED: was 10016
        'Target End': fields.customfield_10059 || '', // CORRECTED: was 10016
        'Updated': fields.updated || '',
        
        // Story Points - CRITICAL for your KPI calculations
        'Story Points': storyPoints,
        'Story points': storyPoints, // Alternate casing
        'Custom field (Story Points)': storyPoints,
        
        // Additional custom fields - CORRECTED FIELD IDs
        'Team': fields.customfield_10001 || '', // CORRECTED: was 10007
        'Epic Name': fields.customfield_10005 || '', // CORRECTED: was 10008
        'Fix versions': fields.fixVersions?.map(v => v.name).join(', ') || '',
        'Fix Version Live': fields.customfield_10217 || '', // CORRECTED: was 10009
        'Versioning Not Required': fields.customfield_10283 || '', // CORRECTED: was 10011
        'Escalate to 2nd Level Support': fields.customfield_10352 || '', // CORRECTED: was 10012
        'Awaiting Versioning': fields.customfield_10481 || '', // CORRECTED: was 10013
        'Allocation status': fields.customfield_10515 || '', // CORRECTED: was 10014
        'Original Estimate': toNumber(fields.timeoriginalestimate)
          ?? toNumber(fields.timetracking?.originalEstimateSeconds) ?? 0,
        'Σ Original Estimate': fields.aggregatetimeoriginalestimate || 0,

        // Time tracking (all values in SECONDS, as Jira returns them)
        // Prefer explicit fields, fall back to the timetracking object if present.
        'Time Spent': toNumber(fields.timespent)
          ?? toNumber(fields.timetracking?.timeSpentSeconds) ?? 0,
        'Σ Time Spent': toNumber(fields.aggregatetimespent)
          ?? toNumber(fields.timespent) ?? 0,
        'Remaining Estimate': toNumber(fields.timeestimate)
          ?? toNumber(fields.timetracking?.remainingEstimateSeconds) ?? 0,

        // Raw fields object for debugging
        _rawFields: fields
      };
      
      // Debug first 10 items to see variety
      if (index < 10) {
        console.log(`Item ${index}:`, {
          key: dashboardItem.Key,
          assignee: dashboardItem.Assignee,
          status: dashboardItem.Status,
          sprint: dashboardItem.Sprint,
          storyPoints: dashboardItem['Story Points'],
          project: dashboardItem.Project
        });
      }
      
      return dashboardItem;
    });
    
    // NEW: Print assignee summary
    console.log('=== ASSIGNEE SUMMARY ===');
    console.log('Total unique assignees:', Object.keys(assigneeCounts).length);
    Object.entries(assigneeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => {
        console.log(`  ${name}: ${count} issues`);
      });
    
    // NEW: Print sprint summary
    console.log('=== SPRINT SUMMARY ===');
    console.log('Total unique sprints:', Object.keys(sprintCounts).length);
    Object.entries(sprintCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10) // Top 10 sprints
      .forEach(([name, count]) => {
        console.log(`  ${name}: ${count} issues`);
      });
    
    // NEW: Print extracted sprint dates
    console.log('=== EXTRACTED SPRINT DATES ===');
    console.log('Total unique sprints with dates:', Object.keys(extractedSprintDates).length);
    Object.entries(extractedSprintDates).forEach(([sprint, dates]) => {
      console.log(`  ${sprint}: ${dates.start} → ${dates.end}`);
    });
    
    // NEW: Store sprint dates globally for Timeline/Gantt chart
    window.jiraSprintDates = extractedSprintDates;
    
    console.log('=== TRANSFORM COMPLETE ===');
    console.log(`Transformed ${transformed.length} items`);
    
    return transformed;
  },

  // Extract sprint name from custom field
  extractSprintName(sprintField) {
    if (!sprintField) return '';
    
    // Handle array of sprints
    if (Array.isArray(sprintField)) {
      if (sprintField.length === 0) return '';
      
      const sprintNames = sprintField.map(sprint => {
        if (typeof sprint === 'object' && sprint.name) {
          return sprint.name;
        } else if (typeof sprint === 'string') {
          return this.parseSprintName(sprint);
        }
        return '';
      }).filter(Boolean);
      
      return sprintNames.join(', ');
    }
    
    // Handle single sprint object (new format)
    if (typeof sprintField === 'object' && sprintField.name) {
      return sprintField.name;
    }
    
    // Handle string representation
    if (typeof sprintField === 'string') {
      return this.parseSprintName(sprintField);
    }
    
    return '';
  },

  // Parse sprint name from sprint string
  parseSprintName(sprintString) {
    if (!sprintString || typeof sprintString !== 'string') return '';
    
    // Try to extract name from various formats
    const patterns = [
      /name=([^,]+)/,
      /com\.atlassian\.greenhopper\.service\.sprint\.Sprint@[^,]+,name=([^,]+)/,
      /id=(\d+),name=([^,]+)/
    ];
    
    for (const pattern of patterns) {
      const match = sprintString.match(pattern);
      if (match) {
        return match[2] || match[1] || match[0];
      }
    }
    
    // If no pattern matches, return the string itself (cleaned)
    return sprintString.replace(/^[^,]*,/, '').replace(/,.*/, '').trim();
  }
};
