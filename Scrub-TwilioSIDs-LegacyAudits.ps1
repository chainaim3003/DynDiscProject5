# ============================================================================
# Scrub-TwilioSIDs-LegacyAudits.ps1
# Removes Twilio Account SIDs (pattern: AC followed by 32 hex chars) from
# every audit-related file under audits/_legacy_escalations/ and audits/.
# ============================================================================
# Why this exists:
#   GitHub Push Protection blocks pushes containing Twilio Account SIDs.
#   Our legacy audit JSONs (pre-v6, historical) contain Twilio SIDs in
#   notifications[].error messages from past WhatsApp delivery failures.
#   This script replaces every occurrence with the literal "AC_REDACTED_LEGACY"
#   so the audits can be committed without triggering the secret scanner.
#
# What it changes:
#   For every file under audits/ matching *.audit.json, *.txt, or .audit.json
#   that contains the pattern AC[a-f0-9]{32}, replaces those matches in-place
#   with the string AC_REDACTED_LEGACY.
#
# What it does NOT touch:
#   - Files outside audits/
#   - Non-audit files
#   - LEIs (20 hex/digit chars, different pattern)
#   - Agent AIDs (start with E, 44 chars long)
#   - Negotiation IDs (numeric-only)
#
# Idempotent: safe to re-run. Already-scrubbed files match the pattern zero
# times and are skipped.
#
# Usage:
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Scrub-TwilioSIDs-LegacyAudits.ps1
#
# Source-of-truth backup with un-redacted SIDs lives at:
#   C:\SATHYA\backups\DynDisc4\escalations-pre-iter1-2026-05-23
# Recovery: if the original SID is ever needed for forensics, restore the file
# from the backup directory.
# ============================================================================

$ErrorActionPreference = "Stop"

$Repo      = "C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1"
$AuditsDir = Join-Path $Repo "A2A\js\src\audits"

# Twilio Account SID: literal "AC" followed by exactly 32 lowercase hex chars.
# Tightened to lowercase to avoid matching any incidental uppercase
# "ACxxxxxx" identifiers (LEIs, AIDs, etc.). All observed Twilio SIDs are lc.
$SidPattern     = '(?-i)AC[0-9a-f]{32}'
$Replacement    = 'AC_REDACTED_LEGACY'

# File patterns to scrub. We do NOT scrub .ts source files (no SIDs there)
# nor PowerShell scripts. Only audit data files.
$FilePatterns = @("*.audit.json", "*.json", "*.txt")

Write-Host ""
Write-Host "==============================================================" -ForegroundColor White
Write-Host " Scrub Twilio Account SIDs from legacy audit files"            -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White
Write-Host ""
Write-Host "Scanning: $AuditsDir"
Write-Host "Pattern : $SidPattern"
Write-Host "Replace : $Replacement"
Write-Host ""

if (-not (Test-Path $AuditsDir -PathType Container)) {
    Write-Host "[FATAL] $AuditsDir does not exist" -ForegroundColor Red
    exit 1
}

# Collect all candidate files
$allFiles = @()
foreach ($pat in $FilePatterns) {
    $allFiles += Get-ChildItem -Path $AuditsDir -Recurse -File -Filter $pat -ErrorAction SilentlyContinue
}
# Dedupe (a file could in principle match multiple patterns, though our list avoids it)
$allFiles = $allFiles | Sort-Object FullName -Unique

Write-Host ("Found {0} candidate audit files" -f $allFiles.Count) -ForegroundColor Cyan
Write-Host ""

$filesScanned     = 0
$filesModified    = 0
$totalReplacements = 0
$modifiedList     = @()

foreach ($f in $allFiles) {
    $filesScanned++
    $content = Get-Content -Path $f.FullName -Raw -Encoding UTF8

    $matches = [regex]::Matches($content, $SidPattern)
    if ($matches.Count -eq 0) { continue }

    $newContent = [regex]::Replace($content, $SidPattern, $Replacement)

    # Write back preserving UTF-8 without BOM (matches how Node writes the originals)
    [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.UTF8Encoding]::new($false))

    $filesModified++
    $totalReplacements += $matches.Count
    $modifiedList     += [pscustomobject]@{
        File         = $f.FullName.Substring($Repo.Length + 1)
        Replacements = $matches.Count
    }
}

# Report
Write-Host "==============================================================" -ForegroundColor White
Write-Host " Summary"                                                        -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White
Write-Host ("Files scanned        : {0}" -f $filesScanned)
Write-Host ("Files modified       : {0}" -f $filesModified)
Write-Host ("Total SID occurrences: {0}" -f $totalReplacements)
Write-Host ""

if ($filesModified -gt 0) {
    Write-Host "Modified files (top 20):" -ForegroundColor Yellow
    $modifiedList | Sort-Object Replacements -Descending | Select-Object -First 20 | Format-Table -AutoSize
    if ($filesModified -gt 20) {
        Write-Host ("(... {0} more files modified, not shown)" -f ($filesModified - 20))
    }
}
else {
    Write-Host "No SIDs found - either already scrubbed or none present." -ForegroundColor Green
}

# Final cross-check: re-scan and confirm zero SID hits remain anywhere
Write-Host ""
Write-Host "Cross-check: searching for any remaining Twilio SIDs..." -ForegroundColor Cyan
$remaining = 0
foreach ($f in $allFiles) {
    $c = Get-Content -Path $f.FullName -Raw -Encoding UTF8
    $m = [regex]::Matches($c, $SidPattern)
    if ($m.Count -gt 0) {
        $remaining += $m.Count
        Write-Host "  STILL HAS SID: $($f.FullName) ($($m.Count) occurrences)" -ForegroundColor Red
    }
}
if ($remaining -eq 0) {
    Write-Host "  No SIDs remain in any scanned file. PASS" -ForegroundColor Green
} else {
    Write-Host ("  WARNING: {0} SID occurrences still present" -f $remaining) -ForegroundColor Red
    exit 2
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
