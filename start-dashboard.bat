@echo off
echo ========================================
echo  Sprint Analytics Dashboard
echo ========================================
echo.
echo  Building frontend...
call npm run build
if %errorlevel% neq 0 (
  echo  Build failed! Check errors above.
  pause
  exit /b 1
)
echo.
echo  Starting backend server...
call pm2 restart jira-backend 2>nul || call pm2 start ecosystem.config.cjs
echo.
echo ========================================
echo  App is running at: http://localhost:4001
echo  This is the ONLY URL you need.
echo ========================================
echo.
pause
