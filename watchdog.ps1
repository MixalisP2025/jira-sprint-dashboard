# PM2 Watchdog - checks every 5 min via Task Scheduler
$projectDir = "C:\Users\pmichalis\Documents\jira-sprint-dashboard"
$pm2        = "C:\Users\pmichalis\AppData\Roaming\npm\pm2.cmd"
$logFile    = "$projectDir\watchdog.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $logFile "$ts  $msg"
}

if (Test-Path $logFile) {
    $lines = Get-Content $logFile
    if ($lines.Count -gt 500) {
        $lines | Select-Object -Last 400 | Set-Content $logFile
    }
}

Set-Location $projectDir

function StartBackend {
    & cmd /c "`"$pm2`" start ecosystem.config.cjs" | Out-Null
    & cmd /c "`"$pm2`" save" | Out-Null
}

# Use pm2 describe which gives simpler output than jlist
$descOutput = & cmd /c "`"$pm2`" describe jira-backend 2>&1"
$isOnline   = $descOutput | Select-String "online" -Quiet

if ($isOnline) {
    Log "OK - jira-backend is online"
} else {
    Log "DOWN - jira-backend not running, restarting..."
    StartBackend
    Log "RESTARTED - jira-backend is back up"
}
