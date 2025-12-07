# Azure DevOps Proxy Setup Guide

## Problem
You're seeing this error from `/api/sprint-progress`:
```json
{
  "error": "Missing organizationUrl or personalAccessToken",
  "config": { "orgUrl": null, "source": "none" }
}
```

## Solution
The backend proxy needs your Azure DevOps credentials to fetch sprint work items. Choose **Method 1 (Config File)** for local development or **Method 2 (Environment Variables)** for CI/CD.

---

## Method 1: Config File (Recommended for Local Development)

### Step 1: Create azdo.config.json

Copy the example file:
```powershell
Copy-Item azdo.config.json.example azdo.config.json
```

Or create a new file named `azdo.config.json` in the **PROJECT ROOT** (same directory as `package.json`):

```json
{
  "organizationUrl": "https://dev.azure.com/yourOrgName",
  "personalAccessToken": "your-personal-access-token-here",
  "apiVersion": "6.0"
}
```

### Step 2: Fill in your values

- **organizationUrl**: Replace `yourOrgName` with your Azure DevOps organization name
  - Example: `https://dev.azure.com/contoso`
- **personalAccessToken**: Create a PAT at https://dev.azure.com/yourOrg/_usersSettings/tokens
  - Required scopes: Work Items (Read)
  - Copy the generated token and paste it here

### Step 3: Verify the file is in .gitignore

The file `azdo.config.json` should already be in `.gitignore` to prevent committing your PAT. If not, add this line to `.gitignore`:
```
azdo.config.json
```

### Step 4: Restart the proxy

```powershell
npm run start:proxy
```

You should see output like:
```
✓ Loaded AZDO config from: C:\...\jira-sprint-dashboard\azdo.config.json
AZDO proxy listening on 4000
```

---

## Method 2: Environment Variables (Recommended for CI/CD)

### PowerShell

Set environment variables before starting the proxy:
```powershell
$env:AZDO_ORG_URL='https://dev.azure.com/yourOrgName'
$env:AZDO_PAT='your-personal-access-token'
npm run start:proxy
```

Or one-liner:
```powershell
$env:AZDO_ORG_URL='https://dev.azure.com/yourOrgName'; $env:AZDO_PAT='yourPAT'; npm run start:proxy
```

### Bash / Linux / macOS

```bash
export AZDO_ORG_URL='https://dev.azure.com/yourOrgName'
export AZDO_PAT='your-personal-access-token'
npm run start:proxy
```

You should see output like:
```
✓ Using AZDO config from environment variables
AZDO proxy listening on 4000
```

---

## Verify Your Setup

### Check if credentials are loaded

```powershell
Invoke-RestMethod -Uri 'http://localhost:4000/api/azdo-config' -Method Get
```

Expected response when configured:
```json
{
  "hasCredentials": true,
  "orgUrl": "https://dev.azure.com/yourOrg",
  "apiVersion": "6.0",
  "source": "file"
}
```

Expected response when NOT configured:
```json
{
  "hasCredentials": false,
  "orgUrl": null,
  "apiVersion": "6.0",
  "source": "none"
}
```

### Test the sprint-progress endpoint

```powershell
Invoke-RestMethod -Uri 'http://localhost:4000/api/sprint-progress' -Method Post -Body (ConvertTo-Json @{ groupBy = 'AreaPath' }) -ContentType 'application/json'
```

Expected response (real data):
```json
{
  "groups": [
    {
      "key": "Project\\Team\\Area",
      "itemsCount": 15,
      "completedCount": 8,
      "totalSP": 42,
      "completedSP": 25,
      "percent": 59.52
    }
  ]
}
```

If you see this response, the proxy is working correctly! 🎉

---

## Troubleshooting

### "No azdo.config.json found"
The proxy searches these locations (in order):
1. `<project-root>/azdo.config.json` ← **PLACE IT HERE**
2. `<project-root>/server/azdo.config.json`
3. Custom path set via `AZDO_CONFIG_PATH` env var

Make sure the file is in the project root (same directory as `package.json`).

### "WIQL failed: 401 Unauthorized"
Your Personal Access Token is invalid or expired. Create a new PAT at:
https://dev.azure.com/yourOrg/_usersSettings/tokens

Required scopes: Work Items (Read)

### "WIQL failed: 203 Non-Authoritative Information" or empty groups
The token is valid but you may not have access to the project, or there are no work items in the current iteration. Verify:
1. You have access to the Azure DevOps project
2. There are work items in the current sprint/iteration
3. The iteration path filter `@CurrentIteration` matches your team's current sprint

### Proxy not picking up config changes
Stop and restart the proxy:
```powershell
# Find the process
Get-Process -Name node | Where-Object { $_.CommandLine -match 'proxy.js' }

# Stop it (replace PID with actual process ID)
Stop-Process -Id <PID> -Force

# Restart
npm run start:proxy
```

---

## Security Best Practices

1. **Never commit azdo.config.json** with real credentials to git
2. Use environment variables in CI/CD pipelines (GitHub Secrets, Azure DevOps Variable Groups)
3. Rotate your PAT regularly (Azure DevOps allows setting expiration dates)
4. Use the minimum required scope (Work Items - Read) for your PAT
5. Keep `azdo.config.json` in `.gitignore` (already added)

---

## Next Steps

Once the proxy is working and returning sprint data:
1. Open the dashboard in your browser (http://localhost:5173)
2. Navigate to the Sprint Progress Summary section
3. Click "Refresh" to fetch current iteration work items
4. Verify the progress bars show real data from Azure DevOps

For mapping upload and suggestion verification, see the main README.md.
