// Jira Configuration
export const JIRA_CONFIG = {
  // Projects to fetch data from - ALL ACTIVE PROJECTS
  // Format: 'KEY' or { key: 'KEY', name: 'Project Name' }
  projects: ['DND', 'CSFR', 'AISITS', 'ACI', 'CSR', 'AFMS', 'AFSDWAM', 'BROAD', 'BMS', 'CADEP', 'CCTA', 'CTONGO', 'CABO', 'CPM', 'CS000344', 'CFT', 'CS00300', 'CS00304', 'CS00332', 'INSETT', 'CSAU', 'IRROA', 'SMSI', 'CS00386', 'CSDRECONC', 'CS00398A', 'CS00398B', 'CNBIL408', 'CS00415PT', 'CSB', 'CS00429', 'CS00434', 'CBAHESF', 'CS441SAPD', 'COGP', 'TRFCSPRM', 'CCPI', 'DRM', 'DWHP', 'NXCLR', 'ECBS', 'FAA', 'FSM', 'BSWAP21', 'ISE', 'INTTAX', 'MOS', 'MDP', 'MCA', 'OGSN', 'OTPCA', 'PIR', 'PIRSOW', 'PEWS', 'PS', 'RC', 'RF', 'RB', 'SSP', 'SRFCSS', 'SETINPFILE', 'SSLM', 'SD', 'SIR', 'SPROJ', 'SRDUAT', 'STLU', 'SI', 'T2S', 'TT', 'TP', 'T0ORS', 'UP', 'UPB', 'UPNTOLD', 'WFNDS', 'WBILL', 'XPRES', 'XPONGO', 'QO00443'],
  
  // Project names mapping (optional - will be fetched from Jira if not provided)
  projectNames: {
    // Example: 'DND': 'Digital and Data',
    // Add your project names here for display in config panel
  },
  
  // Date range for data fetching
  dateRange: {
    // Fetch data from last 365 days (1 year) to capture all active work
    daysBack: 365,
    
    // You can also use specific dates:
    // fromDate: '2024-01-01',
    // toDate: '2025-12-31'
  },
  
  // Fields to fetch from Jira - CORRECT FIELD IDs FROM YOUR JIRA INSTANCE
  fields: [
    // Basic fields
    'summary',
    'status', 
    'assignee',
    'reporter',
    'created',
    'updated',
    'duedate',
    'priority',
    'issuetype',
    'issuekey',
    'project',
    'resolution',
    
    // Sprint and story points - CORRECTED TO YOUR JIRA INSTANCE
    'customfield_10010', // Sprint
    'customfield_10054', // Story point estimate (JSW standard) - PRIMARY
    'customfield_10050', // Story Points (custom field) - FALLBACK
    
    // Dates - CORRECTED
    'customfield_10052', // Start date (was 10017)
    'customfield_10059', // Target end (was 10016)
    
    // Versions
    'fixVersions',
    'customfield_10217', // Fix Version Live (was 10009)
    
    // Time tracking
    'timeoriginalestimate',
    'aggregatetimeoriginalestimate', // Σ Original Estimate
    
    // Custom fields - CORRECTED TO YOUR JIRA INSTANCE
    'customfield_10001', // Team (was 10007)
    'customfield_10005', // Epic Name (was 10008)
    'customfield_10283', // Versioning Not Required (was 10011)
    'customfield_10352', // Escalate to 2nd Level Support (was 10012)
    'customfield_10481', // Awaiting Versioning (was 10013)
    'customfield_10515'  // Allocation Status (was 10014)
  ],
  
  // Pagination settings - increased to capture more data
  pagination: {
    maxResults: 100,
    maxTotalIssues: 0 // 0 means "no artificial cap" - fetch all issues
  }
};

// Helper function to build JQL query
export const buildJQL = (config = JIRA_CONFIG) => {
  const parts = [];
  
  // Add project filtering - THIS WAS THE MISSING PIECE!
  if (config.projects && config.projects.length > 0) {
    const projectList = config.projects.map(p => `"${p}"`).join(',');
    parts.push(`project in (${projectList})`);
  }
  
  // Add date filtering if specified
  if (config.dateRange?.daysBack) {
    parts.push(`updated >= -${config.dateRange.daysBack}d`);
  } else if (config.dateRange?.fromDate) {
    parts.push(`updated >= "${config.dateRange.fromDate}"`);
    if (config.dateRange.toDate) {
      parts.push(`updated <= "${config.dateRange.toDate}"`);
    }
  }
  
  // Only add default date filter if NO filters at all (no projects, no dates)
  if (parts.length === 0) {
    parts.push('updated >= -730d');
  }
  
  const jql = parts.join(' AND ');
  console.log('Generated JQL:', jql);
  return jql;
};

// Helper function to get fields string for API
export const getFieldsString = (config = JIRA_CONFIG) => {
  return config.fields.join(',');
};