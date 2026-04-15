const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = 4001;

// Serve built frontend from dist/ if it exists
const distPath = path.join(__dirname, '..', 'dist');
const hasDist = fs.existsSync(distPath);

// Jira Configuration - Use environment variables for security
const JIRA_CONFIG = {
  baseUrl: process.env.JIRA_BASE_URL || 'https://advancedinformationservices.atlassian.net',
  email: process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN
};

// Validate required environment variables
if (!JIRA_CONFIG.email || !JIRA_CONFIG.apiToken) {
  console.error('❌ Missing required environment variables:');
  if (!JIRA_CONFIG.email) console.error('  - JIRA_EMAIL');
  if (!JIRA_CONFIG.apiToken) console.error('  - JIRA_API_TOKEN');
  console.error('Please check your .env file in the server directory.');
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Oracle DB routes
const dbRoutes = require('./db/routes');
app.use('/api/db', dbRoutes);

// Serve built frontend (production)
if (hasDist) {
  app.use(express.static(distPath));
  console.log('✅ Serving built frontend from dist/');
} else {
  console.log('⚠️  No dist/ folder found — frontend not served. Run: npm run build');
}

// Root endpoint - test if server is running
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server is running!',
    timestamp: new Date().toISOString(),
    endpoints: {
      config: 'GET /api/jira-config',
      issues: 'GET /api/jira/issues?jql=...&fields=...&startAt=0&maxResults=100'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// PM2 Status endpoint
app.get('/api/pm2-status', async (req, res) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);
    
    const backend = processes.find(p => p.name === 'jira-backend');
    const frontend = processes.find(p => p.name === 'jira-frontend');
    
    res.json({ 
      success: true,
      backend: {
        status: backend?.pm2_env?.status || 'offline',
        uptime: backend?.pm2_env?.pm_uptime || null,
        restarts: backend?.pm2_env?.restart_time || 0,
        memory: backend?.monit?.memory || 0,
        cpu: backend?.monit?.cpu || 0
      },
      frontend: {
        status: frontend?.pm2_env?.status || 'offline',
        uptime: frontend?.pm2_env?.pm_uptime || null,
        restarts: frontend?.pm2_env?.restart_time || 0,
        memory: frontend?.monit?.memory || 0,
        cpu: frontend?.monit?.cpu || 0
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'PM2 not available or no processes running',
      error: error.message 
    });
  }
});

// PM2 Start endpoint
app.post('/api/pm2-start', async (req, res) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await execAsync('npm run start:pm2');
    res.json({ 
      success: true, 
      message: 'Servers started successfully',
      output: stdout 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to start servers',
      error: error.message 
    });
  }
});

// PM2 Restart endpoint
app.post('/api/pm2-restart', async (req, res) => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout } = await execAsync('pm2 restart all');
    res.json({ 
      success: true, 
      message: 'Servers restarted successfully',
      output: stdout 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to restart servers',
      error: error.message 
    });
  }
});

// CSR Jira configuration
const CSR_JIRA_CONFIG = {
  baseUrl:  process.env.CSR_JIRA_BASE_URL  || 'https://advancedinformationservices.atlassian.net',
  email:    process.env.CSR_JIRA_EMAIL,
  apiToken: process.env.CSR_JIRA_API_TOKEN,
};

// CSR SLA bulk fetch — fetches SLA breach status for a list of issue keys
app.post('/api/jira-csr/sla-bulk', async (req, res) => {
  try {
    const { keys } = req.body; // array of issue keys
    if (!Array.isArray(keys) || keys.length === 0)
      return res.status(400).json({ error: 'keys array required' });
    if (!CSR_JIRA_CONFIG.email || !CSR_JIRA_CONFIG.apiToken)
      return res.status(500).json({ error: 'CSR Jira credentials not configured' });

    const auth = Buffer.from(`${CSR_JIRA_CONFIG.email}:${CSR_JIRA_CONFIG.apiToken}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };

    // Fetch SLA for each key with concurrency limit of 10
    const CONCURRENCY = 10;
    const results = {};
    for (let i = 0; i < keys.length; i += CONCURRENCY) {
      const batch = keys.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (key) => {
        try {
          const r = await axios.get(
            `${CSR_JIRA_CONFIG.baseUrl}/rest/servicedeskapi/request/${key}/sla`,
            { headers, timeout: 10000 }
          );
          const slaValues = r.data?.values || [];
          // Extract Time to first response and Time to resolution
          const firstResponse = slaValues.find(s => s.name === 'Time to first response');
          const resolution    = slaValues.find(s => s.name === 'Time to resolution');
          results[key] = {
            firstResponse: firstResponse?.ongoingCycle
              ? { breached: firstResponse.ongoingCycle.breached, remaining: firstResponse.ongoingCycle.remainingTime?.friendly, breachTime: firstResponse.ongoingCycle.breachTime?.iso8601 }
              : firstResponse?.completedCycles?.length
              ? { breached: firstResponse.completedCycles[firstResponse.completedCycles.length-1].breached, completed: true }
              : null,
            resolution: resolution?.ongoingCycle
              ? { breached: resolution.ongoingCycle.breached, remaining: resolution.ongoingCycle.remainingTime?.friendly, breachTime: resolution.ongoingCycle.breachTime?.iso8601 }
              : null,
          };
        } catch (_) {
          results[key] = null;
        }
      }));
    }
    res.json(results);
  } catch (err) {
    console.error('CSR SLA bulk error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// CSR Jira issues proxy
app.get('/api/jira-csr/issues', async (req, res) => {
  try {
    const { jql, fields, startAt = 0, maxResults = 100, nextPageToken } = req.query;
    if (!CSR_JIRA_CONFIG.email || !CSR_JIRA_CONFIG.apiToken)
      return res.status(500).json({ error: 'CSR Jira credentials not configured' });

    const auth = Buffer.from(`${CSR_JIRA_CONFIG.email}:${CSR_JIRA_CONFIG.apiToken}`).toString('base64');
    const params = { jql, fields, maxResults: parseInt(maxResults) };
    if (nextPageToken) params.nextPageToken = nextPageToken;
    else params.startAt = parseInt(startAt);

    const response = await axios.get(`${CSR_JIRA_CONFIG.baseUrl}/rest/api/3/search/jql`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      params,
      timeout: 30000,
    });

    const issues = response.data.issues || [];
    res.json({
      issues,
      isLast:        response.data.isLast === true,
      nextPageToken: response.data.nextPageToken || null,
    });
  } catch (error) {
    console.error('CSR Jira API error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'CSR Jira API Error',
      message: error.message,
      details: error.response?.data,
    });
  }
});

// Check Jira configuration
app.get('/api/jira-config', (req, res) => {
  console.log('Config check requested');
  res.json({
    hasCredentials: true,
    baseUrl: JIRA_CONFIG.baseUrl,
    email: JIRA_CONFIG.email
  });
});

// Get issues from Jira
app.get('/api/jira/issues', async (req, res) => {
  try {
    const { jql, fields, startAt = 0, maxResults = 100, nextPageToken } = req.query;

    console.log('=== JIRA API REQUEST ===');
    console.log('JQL:', jql);
    console.log('StartAt:', startAt);
    console.log('MaxResults:', maxResults);
    console.log('NextPageToken:', nextPageToken ? 'Present' : 'None');

    if (!jql) {
      console.log('ERROR: No JQL provided');
      return res.status(400).json({ 
        error: 'JQL query is required',
        example: '/api/jira/issues?jql=project=DND&fields=summary,assignee'
      });
    }

    // Create Basic Auth
    const auth = Buffer.from(
      `${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`
    ).toString('base64');

    console.log('Making request to Jira API...');

    // Use new Jira search/jql API endpoint (GET method with query params)
    const jiraUrl = `${JIRA_CONFIG.baseUrl}/rest/api/3/search/jql`;
    console.log('URL:', jiraUrl);

    const requestParams = {
      jql: jql,
      fields: fields,
      maxResults: parseInt(maxResults)
    };

    // Use nextPageToken if provided, otherwise use startAt
    if (nextPageToken) {
      requestParams.nextPageToken = nextPageToken;
    } else {
      requestParams.startAt = parseInt(startAt);
    }

    const response = await axios.get(jiraUrl, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      params: requestParams,
      timeout: 30000 // 30 second timeout
    });

    console.log('✓ Jira API Response:', {
      issuesReturned: response.data.issues?.length || 0,
      isLast: response.data.isLast,
      hasNextPageToken: !!response.data.nextPageToken
    });

    // The new API uses isLast and nextPageToken for pagination
    const issues = response.data.issues || [];
    const isLast = response.data.isLast === true;
    const nextToken = response.data.nextPageToken || null;
    
    const compatibleResponse = {
      issues,
      total: issues.length, // New API doesn't provide total count
      startAt: parseInt(startAt),
      maxResults: parseInt(maxResults),
      isLast,
      nextPageToken: nextToken
    };

    res.json(compatibleResponse);

  } catch (error) {
    console.error('=== JIRA API ERROR ===');
    console.error('Error Type:', error.name);
    console.error('Error Message:', error.message);
    
    if (error.response) {
      // Jira API returned an error
      console.error('Jira Response Status:', error.response.status);
      console.error('Jira Response Data:', JSON.stringify(error.response.data, null, 2));
      
      return res.status(error.response.status).json({
        error: 'Jira API Error',
        message: error.message,
        jiraError: error.response.data
      });
    } else if (error.request) {
      // Request was made but no response
      console.error('No response from Jira');
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Could not connect to Jira API'
      });
    } else {
      // Something else went wrong
      console.error('Error Details:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  }
});

// Get all projects from Jira
app.get('/api/jira/projects', async (req, res) => {
  try {
    const auth = Buffer.from(
      `${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`
    ).toString('base64');

    const response = await axios.get(`${JIRA_CONFIG.baseUrl}/rest/api/3/project`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching projects:', error.message);
    res.status(500).json({
      error: 'Failed to fetch projects',
      message: error.message
    });
  }
});

// Get all boards from Jira
app.get('/api/jira/boards', async (req, res) => {
  try {
    const { projectKeyOrId } = req.query;
    const auth = Buffer.from(
      `${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`
    ).toString('base64');

    let url = `${JIRA_CONFIG.baseUrl}/rest/agile/1.0/board`;
    if (projectKeyOrId) {
      url += `?projectKeyOrId=${projectKeyOrId}`;
    }

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching boards:', error.message);
    res.status(500).json({
      error: 'Failed to fetch boards',
      message: error.message
    });
  }
});

// Get sprints for a board
app.get('/api/jira/sprints/:boardId', async (req, res) => {
  try {
    const { boardId } = req.params;
    const { state = 'active,future' } = req.query;
    
    const auth = Buffer.from(
      `${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`
    ).toString('base64');

    const response = await axios.get(`${JIRA_CONFIG.baseUrl}/rest/agile/1.0/board/${boardId}/sprint`, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      params: { state },
      timeout: 30000
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching sprints:', error.message);
    res.status(500).json({
      error: 'Failed to fetch sprints',
      message: error.message
    });
  }
});

// Serve React app for all non-API routes (must be after all API routes)
if (hasDist) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api/jira-config',
      'GET /api/jira/issues'
    ]
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('Jira Configuration:');
  console.log('  Base URL:', JIRA_CONFIG.baseUrl);
  console.log('  Email:', JIRA_CONFIG.email);
  console.log('  API Token:', JIRA_CONFIG.apiToken ? '✓ Configured' : '✗ Missing');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Test the server:');
  console.log(`  curl http://localhost:${PORT}`);
  console.log(`  curl http://localhost:${PORT}/api/jira-config`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('Ready to accept requests!');
  console.log('Press Ctrl+C to stop the server');
  console.log('═══════════════════════════════════════════════════════');
});

// Error handling to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Server continues running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Server continues running
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server gracefully');
  const { closePool } = require('./db/oracle');
  closePool().catch(() => {});
  if (server) {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server gracefully');
  const { closePool } = require('./db/oracle');
  closePool().catch(() => {});
  if (server) {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }
});