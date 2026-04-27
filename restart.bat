@echo off
echo ========================================
echo  Rebuilding and Restarting Dashboard
echo ========================================
echo.
echo  Step 1: Building frontend...
call npm run build
if %errorlevel% neq 0 (
  echo  Build failed!
  pause
  exit /b 1
)
echo.
echo  Step 2: Restarting backend server...
call pm2 restart jira-backend 2>nul || call pm2 start ecosystem.config.cjs
echo.
echo ========================================
echo  Done! Hard refresh your app (Ctrl+Shift+R)
echo  App: http://localhost:4001
echo ========================================
echo.
timeout /t 5
