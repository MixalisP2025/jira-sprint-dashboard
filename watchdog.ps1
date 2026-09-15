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
    # Oracle circuit-breaker state. /api/db/status reads in-memory state only and
    # never opens a database connection, so polling it adds no load on DBSRV.
    # The original outage went unnoticed for weeks; this makes it show up here.
    try {
        $db = Invoke-RestMethod -Uri "http://localhost:4001/api/db/status" -TimeoutSec 10 -UseBasicParsing
        if ($db.state -eq "closed") {
            Log "OK - jira-backend is online, Oracle connection healthy"
        } else {
            $err = if ($db.lastError) { $db.lastError.message } else { "no error recorded" }
            Log "DB ALERT - Oracle breaker is '$($db.state)' after $($db.consecutiveFailures) failure(s): $err"
            if ($db.state -eq "blocked") {
                Log "DB ALERT - login rejected; not retrying. Fix the Oracle account/password, then run: pm2 restart jira-backend"
            }
        }
    } catch {
        Log "DB ALERT - could not read /api/db/status: $($_.Exception.Message)"
    }
} else {
    Log "DOWN - jira-backend not running, restarting..."
    StartBackend
    Log "RESTARTED - jira-backend is back up"
}
