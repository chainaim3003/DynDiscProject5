# ============================================================================
# stop-all-agents.ps1 -- Stop all 8 agents by killing whoever owns their port
# ============================================================================
#
# Finds the process holding each known agent port and stops it. This kills
# the Node process for the agent but does NOT close the spawned PowerShell
# windows themselves (they remain open showing "Agent stopped -- press any
# key to close").
#
# Usage:
#   .\stop-all-agents.ps1
# ============================================================================

$AgentPorts = @{
    "buyer"           = 9090
    "seller"          = 8080
    "treasury"        = 7070
    "credit"          = 7071
    "inventory"       = 7072
    "logistics"       = 7073
    "audit-reporting" = 7074
    "audit-query"     = 5000
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Stopping all agents by port"                                 -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

foreach ($name in $AgentPorts.Keys) {
    $port = $AgentPorts[$name]

    # Get-NetTCPConnection returns one or more entries per listening port.
    $conn = $null
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    } catch {
        Write-Host "  [skip] $name on port $port -- no listener" -ForegroundColor DarkGray
        continue
    }

    # OwningProcess is the PID. There can be multiple connection rows for
    # the same listener; dedupe by PID.
    $pids = @($conn | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($targetPid in $pids) {
        try {
            $proc = Get-Process -Id $targetPid -ErrorAction Stop
            Stop-Process -Id $targetPid -Force -ErrorAction Stop
            Write-Host "  [OK]   stopped $name (pid $targetPid, $($proc.ProcessName)) on port $port" -ForegroundColor Green
        } catch {
            Write-Host "  [warn] could not stop $name pid $targetPid on port $port -- $_" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Closing agent windows..." -ForegroundColor Cyan

# run-all-agents.ps1 launched each agent in its own window via
# Start-Process powershell.exe -NoExit, setting the window title to
# "<Name> (port <Port>)". Killing the agent's node process above does NOT
# close that window (it was spawned with -NoExit), so here we find each
# window's PowerShell host process by that title and stop it — which closes
# the window. Independent of the port loop above so windows still close even
# if the agent had already stopped/crashed. Guards: never the current script
# process ($PID), and only powershell/pwsh hosts (so an unrelated app whose
# title happens to contain "(port NNNN)" is never touched).
foreach ($name in $AgentPorts.Keys) {
    $port = $AgentPorts[$name]
    $windows = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -ne $PID -and
        ($_.ProcessName -eq 'powershell' -or $_.ProcessName -eq 'pwsh') -and
        $_.MainWindowTitle -like "*(port $port)*"
    }
    foreach ($w in $windows) {
        try {
            Stop-Process -Id $w.Id -Force -ErrorAction Stop
            Write-Host "  [OK]   closed window '$($w.MainWindowTitle)' (pid $($w.Id))" -ForegroundColor Green
        } catch {
            Write-Host "  [warn] could not close window for $name on port $port -- $_" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Done. All agents stopped and their windows closed." -ForegroundColor Cyan
Write-Host ""
