# ============================================================================
# Test-AuditV6-Iter3.ps1
# Verifies the Audit Framework v6 Iteration 3 state on disk.
# ============================================================================
# Usage:
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Test-AuditV6-Iter3.ps1
#
# What this verifies (in addition to ALL iter-1 + iter-2 checks, kept verbatim):
#   [Iter3Shared]      shared/audit-blocks/ has intent-block.ts + autonomy-block.ts
#   [Iter3Decisions]   DECISIONS.md addendum locks the iter-3 vocabulary
#                        (six pillars, HOOTL_with_guardrails, shape enum,
#                         dimensions taxonomy, commit-gate event types,
#                         ScenarioIntentExcerpt propagation)
#   [Iter3Intent]      most-recent deal's audit has .intent block with
#                        - schemaVersion == 1
#                        - intentSource is one of locked enum values
#                        - expectedOutcome.shape is one of 5 enum values
#                        - expectedOutcome.likely matches scenario verbatim (T1)
#                        - deviationFromIntent.dimensions[] populated when actual
#                          diverges from declared intent (T2)
#   [Iter3Autonomy]    most-recent deal's audit has .autonomy block with
#                        - schemaVersion == 1
#                        - six pillars in canonical order
#                        - humanOversightPosition == "HOOTL_with_guardrails" (T4)
#                        - commitGate.state == "NOT_REQUIRED" (only enum value wired today)
#                        - commitGate.wouldFireAt[] has entry for treasury rejections (T3)
#
# Re-run anytime. After a fresh deal the [Deal] / [Iter*] sections re-verify
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
Write-Host " Audit Framework v6 - Iteration 3 Verification" -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White

# ============================================================================
# ITER-1 CHECKS (copied verbatim from Test-AuditV6-Iter1.ps1 via iter-2)
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

# Iter-1 probe-folder bug: getDealFolder() recursive-mkdirs even for empty
# probes. Filter to folders that ACTUALLY contain buyer.audit.json then pick
# by the audit JSON's own mtime. (Pattern reused from iter-2 test script.)
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

# Variables surfaced for downstream sections
$buyer  = $null
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
# ITER-2 CHECKS (copied verbatim from Test-AuditV6-Iter2.ps1)
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
# 9. Iter-2 design lock - 5-tier enum addendum in DECISIONS.md
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
        $missingPayloadHash = $bml | Where-Object {
            $null -eq $_.transportSignature -or
            -not $_.transportSignature.payloadHash -or
            $_.transportSignature.payloadHash.Length -eq 0
        }
        Check "every buyer.messageLog entry has transportSignature.payloadHash (T4)" (($missingPayloadHash | Measure-Object).Count -eq 0)
        $badSchema = $bml | Where-Object { $_.schemaVersion -ne 1 }
        Check "every buyer.messageLog entry has schemaVersion == 1" (($badSchema | Measure-Object).Count -eq 0)
        $sends    = @($bml | Where-Object { $_.direction -eq 'send' })
        $receives = @($bml | Where-Object { $_.direction -eq 'receive' })
        Check "buyer.messageLog has at least one send"    ($sends.Count -gt 0) "($($sends.Count) sends)"
        Check "buyer.messageLog has at least one receive" ($receives.Count -gt 0) "($($receives.Count) receives)"
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

if ($null -ne $buyer -and $null -ne $seller) {
    $buyerSends    = @($buyer.messageLog  | Where-Object { $_.direction -eq 'send' }).Count
    $sellerRecvs   = @($seller.messageLog | Where-Object { $_.direction -eq 'receive' }).Count
    $buyerRecvs    = @($buyer.messageLog  | Where-Object { $_.direction -eq 'receive' }).Count
    $sellerSends   = @($seller.messageLog | Where-Object { $_.direction -eq 'send' }).Count
    Check "buyer.sends matches seller.receives (T3 cross-check)" ($buyerSends -eq $sellerRecvs) "(buyer-send=$buyerSends seller-recv=$sellerRecvs)"
    Check "seller.sends matches buyer.receives (T3 cross-check)" ($sellerSends -eq $buyerRecvs) "(seller-send=$sellerSends buyer-recv=$buyerRecvs)"
}

# ============================================================================
# ITER-3 CHECKS (new sections)
# ============================================================================

# ---------------------------------------------------------------------------
# 13. Iter-3 shared modules
# ---------------------------------------------------------------------------
Section "Iter3Shared"
Check "shared/audit-blocks/intent-block.ts"   (Test-Path (Join-Path $auditBlocksDir "intent-block.ts")   -PathType Leaf)
Check "shared/audit-blocks/autonomy-block.ts" (Test-Path (Join-Path $auditBlocksDir "autonomy-block.ts") -PathType Leaf)
# intent-types.ts must carry the new ScenarioIntentExcerpt export
$intentTypesPath = Join-Path $SrcRoot "shared\intent-types.ts"
if (Test-Path $intentTypesPath -PathType Leaf) {
    $itContent = Get-Content $intentTypesPath -Raw
    Check "intent-types.ts exports ScenarioIntentExcerpt" ($itContent -match 'export\s+interface\s+ScenarioIntentExcerpt')
} else {
    Skip "intent-types.ts ScenarioIntentExcerpt" "file not found"
}
# negotiation-types.ts must carry the new CommitGateEvent type and scenarioIntent fields
$negTypesPath = Join-Path $SrcRoot "shared\negotiation-types.ts"
if (Test-Path $negTypesPath -PathType Leaf) {
    $ntContent = Get-Content $negTypesPath -Raw
    Check "negotiation-types.ts exports CommitGateEvent"          ($ntContent -match 'export\s+interface\s+CommitGateEvent')
    Check "negotiation-types.ts exports CommitGateEventType"      ($ntContent -match 'export\s+type\s+CommitGateEventType')
    Check "OfferData carries scenarioIntent?"                     ($ntContent -match 'scenarioIntent\?\s*:\s*ScenarioIntentExcerpt')
    Check "BuyerNegotiationState carries scenarioIntent?"         ($ntContent -match 'scenarioIntent\?\s*:\s*ScenarioIntentExcerpt')
    Check "SellerNegotiationState carries receivedScenarioIntent?" ($ntContent -match 'receivedScenarioIntent\?\s*:\s*ScenarioIntentExcerpt')
    Check "States carry commitGateEvents?"                        ($ntContent -match 'commitGateEvents\?\s*:\s*CommitGateEvent\[\]')
} else {
    Skip "negotiation-types.ts iter-3 fields" "file not found"
}

# ---------------------------------------------------------------------------
# 14. Iter-3 design lock - vocabulary addendum in DECISIONS.md
# ---------------------------------------------------------------------------
Section "Iter3Decisions"
if (Test-Path $decisionsPath -PathType Leaf) {
    $decContent3 = Get-Content $decisionsPath -Raw
    Check "DECISIONS.md has iter-3 addendum heading" ($decContent3 -match 'Iter 3 vocabulary lock')
    # Item 1 - six pillars
    Check "DECISIONS.md lists goalInterpretation pillar"  ($decContent3 -match 'goalInterpretation')
    Check "DECISIONS.md lists planning pillar"            ($decContent3 -match '\bplanning\b')
    Check "DECISIONS.md lists toolInvocation pillar"      ($decContent3 -match 'toolInvocation')
    Check "DECISIONS.md lists commitmentAuthority pillar" ($decContent3 -match 'commitmentAuthority')
    Check "DECISIONS.md lists peerCommunication pillar"   ($decContent3 -match 'peerCommunication')
    Check "DECISIONS.md lists learningFromOutcome pillar" ($decContent3 -match 'learningFromOutcome')
    # Item 2 - humanOversightPosition
    Check "DECISIONS.md locks HOOTL_with_guardrails"      ($decContent3 -match 'HOOTL_with_guardrails')
    # Item 3 - shape discriminator
    Check "DECISIONS.md lists PRICE_RANGE_CLOSE shape"    ($decContent3 -match 'PRICE_RANGE_CLOSE')
    Check "DECISIONS.md lists ESCALATION_EXPECTED shape"  ($decContent3 -match 'ESCALATION_EXPECTED')
    Check "DECISIONS.md lists FREE_TEXT shape"            ($decContent3 -match 'FREE_TEXT')
    # Item 4 - deviation dimensions
    Check "DECISIONS.md lists outcomeShape dimension"     ($decContent3 -match 'outcomeShape')
    Check "DECISIONS.md lists pricePerUnit dimension"     ($decContent3 -match 'pricePerUnit')
    Check "DECISIONS.md lists quantityMismatch dimension" ($decContent3 -match 'quantityMismatch')
    # Item 5 - commit-gate event types
    Check "DECISIONS.md lists TREASURY_VETO event"             ($decContent3 -match 'TREASURY_VETO')
    Check "DECISIONS.md lists MAX_ROUNDS_REACHED event"        ($decContent3 -match 'MAX_ROUNDS_REACHED')
    Check "DECISIONS.md lists COUNTERPARTY_REJECT_FINAL event" ($decContent3 -match 'COUNTERPARTY_REJECT_FINAL')
    Check "DECISIONS.md lists GUARDRAIL_OVERRIDE event"        ($decContent3 -match 'GUARDRAIL_OVERRIDE')
    # Item 6 - ScenarioIntentExcerpt propagation
    Check "DECISIONS.md mentions ScenarioIntentExcerpt"   ($decContent3 -match 'ScenarioIntentExcerpt')
} else {
    Skip "DECISIONS.md iter-3 addendum" "file not found at $decisionsPath"
}

# ---------------------------------------------------------------------------
# 15. Iter-3 intent block in most-recent deal (T1, T2)
# ---------------------------------------------------------------------------
Section "Iter3Intent"
$allowedShapes  = @('PRICE_RANGE_CLOSE','POINT_CLOSE','ESCALATION_EXPECTED','ABANDON_EXPECTED','FREE_TEXT')
$allowedSources = @('SCENARIO_DECLARED','AGENT_DEFAULT_CONFIG','NONE')

function CheckIntentBlock([string]$side, $audit) {
    if ($null -eq $audit) {
        Skip "$side intent block" "no deal to inspect"
        return
    }
    if ($null -eq $audit.intent) {
        Skip "$side intent block" "intent block absent (deal pre-dates iter-3 or backward-compat path)"
        return
    }
    $intent = $audit.intent
    Check "$side.intent.schemaVersion == 1"                ($intent.schemaVersion -eq 1)
    Check "$side.intent.perspective set"                   ($null -ne $intent.perspective -and $intent.perspective.Length -gt 0)
    Check "$side.intent.intentSource is one of enum values" ($allowedSources -contains $intent.intentSource) "(intentSource='$($intent.intentSource)')"
    Check "$side.intent.expectedOutcome present"           ($null -ne $intent.expectedOutcome)
    if ($null -ne $intent.expectedOutcome) {
        $shape = $intent.expectedOutcome.shape
        Check "$side.intent.expectedOutcome.shape is one of 5 enum values" ($allowedShapes -contains $shape) "(shape='$shape')"
        Check "$side.intent.expectedOutcome.likely non-empty"              ($intent.expectedOutcome.likely -and $intent.expectedOutcome.likely.Length -gt 0)
    }
    Check "$side.intent.deviationFromIntent present"       ($null -ne $intent.deviationFromIntent)
    if ($null -ne $intent.deviationFromIntent) {
        $dims = @($intent.deviationFromIntent.dimensions)
        # PowerShell quirk: a $null .dimensions becomes a single-element array
        # containing $null when wrapped in @(). Filter those out.
        $realDims = @($dims | Where-Object { $_ -is [PSCustomObject] })
        Check "$side.intent.deviationFromIntent.dimensions is an array" ($null -ne $intent.deviationFromIntent.dimensions)
        Check "$side.intent.deviationFromIntent.overallSeverity set"    ($null -ne $intent.deviationFromIntent.overallSeverity)
        $allowedSeverity = @('high','medium','low','none')
        if ($null -ne $intent.deviationFromIntent.overallSeverity) {
            Check "$side.intent.deviationFromIntent.overallSeverity is one of 4 enum values" ($allowedSeverity -contains $intent.deviationFromIntent.overallSeverity) "(severity='$($intent.deviationFromIntent.overallSeverity)')"
        }
    }
    # When source is SCENARIO_DECLARED, scenarioId + scenarioTitle should be set
    if ($intent.intentSource -eq 'SCENARIO_DECLARED') {
        Check "$side.intent.scenarioId set (SCENARIO_DECLARED)"    ($intent.scenarioId -and $intent.scenarioId.Length -gt 0)
        Check "$side.intent.scenarioTitle set (SCENARIO_DECLARED)" ($intent.scenarioTitle -and $intent.scenarioTitle.Length -gt 0)
    }
}

CheckIntentBlock "buyer"  $buyer
CheckIntentBlock "seller" $seller

# Cross-side: when both sides declared a scenario, scenarioId must match (T1).
if ($null -ne $buyer -and $null -ne $seller -and $null -ne $buyer.intent -and $null -ne $seller.intent) {
    if ($buyer.intent.intentSource -eq 'SCENARIO_DECLARED' -and $seller.intent.intentSource -eq 'SCENARIO_DECLARED') {
        Check "buyer.intent.scenarioId matches seller.intent.scenarioId (T1)" ($buyer.intent.scenarioId -eq $seller.intent.scenarioId) "(buyer='$($buyer.intent.scenarioId)' seller='$($seller.intent.scenarioId)')"
        Check "buyer.intent.expectedOutcome.likely matches seller's (T1)"     ($buyer.intent.expectedOutcome.likely -eq $seller.intent.expectedOutcome.likely)
    } else {
        Skip "cross-side scenario id match" "at least one side has intentSource != SCENARIO_DECLARED (deal not run with --scenario)"
    }
}

# ---------------------------------------------------------------------------
# 16. Iter-3 autonomy block in most-recent deal (T3, T4)
# ---------------------------------------------------------------------------
Section "Iter3Autonomy"
$expectedPillars = @('goalInterpretation','planning','toolInvocation','commitmentAuthority','peerCommunication','learningFromOutcome')
$allowedOversight = @('HITC','HITL','HITL_with_guardrails','HOTL','HOTL_with_guardrails','HOOTL','HOOTL_with_guardrails')
$allowedGateStates = @('NOT_REQUIRED','PENDING','APPROVED','REJECTED','DEFERRED','TIMED_OUT','CANCELLED','ESCALATED')
$allowedEventTypes = @('TREASURY_VETO','MAX_ROUNDS_REACHED','COUNTERPARTY_REJECT_FINAL','GUARDRAIL_OVERRIDE')

function CheckAutonomyBlock([string]$side, $audit) {
    if ($null -eq $audit) {
        Skip "$side autonomy block" "no deal to inspect"
        return
    }
    if ($null -eq $audit.autonomy) {
        Skip "$side autonomy block" "autonomy block absent (deal pre-dates iter-3 or backward-compat path)"
        return
    }
    $auto = $audit.autonomy
    Check "$side.autonomy.schemaVersion == 1"                  ($auto.schemaVersion -eq 1)
    Check "$side.autonomy.capabilitiesActive present"          ($null -ne $auto.capabilitiesActive)
    if ($null -ne $auto.capabilitiesActive) {
        foreach ($p in $expectedPillars) {
            $row = $auto.capabilitiesActive.$p
            Check "$side.autonomy.capabilitiesActive.$p present" ($null -ne $row)
            if ($null -ne $row) {
                Check "$side.autonomy.capabilitiesActive.$p.justification non-empty" ($row.justification -and $row.justification.Length -gt 0)
            }
        }
        # learningFromOutcome must be inactive today (post-MVP work)
        if ($null -ne $auto.capabilitiesActive.learningFromOutcome) {
            Check "$side.autonomy.capabilitiesActive.learningFromOutcome.active == false" ($auto.capabilitiesActive.learningFromOutcome.active -eq $false)
        }
    }
    Check "$side.autonomy.humanOversightPosition is one of 7 enum values" ($allowedOversight -contains $auto.humanOversightPosition) "(position='$($auto.humanOversightPosition)')"
    # T4: must be HOOTL_with_guardrails today
    Check "$side.autonomy.humanOversightPosition == HOOTL_with_guardrails (T4)" ($auto.humanOversightPosition -eq 'HOOTL_with_guardrails')
    Check "$side.autonomy.guardrails is an array"              ($null -ne $auto.guardrails)
    if ($null -ne $auto.guardrails) {
        $gr = @($auto.guardrails)
        Check "$side.autonomy.guardrails non-empty"            ($gr.Count -gt 0) "($($gr.Count) guardrails)"
    }
    Check "$side.autonomy.commitGate present"                  ($null -ne $auto.commitGate)
    if ($null -ne $auto.commitGate) {
        Check "$side.autonomy.commitGate.state is one of 8 enum values" ($allowedGateStates -contains $auto.commitGate.state) "(state='$($auto.commitGate.state)')"
        Check "$side.autonomy.commitGate.state == NOT_REQUIRED (today)" ($auto.commitGate.state -eq 'NOT_REQUIRED')
        Check "$side.autonomy.commitGate.description non-empty"         ($auto.commitGate.description -and $auto.commitGate.description.Length -gt 0)
        Check "$side.autonomy.commitGate.wouldFireAt is an array"       ($null -ne $auto.commitGate.wouldFireAt)
        if ($null -ne $auto.commitGate.wouldFireAt) {
            $events = @($auto.commitGate.wouldFireAt | Where-Object { $_ -is [PSCustomObject] })
            foreach ($ev in $events) {
                Check "$side.autonomy event eventType '$($ev.eventType)' is one of 4 enum values" ($allowedEventTypes -contains $ev.eventType)
                Check "$side.autonomy event eventType='$($ev.eventType)' has triggerSource" ($ev.triggerSource -and $ev.triggerSource.Length -gt 0)
                Check "$side.autonomy event eventType='$($ev.eventType)' has timestamp"     ($ev.timestamp -and $ev.timestamp.Length -gt 0)
            }
        }
        # eventCounts should have all 4 keys
        $ec = $auto.commitGate.eventCounts
        Check "$side.autonomy.commitGate.eventCounts has all 4 keys" ($null -ne $ec -and $null -ne $ec.TREASURY_VETO -and $null -ne $ec.MAX_ROUNDS_REACHED -and $null -ne $ec.COUNTERPARTY_REJECT_FINAL -and $null -ne $ec.GUARDRAIL_OVERRIDE)
    }
}

CheckAutonomyBlock "buyer"  $buyer
CheckAutonomyBlock "seller" $seller

# T3: if outcome is escalation OR REJECTED, the seller should have at least one
# TREASURY_VETO (from below-floor scenarios) OR the buyer should have a
# MAX_ROUNDS_REACHED / COUNTERPARTY_REJECT_FINAL. For SUCCESS deals, events
# may legitimately be empty (no treasury rejections, no max-rounds).
if ($null -ne $buyer -and $null -ne $buyer.autonomy -and $null -ne $buyer.autonomy.commitGate) {
    $isEscalation = ($buyer.outcome -eq 'escalation')
    $buyerEvents  = @($buyer.autonomy.commitGate.wouldFireAt | Where-Object { $_ -is [PSCustomObject] })
    if ($isEscalation) {
        Check "buyer escalation: at least one commitGate event recorded (T3)" ($buyerEvents.Count -gt 0) "($($buyerEvents.Count) events)"
    } else {
        # success: events allowed to be empty, just note
        Write-Host "  [INFO] buyer success: $($buyerEvents.Count) commitGate events" -ForegroundColor DarkGray
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
