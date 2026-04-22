# Sprint Analytics Dashboard — Single App Startup
# Always use http://localhost:4001 — no need for localhost:5174

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sprint Analytics Dashboard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Building frontend..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Check errors above." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Starting backend server..." -ForegroundColor Yellow
$pm2Running = pm2 list 2>$null | Select-String "jira-backend"
if ($pm2Running) {
    pm2 restart jira-backend
} else {
    pm2 start ecosystem.config.cjs
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  App running at: http://localhost:4001" -ForegroundColor Green
Write-Host "  This is the ONLY URL you need." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To deploy code changes in future, just run:" -ForegroundColor Cyan
Write-Host "  npm run deploy" -ForegroundColor White
Write-Host ""
