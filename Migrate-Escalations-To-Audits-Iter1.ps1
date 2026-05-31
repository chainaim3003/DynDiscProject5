# ============================================================================
# Audit Framework v6 — Iteration 1
# Migrate escalations/ -> audits/ with legacy preservation + reports scaffold
# ============================================================================
# Run this from PowerShell in the repo root (or anywhere — paths are absolute):
#
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Migrate-Escalations-To-Audits-Iter1.ps1
#
# What this does:
#   1. Renames A2A/js/src/escalations/ -> A2A/js/src/audits/
#   2. Creates A2A/js/src/audits/_legacy_escalations/
#   3. Moves every FLAT file at the top of A2A/js/src/audits/
#      into _legacy_escalations/ (subdirectories are left alone)
#   4. Creates audits/reports/{daily,weekly,on-demand}/ (empty, for iter 7)
#   5. Verifies the legacy file count against the pre-iter1 backup
#
# Idempotent: safe to re-run after a partial failure or after success.
# Source-of-truth backup is at:
#   C:\SATHYA\backups\DynDisc4\escalations-pre-iter1-2026-05-23
# ============================================================================

$ErrorActionPreference = "Stop"

$Repo        = "C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1"
$SrcRoot     = Join-Path $Repo "A2A\js\src"
$EscalDir    = Join-Path $SrcRoot "escalations"
$AuditsDir   = Join-Path $SrcRoot "audits"
$LegacyDir   = Join-Path $AuditsDir "_legacy_escalations"
$ReportsRoot = Join-Path $AuditsDir "reports"
$BackupDir   = "C:\SATHYA\backups\DynDisc4\escalations-pre-iter1-2026-05-23"

Write-Host ""
Write-Host "=============================================================="
Write-Host " Audit Framework v6 - Iteration 1 escalations -> audits/ rename"
Write-Host "=============================================================="
Write-Host ""
Write-Host "Repo root : $Repo"
Write-Host ""

# ---------------------------------------------------------------------------
# Step 1: rename escalations/ to audits/ (only if rename hasn't happened)
# ---------------------------------------------------------------------------
if ((Test-Path $EscalDir -PathType Container) -and -not (Test-Path $AuditsDir -PathType Container)) {
    Write-Host "[1/4] Renaming escalations/ -> audits/" -ForegroundColor Cyan
    Rename-Item -Path $EscalDir -NewName "audits"
    Write-Host "      OK"
}
elseif ((Test-Path $EscalDir -PathType Container) -and (Test-Path $AuditsDir -PathType Container)) {
    Write-Host "[1/4] BOTH escalations/ and audits/ exist - manual reconciliation needed." -ForegroundColor Red
    Write-Host "      Move files manually or restore from backup before re-running." -ForegroundColor Red
    exit 1
}
elseif (Test-Path $AuditsDir -PathType Container) {
    Write-Host "[1/4] audits/ already exists - skipping rename" -ForegroundColor Yellow
}
else {
    Write-Host "[1/4] ERROR: neither escalations/ nor audits/ exists at $SrcRoot" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Step 2: create _legacy_escalations/ subfolder
# ---------------------------------------------------------------------------
if (-not (Test-Path $LegacyDir -PathType Container)) {
    Write-Host "[2/4] Creating _legacy_escalations/" -ForegroundColor Cyan
    New-Item -Path $LegacyDir -ItemType Directory | Out-Null
    Write-Host "      OK"
}
else {
    Write-Host "[2/4] _legacy_escalations/ already exists - skipping create" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 3: move flat files from audits/ into _legacy_escalations/
# Only TOP-LEVEL files are moved. Existing subdirectories
# (_legacy_escalations/, reports/, YYYY-MM-DD/, NEG-* etc.) stay put.
# ---------------------------------------------------------------------------
$flatFiles = Get-ChildItem -Path $AuditsDir -File
$flatCount = $flatFiles.Count
if ($flatCount -gt 0) {
    Write-Host "[3/4] Moving $flatCount flat file(s) -> _legacy_escalations/" -ForegroundColor Cyan
    foreach ($f in $flatFiles) {
        Move-Item -Path $f.FullName -Destination $LegacyDir
    }
    Write-Host "      Moved $flatCount file(s)"
}
else {
    Write-Host "[3/4] No flat files in audits/ to move - already migrated" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 4: create reports/{daily,weekly,on-demand}/ for future iteration 7
# ---------------------------------------------------------------------------
$reportsSubs = @("daily", "weekly", "on-demand")
Write-Host "[4/4] Ensuring reports/{daily,weekly,on-demand}/ exist" -ForegroundColor Cyan
foreach ($sub in $reportsSubs) {
    $p = Join-Path $ReportsRoot $sub
    if (-not (Test-Path $p -PathType Container)) {
        New-Item -Path $p -ItemType Directory -Force | Out-Null
        Write-Host "      created $p"
    }
    else {
        Write-Host "      exists  $p"
    }
}

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================================="
Write-Host " Verification"
Write-Host "=============================================================="

$legacyFiles = Get-ChildItem -Path $LegacyDir -File
Write-Host ""
Write-Host "File count in _legacy_escalations/  : $($legacyFiles.Count)"
Write-Host "Expected (per backup 2026-05-23)    : 494 (or higher if new deals ran since)"
Write-Host ""

if (Test-Path $BackupDir -PathType Container) {
    $backupFiles = Get-ChildItem -Path $BackupDir -File
    Write-Host "Backup file count                   : $($backupFiles.Count)"
    if ($legacyFiles.Count -ge $backupFiles.Count) {
        Write-Host "  -> migrated count >= backup count   [PASS]" -ForegroundColor Green
    }
    else {
        Write-Host "  -> MIGRATED COUNT BELOW BACKUP      [FAIL - investigate before continuing]" -ForegroundColor Red
    }
}
else {
    Write-Host "Backup dir not found at $BackupDir - skipping count-cross-check"
}

Write-Host ""
Write-Host "Layout now:"
Write-Host "  $AuditsDir"
Write-Host "  + _legacy_escalations\  ($($legacyFiles.Count) files)"
Write-Host "  + reports\daily\        (empty, for iter 7)"
Write-Host "  + reports\weekly\       (empty, for iter 7)"
Write-Host "  + reports\on-demand\    (empty, for iter 7)"
Write-Host ""
Write-Host "Done. Next step: run a fresh deal end-to-end as Iteration 1 acceptance test T2."
Write-Host ""
