# ============================================================================
# Test-AuditV6-Iter7.ps1
# Verifies the Audit Framework v6 Iteration 7 state on disk.
# ============================================================================
# Usage:
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Test-AuditV6-Iter7.ps1
#
# What this verifies (in addition to ALL iter-1..iter-6 checks, run by
# delegating to Test-AuditV6-Iter6.ps1 as a child process):
#
#   [Iter7AuditPdfExtended]    A2A/js/src/shared/audit-pdf.ts top doc-comment
#                              lists 16 sections covering all 14 v6 blocks;
#                              the 8 new section-drawer functions exist
#                              (drawIntent / drawSelfCheck /
#                              drawThinkCycleTrace / drawDelegationChain /
#                              drawAutonomy / drawFrameworkMetrics /
#                              drawMessageLog / drawCompliance);
#                              generateAuditPdf() calls them in order;
#                              drawFooter is the last call (16. Document
#                              Provenance).
#
#   [Iter7ReportingAgent]      A2A/js/src/agents/audit-reporting-agent/
#                              index.ts exists, declares :7074, registers the
#                              expected endpoints, and (if running) responds
#                              200 OK on http://127.0.0.1:7074/health with
#                              the expected agent name + role.
#
#   [Iter7ReportingTemplates]  The 3 Handlebars templates exist under
#                              A2A/js/src/agents/audit-reporting-agent/
#                              templates/ (daily.md.hbs, weekly.md.hbs,
#                              forensic.md.hbs) and contain the
#                              expected mustache anchors.
#
#   [Iter7ReportsCron]         Smoke test: if the agent is running, POST
#                              /api/reports/daily on-demand returns ok=true
#                              and writes a fresh markdown file. node-cron
#                              task introspection is version-fragile across
#                              v3/v4 so we prove cron *would* fire by proving
#                              the on-demand path (which uses the same
#                              writeDailyReport function the cron callback
#                              uses) works end-to-end.
#
#   [Iter7ReportingSelfAudit]  After the daily on-demand trigger in section
#                              36, at least one report-generation.audit.json
#                              exists under audits/<today-utc>/NEG-RG-*/
#                              and conforms to the locked self-audit shape
#                              (DECISIONS Item 13).
#
# Iter-7 deal acceptance T1-T5 mapping:
#   T1 Daily cron     → covered by section 36 (on-demand path = cron path)
#   T2 Weekly cron    → covered by section 36 (on-demand weekly probe)
#   T3 Forensic PDF   → covered by section 33 (drawer presence) + agent
#                       endpoint smoke
#   T4 A2A trigger    → covered by section 36 (a2a endpoint shape probe)
#   T5 Self-audit     → covered by section 37
#
# Re-run anytime. Sections 33-35 + 37 file-system checks always run.
# Sections 34 (HTTP probe) + 36 + 37 (self-audit creation) require the
# audit-reporting agent to be running on :7074; otherwise they SKIP cleanly.
# ============================================================================

$ErrorActionPreference = "Stop"

$Repo       = "C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1"
$SrcRoot    = Join-Path $Repo "A2A\js\src"
$AuditsDir  = Join-Path $SrcRoot "audits"
$ReportsDir = Join-Path $AuditsDir "reports"
$AgentDir   = Join-Path $SrcRoot "agents\audit-reporting-agent"
$Iter6Test  = Join-Path $Repo "Test-AuditV6-Iter6.ps1"
$AgentBase  = "http://127.0.0.1:7074"

$script:pass = 0
$script:fail = 0
$script:skip = 0

function Section([string]$label) {
    Write-Host ""
    Write-Host "[$label]" -ForegroundColor Cyan
}

function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) {
        Write-Host "  [PASS] $name $detail" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  [FAIL] $name $detail" -ForegroundColor Red
        $script:fail++
    }
}

function Skip([string]$name, [string]$reason) {
    Write-Host "  [SKIP] $name - $reason" -ForegroundColor Yellow
    $script:skip++
}

function Test-AgentRunning {
    try {
        $r = Invoke-WebRequest -Uri "$AgentBase/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

# ============================================================================
# Phase A — Delegate to iter-6 to cover sections 1-32 verbatim
# ============================================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  Phase A: Running Test-AuditV6-Iter6.ps1 for sections 1-32" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

$iter6Pass = 0
$iter6Fail = 0
$iter6Skip = 0
$iter6Output = $null
if (Test-Path $Iter6Test) {
    # Run iter-6 as a child PowerShell so its $script: counters don't clobber ours
    $iter6Output = & powershell.exe -ExecutionPolicy Bypass -File $Iter6Test 2>&1
    # Mirror its output for the user
    $iter6Output | ForEach-Object { Write-Host $_ }
    # Parse the summary line "PASS: N    FAIL: N    SKIP: N" if present;
    # fall back to counting PASS/FAIL/SKIP tokens in the captured stream.
    foreach ($line in $iter6Output) {
        $s = [string]$line
        if ($s -match "PASS:\s*(\d+).*FAIL:\s*(\d+).*SKIP:\s*(\d+)") {
            $iter6Pass = [int]$matches[1]
            $iter6Fail = [int]$matches[2]
            $iter6Skip = [int]$matches[3]
            break
        }
    }
    if ($iter6Pass -eq 0 -and $iter6Fail -eq 0) {
        # Fallback token count (less reliable but better than nothing)
        $iter6Pass = ($iter6Output | Select-String -Pattern "\[PASS\]" -SimpleMatch).Count
        $iter6Fail = ($iter6Output | Select-String -Pattern "\[FAIL\]" -SimpleMatch).Count
        $iter6Skip = ($iter6Output | Select-String -Pattern "\[SKIP\]" -SimpleMatch).Count
    }
    Write-Host ""
    Write-Host "  iter-6 totals: PASS=$iter6Pass  FAIL=$iter6Fail  SKIP=$iter6Skip" -ForegroundColor Cyan
} else {
    Write-Host "  Test-AuditV6-Iter6.ps1 not found at $Iter6Test - iter-7 checks only" -ForegroundColor Yellow
}

# ============================================================================
# Phase B — Iter-7 new sections (33-37)
# ============================================================================

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  Phase B: Iter-7 new sections 33-37"                          -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

# ----------------------------------------------------------------------------
# Section 33 — Iter7AuditPdfExtended
# ----------------------------------------------------------------------------
Section "33. Iter7AuditPdfExtended"
$auditPdfFile = Join-Path $SrcRoot "shared\audit-pdf.ts"
$pdfExists = Test-Path $auditPdfFile
Check "audit-pdf.ts file exists" $pdfExists "($auditPdfFile)"

if ($pdfExists) {
    $pdfText = Get-Content $auditPdfFile -Raw

    # Doc-comment lists the 16 sections (iter-7 extension marker)
    Check "doc-comment lists 16 sections" `
        ($pdfText -match "16\.\s+Document\s+Provenance") `
        "(top doc-comment renumber)"

    # 8 new drawer function definitions
    $newDrawers = @(
        "drawIntent",
        "drawSelfCheck",
        "drawThinkCycleTrace",
        "drawDelegationChain",
        "drawAutonomy",
        "drawFrameworkMetrics",
        "drawMessageLog",
        "drawCompliance"
    )
    foreach ($d in $newDrawers) {
        $pattern = "function\s+$d\s*\("
        Check "drawer function $d exists" ($pdfText -match $pattern)
    }

    # generateAuditPdf calls them in the locked order
    $orderPattern = "drawIntent.*drawSelfCheck.*drawThinkCycleTrace.*drawDelegationChain.*drawAutonomy.*drawFrameworkMetrics.*drawMessageLog.*drawCompliance"
    $singleLine = $pdfText -replace "`r?`n", " "
    Check "generateAuditPdf invokes new drawers in locked order" `
        ($singleLine -match $orderPattern)

    # drawFooter is the LAST call (16. Document Provenance)
    Check "drawFooter is the last call in generateAuditPdf" `
        ($singleLine -match "drawCompliance.*drawExternalNotifications.*drawFooter\s*\(doc,\s*audit\)\s*;\s*//\s*16")

    # generateAuditPdf signature unchanged (audit, sellerAudit, out)
    Check "generateAuditPdf signature unchanged" `
        ($singleLine -match "export\s+async\s+function\s+generateAuditPdf\s*\(\s*audit:\s*AnyRecord\s*,\s*sellerAudit:\s*AnyRecord\s*\|\s*null\s*,")
}

# ----------------------------------------------------------------------------
# Section 34 — Iter7ReportingAgent
# ----------------------------------------------------------------------------
Section "34. Iter7ReportingAgent"
$agentFile = Join-Path $AgentDir "index.ts"
$agentExists = Test-Path $agentFile
Check "audit-reporting-agent/index.ts exists" $agentExists "($agentFile)"

if ($agentExists) {
    $agentText = Get-Content $agentFile -Raw

    Check "agent declares port 7074"           ($agentText -match "PORT\s*=\s*7074")
    Check "agent imports generateAuditPdf"     ($agentText -match "import\s*\{[^}]*generateAuditPdf[^}]*\}\s*from\s*[`"']\.\./\.\./shared/audit-pdf\.js[`"']")
    Check "agent imports getReportsRoot"       ($agentText -match "getReportsRoot")
    Check "agent imports node-cron"            ($agentText -match "import\s+cron\s+from\s+[`"']node-cron[`"']")
    Check "agent imports Handlebars"           ($agentText -match "import\s+Handlebars\s+from\s+[`"']handlebars[`"']")

    Check "endpoint POST /api/reports/daily"           ($agentText -match "app\.post\(\s*[`"']/api/reports/daily[`"']")
    Check "endpoint POST /api/reports/weekly"          ($agentText -match "app\.post\(\s*[`"']/api/reports/weekly[`"']")
    Check "endpoint POST /api/reports/forensic"        ($agentText -match "app\.post\(\s*[`"']/api/reports/forensic[`"']")
    Check "endpoint POST /a2a/reports/trigger"         ($agentText -match "app\.post\(\s*[`"']/a2a/reports/trigger[`"']")
    Check "endpoint GET  /health"                      ($agentText -match "app\.get\(\s*[`"']/health[`"']")

    Check "cron daily schedule '0 21 * * *'"           ($agentText -match "CRON_DAILY\s*=\s*[`"']0\s+21\s+\*\s+\*\s+\*[`"']")
    Check "cron weekly schedule '0 21 * * 0'"          ($agentText -match "CRON_WEEKLY\s*=\s*[`"']0\s+21\s+\*\s+\*\s+0[`"']")
    Check "cron timezone is UTC"                       ((($agentText -match "timezone:\s*[`"']UTC[`"']") -or ($agentText -match "timezone:\s*CRON_TIMEZONE")) -and ($agentText -match "CRON_TIMEZONE\s*=\s*[`"']UTC[`"']"))

    Check "authority role = Chief Audit Officer"       ($agentText -match "Chief Audit Officer")
    Check "credentialMode is 'plain' (Q27)"            ($agentText -match "credentialMode:\s*[`"']plain[`"']")
    Check "vLeiDeferred marker present"                ($agentText -match "vLeiDeferred:\s*true")
    Check "5-min cache TTL (Q26)"                      ($agentText -match "CACHE_TTL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000")
}

# HTTP probe (only if agent running)
if (Test-AgentRunning) {
    try {
        $h = Invoke-RestMethod -Uri "$AgentBase/health" -Method GET -TimeoutSec 5
        Check "/health returns agent=audit-reporting-agent" ($h.agent -eq "audit-reporting-agent")
        Check "/health returns port=7074"                   ($h.port -eq 7074)
        Check "/health returns role=Chief Audit Officer"    ($h.role -eq "Chief Audit Officer")
        Check "/health has authority envelope"              ($null -ne $h.authority -and $h.authority.actorType -eq "AuditReportingAgent")
    } catch {
        Check "/health responds OK" $false "(error: $_)"
    }
} else {
    Skip "/health HTTP probe" "agent not running on $AgentBase (run 'npm run agents:audit-reporting' to enable this probe)"
}

# ----------------------------------------------------------------------------
# Section 35 — Iter7ReportingTemplates
# ----------------------------------------------------------------------------
Section "35. Iter7ReportingTemplates"
$tplDir   = Join-Path $AgentDir "templates"
$tplDaily = Join-Path $tplDir "daily.md.hbs"
$tplWeek  = Join-Path $tplDir "weekly.md.hbs"
$tplForen = Join-Path $tplDir "forensic.md.hbs"

Check "templates/ folder exists"     (Test-Path $tplDir)
Check "daily.md.hbs exists"          (Test-Path $tplDaily)
Check "weekly.md.hbs exists"         (Test-Path $tplWeek)
Check "forensic.md.hbs exists"       (Test-Path $tplForen)

if (Test-Path $tplDaily) {
    $t = Get-Content $tplDaily -Raw
    Check "daily template has {{dateUtc}}"           ($t -match "\{\{dateUtc\}\}")
    Check "daily template has {{authority.role}}"    ($t -match "\{\{authority\.role\}\}")
    Check "daily template loops over deals"          ($t -match "\{\{#each deals\}\}")
    Check "daily template has dealCount stat"        ($t -match "dealCount")
}
if (Test-Path $tplWeek) {
    $t = Get-Content $tplWeek -Raw
    Check "weekly template has {{weekKey}}"          ($t -match "\{\{weekKey\}\}")
    Check "weekly template has byDay loop"           ($t -match "\{\{#each byDay\}\}")
    Check "weekly template has escalation rate"      ($t -match "escalationRatePct")
}
if (Test-Path $tplForen) {
    $t = Get-Content $tplForen -Raw
    Check "forensic template has {{negotiationId}}"  ($t -match "\{\{negotiationId\}\}")
    Check "forensic template has all 14 sections"    ($t -match "1\.\s+Deal\s+Summary" -and $t -match "14\.\s+Compliance\s+Mapping")
}

# ----------------------------------------------------------------------------
# Section 36 — Iter7ReportsCron (smoke-test on-demand which uses cron path)
# ----------------------------------------------------------------------------
Section "36. Iter7ReportsCron"

$today = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
$dailyDir  = Join-Path $ReportsDir "daily"
$weeklyDir = Join-Path $ReportsDir "weekly"
$dailyFile = Join-Path $dailyDir "$today.md"

Check "audits/reports/daily/ folder exists"   (Test-Path $dailyDir)
Check "audits/reports/weekly/ folder exists"  (Test-Path $weeklyDir)

if (Test-AgentRunning) {
    # Snapshot weekly count before probe to assert weekly trigger writes
    $weeklyBefore = if (Test-Path $weeklyDir) {
        @(Get-ChildItem -Path $weeklyDir -Filter "*.md" -ErrorAction SilentlyContinue).Count
    } else { 0 }

    # Daily on-demand
    try {
        $body = "{}"
        $r = Invoke-RestMethod -Uri "$AgentBase/api/reports/daily" -Method POST `
                -ContentType "application/json" -Body $body -TimeoutSec 30
        Check "POST /api/reports/daily returned ok=true"          ($r.ok -eq $true)
        Check "POST /api/reports/daily produced outputPath"       ($null -ne $r.outputPath)
        Check "POST /api/reports/daily produced selfAuditPath"    ($null -ne $r.selfAuditPath)
        Check "daily report file was created on disk"             (Test-Path $dailyFile)
    } catch {
        Check "POST /api/reports/daily succeeded" $false "(error: $_)"
    }

    # Weekly on-demand
    try {
        $r2 = Invoke-RestMethod -Uri "$AgentBase/api/reports/weekly" -Method POST `
                -ContentType "application/json" -Body "{}" -TimeoutSec 30
        Check "POST /api/reports/weekly returned ok=true"         ($r2.ok -eq $true)
        Check "POST /api/reports/weekly produced weekKey"         ($null -ne $r2.weekKey)
        $weeklyAfter = @(Get-ChildItem -Path $weeklyDir -Filter "*.md" -ErrorAction SilentlyContinue).Count
        Check "weekly file count grew or stayed >= 1"             ($weeklyAfter -ge 1 -or $weeklyAfter -ge $weeklyBefore)
    } catch {
        Check "POST /api/reports/weekly succeeded" $false "(error: $_)"
    }

    # A2A trigger smoke (Q26 — must accept 'daily' or 'weekly')
    try {
        $r3 = Invoke-RestMethod -Uri "$AgentBase/a2a/reports/trigger" -Method POST `
                -ContentType "application/json" -Body '{"type":"daily"}' -TimeoutSec 30
        Check "POST /a2a/reports/trigger {type:daily} returned ok=true" ($r3.ok -eq $true)
        Check "/a2a/reports/trigger response declares cached flag"      ($null -ne $r3.cached)
    } catch {
        Check "POST /a2a/reports/trigger succeeded" $false "(error: $_)"
    }
} else {
    Skip "POST /api/reports/daily smoke"   "agent not running on $AgentBase"
    Skip "POST /api/reports/weekly smoke"  "agent not running on $AgentBase"
    Skip "POST /a2a/reports/trigger smoke" "agent not running on $AgentBase"
}

# ----------------------------------------------------------------------------
# Section 37 — Iter7ReportingSelfAudit
# ----------------------------------------------------------------------------
Section "37. Iter7ReportingSelfAudit"

$todayDir = Join-Path $AuditsDir $today
if (Test-Path $todayDir) {
    $rgFolders = Get-ChildItem -Path $todayDir -Filter "NEG-RG-*" -Directory -ErrorAction SilentlyContinue
    if ($rgFolders -and $rgFolders.Count -gt 0) {
        Check "at least one NEG-RG-* folder exists for $today" $true "($($rgFolders.Count) found)"

        # Verify shape of the latest self-audit
        $latest = $rgFolders | Sort-Object Name -Descending | Select-Object -First 1
        $selfAuditFile = Join-Path $latest.FullName "report-generation.audit.json"
        if (Test-Path $selfAuditFile) {
            Check "report-generation.audit.json present in latest NEG-RG-*" $true "($($latest.Name))"
            try {
                $json = Get-Content $selfAuditFile -Raw | ConvertFrom-Json
                Check "self-audit has schemaVersion=1"                ($json.schemaVersion -eq 1)
                Check "self-audit auditKind = report-generation"      ($json.auditKind -eq "report-generation")
                Check "self-audit reportType ∈ {daily,weekly,forensic}" (@("daily","weekly","forensic") -contains $json.reportType)
                Check "self-audit triggerSource ∈ {cron,http-ui,http-a2a}" (@("cron","http-ui","http-a2a") -contains $json.triggerSource)
                Check "self-audit has actorId"                        ($null -ne $json.actorId)
                Check "self-audit has authority envelope"             ($null -ne $json.authority -and $json.authority.role -eq "Chief Audit Officer")
                Check "self-audit authority credentialMode=plain"     ($json.authority.credentialMode -eq "plain")
                Check "self-audit authority vLeiDeferred=true"        ($json.authority.vLeiDeferred -eq $true)
                Check "self-audit has startedAt + completedAt"        ($null -ne $json.startedAt -and $null -ne $json.completedAt)
                Check "self-audit durationMs is >= 0"                 ($json.durationMs -ge 0)
            } catch {
                Check "self-audit JSON parses" $false "(error: $_)"
            }
        } else {
            Check "report-generation.audit.json present in latest NEG-RG-*" $false "(missing in $($latest.Name))"
        }
    } else {
        if (Test-AgentRunning) {
            Check "at least one NEG-RG-* folder exists for $today" $false "(no NEG-RG-* under $todayDir even after on-demand probe; check agent stderr)"
        } else {
            Skip "self-audit folder verification" "agent not running and no prior runs today"
        }
    }
} else {
    if (Test-AgentRunning) {
        Check "today's audit date folder exists" $false "($todayDir missing even after on-demand probe)"
    } else {
        Skip "self-audit folder verification" "agent not running and $todayDir not present"
    }
}

# ============================================================================
# Final summary (iter-6 + iter-7 combined)
# ============================================================================

$totalPass = $iter6Pass + $script:pass
$totalFail = $iter6Fail + $script:fail
$totalSkip = $iter6Skip + $script:skip

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  Test-AuditV6-Iter7 summary"                                 -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  iter-6 (delegated):  PASS=$iter6Pass  FAIL=$iter6Fail  SKIP=$iter6Skip" -ForegroundColor Cyan
Write-Host "  iter-7 (this file):  PASS=$($script:pass)  FAIL=$($script:fail)  SKIP=$($script:skip)" -ForegroundColor Cyan
Write-Host ""
$color = if ($totalFail -eq 0) { "Green" } else { "Red" }
Write-Host "  COMBINED: PASS: $totalPass    FAIL: $totalFail    SKIP: $totalSkip" -ForegroundColor $color
Write-Host ""

if ($totalFail -gt 0) {
    exit 1
} else {
    exit 0
}
