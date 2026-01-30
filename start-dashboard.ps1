# Jira Sprint Dashboard Startup Script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Jira Sprint Dashboard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting both Backend and Frontend servers..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Backend will run on: http://localhost:4001" -ForegroundColor Green
Write-Host "Frontend will run on: http://localhost:5174" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop both servers" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

npm start
