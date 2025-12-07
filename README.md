# React + Vite

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
