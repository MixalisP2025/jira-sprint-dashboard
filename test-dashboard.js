#!/usr/bin/env node

/**
 * Test script to verify dashboard fixes
 * Run with: node test-dashboard.js
 */

const axios = require('axios');

const API_BASE = 'http://localhost:4001/api';

async function testDashboard() {
  console.log('🧪 Testing Dashboard Fixes...\n');

  try {
    // Test 1: Check if server is running
    console.log('1️⃣ Testing server connection...');
    const healthResponse = await axios.get('http://localhost:4001/health');
    console.log('✅ Server is running:', healthResponse.data);

    // Test 2: Check Jira config
    console.log('\n2️⃣ Testing Jira configuration...');
    const configResponse = await axios.get(`${API_BASE}/jira-config`);
    console.log('✅ Jira config:', configResponse.data);

    // Test 3: Test a simple JQL query
    console.log('\n3️⃣ Testing Jira API with simple query...');
    const testJql = 'project = "DND" ORDER BY updated DESC';
    const issuesResponse = await axios.get(`${API_BASE}/jira/issues`, {
      params: {
        jql: testJql,
        fields: 'summary,assignee,project',
        maxResults: 5
      }
    });
    
    console.log('✅ Jira API response:', {
      total: issuesResponse.data.total,
      returned: issuesResponse.data.issues?.length || 0,
      sample: issuesResponse.data.issues?.[0] ? {
        key: issuesResponse.data.issues[0].key,
        summary: issuesResponse.data.issues[0].fields?.summary,
        assignee: issuesResponse.data.issues[0].fields?.assignee?.displayName || 'Unassigned'
      } : 'No issues returned'
    });

    console.log('\n🎉 All tests passed! Dashboard should be working now.');
    console.log('\n📋 Next steps:');
    console.log('1. Install dotenv in server: cd server && npm install');
    console.log('2. Start the server: cd server && npm start');
    console.log('3. Start the frontend: npm run dev');
    console.log('4. Click the refresh button in the dashboard');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Server is not running. Start it with:');
      console.log('   cd server && npm start');
    } else if (error.response) {
      console.log('\n📋 Server response:', error.response.data);
    }
  }
}

// Run the test
testDashboard();