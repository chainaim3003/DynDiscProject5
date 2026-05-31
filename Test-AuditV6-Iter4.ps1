# ============================================================================
# Test-AuditV6-Iter4.ps1
# Verifies the Audit Framework v6 Iteration 4 state on disk.
# ============================================================================
# Usage:
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Test-AuditV6-Iter4.ps1
#
# What this verifies (in addition to ALL iter-1 + iter-2 + iter-3 checks,
# kept verbatim):
#   [Iter4Shared]      shared/audit-blocks/ has think-cycle-trace.ts +
#                        delegation-chain.ts + delegation-steps.json;
#                        llm-client.ts carries prompt: {text, hash} threading;
#                        logger.ts carries thinkCycleRounds + delegationSteps
#                        params
#   [Iter4Decisions]   DECISIONS.md addendum 2026-05-25 locks the iter-4
#                        vocabulary (5 think-cycle step names, 6 delegation
#                        step names, scope markers, gen_ai.* + prompt.*
#                        fields, DCC marker fields incl. [DCC-2026] deferred
#                        reason, EU AI Act 4 booleans, HMAC signature kind)
#   [Iter4Scope]       most-recent deal's seller audit has
#                        thinkCycleTraceScope == 'seller-only' and
#                        delegationChainScope == 'seller-only' (PLAN Iter4 T1
#                        scope addendum); buyer audit has neither block.
#                        SKIPs cleanly when both blocks are absent (deal
#                        pre-dates iter-4), mirroring iter-3's pattern.
#   [Iter4ThinkCycle]  most-recent deal's seller audit has thinkCycleTrace[]
#                        with per-entry mode marker; structure dispatched on
#                        seller.selfProcessMode:
#                          - L2_*  -> 5 steps (PLAN Iter4 T1, T2),
#                                     gen_ai.* only on step 4 (PLAN T2),
#                                     prompt.hash on step 4 when LLM called
#                                     (PLAN T6); when prompt.text present,
#                                     sha256(prompt.text) == prompt.hash
#                          - BASIC/L1 -> 2 steps (geminiCall + guardrails)
#                                     per addendum 2026-05-25 Item 0 honesty
#   [Iter4Delegation]  most-recent deal's seller audit has delegationChain[]
#                        with per-entry DCC marker
#                        (propertiesEmitted=4, propertiesFullSpec=7,
#                        deferredReason mentions [DCC-2026] Patil),
#                        EU AI Act block honest 4 booleans (PLAN T5),
#                        HMAC envelope, stepName in canonical 6;
#                        per-round count dispatched on selfProcessMode:
#                          - L2_*     -> 6 entries/round in canonical order
#                                        (PLAN Iter4 T3)
#                          - BASIC/L1 -> 1 entry/round, stepName ==
#                                        'treasury-consultation'
#   [Iter4Signature]   per-entry HMAC reverification (PLAN Iter4 T4): strip
#                        signature, JSON.stringify in original key order via
#                        node (V8 insertion-order, matches iter-2
#                        PlainHashSigner.hashPayload convention), sha256,
#                        compare hex to entry.signature.value
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
Write-Host " Audit Framework v6 - Iteration 4 Verification" -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White

# ============================================================================
# ITER-1 CHECKS (copied verbatim from Test-AuditV6-Iter1.ps1 via iter-3)
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
        # Iter-4 fix 2026-05-25: read as UTF-8 explicitly. Windows PS 5.1's
        # Get-Content -Raw without -Encoding defaults to the system codepage
        # (typically Windows-1252), which mangles multibyte UTF-8 chars in the
        # audit JSON (e.g. ₹ E2 82 B9 → â‚¹). That breaks both the
        # sha256(prompt.text)==prompt.hash check AND the delegation HMAC
        # re-verify, because the in-memory string then re-encodes to UTF-8
        # with extra bytes vs what the seller agent originally hashed/signed.
        $buyer = Get-Content $buyerJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Check "buyer.negotiationId matches folder"               ($buyer.negotiationId -eq $negId)
        Check "buyer has selfProcessMode (renamed) key"          ($null -ne $buyer.selfProcessMode)
        Check "buyer has sellerResponseMode (new) key"           ($null -ne $buyer.sellerResponseMode)
        $servedBy = $buyer.sellerResponseMode.servedBy
        Check "buyer.sellerResponseMode is from LIVE seller fetch" ($servedBy -eq 'seller-agent@port-8080') "(servedBy='$servedBy')"
        Check "buyer.decisions[] non-empty (Bug 2 fix)"          ($buyer.decisions -and @($buyer.decisions).Count -gt 0) "($(@($buyer.decisions).Count) entries)"
    }

    if (Test-Path $sellerJsonPath -PathType Leaf) {
        $seller = Get-Content $sellerJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
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
# ITER-2 CHECKS (copied verbatim from Test-AuditV6-Iter2.ps1 via iter-3)
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
# ITER-3 CHECKS (copied verbatim from Test-AuditV6-Iter3.ps1)
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

# ============================================================================
# ITER-4 CHECKS (new sections)
# ============================================================================

# Canonical vocabulary locked by addendum 2026-05-25
$thinkStepNamesFull   = @('receiveOffer','advisorConsultation','mathAggregator','geminiCall','guardrails')
$thinkStepNamesBasic  = @('geminiCall','guardrails')  # degenerate trace per Q-iter4-A
$delegStepNamesCanon  = @('treasury-consultation','inventory-consultation','logistics-consultation','credit-consultation','executive-synthesis','consultation-routing')

# ---------------------------------------------------------------------------
# 17. Iter-4 shared modules + code-edit markers
# ---------------------------------------------------------------------------
Section "Iter4Shared"
$thinkCycleTracePath = Join-Path $auditBlocksDir "think-cycle-trace.ts"
$delegationChainPath = Join-Path $auditBlocksDir "delegation-chain.ts"
$delegationStepsPath = Join-Path $auditBlocksDir "delegation-steps.json"
Check "shared/audit-blocks/think-cycle-trace.ts" (Test-Path $thinkCycleTracePath -PathType Leaf)
Check "shared/audit-blocks/delegation-chain.ts"  (Test-Path $delegationChainPath -PathType Leaf)
Check "shared/audit-blocks/delegation-steps.json" (Test-Path $delegationStepsPath -PathType Leaf)

# delegation-steps.json must contain the 6 canonical step names
# Iter-4 fix 2026-05-25: the previous version did PSCustomObject property
# access via $item.stepName inside a foreach. That fails silently under
# PowerShell 5.1 with Set-StrictMode in scope (profile-loaded), returning
# $null for the property even when the JSON has it. We now do a raw
# substring scan on the file content as the authoritative check, and keep
# the parsed-shape sanity check as a separate diagnostic.
if (Test-Path $delegationStepsPath -PathType Leaf) {
    $rawSteps = Get-Content $delegationStepsPath -Raw
    try {
        $stepsJson = $rawSteps | ConvertFrom-Json
        $stepsArr = $null
        if ($stepsJson -is [array]) { $stepsArr = @($stepsJson) }
        elseif ($null -ne $stepsJson.steps) { $stepsArr = @($stepsJson.steps) }
        elseif ($null -ne $stepsJson.canonicalStepNames) { $stepsArr = @($stepsJson.canonicalStepNames) }
        Check "delegation-steps.json contains an array of step names" ($null -ne $stepsArr -and $stepsArr.Count -ge 6)
    } catch {
        Check "delegation-steps.json parses as JSON" $false "($($_.Exception.Message))"
    }
    # Authoritative membership test: raw file scan. Looks for the step name
    # as a quoted JSON string value ("<name>") to avoid false positives
    # from comment text mentioning the names.
    foreach ($s in $delegStepNamesCanon) {
        $pattern = '"' + [regex]::Escape($s) + '"'
        Check "delegation-steps.json contains '$s'" ($rawSteps -match $pattern)
    }
} else {
    Skip "delegation-steps.json contents" "file not found"
}

# think-cycle-trace.ts must export buildThinkCycleTrace + read the env var
if (Test-Path $thinkCycleTracePath -PathType Leaf) {
    $tctContent = Get-Content $thinkCycleTracePath -Raw
    Check "think-cycle-trace.ts exports buildThinkCycleTrace" ($tctContent -match 'export\s+function\s+buildThinkCycleTrace')
    Check "think-cycle-trace.ts reads AUDIT_INCLUDE_PROMPT_TEXT env var (Q-iter4-B)" ($tctContent -match 'AUDIT_INCLUDE_PROMPT_TEXT')
    Check "think-cycle-trace.ts emits thinkCycleTraceScope (Item 8)" ($tctContent -match 'thinkCycleTraceScope')
    Check "think-cycle-trace.ts references 'seller-only' scope (Item 1)" ($tctContent -match "'seller-only'|`"seller-only`"")
    Check "think-cycle-trace.ts handles gen_ai.system field (Item 2)" ($tctContent -match "gen_ai\.system")
    Check "think-cycle-trace.ts handles gen_ai.request.model field (Item 2)" ($tctContent -match "gen_ai\.request\.model")
    Check "think-cycle-trace.ts handles gen_ai.usage.input_tokens field (Item 2)" ($tctContent -match "gen_ai\.usage\.input_tokens")
    Check "think-cycle-trace.ts handles gen_ai.usage.output_tokens field (Item 2)" ($tctContent -match "gen_ai\.usage\.output_tokens")
} else {
    Skip "think-cycle-trace.ts content checks" "file not found"
}

# delegation-chain.ts must export buildDelegationChain + computeDelegationSignatureValue
if (Test-Path $delegationChainPath -PathType Leaf) {
    $dcContent = Get-Content $delegationChainPath -Raw
    Check "delegation-chain.ts exports buildDelegationChain" ($dcContent -match 'export\s+function\s+buildDelegationChain')
    Check "delegation-chain.ts exports computeDelegationSignatureValue" ($dcContent -match 'export\s+function\s+computeDelegationSignatureValue')
    Check "delegation-chain.ts emits delegationChainScope (Item 8)" ($dcContent -match 'delegationChainScope')
    Check "delegation-chain.ts references 'seller-only' scope (Item 4)" ($dcContent -match "'seller-only'|`"seller-only`"")
    Check "delegation-chain.ts loads delegation-steps.json" ($dcContent -match 'delegation-steps\.json')
    Check "delegation-chain.ts emits dcc.propertiesEmitted (Item 5)" ($dcContent -match 'propertiesEmitted')
    Check "delegation-chain.ts emits dcc.propertiesFullSpec (Item 5)" ($dcContent -match 'propertiesFullSpec')
    Check "delegation-chain.ts emits dcc.deferredReason (Item 5)" ($dcContent -match 'deferredReason')
    Check "delegation-chain.ts references [DCC-2026] Patil (Item 5)" ($dcContent -match 'DCC-2026' -and $dcContent -match 'Patil')
    Check "delegation-chain.ts emits euAiActArticle14 (Item 6)" ($dcContent -match 'euAiActArticle14')
    Check "delegation-chain.ts emits monitorability (Item 6)" ($dcContent -match 'monitorability')
    Check "delegation-chain.ts emits interventionPossible (Item 6)" ($dcContent -match 'interventionPossible')
    Check "delegation-chain.ts emits signature kind HMAC (Item 7)" ($dcContent -match "'HMAC'|`"HMAC`"")
} else {
    Skip "delegation-chain.ts content checks" "file not found"
}

# llm-client.ts must carry prompt: {text, hash} threading
$llmClientPath = Join-Path $SrcRoot "shared\llm-client.ts"
if (Test-Path $llmClientPath -PathType Leaf) {
    $llmContent = Get-Content $llmClientPath -Raw
    Check "llm-client.ts threads prompt hash through audit (Item 2)" ($llmContent -match 'promptHash')
    Check "llm-client.ts threads prompt text through audit (Item 2)" ($llmContent -match 'prompt\s*:\s*\{[^}]*text' -or $llmContent -match 'promptText')
    Check "llm-client.ts imports crypto for sha256 (Item 2)" ($llmContent -match "from\s+['""]crypto['""]" -or $llmContent -match "from\s+['""]node:crypto['""]")
} else {
    Skip "llm-client.ts content checks" "file not found"
}

# logger.ts must carry thinkCycleRounds + delegationSteps params on saveAuditJson
$loggerPath = Join-Path $SrcRoot "shared\logger.ts"
if (Test-Path $loggerPath -PathType Leaf) {
    $logContent = Get-Content $loggerPath -Raw
    Check "logger.ts saveAuditJson has thinkCycleRounds? param" ($logContent -match 'thinkCycleRounds\??')
    Check "logger.ts saveAuditJson has delegationSteps? param" ($logContent -match 'delegationSteps\??')
    Check "logger.ts imports buildThinkCycleTrace" ($logContent -match 'buildThinkCycleTrace')
    Check "logger.ts imports buildDelegationChain" ($logContent -match 'buildDelegationChain')
} else {
    Skip "logger.ts content checks" "file not found"
}

# seller-agent/index.ts must carry recordLlmAudit + buildIter4AuditParams
$sellerAgentPath = Join-Path $SrcRoot "agents\seller-agent\index.ts"
if (Test-Path $sellerAgentPath -PathType Leaf) {
    $saContent = Get-Content $sellerAgentPath -Raw
    Check "seller-agent/index.ts has recordLlmAudit method" ($saContent -match 'recordLlmAudit')
    Check "seller-agent/index.ts has buildIter4AuditParams method" ($saContent -match 'buildIter4AuditParams')
    Check "seller-agent/index.ts has llmAuditByRound accumulator" ($saContent -match 'llmAuditByRound')
} else {
    Skip "seller-agent/index.ts content checks" "file not found"
}

# ---------------------------------------------------------------------------
# 18. Iter-4 design lock - vocabulary addendum in DECISIONS.md
# ---------------------------------------------------------------------------
Section "Iter4Decisions"
if (Test-Path $decisionsPath -PathType Leaf) {
    $decContent4 = Get-Content $decisionsPath -Raw
    Check "DECISIONS.md has iter-4 addendum heading" ($decContent4 -match 'Iter 4 vocabulary lock')
    # Item 0 - philosophy marker
    Check "DECISIONS.md mentions 'honest partial' philosophy (Item 0)" ($decContent4 -match 'honest partial')
    # Item 1 - the 5 think-cycle step names verbatim
    foreach ($s in $thinkStepNamesFull) {
        Check "DECISIONS.md lists think-cycle step '$s' (Item 1)" ($decContent4 -match [regex]::Escape($s))
    }
    Check "DECISIONS.md emits thinkCycleTraceScope marker (Item 8)" ($decContent4 -match 'thinkCycleTraceScope')
    # Item 2 - gen_ai.* fields (OTel)
    Check "DECISIONS.md mentions gen_ai.system field (Item 2)" ($decContent4 -match 'gen_ai\.system')
    Check "DECISIONS.md mentions gen_ai.request.model field (Item 2)" ($decContent4 -match 'gen_ai\.request\.model')
    Check "DECISIONS.md mentions gen_ai.usage.input_tokens field (Item 2)" ($decContent4 -match 'gen_ai\.usage\.input_tokens')
    Check "DECISIONS.md mentions gen_ai.usage.output_tokens field (Item 2)" ($decContent4 -match 'gen_ai\.usage\.output_tokens')
    # Item 3 - prompt.text config flag
    Check "DECISIONS.md mentions prompt.hash (Item 3)" ($decContent4 -match 'prompt\.hash')
    Check "DECISIONS.md mentions prompt.text (Item 3)" ($decContent4 -match 'prompt\.text')
    Check "DECISIONS.md locks auditConfig.includePromptText (Item 3)" ($decContent4 -match 'auditConfig\.includePromptText')
    # Item 4 - the 6 delegation step names verbatim
    foreach ($s in $delegStepNamesCanon) {
        Check "DECISIONS.md lists delegation step '$s' (Item 4)" ($decContent4 -match [regex]::Escape($s))
    }
    Check "DECISIONS.md emits delegationChainScope marker (Item 8)" ($decContent4 -match 'delegationChainScope')
    # Item 5 - DCC marker
    Check "DECISIONS.md locks propertiesEmitted: 4 (Item 5)" ($decContent4 -match 'propertiesEmitted')
    Check "DECISIONS.md locks propertiesFullSpec: 7 (Item 5)" ($decContent4 -match 'propertiesFullSpec')
    Check "DECISIONS.md mentions [DCC-2026] deferred reason (Item 5)" ($decContent4 -match 'DCC-2026')
    Check "DECISIONS.md mentions Patil arxiv 2604.02767 (Item 5)" ($decContent4 -match '2604\.02767')
    # Item 6 - EU AI Act Article 14 four booleans
    Check "DECISIONS.md mentions monitorability (Item 6)"       ($decContent4 -match 'monitorability')
    Check "DECISIONS.md mentions traceability (Item 6)"         ($decContent4 -match 'traceability')
    Check "DECISIONS.md mentions interventionPossible (Item 6)" ($decContent4 -match 'interventionPossible')
    Check "DECISIONS.md mentions overridePossible (Item 6)"     ($decContent4 -match 'overridePossible')
    Check "DECISIONS.md mentions attributesEmitted: 4 (Item 6)" ($decContent4 -match 'attributesEmitted')
    # Item 7 - HMAC signature kind
    Check "DECISIONS.md locks signature kind HMAC (Item 7)" ($decContent4 -match '"HMAC"|`HMAC`')
    Check "DECISIONS.md mentions PlainHashSigner (Item 7)" ($decContent4 -match 'PlainHashSigner')
} else {
    Skip "DECISIONS.md iter-4 addendum" "file not found at $decisionsPath"
}

# ---------------------------------------------------------------------------
# 19. Iter-4 scope: seller-only markers + buyer absence (addendum Item 8)
# ---------------------------------------------------------------------------
Section "Iter4Scope"
# Iter-4 fix 2026-05-25: replaced the `$null -eq $seller.X -and $null -eq
# $seller.Y` compound check with explicit PSObject.Properties.Name lookups.
# The compound `-and` form was silently evaluating to False on the user's
# PS5.1 environment (likely Set-StrictMode in profile), forcing the else
# branch and producing 4 bogus FAILs on a legitimately pre-iter-4 audit.
# The property-name lookup is unambiguous regardless of strict mode.
$sellerHasThinkCycle = $false
$sellerHasDelegation = $false
if ($null -ne $seller) {
    $sellerProps = @($seller.PSObject.Properties.Name)
    $sellerHasThinkCycle = ($sellerProps -contains 'thinkCycleTrace')
    $sellerHasDelegation = ($sellerProps -contains 'delegationChain')
}
if ($null -eq $seller) {
    Skip "seller scope markers" "no deal to inspect"
} elseif (-not $sellerHasThinkCycle -and -not $sellerHasDelegation) {
    # Deal pre-dates iter-4: both blocks legitimately absent (the seller audit
    # was written by a pre-iter-4 codebase). Mirror iter-3's SKIP pattern so
    # re-running this script against an old deal doesn't report bogus
    # failures. After a fresh iter-4 deal these convert to PASS/FAIL.
    Skip "seller.thinkCycleTraceScope == 'seller-only'" "iter-4 blocks absent (deal pre-dates iter-4 - rebuild + restart agents + run a new deal)"
    Skip "seller.delegationChainScope == 'seller-only'" "iter-4 blocks absent (deal pre-dates iter-4)"
    Skip "seller.thinkCycleTrace present"               "iter-4 blocks absent (deal pre-dates iter-4)"
    Skip "seller.delegationChain present"               "iter-4 blocks absent (deal pre-dates iter-4)"
} else {
    Check "seller.thinkCycleTraceScope == 'seller-only'" ($seller.thinkCycleTraceScope -eq 'seller-only') "(scope='$($seller.thinkCycleTraceScope)')"
    Check "seller.delegationChainScope == 'seller-only'" ($seller.delegationChainScope -eq 'seller-only') "(scope='$($seller.delegationChainScope)')"
    Check "seller.thinkCycleTrace present"               ($null -ne $seller.thinkCycleTrace)
    Check "seller.delegationChain present"               ($null -ne $seller.delegationChain)
}

if ($null -eq $buyer) {
    Skip "buyer scope absence" "no deal to inspect"
} else {
    # Per addendum Item 1 / Item 4: buyer audit shape is UNCHANGED in iter-4.
    # Buyer must NOT carry the seller-only blocks or their scope markers.
    Check "buyer.thinkCycleTrace absent (Item 1)"      ($null -eq $buyer.thinkCycleTrace)
    Check "buyer.thinkCycleTraceScope absent (Item 1)" ($null -eq $buyer.thinkCycleTraceScope)
    Check "buyer.delegationChain absent (Item 4)"      ($null -eq $buyer.delegationChain)
    Check "buyer.delegationChainScope absent (Item 4)" ($null -eq $buyer.delegationChainScope)
}

# ---------------------------------------------------------------------------
# 20. Iter-4 thinkCycleTrace[] in most-recent seller audit
#     (PLAN Iter4 T1, T2, T6 + addendum Q-iter4-A mode dispatch)
# ---------------------------------------------------------------------------
Section "Iter4ThinkCycle"
$mode = $null
$isBasic = $false
if ($null -ne $seller) {
    $mode = $seller.selfProcessMode
    # iter-2 audit-writer stores selfProcessMode as an object with .mode (or
    # similar). Accept either a raw string or an object with a .mode/.code
    # property. The handoff confirms it's the seller's SELLER_RESPONSE_MODE.
    $modeStr = $null
    if ($mode -is [string]) { $modeStr = $mode }
    elseif ($null -ne $mode.mode) { $modeStr = [string]$mode.mode }
    elseif ($null -ne $mode.code) { $modeStr = [string]$mode.code }
    elseif ($null -ne $mode.value) { $modeStr = [string]$mode.value }
    elseif ($null -ne $mode.name) { $modeStr = [string]$mode.name }
    else { $modeStr = ($mode | ConvertTo-Json -Compress -Depth 10) }
    Write-Host "  Detected seller mode: $modeStr" -ForegroundColor DarkGray
    $isBasic = ($modeStr -match 'BASIC' -or $modeStr -match '^L1_' -or $modeStr -match '_L1_' -or $modeStr -match 'L1$')
    if ($isBasic) {
        Write-Host "  -> applying BASIC/L1 mode checks (degenerate trace per Q-iter4-A)" -ForegroundColor DarkGray
    } else {
        Write-Host "  -> applying L2 mode checks (full 5-step trace)" -ForegroundColor DarkGray
    }
}

if ($null -eq $seller -or $null -eq $seller.thinkCycleTrace) {
    Skip "seller thinkCycleTrace[]" "no seller audit or no thinkCycleTrace block"
} else {
    $tct = @($seller.thinkCycleTrace | Where-Object { $_ -is [PSCustomObject] })
    Check "seller.thinkCycleTrace is non-empty array" ($tct.Count -gt 0) "($($tct.Count) round entries)"

    $expectedStepNames = if ($isBasic) { $thinkStepNamesBasic } else { $thinkStepNamesFull }
    $expectedStepCount = $expectedStepNames.Count

    $roundIdx = 0
    foreach ($entry in $tct) {
        $roundIdx++
        $rTag = "round#$roundIdx"
        Check "thinkCycleTrace $rTag has round number"     ($null -ne $entry.round)
        Check "thinkCycleTrace $rTag has mode marker (per-entry, addendum Item 0)" ($entry.mode -and ([string]$entry.mode).Length -gt 0) "(mode='$($entry.mode)')"
        $steps = @($entry.steps | Where-Object { $_ -is [PSCustomObject] })
        Check "thinkCycleTrace $rTag steps[] count == $expectedStepCount ($([string]::Join(',',$expectedStepNames)))" ($steps.Count -eq $expectedStepCount) "($($steps.Count) steps)"

        # Step ordering + name match
        for ($i = 0; $i -lt [Math]::Min($steps.Count, $expectedStepNames.Count); $i++) {
            $step = $steps[$i]
            $expectedName = $expectedStepNames[$i]
            Check "thinkCycleTrace $rTag step[$i].stepName == '$expectedName'" ($step.stepName -eq $expectedName) "(got '$($step.stepName)')"
            Check "thinkCycleTrace $rTag step[$i].stepNumber set" ($null -ne $step.stepNumber)
        }

        # Per-step gen_ai.* policy (addendum Item 2): ONLY step 4 (geminiCall)
        # may carry gen_ai.* fields. Steps 1/2/3/5 must NOT carry any gen_ai.*
        # key.
        foreach ($step in $steps) {
            $sn = [string]$step.stepName
            $genAiKeys = @($step.PSObject.Properties | Where-Object { $_.Name -like 'gen_ai.*' })
            if ($sn -eq 'geminiCall') {
                # Step 4: gen_ai.* may be present; if present, sanity-check
                $genAiSystem = $step.'gen_ai.system'
                if ($null -ne $genAiSystem) {
                    Check "thinkCycleTrace $rTag geminiCall step gen_ai.system == 'gemini' (PLAN T2)" ($genAiSystem -eq 'gemini') "(got '$genAiSystem')"
                }
                $genAiModel = $step.'gen_ai.request.model'
                if ($null -ne $genAiModel) {
                    Check "thinkCycleTrace $rTag geminiCall step gen_ai.request.model non-empty (PLAN T2)" (([string]$genAiModel).Length -gt 0) "(got '$genAiModel')"
                }
                $genAiInTok = $step.'gen_ai.usage.input_tokens'
                if ($null -ne $genAiInTok) {
                    Check "thinkCycleTrace $rTag geminiCall step gen_ai.usage.input_tokens is numeric (PLAN T2)" ($genAiInTok -is [int] -or $genAiInTok -is [long] -or $genAiInTok -is [double])
                }
                $genAiOutTok = $step.'gen_ai.usage.output_tokens'
                if ($null -ne $genAiOutTok) {
                    Check "thinkCycleTrace $rTag geminiCall step gen_ai.usage.output_tokens is numeric (PLAN T2)" ($genAiOutTok -is [int] -or $genAiOutTok -is [long] -or $genAiOutTok -is [double])
                }
                # prompt.hash + prompt.text policy (Item 3, PLAN T6)
                # Implementation may emit `prompt` either as a nested object
                # {hash, text} or as dot-keyed siblings (prompt.hash,
                # prompt.text). Accept both shapes.
                $promptObj    = $step.prompt
                $promptHashDk = $step.'prompt.hash'
                $promptTextDk = $step.'prompt.text'
                $promptHashEffective = $null
                $promptTextEffective = $null
                if ($null -ne $promptObj) {
                    $promptHashEffective = $promptObj.hash
                    $promptTextEffective = $promptObj.text
                } else {
                    $promptHashEffective = $promptHashDk
                    $promptTextEffective = $promptTextDk
                }
                if ($null -ne $promptHashEffective) {
                    Check "thinkCycleTrace $rTag geminiCall step prompt.hash is 64-char hex (Item 2)" ($promptHashEffective -match '^[0-9a-f]{64}$') "(got '$promptHashEffective')"
                    # If prompt.text is present, sha256(text) must equal hash (Item 3 verifiability)
                    if ($null -ne $promptTextEffective -and ([string]$promptTextEffective).Length -gt 0) {
                        $sha = [System.Security.Cryptography.SHA256]::Create()
                        try {
                            $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$promptTextEffective)
                            $hashBytes = $sha.ComputeHash($bytes)
                            $hashHex = (($hashBytes | ForEach-Object { $_.ToString('x2') }) -join '')
                            Check "thinkCycleTrace $rTag geminiCall sha256(prompt.text) == prompt.hash (PLAN T6 verifiability)" ($hashHex -eq $promptHashEffective) "(computed='$hashHex' stored='$promptHashEffective')"
                        } finally {
                            $sha.Dispose()
                        }
                    } else {
                        Write-Host "  [INFO] thinkCycleTrace $rTag prompt.text absent (AUDIT_INCLUDE_PROMPT_TEXT=false path or token-ceiling)" -ForegroundColor DarkGray
                    }
                }
            } else {
                # Steps 1/2/3/5: NO gen_ai.* keys allowed (addendum Item 2)
                Check "thinkCycleTrace $rTag step '$sn' has no gen_ai.* keys (Item 2)" ($genAiKeys.Count -eq 0) "(found $($genAiKeys.Count) gen_ai.* keys)"
                # prompt.* keys are also step-4-only
                $promptKeys = @($step.PSObject.Properties | Where-Object { $_.Name -like 'prompt*' -or $_.Name -eq 'prompt' })
                Check "thinkCycleTrace $rTag step '$sn' has no prompt.* keys (Item 2)" ($promptKeys.Count -eq 0)
            }
        }
    }
}

# ---------------------------------------------------------------------------
# 21. Iter-4 delegationChain[] in most-recent seller audit
#     (PLAN Iter4 T3, T5 + addendum Items 4/5/6/7/8 + mode dispatch)
# ---------------------------------------------------------------------------
Section "Iter4Delegation"
if ($null -eq $seller -or $null -eq $seller.delegationChain) {
    Skip "seller delegationChain[]" "no seller audit or no delegationChain block"
} else {
    $dc = @($seller.delegationChain | Where-Object { $_ -is [PSCustomObject] })
    Check "seller.delegationChain is non-empty array" ($dc.Count -gt 0) "($($dc.Count) entries)"

    # Mode-dependent per-round count expectation
    if (-not $isBasic) {
        # L2: 6 entries per round in canonical order
        $expectedEntriesPerRound = 6
    } else {
        # BASIC/L1: 1 entry per round (treasury-consultation)
        $expectedEntriesPerRound = 1
    }

    # Compute expected total: groups by round
    $rounds = @($dc | ForEach-Object { $_.round } | Sort-Object -Unique | Where-Object { $null -ne $_ })
    Check "seller.delegationChain has at least one distinct round number" ($rounds.Count -gt 0)
    foreach ($r in $rounds) {
        $entriesInR = @($dc | Where-Object { $_.round -eq $r })
        Check "delegationChain round $r entry count == $expectedEntriesPerRound" ($entriesInR.Count -eq $expectedEntriesPerRound) "($($entriesInR.Count) entries)"
        if (-not $isBasic) {
            # L2: must be in canonical order
            for ($i = 0; $i -lt [Math]::Min($entriesInR.Count, $delegStepNamesCanon.Count); $i++) {
                $entry = $entriesInR[$i]
                $expected = $delegStepNamesCanon[$i]
                Check "delegationChain round $r entry[$i].stepName == '$expected' (canonical order)" ($entry.stepName -eq $expected) "(got '$($entry.stepName)')"
            }
        } else {
            # BASIC/L1: the single entry must be treasury-consultation
            if ($entriesInR.Count -ge 1) {
                Check "delegationChain round $r entry[0].stepName == 'treasury-consultation' (BASIC/L1)" ($entriesInR[0].stepName -eq 'treasury-consultation') "(got '$($entriesInR[0].stepName)')"
            }
        }
    }

    # Per-entry structural checks (all entries, regardless of mode)
    $entryIdx = 0
    foreach ($entry in $dc) {
        $entryIdx++
        $eTag = "entry#$entryIdx(round=$($entry.round),step='$($entry.stepName)')"

        # stepName must be one of the canonical 6
        Check "delegationChain $eTag stepName is one of canonical 6" ($delegStepNamesCanon -contains [string]$entry.stepName)

        # 3 DCC top-level properties from FRAMEWORK-V2 §8 (addendum Item 5)
        Check "delegationChain $eTag decidedBy non-empty"         ($entry.decidedBy -and ([string]$entry.decidedBy).Length -gt 0)
        Check "delegationChain $eTag onAuthorityOf non-empty"     ($entry.onAuthorityOf -and ([string]$entry.onAuthorityOf).Length -gt 0)
        Check "delegationChain $eTag authorityEnvelope present"   ($null -ne $entry.authorityEnvelope)
        if ($null -ne $entry.authorityEnvelope) {
            Check "delegationChain $eTag authorityEnvelope.description non-empty" ($entry.authorityEnvelope.description -and ([string]$entry.authorityEnvelope.description).Length -gt 0)
            Check "delegationChain $eTag authorityEnvelope.limits present"        ($null -ne $entry.authorityEnvelope.limits)
        }
        Check "delegationChain $eTag outcome present"             ($null -ne $entry.outcome)
        Check "delegationChain $eTag rationale non-empty"         ($entry.rationale -and ([string]$entry.rationale).Length -gt 0)

        # DCC marker (Item 5)
        Check "delegationChain $eTag dcc present"                 ($null -ne $entry.dcc)
        if ($null -ne $entry.dcc) {
            Check "delegationChain $eTag dcc.propertiesEmitted == 4 (Item 5)"    ($entry.dcc.propertiesEmitted -eq 4)
            Check "delegationChain $eTag dcc.propertiesFullSpec == 7 (Item 5)"   ($entry.dcc.propertiesFullSpec -eq 7)
            Check "delegationChain $eTag dcc.spec mentions FRAMEWORK-V2 (Item 5)" (([string]$entry.dcc.spec) -match 'FRAMEWORK-V2')
            Check "delegationChain $eTag dcc.deferredReason mentions DCC-2026 (Item 5)" (([string]$entry.dcc.deferredReason) -match 'DCC-2026')
            Check "delegationChain $eTag dcc.deferredReason mentions 2604.02767 (Item 5)" (([string]$entry.dcc.deferredReason) -match '2604\.02767')
        }

        # EU AI Act block (Item 6, PLAN T5)
        Check "delegationChain $eTag euAiActArticle14 present"    ($null -ne $entry.euAiActArticle14)
        if ($null -ne $entry.euAiActArticle14) {
            Check "delegationChain $eTag euAiActArticle14.monitorability == true (PLAN T5)"        ($entry.euAiActArticle14.monitorability -eq $true)
            Check "delegationChain $eTag euAiActArticle14.traceability == true (PLAN T5)"          ($entry.euAiActArticle14.traceability -eq $true)
            Check "delegationChain $eTag euAiActArticle14.interventionPossible == false (PLAN T5)" ($entry.euAiActArticle14.interventionPossible -eq $false)
            Check "delegationChain $eTag euAiActArticle14.overridePossible == false (PLAN T5)"     ($entry.euAiActArticle14.overridePossible -eq $false)
            Check "delegationChain $eTag euAiActArticle14.attributesEmitted == 4 (Item 6)"         ($entry.euAiActArticle14.attributesEmitted -eq 4)
            Check "delegationChain $eTag euAiActArticle14.note non-empty (Item 6)"                 ($entry.euAiActArticle14.note -and ([string]$entry.euAiActArticle14.note).Length -gt 0)
        }

        # Signature envelope (Item 7)
        Check "delegationChain $eTag signedAt set"        ($entry.signedAt -and ([string]$entry.signedAt).Length -gt 0)
        Check "delegationChain $eTag signature present"   ($null -ne $entry.signature)
        if ($null -ne $entry.signature) {
            Check "delegationChain $eTag signature.kind == 'HMAC' (Item 7)" ($entry.signature.kind -eq 'HMAC')
            Check "delegationChain $eTag signature.value is 64-char hex (Item 7)" ($entry.signature.value -match '^[0-9a-f]{64}$') "(got '$($entry.signature.value)')"
            Check "delegationChain $eTag signature.signedAt set (Item 7)" ($entry.signature.signedAt -and ([string]$entry.signature.signedAt).Length -gt 0)
        }
    }
}

# ---------------------------------------------------------------------------
# 22. Iter-4 HMAC re-verification per entry (PLAN Iter4 T4)
#     Uses `node` on PATH to JSON.stringify (V8 insertion-order convention,
#     matching iter-2 PlainHashSigner.hashPayload) so the recomputed
#     sha256(entry-minus-signature) is byte-for-byte faithful to what
#     computeDelegationSignatureValue produced at deal-close time.
# ---------------------------------------------------------------------------
Section "Iter4Signature"
$nodeAvail = $false
try {
    $nodeVer = & node --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $nodeVer) { $nodeAvail = $true }
} catch {
    $nodeAvail = $false
}

if (-not $nodeAvail) {
    Skip "delegation HMAC re-verification (PLAN T4)" "node not on PATH - install Node.js or run inside the project env to verify cryptographic signatures"
} elseif ($null -eq $seller -or $null -eq $seller.delegationChain) {
    Skip "delegation HMAC re-verification (PLAN T4)" "no seller audit or no delegationChain block"
} else {
    # Node script reads entry JSON via stdin, strips signature, JSON.stringify
    # in V8 insertion order, sha256, prints hex to stdout. This matches the
    # implementation's computeDelegationSignatureValue convention per the
    # iter-4 handoff (V8 insertion-order JSON, NOT sorted-keys).
    # Iter-4 fix 2026-05-25: write node script + each entry JSON to UTF-8
    # temp files and invoke `node $scriptPath $entryFile` instead of piping
    # through `node -e $nodeScript`. The original `-e` form mangled the
    # multi-line JS body via Windows cmd.exe quoting, causing every entry
    # to fail at [eval]:1 regardless of signature validity. Writing both
    # files as UTF-8 (no BOM) via [IO.File]::WriteAllText also avoids the
    # PS 5.1 cp1252 default-encoding pitfall on stdin (same root cause as
    # the buyer/seller audit-load fix in Section 6).
    $nodeScript = @'
const fs = require("fs");
const crypto = require("crypto");
const entryPath = process.argv[2];
try {
  const data = fs.readFileSync(entryPath, "utf8");
  const entry = JSON.parse(data);
  delete entry.signature;
  const json = JSON.stringify(entry);
  process.stdout.write(crypto.createHash("sha256").update(json).digest("hex"));
} catch (e) {
  process.stderr.write("ERR: " + e.message);
  process.exit(2);
}
'@
    $tempDir        = [System.IO.Path]::GetTempPath()
    $nodeScriptPath = Join-Path $tempDir "audit-v6-iter4-verify.cjs"
    $utf8NoBom      = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($nodeScriptPath, $nodeScript, $utf8NoBom)

    $dcAll = @($seller.delegationChain | Where-Object { $_ -is [PSCustomObject] })
    $entryIdx = 0
    foreach ($entry in $dcAll) {
        $entryIdx++
        $eTag = "entry#$entryIdx(round=$($entry.round),step='$($entry.stepName)')"
        if ($null -eq $entry.signature -or -not $entry.signature.value) {
            Check "delegation HMAC re-verify $eTag" $false "(entry has no signature.value)"
            continue
        }
        $expectedSig = [string]$entry.signature.value
        $entryFile = $null
        try {
            # Round-trip via ConvertTo-Json -Compress preserves insertion order
            # for PSCustomObject in PowerShell 5.1+ (NoteProperty insertion
            # order is preserved through both ConvertFrom-Json and
            # ConvertTo-Json). The node process then re-parses (which loses
            # nothing because we re-stringify with V8 insertion order).
            $entryJson = $entry | ConvertTo-Json -Compress -Depth 100
            $entryFile = Join-Path $tempDir ("audit-v6-iter4-entry-{0}.json" -f $entryIdx)
            [System.IO.File]::WriteAllText($entryFile, $entryJson, $utf8NoBom)
            $computedSig = (& node $nodeScriptPath $entryFile 2>$null)
            if ($LASTEXITCODE -ne 0) {
                Check "delegation HMAC re-verify $eTag" $false "(node exited $LASTEXITCODE)"
            } else {
                $computedSig = [string]$computedSig
                Check "delegation HMAC re-verify $eTag (PLAN T4)" ($computedSig -eq $expectedSig) "(computed='$computedSig' stored='$expectedSig')"
            }
        } catch {
            Check "delegation HMAC re-verify $eTag" $false "($($_.Exception.Message))"
        } finally {
            if ($null -ne $entryFile -and (Test-Path $entryFile)) {
                Remove-Item $entryFile -ErrorAction SilentlyContinue
            }
        }
    }
    Remove-Item $nodeScriptPath -ErrorAction SilentlyContinue
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
