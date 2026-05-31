# ============================================================================
# Test-AuditV6-Iter1.ps1
# Verifies the Audit Framework v6 Iteration 1 state on disk.
# ============================================================================
# Usage:
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Test-AuditV6-Iter1.ps1
#
# What this verifies:
#   [Layout]   audits/ exists with the new structure; old escalations/ is gone
#   [Shared]   new helper modules (audit-paths, audit-index-schema, index-jsonl-writer)
#   [Packages] workspace scaffolding (audit-framework-core, audit-framework-procurement)
#   [Legacy]   _legacy_escalations/ contains the migrated files
#   [Index]    audits/index.jsonl exists and last 2 lines reference the same deal
#              with BUYER+SELLER perspectives
#   [Deal]     most-recent deal under audits/YYYY-MM-DD/NEG-{id}/ has:
#                - buyer.audit.json + seller.audit.json
#                - selfProcessMode key (renamed block)
#                - sellerResponseMode block with servedBy=seller-agent@port-8080
#                  (proof of live fetch on buyer-side)
#                - sellerResponseMode == null on seller side (by design)
#                - non-empty decisions[] (Bug 2 fix)
#   [API]      optional smoke test against http://localhost:9090/api/quality/{id}
#              if the buyer agent is running
#
# Re-run this script anytime. To re-test the [Deal] block fully, kick off
# a fresh "start negotiation" via your usual interface first, then re-run.
# ============================================================================

$ErrorActionPreference = "Stop"

$Repo      = "C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1"
$SrcRoot   = Join-Path $Repo "A2A\js\src"
$AuditsDir = Join-Path $SrcRoot "audits"
$PkgRoot   = Join-Path $Repo "A2A\js\packages"

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

Write-Host ""
Write-Host "==============================================================" -ForegroundColor White
Write-Host " Audit Framework v6 - Iteration 1 Verification" -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White

# ---------------------------------------------------------------------------
# 1. Folder layout
# ---------------------------------------------------------------------------
Section "Layout"
Check "audits/ exists"                       (Test-Path $AuditsDir -PathType Container)
Check "audits/_legacy_escalations/ exists"   (Test-Path (Join-Path $AuditsDir "_legacy_escalations") -PathType Container)
Check "audits/reports/daily/ exists"         (Test-Path (Join-Path $AuditsDir "reports\daily")       -PathType Container)
Check "audits/reports/weekly/ exists"        (Test-Path (Join-Path $AuditsDir "reports\weekly")      -PathType Container)
Check "audits/reports/on-demand/ exists"     (Test-Path (Join-Path $AuditsDir "reports\on-demand")   -PathType Container)
Check "old escalations/ folder removed"      (-not (Test-Path (Join-Path $SrcRoot "escalations") -PathType Container))

# ---------------------------------------------------------------------------
# 2. New shared helper modules
# ---------------------------------------------------------------------------
Section "Shared"
Check "shared/audit-paths.ts"         (Test-Path (Join-Path $SrcRoot "shared\audit-paths.ts")         -PathType Leaf)
Check "shared/audit-index-schema.ts"  (Test-Path (Join-Path $SrcRoot "shared\audit-index-schema.ts")  -PathType Leaf)
Check "shared/index-jsonl-writer.ts"  (Test-Path (Join-Path $SrcRoot "shared\index-jsonl-writer.ts")  -PathType Leaf)

# ---------------------------------------------------------------------------
# 3. Workspace packages
# ---------------------------------------------------------------------------
Section "Packages"
Check "audit-framework-core/package.json"        (Test-Path (Join-Path $PkgRoot "audit-framework-core\package.json")        -PathType Leaf)
Check "audit-framework-core/src/index.ts"        (Test-Path (Join-Path $PkgRoot "audit-framework-core\src\index.ts")        -PathType Leaf)
Check "audit-framework-procurement/package.json" (Test-Path (Join-Path $PkgRoot "audit-framework-procurement\package.json") -PathType Leaf)
Check "audit-framework-procurement/src/index.ts" (Test-Path (Join-Path $PkgRoot "audit-framework-procurement\src\index.ts") -PathType Leaf)
Check "audit-framework-procurement/templates/"   (Test-Path (Join-Path $PkgRoot "audit-framework-procurement\templates")    -PathType Container)

# ---------------------------------------------------------------------------
# 4. Legacy preservation
# ---------------------------------------------------------------------------
Section "Legacy"
$legacyDir = Join-Path $AuditsDir "_legacy_escalations"
if (Test-Path $legacyDir -PathType Container) {
    $legacyCount = (Get-ChildItem $legacyDir -File -ErrorAction SilentlyContinue | Measure-Object).Count
    Check "_legacy_escalations file count >= 494" ($legacyCount -ge 494) "($legacyCount files)"
} else {
    Skip "_legacy_escalations file count" "directory missing"
}

# ---------------------------------------------------------------------------
# 5. index.jsonl
# ---------------------------------------------------------------------------
Section "Index"
$indexPath = Join-Path $AuditsDir "index.jsonl"
$indexOk   = Test-Path $indexPath -PathType Leaf
Check "audits/index.jsonl exists" $indexOk
if ($indexOk) {
    $lines = @(Get-Content $indexPath | Where-Object { $_.Trim() -ne "" })
    Check "index.jsonl has at least 2 lines" ($lines.Count -ge 2) "($($lines.Count) lines)"
    if ($lines.Count -ge 2) {
        try {
            $a = $lines[-2] | ConvertFrom-Json
            $b = $lines[-1] | ConvertFrom-Json
            Check "last 2 lines reference the same negotiationId" ($a.negotiationId -eq $b.negotiationId) "($($a.negotiationId))"
            $perspectives = @($a.perspective, $b.perspective) | Sort-Object
            Check "last 2 lines are BUYER + SELLER perspectives" ($perspectives -join ',' -eq 'BUYER,SELLER')
            Check "schemaVersion == 1 on both lines" ($a.schemaVersion -eq 1 -and $b.schemaVersion -eq 1)
        } catch {
            Check "last 2 lines parse as JSON" $false "($($_.Exception.Message))"
        }
    }
}

# ---------------------------------------------------------------------------
# 6. Most-recent deal audit content
# ---------------------------------------------------------------------------
Section "Deal"
$dateFolders = @()
if (Test-Path $AuditsDir -PathType Container) {
    $dateFolders = Get-ChildItem $AuditsDir -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' }
}

$recentDeal = $null
foreach ($d in $dateFolders) {
    $negDirs = Get-ChildItem $d.FullName -Directory | Where-Object { $_.Name -like 'NEG-*' }
    foreach ($n in $negDirs) {
        if ($null -eq $recentDeal -or $n.LastWriteTime -gt $recentDeal.LastWriteTime) {
            $recentDeal = $n
        }
    }
}

if ($null -eq $recentDeal) {
    Skip "most-recent deal contents" "no NEG-* deal folders found - kick off a deal and re-run"
} else {
    Write-Host "  Inspecting: $($recentDeal.FullName)" -ForegroundColor DarkGray
    $negId          = $recentDeal.Name
    $buyerJsonPath  = Join-Path $recentDeal.FullName "buyer.audit.json"
    $sellerJsonPath = Join-Path $recentDeal.FullName "seller.audit.json"

    Check "buyer.audit.json exists"  (Test-Path $buyerJsonPath  -PathType Leaf)
    Check "seller.audit.json exists" (Test-Path $sellerJsonPath -PathType Leaf)

    if (Test-Path $buyerJsonPath -PathType Leaf) {
        $buyer = Get-Content $buyerJsonPath -Raw | ConvertFrom-Json
        Check "buyer.negotiationId matches folder"               ($buyer.negotiationId -eq $negId)
        Check "buyer has selfProcessMode (renamed) key"          ($null -ne $buyer.selfProcessMode)
        Check "buyer has sellerResponseMode (new) key"           ($null -ne $buyer.sellerResponseMode)
        $servedBy = $buyer.sellerResponseMode.servedBy
        Check "buyer.sellerResponseMode is from LIVE seller fetch" ($servedBy -eq 'seller-agent@port-8080') "(servedBy='$servedBy')"
        Check "buyer.decisions[] non-empty (Bug 2 fix)"          ($buyer.decisions -and @($buyer.decisions).Count -gt 0) "($(@($buyer.decisions).Count) entries)"
    }

    if (Test-Path $sellerJsonPath -PathType Leaf) {
        $seller = Get-Content $sellerJsonPath -Raw | ConvertFrom-Json
        Check "seller.negotiationId matches folder"              ($seller.negotiationId -eq $negId)
        Check "seller has selfProcessMode (renamed) key"         ($null -ne $seller.selfProcessMode)
        Check "seller.sellerResponseMode is null (by design)"    ($null -eq $seller.sellerResponseMode)
    }
}

# ---------------------------------------------------------------------------
# 7. Optional API smoke test
# ---------------------------------------------------------------------------
Section "API"
if ($null -eq $recentDeal) {
    Skip "buyer /api/quality endpoint" "no deal to query"
} else {
    $negId = $recentDeal.Name
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:9090/api/quality/$negId" -Method Get -TimeoutSec 3
        Check "GET /api/quality/$negId returns 200"   ($null -ne $resp)
        Check "endpoint returns matching negotiationId" ($resp.negotiationId -eq $negId)
        Check "endpoint payload has selfProcessMode"    ($null -ne $resp.selfProcessMode)
        Check "endpoint payload has sellerResponseMode" ($null -ne $resp.sellerResponseMode)
    } catch {
        Skip "buyer /api/quality endpoint" "buyer agent not reachable on :9090"
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "==============================================================" -ForegroundColor White
Write-Host (" Summary: {0} PASS  {1} FAIL  {2} SKIP" -f $script:pass, $script:fail, $script:skip) -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White
Write-Host ""

if ($script:fail -gt 0) { exit 1 } else { exit 0 }
