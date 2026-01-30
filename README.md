# Jira Sprint Dashboard

A comprehensive Sprint Analytics Dashboard that integrates with Jira to provide real-time insights into sprint progress, team capacity, and workload distribution.

## 🚀 Quick Start

### Option 1: One Command (Recommended)
Start both backend and frontend servers simultaneously:

```bash
npm start
```

Or use the convenient startup scripts:

**Windows (Command Prompt):**
```cmd
start-dashboard.bat
```

**Windows (PowerShell):**
```powershell
.\start-dashboard.ps1
```

This will start:
- **Backend Server**: http://localhost:4001
- **Frontend Server**: http://localhost:5174

Press `Ctrl+C` to stop both servers.

### Option 2: Manual Start (Individual Servers)

**Start Backend Only:**
```bash
npm run start:backend
```

**Start Frontend Only:**
```bash
npm run start:frontend
```

## 📋 Prerequisites

1. **Node.js** (v16 or higher)
2. **npm** (comes with Node.js)
3. **Jira Account** with API access

## 🔧 Setup

### 1. Install Dependencies

```bash
npm install
cd server
npm install
cd ..
```

### 2. Configure Jira Credentials

Create a `.env` file in the `server` directory:

```env
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-jira-api-token
```

**How to get a Jira API Token:**
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a name and copy the token
4. Paste it in your `.env` file

### 3. Update Jira Configuration

Edit `src/config/jiraConfig.js` to match your Jira instance:
- Update project keys in the `projects` array
- Verify custom field IDs match your Jira instance

## 📊 Features

- **Real-time Jira Integration**: Fetch data directly from Jira API
- **Capacity Planning**: Track team capacity vs active workload
- **Sprint Analytics**: Monitor sprint progress and completion rates
- **Risk Management**: Identify overloaded team members and at-risk items
- **Workload Distribution**: Visualize team workload across projects
- **File Upload**: Support for CSV/TSV Jira exports

## 🛠️ Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start both backend and frontend servers |
| `npm run start:all` | Same as `npm start` |
| `npm run start:backend` | Start only the backend server |
| `npm run start:frontend` | Start only the frontend server |
| `npm run dev` | Start frontend in development mode |
| `npm run build` | Build for production |
| `npm test` | Run tests |
| `npm run lint` | Run ESLint |

## 📁 Project Structure

```
jira-sprint-dashboard/
├── server/                 # Backend Express server
│   ├── server.js          # Main server file
│   ├── .env               # Environment variables (create this)
│   └── package.json       # Backend dependencies
├── src/                   # Frontend React application
│   ├── components/        # React components
│   ├── config/           # Configuration files
│   ├── utils/            # Utility functions
│   └── SprintDashboard.jsx # Main dashboard component
├── start-dashboard.bat    # Windows batch startup script
├── start-dashboard.ps1    # PowerShell startup script
└── package.json          # Root dependencies
```

## 🔒 Security Notes

- Never commit `.env` files or API tokens to version control
- The `.env` file is already in `.gitignore`
- Keep your Jira API token secure and rotate it regularly

## 🐛 Troubleshooting

**Port Already in Use:**
If you see "Port 4001 already in use", stop any running backend servers:
```bash
# Find and kill process on port 4001 (Windows)
netstat -ano | findstr :4001
taskkill /PID <PID> /F
```

**Jira Connection Issues:**
- Verify your `.env` file is in the `server` directory
- Check that your Jira API token is valid
- Ensure your Jira base URL is correct (no trailing slash)

**No Data Showing:**
- Click "Refresh from Jira" button
- Check browser console for errors
- Verify custom field IDs in `src/config/jiraConfig.js` match your Jira instance

## 📝 License

This project is private and proprietary.

---

## React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Azure DevOps proxy (local dev)

This project includes a small server-side proxy at `/api/sprint-progress` that can query Azure DevOps for the current iteration's work items. The proxy needs two values to be configured: `organizationUrl` and `personalAccessToken` (PAT).

Provide settings using one of the following methods (prefer env vars or a local config file):

1) Environment variables (recommended)

PowerShell example:

```powershell
$env:AZDO_ORG_URL='https://dev.azure.com/yourOrg'
$env:AZDO_PAT='yourPersonalAccessToken'
npm run start:proxy
```

2) Config file (project root)

Create `azdo.config.json` in the project root (do not commit this file):

```json
{
	"organizationUrl": "https://dev.azure.com/yourOrg",
	"personalAccessToken": "<YOUR_PERSONAL_ACCESS_TOKEN>",
	"apiVersion": "6.0"
}
```

Then start the proxy:

```powershell
npm run start:proxy
```

3) One-off POST (local testing only)

You can POST credentials to the `/api/sprint-progress` endpoint for quick local testing (not for production):

```powershell
Invoke-RestMethod -Uri 'http://localhost:4000/api/sprint-progress' -Method Post -Body (ConvertTo-Json @{ organizationUrl = 'https://dev.azure.com/yourOrg'; personalAccessToken = 'yourPAT'; groupBy = 'AreaPath' }) -ContentType 'application/json'
```

Check whether the proxy has credentials configured (endpoint does NOT reveal your PAT):

```powershell
Invoke-RestMethod -Uri 'http://localhost:4000/api/azdo-config' -Method Get
```

Fetch sprint groups once credentials are set:

```powershell
Invoke-RestMethod -Uri 'http://localhost:4000/api/sprint-progress' -Method Post -Body (ConvertTo-Json @{ groupBy = 'AreaPath' }) -ContentType 'application/json'
```

Security note: Never commit a real PAT to the repository. Add `azdo.config.json` to `.gitignore` if you use a config file locally.

## Jira CSV loader and `project` config

If your WIQL uses `@CurrentIteration`, the WIQL query must be executed in a project/team context so `@CurrentIteration` can be resolved. You can configure the project used by the proxy via `azdo.config.json` or environment variable.

Example `azdo.config.json` snippet:

```json
{
	"organizationUrl": "https://dev.azure.com/yourOrgName",
	"personalAccessToken": "your-personal-access-token-here",
	"project": "YourProjectName",
	"apiVersion": "6.0"
}
```

New endpoint: `POST /api/jira-sprint-progress`
- Accepts a Jira CSV/TSV export as raw `csv` text or a `rows` array of objects and a `sprintName` string.
- Filters rows to the given sprint, groups by `Project`, excludes subtasks, and computes per-project progress:
	- `totalSP`: sum of Story Points for parent issues
	- `completedSP`: sum of Story Points where `Status === "Done"` or `Resolution === "Done"`
	- If `totalSP > 0`: `percent = completedSP / totalSP`
	- Otherwise: `percent = completedItemCount / totalItemCount` (fallback using counts)

Example PowerShell POST:

```powershell
$csv = Get-Content -Raw '.\my-jira-export.csv'
$body = @{ csv = $csv; sprintName = 'Sprint 12 24-11-25 to 05-12-25' } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://localhost:4000/api/jira-sprint-progress' -Method Post -ContentType 'application/json' -Body $body
```

After installing dependencies (`npm install`) and starting the proxy (`npm run start:proxy`), the frontend Sprint Progress component will show a CSV paste UI when Azure DevOps credentials are not configured, allowing you to paste a Jira export and load per-project progress for a given sprint.
