@echo off
echo ========================================
echo  Deploying changes to localhost:4001
echo ========================================
echo.
echo  Building...
call npm run build
if %errorlevel% neq 0 (
  echo  Build failed!
  pause
  exit /b 1
)
echo.
echo  Restarting server...
call pm2 restart jira-backend
echo.
echo ========================================
echo  Done! Refresh your app at localhost:4001
echo  (Ctrl+Shift+R for a hard refresh)
echo ========================================
pause
