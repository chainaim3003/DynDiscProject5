# ============================================================================
# Test-AuditV6-Iter2.ps1
# Verifies the Audit Framework v6 Iteration 2 state on disk.
# ============================================================================
# Usage:
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Test-AuditV6-Iter2.ps1
#
# What this verifies (in addition to ALL 34 iter-1 checks, kept verbatim):
#   [Iter2Shared]      shared/audit-blocks/ folder + 3 new modules
#   [Iter2Decisions]   DECISIONS.md addendum locking the 5-tier enum
#   [Iter2Identity]    most-recent deal's audit has agent.* + identityProof blocks
#   [Iter2Signing]     messageSigningPosture block with tier=HASH_ENVELOPE (T2)
#   [Iter2Messages]    messageLog[] non-empty + every entry has payloadHash (T3, T4)
#
# Re-run anytime. After a fresh deal the [Deal] / [Iter2*] sections re-verify
# against the latest NEG-* folder.
# ============================================================================

$ErrorActionPreference = "Stop"

$Repo      = "C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1"
$SrcRoot   = Join-Path $Repo "A2A\js\src"
$AuditsDir = Join-Path $SrcRoot "audits"
$PkgRoot   = Join-Path $Repo "A2A\js\packages"
$DesignDir = Join-Path $Repo "DESIGN\revamp-2026-05-18-framework"

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
Write-Host " Audit Framework v6 - Iteration 2 Verification" -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White

# ============================================================================
# ITER-1 CHECKS (copied verbatim from Test-AuditV6-Iter1.ps1)
# ============================================================================

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
# 2. New shared helper modules (iter-1)
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
# 6. Most-recent deal audit content (iter-1 checks)
# ---------------------------------------------------------------------------
Section "Deal"
$dateFolders = @()
if (Test-Path $AuditsDir -PathType Container) {
    $dateFolders = Get-ChildItem $AuditsDir -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' }
}

# NOTE: iter-1 has a known bug where /api/quality/:id probes mkdir the
# deal folder even when the file does not exist (getDealFolder() always
# recursive-mkdirs). This bumps folder mtime without writing any audit
# JSON, so picking by folder mtime alone can land on an empty probe
# folder. Filter to folders that ACTUALLY contain buyer.audit.json, then
# pick by the audit JSON's own mtime.
$recentDeal      = $null
$recentDealMtime = $null
foreach ($d in $dateFolders) {
    $negDirs = Get-ChildItem $d.FullName -Directory | Where-Object { $_.Name -like 'NEG-*' }
    foreach ($n in $negDirs) {
        $bj = Join-Path $n.FullName 'buyer.audit.json'
        if (-not (Test-Path $bj -PathType Leaf)) { continue }
        $mt = (Get-Item $bj).LastWriteTime
        if ($null -eq $recentDeal -or $mt -gt $recentDealMtime) {
            $recentDeal      = $n
            $recentDealMtime = $mt
        }
    }
}

# Variables surfaced for iter-2 sections below
$buyer = $null
$seller = $null
$buyerJsonPath  = $null
$sellerJsonPath = $null

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
# 7. Optional API smoke test (iter-1)
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

# ============================================================================
# ITER-2 CHECKS (new sections)
# ============================================================================

# ---------------------------------------------------------------------------
# 8. Iter-2 shared modules
# ---------------------------------------------------------------------------
Section "Iter2Shared"
$auditBlocksDir = Join-Path $SrcRoot "shared\audit-blocks"
Check "shared/audit-blocks/ folder"                       (Test-Path $auditBlocksDir -PathType Container)
Check "shared/audit-blocks/identity-proof.ts"             (Test-Path (Join-Path $auditBlocksDir "identity-proof.ts")           -PathType Leaf)
Check "shared/audit-blocks/message-signing-posture.ts"    (Test-Path (Join-Path $auditBlocksDir "message-signing-posture.ts")  -PathType Leaf)
Check "shared/message-log-collector.ts"                   (Test-Path (Join-Path $SrcRoot "shared\message-log-collector.ts")    -PathType Leaf)

# ---------------------------------------------------------------------------
# 9. Iter-2 design lock — 5-tier enum addendum in DECISIONS.md
# ---------------------------------------------------------------------------
Section "Iter2Decisions"
$decisionsPath = Join-Path $DesignDir "AUDIT-FRAMEWORK-V6-DECISIONS.md"
if (Test-Path $decisionsPath -PathType Leaf) {
    $decContent = Get-Content $decisionsPath -Raw
    Check "DECISIONS.md mentions HASH_ENVELOPE"  ($decContent -match 'HASH_ENVELOPE')
    Check "DECISIONS.md mentions NONE tier"      ($decContent -match '`NONE`')
    Check "DECISIONS.md mentions SIGNED_HASH"    ($decContent -match 'SIGNED_HASH')
    Check "DECISIONS.md mentions KERI_SEAL"      ($decContent -match 'KERI_SEAL')
    Check "DECISIONS.md mentions VLEI_BOUND"     ($decContent -match 'VLEI_BOUND')
    Check "DECISIONS.md has iter-2 addendum heading" ($decContent -match 'Iter 2')
} else {
    Skip "DECISIONS.md addendum" "file not found at $decisionsPath"
}

# ---------------------------------------------------------------------------
# 10. Iter-2 identity blocks in most-recent deal (T1)
# ---------------------------------------------------------------------------
Section "Iter2Identity"
if ($null -eq $buyer) {
    Skip "buyer identity blocks" "no deal to inspect"
} else {
    Check "buyer.agent.self present"             ($null -ne $buyer.agent -and $null -ne $buyer.agent.self)
    Check "buyer.agent.counterparty present"     ($null -ne $buyer.agent -and $null -ne $buyer.agent.counterparty)
    Check "buyer.agent.self.role == BUYER"       ($buyer.agent.self.role -eq 'BUYER')
    Check "buyer.agent.counterparty.role == SELLER" ($buyer.agent.counterparty.role -eq 'SELLER')
    Check "buyer.identityProof present"          ($null -ne $buyer.identityProof)
    Check "buyer.identityProof.schemaVersion == 1" ($buyer.identityProof.schemaVersion -eq 1)
    Check "buyer.identityProof.self.lei non-empty" ($null -ne $buyer.identityProof.self -and $buyer.identityProof.self.lei -and $buyer.identityProof.self.lei.Length -gt 0)
    Check "buyer.identityProof.counterparty.lei non-empty" ($null -ne $buyer.identityProof.counterparty -and $buyer.identityProof.counterparty.lei -and $buyer.identityProof.counterparty.lei.Length -gt 0)
    Check "buyer.identityProof.counterparty.verifiedAt set" ($null -ne $buyer.identityProof.counterparty.verifiedAt)
    Check "buyer.identityProof.counterparty.verificationPath array" (($buyer.identityProof.counterparty.verificationPath | Measure-Object).Count -gt 0)
}

if ($null -eq $seller) {
    Skip "seller identity blocks" "no deal to inspect"
} else {
    Check "seller.agent.self present"            ($null -ne $seller.agent -and $null -ne $seller.agent.self)
    Check "seller.agent.counterparty present"    ($null -ne $seller.agent -and $null -ne $seller.agent.counterparty)
    Check "seller.agent.self.role == SELLER"     ($seller.agent.self.role -eq 'SELLER')
    Check "seller.identityProof present"         ($null -ne $seller.identityProof)
    Check "seller.identityProof.self.lei non-empty" ($null -ne $seller.identityProof.self -and $seller.identityProof.self.lei -and $seller.identityProof.self.lei.Length -gt 0)
}

# ---------------------------------------------------------------------------
# 11. Iter-2 messageSigningPosture block (T2)
# ---------------------------------------------------------------------------
Section "Iter2Signing"
$allowedTiers = @('NONE','HASH_ENVELOPE','SIGNED_HASH','KERI_SEAL','VLEI_BOUND')
if ($null -eq $buyer) {
    Skip "buyer messageSigningPosture" "no deal to inspect"
} else {
    Check "buyer.messageSigningPosture present"     ($null -ne $buyer.messageSigningPosture)
    if ($null -ne $buyer.messageSigningPosture) {
        $btier = $buyer.messageSigningPosture.tier
        Check "buyer.messageSigningPosture.tier is one of 5 enum values" ($allowedTiers -contains $btier) "(tier='$btier')"
        Check "buyer.messageSigningPosture.tier == HASH_ENVELOPE (today)" ($btier -eq 'HASH_ENVELOPE') "(tier='$btier')"
        Check "buyer.messageSigningPosture.capabilities present"          ($null -ne $buyer.messageSigningPosture.capabilities)
        Check "buyer.messageSigningPosture.config.maxMessageAgeMs > 0"    ($buyer.messageSigningPosture.config.maxMessageAgeMs -gt 0)
        Check "buyer.messageSigningPosture.honestNote non-empty"          ($buyer.messageSigningPosture.honestNote -and $buyer.messageSigningPosture.honestNote.Length -gt 0)
    }
}
if ($null -eq $seller) {
    Skip "seller messageSigningPosture" "no deal to inspect"
} else {
    Check "seller.messageSigningPosture present"    ($null -ne $seller.messageSigningPosture)
    if ($null -ne $seller.messageSigningPosture) {
        $stier = $seller.messageSigningPosture.tier
        Check "seller.messageSigningPosture.tier == HASH_ENVELOPE (today)" ($stier -eq 'HASH_ENVELOPE') "(tier='$stier')"
    }
}

# ---------------------------------------------------------------------------
# 12. Iter-2 messageLog[] (T3, T4)
# ---------------------------------------------------------------------------
Section "Iter2Messages"
if ($null -eq $buyer) {
    Skip "buyer messageLog[]" "no deal to inspect"
} else {
    $bml = @($buyer.messageLog)
    Check "buyer.messageLog is an array"            ($null -ne $buyer.messageLog)
    Check "buyer.messageLog non-empty"              ($bml.Count -gt 0) "($($bml.Count) entries)"
    if ($bml.Count -gt 0) {
        # T4: every entry has transportSignature.payloadHash populated
        $missingPayloadHash = $bml | Where-Object {
            $null -eq $_.transportSignature -or
            -not $_.transportSignature.payloadHash -or
            $_.transportSignature.payloadHash.Length -eq 0
        }
        Check "every buyer.messageLog entry has transportSignature.payloadHash (T4)" (($missingPayloadHash | Measure-Object).Count -eq 0)
        # Schema version
        $badSchema = $bml | Where-Object { $_.schemaVersion -ne 1 }
        Check "every buyer.messageLog entry has schemaVersion == 1" (($badSchema | Measure-Object).Count -eq 0)
        # Mix of directions
        $sends    = @($bml | Where-Object { $_.direction -eq 'send' })
        $receives = @($bml | Where-Object { $_.direction -eq 'receive' })
        Check "buyer.messageLog has at least one send"    ($sends.Count -gt 0) "($($sends.Count) sends)"
        Check "buyer.messageLog has at least one receive" ($receives.Count -gt 0) "($($receives.Count) receives)"
        # Every receive entry has verification result
        $missingVerif = $receives | Where-Object { $null -eq $_.verification }
        Check "every buyer receive entry has verification result" (($missingVerif | Measure-Object).Count -eq 0)
    }
}
if ($null -eq $seller) {
    Skip "seller messageLog[]" "no deal to inspect"
} else {
    $sml = @($seller.messageLog)
    Check "seller.messageLog is an array"           ($null -ne $seller.messageLog)
    Check "seller.messageLog non-empty"             ($sml.Count -gt 0) "($($sml.Count) entries)"
    if ($sml.Count -gt 0) {
        $missingPayloadHashS = $sml | Where-Object {
            $null -eq $_.transportSignature -or
            -not $_.transportSignature.payloadHash -or
            $_.transportSignature.payloadHash.Length -eq 0
        }
        Check "every seller.messageLog entry has transportSignature.payloadHash (T4)" (($missingPayloadHashS | Measure-Object).Count -eq 0)
    }
}

# Cross-side sanity: buyer sends == seller receives (counter-direction match)
if ($null -ne $buyer -and $null -ne $seller) {
    $buyerSends    = @($buyer.messageLog  | Where-Object { $_.direction -eq 'send' }).Count
    $sellerRecvs   = @($seller.messageLog | Where-Object { $_.direction -eq 'receive' }).Count
    $buyerRecvs    = @($buyer.messageLog  | Where-Object { $_.direction -eq 'receive' }).Count
    $sellerSends   = @($seller.messageLog | Where-Object { $_.direction -eq 'send' }).Count
    Check "buyer.sends matches seller.receives (T3 cross-check)" ($buyerSends -eq $sellerRecvs) "(buyer-send=$buyerSends seller-recv=$sellerRecvs)"
    Check "seller.sends matches buyer.receives (T3 cross-check)" ($sellerSends -eq $buyerRecvs) "(seller-send=$sellerSends buyer-recv=$buyerRecvs)"
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
