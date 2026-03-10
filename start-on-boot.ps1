# ─── Auto-start script for Windows Task Scheduler ───────────────────────────
# This script is called by Task Scheduler on user login.
# It builds the frontend and starts the PM2 backend server.

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

# Build the frontend (ensures latest code is always served)
Write-Host "Building frontend..." -ForegroundColor Cyan
npm run build

# Start PM2 with saved process list
Write-Host "Starting PM2 servers..." -ForegroundColor Cyan
pm2 resurrect

# If resurrect fails (first time), start fresh
pm2 start ecosystem.config.cjs

Write-Host "Dashboard running at http://localhost:4001" -ForegroundColor Green
