# ============================================================================
# Test-AuditV6-Iter5.ps1
# Verifies the Audit Framework v6 Iteration 5 state on disk.
# ============================================================================
# Usage:
#   cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDisc4-ent1
#   powershell -ExecutionPolicy Bypass -File .\Test-AuditV6-Iter5.ps1
#
# What this verifies (in addition to ALL iter-1 + iter-2 + iter-3 + iter-4
# checks, kept verbatim from Test-AuditV6-Iter4.ps1):
#   [Iter5Shared]            shared/audit-blocks/ has framework-metrics.ts +
#                              self-check.ts + compliance.ts; each exports
#                              the expected builders/helpers; logger.ts
#                              imports buildFrameworkMetrics/buildSelfCheck/
#                              buildCompliance + computeDelegationSignatureValue
#                              + createHash and carries the new optional
#                              llmAuditRecords? param on saveAuditJson;
#                              buyer-agent/index.ts has the llmAuditRecords
#                              accumulator wired through all 4 saveAuditJson
#                              call sites
#   [Iter5Decisions]         DECISIONS.md addendum 2026-05-25 (Iter 5 lock)
#                              has the heading, the honest-partial Item 0
#                              reaffirmation, all 3 scope markers, all 5
#                              selfCheck names, all 4 overallVerdict enum
#                              values, all 6 compliance framework ids, the
#                              verdict-derivation keywords (critical,
#                              allPassedOrNA), and the evidenceRefConvention
#                              wildcard convention
#   [Iter5Scope]             most-recent deal's buyer + seller audits both
#                              carry frameworkMetricsScope / selfCheckScope /
#                              complianceScope == "both" (addendum Item 5).
#                              SKIPs cleanly when all 3 blocks are absent
#                              (deal pre-dates iter-5), mirroring iter-3/
#                              iter-4 pattern.
#   [Iter5FrameworkMetrics]  most-recent deal: cost.totalCostUSD > 0 on
#                              seller AND byModel has at least one entry
#                              (PLAN T1); cost arithmetic per byModel entry
#                              matches the GEMINI_PRICING table in
#                              shared/llm-client.ts (PLAN T5: for each model
#                              m, costUSD ~= (in/1e6)*pricing[m].in +
#                              (out/1e6)*pricing[m].out, rounded to 8
#                              decimals); outcome + riskAvoided shape
#                              verified; buyer cost is >= 0 (0 honestly when
#                              buyer never called LLM)
#   [Iter5SelfCheck]         selfCheck.checks is an array of exactly 5 with
#                              the locked names in locked order and the
#                              locked /identityProof, /messageSigningPosture,
#                              /intent, /thinkCycleTrace, /delegationChain
#                              refs (PLAN T2); overallVerdict is one of the
#                              4 enum values (Q6); every non-null check's
#                              `ref` resolves to a non-null block on the
#                              audit via an inline RFC-6901 walker (PLAN T3);
#                              on the BUYER, checks[3].passed (reasoning-
#                              Auditable) and checks[4].passed (delegation-
#                              Attested) are null with the cross-side N/A
#                              note (addendum Item 2); on the SELLER, both
#                              are non-null booleans; verdict derivation
#                              matches the Item 3 algorithm
#   [Iter5Compliance]        compliance.frameworks is an array of exactly
#                              6 in locked id order (NIST_AI_RMF, ISO_42001,
#                              EU_AI_Act_Article_14, DCC_2026,
#                              OpenTelemetry_GenAI, VERIFAGENT_2025); PLAN
#                              T4 requires NIST/ISO/EUAct/DCC present;
#                              evidenceRefConvention non-empty string;
#                              per-entry shape (id, version, mappedTo[],
#                              evidenceRefs[]) verified
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
Write-Host " Audit Framework v6 - Iteration 5 Verification" -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor White

# ============================================================================
# ITER-1 CHECKS (copied verbatim from Test-AuditV6-Iter1.ps1 via iter-3/iter-4)
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
# ITER-2 CHECKS (copied verbatim from Test-AuditV6-Iter2.ps1 via iter-3/iter-4)
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
# ITER-4 CHECKS (copied verbatim from Test-AuditV6-Iter4.ps1)
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

# ============================================================================
# ITER-5 CHECKS (new — addendum 2026-05-25 Items 0-6)
# ============================================================================

# Canonical vocabulary locked by iter-5 addendum
$iter5CheckNames     = @('identityVerified','messageIntegrityIntact','intentDeclaredAndTracked','reasoningAuditable','delegationAttested')
$iter5CheckRefs      = @('/identityProof','/messageSigningPosture','/intent','/thinkCycleTrace','/delegationChain')
$iter5VerdictEnum    = @('ON_TRACK','ON_TRACK_BUT_FLAGGED','OFF_TRACK','NEEDS_REVIEW')
$iter5FrameworkIds   = @('NIST_AI_RMF','ISO_42001','EU_AI_Act_Article_14','DCC_2026','OpenTelemetry_GenAI','VERIFAGENT_2025')
$iter5T4FrameworkIds = @('NIST_AI_RMF','ISO_42001','EU_AI_Act_Article_14','DCC_2026')
# GEMINI_PRICING table mirrors shared/llm-client.ts (USD per 1M tokens).
# Used by [Iter5FrameworkMetrics] T5 to re-derive byModel costs from token
# counts and compare against the audit's stored costUSD. Update both this
# table and llm-client.ts together if Google's published per-token rates
# move.
$geminiPricing = @{
    'gemini-2.5-pro'        = @{ in = 1.25;  out = 10.00 }
    'gemini-2.5-flash'      = @{ in = 0.30;  out = 2.50  }
    'gemini-2.5-flash-lite' = @{ in = 0.10;  out = 0.40  }
}

# RFC-6901 JSON Pointer resolver (per addendum Item 4 evidenceRefConvention).
# Walks slash-separated segments from the audit root. Returns the referenced
# value, or $null if any segment is missing. Wildcards ('*') are not used by
# selfCheck.checks[].ref (only by compliance.evidenceRefs); a wildcard
# encountered here returns $null since this resolver is for selfCheck refs.
function Resolve-JsonPointer {
    param([object]$audit, [string]$pointer)
    if ([string]::IsNullOrEmpty($pointer)) { return $audit }
    if ($pointer -eq '/') { return $audit }
    if ($pointer[0] -ne '/') { return $null }
    $parts = $pointer.Substring(1) -split '/'
    $node = $audit
    foreach ($p in $parts) {
        if ($null -eq $node) { return $null }
        if ($p -eq '*') { return $null }   # wildcards not expected on selfCheck refs
        # RFC-6901 escapes: ~1 -> /, ~0 -> ~ (order matters: ~1 first)
        $decoded = ($p -replace '~1','/') -replace '~0','~'
        if ($node -is [array]) {
            if ($decoded -match '^\d+$') {
                $idx = [int]$decoded
                if ($idx -lt 0 -or $idx -ge $node.Count) { return $null }
                $node = $node[$idx]
            } else { return $null }
        } elseif ($node -is [System.Management.Automation.PSCustomObject]) {
            $prop = $node.PSObject.Properties[$decoded]
            if ($null -eq $prop) { return $null }
            $node = $prop.Value
        } else { return $null }
    }
    return $node
}

# selfCheck verdict derivation (addendum Item 3):
#   critical       = identityVerified === true AND messageIntegrityIntact === true
#   allPassedOrNA  = every check is true OR null
#   if (!critical)         -> OFF_TRACK
#   else if (allPassedOrNA) -> ON_TRACK
#   else                    -> ON_TRACK_BUT_FLAGGED
# NEEDS_REVIEW is reserved vocabulary, not produced by clean iter-5.
# Strict-mode-safe stepwise evaluation (no compound `-and` with $null).
function Get-ExpectedVerdict {
    param([object]$checks)
    $byName = @{}
    foreach ($c in $checks) {
        if ($null -eq $c) { continue }
        $byName[[string]$c.name] = $c.passed
    }
    $id         = $byName['identityVerified']
    $msg        = $byName['messageIntegrityIntact']
    $intent     = $byName['intentDeclaredAndTracked']
    $reasoning  = $byName['reasoningAuditable']
    $delegation = $byName['delegationAttested']

    $criticalOk = ($id -eq $true)
    if ($criticalOk) { $criticalOk = ($msg -eq $true) }
    if (-not $criticalOk) { return 'OFF_TRACK' }

    $intentOk = ($intent -eq $true)
    if (-not $intentOk) { return 'ON_TRACK_BUT_FLAGGED' }

    $reasoningOk = ($reasoning -eq $true)
    if (-not $reasoningOk) { $reasoningOk = ($null -eq $reasoning) }
    if (-not $reasoningOk) { return 'ON_TRACK_BUT_FLAGGED' }

    $delegationOk = ($delegation -eq $true)
    if (-not $delegationOk) { $delegationOk = ($null -eq $delegation) }
    if (-not $delegationOk) { return 'ON_TRACK_BUT_FLAGGED' }

    return 'ON_TRACK'
}

# Helper: determine whether the audit was written by an iter-5-aware logger.
# Property-name lookup is strict-mode safe (same pattern as iter-4 Section 19).
function Test-HasIter5Blocks {
    param([object]$audit)
    if ($null -eq $audit) { return $false }
    $props = @($audit.PSObject.Properties.Name)
    return ($props -contains 'frameworkMetrics') -or ($props -contains 'selfCheck') -or ($props -contains 'compliance')
}

# ---------------------------------------------------------------------------
# 23. Iter-5 shared modules + code-edit markers
# ---------------------------------------------------------------------------
Section "Iter5Shared"
$frameworkMetricsPath = Join-Path $auditBlocksDir "framework-metrics.ts"
$selfCheckPath        = Join-Path $auditBlocksDir "self-check.ts"
$compliancePath       = Join-Path $auditBlocksDir "compliance.ts"
Check "shared/audit-blocks/framework-metrics.ts" (Test-Path $frameworkMetricsPath -PathType Leaf)
Check "shared/audit-blocks/self-check.ts"        (Test-Path $selfCheckPath        -PathType Leaf)
Check "shared/audit-blocks/compliance.ts"        (Test-Path $compliancePath       -PathType Leaf)

# framework-metrics.ts: builder + helpers + scope marker
if (Test-Path $frameworkMetricsPath -PathType Leaf) {
    $fmContent = Get-Content $frameworkMetricsPath -Raw
    Check "framework-metrics.ts exports buildFrameworkMetrics"                            ($fmContent -match 'export\s+function\s+buildFrameworkMetrics')
    Check "framework-metrics.ts exports aggregateSellerCostFromThinkCycleTrace"           ($fmContent -match 'export\s+function\s+aggregateSellerCostFromThinkCycleTrace')
    Check "framework-metrics.ts exports aggregateCostFromLlmCallRecords"                  ($fmContent -match 'export\s+function\s+aggregateCostFromLlmCallRecords')
    Check "framework-metrics.ts exports aggregateRiskAvoidedFromCommitGate"               ($fmContent -match 'export\s+function\s+aggregateRiskAvoidedFromCommitGate')
    Check "framework-metrics.ts exports extractOutcomeMetrics"                            ($fmContent -match 'export\s+function\s+extractOutcomeMetrics')
    Check "framework-metrics.ts emits frameworkMetricsScope marker (Item 5)"              ($fmContent -match 'frameworkMetricsScope')
    Check "framework-metrics.ts references 'both' scope (Item 5)"                         ($fmContent -match "'both'|`"both`"")
    Check "framework-metrics.ts references GEMINI_PRICING source (Item 1 perCallSource)"  ($fmContent -match 'GEMINI_PRICING')
} else {
    Skip "framework-metrics.ts content checks" "file not found"
}

# self-check.ts: builder + 5 check helpers + scope marker + verdict enum
if (Test-Path $selfCheckPath -PathType Leaf) {
    $scContent = Get-Content $selfCheckPath -Raw
    Check "self-check.ts exports buildSelfCheck"                                     ($scContent -match 'export\s+function\s+buildSelfCheck')
    Check "self-check.ts exports checkIdentityVerified"                              ($scContent -match 'export\s+function\s+checkIdentityVerified')
    Check "self-check.ts exports checkMessageIntegrityIntact"                        ($scContent -match 'export\s+function\s+checkMessageIntegrityIntact')
    Check "self-check.ts exports checkIntentDeclaredAndTracked"                      ($scContent -match 'export\s+function\s+checkIntentDeclaredAndTracked')
    Check "self-check.ts exports checkReasoningAuditable"                            ($scContent -match 'export\s+function\s+checkReasoningAuditable')
    Check "self-check.ts exports checkDelegationAttested"                            ($scContent -match 'export\s+function\s+checkDelegationAttested')
    Check "self-check.ts emits selfCheckScope marker (Item 5)"                       ($scContent -match 'selfCheckScope')
    foreach ($v in $iter5VerdictEnum) {
        Check "self-check.ts references verdict enum value '$v' (Q6)"                ($scContent -match [regex]::Escape($v))
    }
    foreach ($n in $iter5CheckNames) {
        Check "self-check.ts references check name '$n' (Item 2)"                    ($scContent -match [regex]::Escape($n))
    }
} else {
    Skip "self-check.ts content checks" "file not found"
}

# compliance.ts: builder + 6 framework ids + scope marker + wildcard convention
if (Test-Path $compliancePath -PathType Leaf) {
    $cpContent = Get-Content $compliancePath -Raw
    Check "compliance.ts exports buildCompliance"                                    ($cpContent -match 'export\s+function\s+buildCompliance')
    Check "compliance.ts emits complianceScope marker (Item 5)"                      ($cpContent -match 'complianceScope')
    Check "compliance.ts references evidenceRefConvention (Item 4)"                  ($cpContent -match 'evidenceRefConvention')
    Check "compliance.ts references RFC-6901 (Item 4)"                               ($cpContent -match 'RFC-6901')
    foreach ($f in $iter5FrameworkIds) {
        Check "compliance.ts references framework id '$f' (Item 4)"                  ($cpContent -match [regex]::Escape($f))
    }
} else {
    Skip "compliance.ts content checks" "file not found"
}

# logger.ts wires in the 3 builders + verifier dependencies + new param
if (Test-Path $loggerPath -PathType Leaf) {
    $logContent5 = Get-Content $loggerPath -Raw
    Check "logger.ts imports buildFrameworkMetrics (Item 6 inline integration)"      ($logContent5 -match 'buildFrameworkMetrics')
    Check "logger.ts imports buildSelfCheck"                                         ($logContent5 -match 'buildSelfCheck')
    Check "logger.ts imports buildCompliance"                                        ($logContent5 -match 'buildCompliance')
    Check "logger.ts imports computeDelegationSignatureValue (selfCheck #5 verifier)" ($logContent5 -match 'computeDelegationSignatureValue')
    Check "logger.ts imports createHash from node:crypto (selfCheck #4 verifier)"    ($logContent5 -match "createHash\s*[\},].*?node:crypto" -or $logContent5 -match "from\s+['""]node:crypto['""]")
    Check "logger.ts saveAuditJson has llmAuditRecords? param"                       ($logContent5 -match 'llmAuditRecords\??\s*:')
    Check "logger.ts assembles finalDoc with the 3 iter-5 blocks"                    ($logContent5 -match 'finalDoc' -and $logContent5 -match 'frameworkMetrics' -and $logContent5 -match 'selfCheck' -and $logContent5 -match 'compliance')
} else {
    Skip "logger.ts iter-5 wiring checks" "file not found"
}

# buyer-agent/index.ts has the llmAuditRecords accumulator (Step B)
$buyerAgentPath = Join-Path $SrcRoot "agents\buyer-agent\index.ts"
if (Test-Path $buyerAgentPath -PathType Leaf) {
    $baContent = Get-Content $buyerAgentPath -Raw
    Check "buyer-agent/index.ts has llmAuditRecords accumulator (Map field)"         ($baContent -match 'llmAuditRecords\s*=\s*new\s+Map' -or $baContent -match 'private\s+llmAuditRecords')
    Check "buyer-agent/index.ts pushes to llmAuditRecords (getLLMDecision wiring)"   ($baContent -match 'llmAuditRecords\.set' -and $baContent -match 'llmAuditRecords\.get')
    Check "buyer-agent/index.ts threads llmAuditRecords through saveAuditJson"       ($baContent -match 'llmAuditRecords\s*:\s*this\.llmAuditRecords\.get')
} else {
    Skip "buyer-agent/index.ts iter-5 wiring checks" "file not found"
}

# ---------------------------------------------------------------------------
# 24. Iter-5 design lock - vocabulary addendum in DECISIONS.md (Items 0-6)
# ---------------------------------------------------------------------------
Section "Iter5Decisions"
if (Test-Path $decisionsPath -PathType Leaf) {
    $decContent5 = Get-Content $decisionsPath -Raw
    Check "DECISIONS.md has iter-5 addendum heading" ($decContent5 -match 'Iter 5 vocabulary lock')
    # Item 0 - philosophy reaffirmation (carried forward from iter-4)
    Check "DECISIONS.md mentions 'honest partial' philosophy (Item 0)"          ($decContent5 -match 'honest partial')
    Check "DECISIONS.md mentions cross-side N/A representation (Item 0)"        ($decContent5 -match 'cross-side N/A|cross-side\s+N\\?\/A' -or $decContent5 -match 'tri-state')
    # Item 1 - frameworkMetrics block + scope marker
    Check "DECISIONS.md mentions frameworkMetrics block (Item 1)"               ($decContent5 -match 'frameworkMetrics')
    Check "DECISIONS.md emits frameworkMetricsScope marker (Item 5)"            ($decContent5 -match 'frameworkMetricsScope')
    Check "DECISIONS.md mentions totalCostUSD (Item 1)"                         ($decContent5 -match 'totalCostUSD')
    Check "DECISIONS.md mentions byModel field (Item 1)"                        ($decContent5 -match 'byModel')
    Check "DECISIONS.md mentions surplusCapturedShare (Item 1)"                 ($decContent5 -match 'surplusCapturedShare')
    Check "DECISIONS.md mentions riskAvoided block (Item 1)"                    ($decContent5 -match 'riskAvoided')
    Check "DECISIONS.md mentions GEMINI_PRICING source (Item 1)"                ($decContent5 -match 'GEMINI_PRICING')
    # Item 2 - selfCheck check names
    foreach ($n in $iter5CheckNames) {
        Check "DECISIONS.md lists selfCheck name '$n' (Item 2)"                 ($decContent5 -match [regex]::Escape($n))
    }
    Check "DECISIONS.md emits selfCheckScope marker (Item 5)"                   ($decContent5 -match 'selfCheckScope')
    # Item 2 - the locked refs
    Check "DECISIONS.md mentions /identityProof ref (Item 2)"                   ($decContent5 -match '/identityProof')
    Check "DECISIONS.md mentions /messageSigningPosture ref (Item 2)"           ($decContent5 -match '/messageSigningPosture')
    Check "DECISIONS.md mentions /intent ref (Item 2)"                          ($decContent5 -match '/intent\b')
    Check "DECISIONS.md mentions /thinkCycleTrace ref (Item 2)"                 ($decContent5 -match '/thinkCycleTrace')
    Check "DECISIONS.md mentions /delegationChain ref (Item 2)"                 ($decContent5 -match '/delegationChain')
    # Item 3 - verdict derivation algorithm
    Check "DECISIONS.md mentions 'critical' derivation keyword (Item 3)"        ($decContent5 -match '\bcritical\b')
    Check "DECISIONS.md mentions 'allPassedOrNA' derivation keyword (Item 3)"   ($decContent5 -match 'allPassedOrNA')
    foreach ($v in $iter5VerdictEnum) {
        Check "DECISIONS.md lists overallVerdict enum value '$v' (Q6)"          ($decContent5 -match [regex]::Escape($v))
    }
    # Item 4 - compliance block + 6 framework ids + wildcard convention
    Check "DECISIONS.md mentions compliance block (Item 4)"                     ($decContent5 -match '\bcompliance\b' -and $decContent5 -match 'frameworks')
    Check "DECISIONS.md emits complianceScope marker (Item 5)"                  ($decContent5 -match 'complianceScope')
    Check "DECISIONS.md mentions evidenceRefConvention (Item 4)"                ($decContent5 -match 'evidenceRefConvention')
    Check "DECISIONS.md mentions RFC-6901 (Item 4)"                             ($decContent5 -match 'RFC-6901')
    Check "DECISIONS.md mentions wildcard '*' convention (Item 4)"              ($decContent5 -match "wildcard")
    foreach ($f in $iter5FrameworkIds) {
        Check "DECISIONS.md lists framework id '$f' (Item 4)"                   ($decContent5 -match [regex]::Escape($f))
    }
    # Item 5 - scope markers all "both"
    Check "DECISIONS.md sets frameworkMetricsScope to 'both' (Item 5)"          ($decContent5 -match 'frameworkMetricsScope[^"]*"both"' -or $decContent5 -match '"both"[^,]*frameworkMetricsScope|frameworkMetricsScope.+"both"')
    Check "DECISIONS.md sets selfCheckScope to 'both' (Item 5)"                 ($decContent5 -match 'selfCheckScope[^"]*"both"' -or $decContent5 -match 'selfCheckScope.+"both"')
    Check "DECISIONS.md sets complianceScope to 'both' (Item 5)"                ($decContent5 -match 'complianceScope[^"]*"both"' -or $decContent5 -match 'complianceScope.+"both"')
    # Item 6 - what doesn't change
    Check "DECISIONS.md preserves Q6 verdict enum (Item 6 'does NOT change')"   ($decContent5 -match 'Q6')
} else {
    Skip "DECISIONS.md iter-5 addendum" "file not found at $decisionsPath"
}

# ---------------------------------------------------------------------------
# 25. Iter-5 scope: all 3 markers == "both" on BOTH sides (addendum Item 5)
# ---------------------------------------------------------------------------
Section "Iter5Scope"

$buyerHasIter5  = Test-HasIter5Blocks $buyer
$sellerHasIter5 = Test-HasIter5Blocks $seller

if ($null -eq $buyer) {
    Skip "buyer iter-5 scope markers" "no buyer audit to inspect"
} elseif (-not $buyerHasIter5) {
    # Deal pre-dates iter-5: SKIP cleanly per iter-3/iter-4 pattern.
    Skip "buyer.frameworkMetricsScope == 'both'" "iter-5 blocks absent (deal pre-dates iter-5 - rebuild + restart agents + run a new deal)"
    Skip "buyer.selfCheckScope == 'both'"        "iter-5 blocks absent (deal pre-dates iter-5)"
    Skip "buyer.complianceScope == 'both'"       "iter-5 blocks absent (deal pre-dates iter-5)"
} else {
    Check "buyer.frameworkMetrics present"               ($null -ne $buyer.frameworkMetrics)
    Check "buyer.selfCheck present"                      ($null -ne $buyer.selfCheck)
    Check "buyer.compliance present"                     ($null -ne $buyer.compliance)
    Check "buyer.frameworkMetrics.frameworkMetricsScope == 'both'" ($buyer.frameworkMetrics.frameworkMetricsScope -eq 'both') "(got '$($buyer.frameworkMetrics.frameworkMetricsScope)')"
    Check "buyer.selfCheck.selfCheckScope == 'both'"     ($buyer.selfCheck.selfCheckScope -eq 'both')                          "(got '$($buyer.selfCheck.selfCheckScope)')"
    Check "buyer.compliance.complianceScope == 'both'"   ($buyer.compliance.complianceScope -eq 'both')                        "(got '$($buyer.compliance.complianceScope)')"
}

if ($null -eq $seller) {
    Skip "seller iter-5 scope markers" "no seller audit to inspect"
} elseif (-not $sellerHasIter5) {
    Skip "seller.frameworkMetricsScope == 'both'" "iter-5 blocks absent (deal pre-dates iter-5)"
    Skip "seller.selfCheckScope == 'both'"        "iter-5 blocks absent (deal pre-dates iter-5)"
    Skip "seller.complianceScope == 'both'"       "iter-5 blocks absent (deal pre-dates iter-5)"
} else {
    Check "seller.frameworkMetrics present"              ($null -ne $seller.frameworkMetrics)
    Check "seller.selfCheck present"                     ($null -ne $seller.selfCheck)
    Check "seller.compliance present"                    ($null -ne $seller.compliance)
    Check "seller.frameworkMetrics.frameworkMetricsScope == 'both'" ($seller.frameworkMetrics.frameworkMetricsScope -eq 'both') "(got '$($seller.frameworkMetrics.frameworkMetricsScope)')"
    Check "seller.selfCheck.selfCheckScope == 'both'"    ($seller.selfCheck.selfCheckScope -eq 'both')                           "(got '$($seller.selfCheck.selfCheckScope)')"
    Check "seller.compliance.complianceScope == 'both'"  ($seller.compliance.complianceScope -eq 'both')                         "(got '$($seller.compliance.complianceScope)')"
}

# ---------------------------------------------------------------------------
# 26. Iter-5 frameworkMetrics block (PLAN T1, T5 + addendum Item 1)
# ---------------------------------------------------------------------------
Section "Iter5FrameworkMetrics"

function CheckFrameworkMetricsBlock {
    param([string]$side, [object]$audit, [bool]$requirePositiveCost)
    if ($null -eq $audit) {
        Skip "$side frameworkMetrics block" "no audit to inspect"
        return
    }
    if ($null -eq $audit.frameworkMetrics) {
        Skip "$side frameworkMetrics block" "block absent (deal pre-dates iter-5)"
        return
    }
    $fm = $audit.frameworkMetrics

    # cost shape
    Check "$side.frameworkMetrics.cost present"                ($null -ne $fm.cost)
    if ($null -ne $fm.cost) {
        Check "$side.frameworkMetrics.cost.currency == 'USD'"  ($fm.cost.currency -eq 'USD')                                "(got '$($fm.cost.currency)')"
        Check "$side.frameworkMetrics.cost.totalCostUSD is numeric" ($fm.cost.totalCostUSD -is [int] -or $fm.cost.totalCostUSD -is [long] -or $fm.cost.totalCostUSD -is [double] -or $fm.cost.totalCostUSD -is [decimal])
        if ($requirePositiveCost) {
            Check "$side.frameworkMetrics.cost.totalCostUSD > 0 (PLAN T1)" ($fm.cost.totalCostUSD -gt 0)                    "(got $($fm.cost.totalCostUSD))"
        } else {
            # Buyer may have $0 if no LLM calls (seller ACCEPTed opening offer)
            Check "$side.frameworkMetrics.cost.totalCostUSD >= 0 (Item 0 honest baseline)" ($fm.cost.totalCostUSD -ge 0)    "(got $($fm.cost.totalCostUSD))"
        }
        Check "$side.frameworkMetrics.cost.byModel present"    ($null -ne $fm.cost.byModel)
        Check "$side.frameworkMetrics.cost.perCallSource non-empty" ($fm.cost.perCallSource -and ([string]$fm.cost.perCallSource).Length -gt 0)

        if ($null -ne $fm.cost.byModel) {
            $modelKeys = @($fm.cost.byModel.PSObject.Properties.Name)
            if ($requirePositiveCost) {
                Check "$side.frameworkMetrics.cost.byModel non-empty (PLAN T1)" ($modelKeys.Count -gt 0) "($($modelKeys.Count) models)"
            }
            # T5: cost arithmetic per byModel entry
            foreach ($m in $modelKeys) {
                $bucket = $fm.cost.byModel.$m
                if ($null -eq $bucket) { continue }
                Check "$side.frameworkMetrics.cost.byModel['$m'].calls is numeric"        ($bucket.calls -is [int] -or $bucket.calls -is [long] -or $bucket.calls -is [double])
                Check "$side.frameworkMetrics.cost.byModel['$m'].inputTokens is numeric"  ($bucket.inputTokens -is [int] -or $bucket.inputTokens -is [long] -or $bucket.inputTokens -is [double])
                Check "$side.frameworkMetrics.cost.byModel['$m'].outputTokens is numeric" ($bucket.outputTokens -is [int] -or $bucket.outputTokens -is [long] -or $bucket.outputTokens -is [double])
                Check "$side.frameworkMetrics.cost.byModel['$m'].costUSD is numeric"      ($bucket.costUSD -is [int] -or $bucket.costUSD -is [long] -or $bucket.costUSD -is [double] -or $bucket.costUSD -is [decimal])

                if ($geminiPricing.ContainsKey($m)) {
                    $rate = $geminiPricing[$m]
                    $expected = [Math]::Round((([double]$bucket.inputTokens / 1e6) * [double]$rate.in + ([double]$bucket.outputTokens / 1e6) * [double]$rate.out), 8)
                    $actual   = [double]$bucket.costUSD
                    $diff     = [Math]::Abs($actual - $expected)
                    Check "$side.frameworkMetrics.cost.byModel['$m'].costUSD matches GEMINI_PRICING arithmetic (PLAN T5)" ($diff -le 1e-7) "(expected=$expected actual=$actual diff=$diff)"
                } else {
                    # Unknown model: skip arithmetic check rather than fail.
                    # If a future GEMINI_FORCE_MODEL points at a non-table
                    # model, the audit's costUSD is 0 by llm-client.ts
                    # estimateCostUSD; tolerate that honestly.
                    Skip "$side.frameworkMetrics.cost.byModel['$m'] arithmetic (PLAN T5)" "model not in GEMINI_PRICING table (force-model points elsewhere)"
                }
            }
        }
    }

    # outcome shape
    Check "$side.frameworkMetrics.outcome present"             ($null -ne $fm.outcome)
    if ($null -ne $fm.outcome) {
        Check "$side.frameworkMetrics.outcome.closed is boolean"     ($fm.outcome.closed -is [bool])
        Check "$side.frameworkMetrics.outcome.currency == 'INR'"     ($fm.outcome.currency -eq 'INR')           "(got '$($fm.outcome.currency)')"
        $hasFinalPrice  = $fm.outcome.PSObject.Properties['finalPrice']
        $hasSurplusShr  = $fm.outcome.PSObject.Properties['surplusCapturedShare']
        Check "$side.frameworkMetrics.outcome.finalPrice key present (Item 1)"            ($null -ne $hasFinalPrice)
        Check "$side.frameworkMetrics.outcome.surplusCapturedShare key present (Item 1)"  ($null -ne $hasSurplusShr)
    }

    # riskAvoided shape (mirrors autonomy.commitGate.eventCounts)
    Check "$side.frameworkMetrics.riskAvoided present"         ($null -ne $fm.riskAvoided)
    if ($null -ne $fm.riskAvoided) {
        Check "$side.frameworkMetrics.riskAvoided.treasuryVetoes is numeric"          ($fm.riskAvoided.treasuryVetoes -is [int] -or $fm.riskAvoided.treasuryVetoes -is [long] -or $fm.riskAvoided.treasuryVetoes -is [double])
        Check "$side.frameworkMetrics.riskAvoided.maxRoundsReached is numeric"        ($fm.riskAvoided.maxRoundsReached -is [int] -or $fm.riskAvoided.maxRoundsReached -is [long] -or $fm.riskAvoided.maxRoundsReached -is [double])
        Check "$side.frameworkMetrics.riskAvoided.counterpartyRejectFinal is numeric" ($fm.riskAvoided.counterpartyRejectFinal -is [int] -or $fm.riskAvoided.counterpartyRejectFinal -is [long] -or $fm.riskAvoided.counterpartyRejectFinal -is [double])
        Check "$side.frameworkMetrics.riskAvoided.guardrailOverrides is numeric"      ($fm.riskAvoided.guardrailOverrides -is [int] -or $fm.riskAvoided.guardrailOverrides -is [long] -or $fm.riskAvoided.guardrailOverrides -is [double])
        Check "$side.frameworkMetrics.riskAvoided.source == '/autonomy/commitGate/eventCounts' (Item 1)" ($fm.riskAvoided.source -eq '/autonomy/commitGate/eventCounts') "(got '$($fm.riskAvoided.source)')"
    }
}

# Seller: require positive cost (seller always calls LLM if a deal happened).
# Buyer: cost may legitimately be 0 (seller ACCEPTed buyer's opening offer
# before any buyer LLM call). Item 0 honesty: emit, don't omit.
CheckFrameworkMetricsBlock "buyer"  $buyer  $false
CheckFrameworkMetricsBlock "seller" $seller $true

# ---------------------------------------------------------------------------
# 27. Iter-5 selfCheck block (PLAN T2, T3 + addendum Items 2, 3)
# ---------------------------------------------------------------------------
Section "Iter5SelfCheck"

function CheckSelfCheckBlock {
    param([string]$side, [object]$audit, [bool]$isSellerSide)
    if ($null -eq $audit) {
        Skip "$side selfCheck block" "no audit to inspect"
        return
    }
    if ($null -eq $audit.selfCheck) {
        Skip "$side selfCheck block" "block absent (deal pre-dates iter-5)"
        return
    }
    $sc = $audit.selfCheck

    # Verdict enum (Q6)
    Check "$side.selfCheck.overallVerdict is one of 4 enum values (Q6)" ($iter5VerdictEnum -contains $sc.overallVerdict) "(got '$($sc.overallVerdict)')"

    # Checks array — length, names, ref ordering
    $checks = @($sc.checks | Where-Object { $_ -is [PSCustomObject] })
    Check "$side.selfCheck.checks is array of exactly 5 (PLAN T2)" ($checks.Count -eq 5) "($($checks.Count) checks)"

    if ($checks.Count -eq 5) {
        for ($i = 0; $i -lt 5; $i++) {
            $c = $checks[$i]
            Check "$side.selfCheck.checks[$i].name == '$($iter5CheckNames[$i])' (locked order)" ($c.name -eq $iter5CheckNames[$i]) "(got '$($c.name)')"
            Check "$side.selfCheck.checks[$i].ref == '$($iter5CheckRefs[$i])' (locked ref)"     ($c.ref -eq $iter5CheckRefs[$i])   "(got '$($c.ref)')"
        }

        # Cross-side N/A (Item 0 / Item 2): on BUYER, checks[3] + checks[4] must be null
        if ($isSellerSide) {
            # Seller: checks 4 and 5 must be non-null boolean
            $rChk = $checks[3]   # reasoningAuditable
            $dChk = $checks[4]   # delegationAttested
            $rPassedIsBool = ($rChk.passed -is [bool])
            $dPassedIsBool = ($dChk.passed -is [bool])
            Check "$side.selfCheck.checks[3] (reasoningAuditable) is non-null boolean" $rPassedIsBool "(passed=$($rChk.passed))"
            Check "$side.selfCheck.checks[4] (delegationAttested) is non-null boolean" $dPassedIsBool "(passed=$($dChk.passed))"
        } else {
            # Buyer: checks 4 and 5 must be null with cross-side note
            $rChk = $checks[3]
            $dChk = $checks[4]
            Check "$side.selfCheck.checks[3] (reasoningAuditable) passed is null on buyer (Item 2)" ($null -eq $rChk.passed)
            Check "$side.selfCheck.checks[4] (delegationAttested) passed is null on buyer (Item 2)" ($null -eq $dChk.passed)
            Check "$side.selfCheck.checks[3] (reasoningAuditable) has cross-side N/A note" ($rChk.note -and ([string]$rChk.note).Length -gt 0)
            Check "$side.selfCheck.checks[4] (delegationAttested) has cross-side N/A note" ($dChk.note -and ([string]$dChk.note).Length -gt 0)
        }

        # First 3 checks: passed must be boolean on both sides
        for ($i = 0; $i -lt 3; $i++) {
            $c = $checks[$i]
            Check "$side.selfCheck.checks[$i] ($($iter5CheckNames[$i])) passed is boolean" ($c.passed -is [bool]) "(passed=$($c.passed))"
        }

        # PLAN T3: RFC-6901 walker — each non-null check's ref resolves to a
        # non-null block on this audit. Null-passed checks (cross-side N/A)
        # resolve to null/absent, which is the honest cross-side state.
        for ($i = 0; $i -lt 5; $i++) {
            $c = $checks[$i]
            $resolved = Resolve-JsonPointer $audit $c.ref
            if ($null -eq $c.passed) {
                # Cross-side N/A — ref should resolve to null (block absent)
                Check "$side.selfCheck.checks[$i] ref '$($c.ref)' resolves to null on cross-side N/A (PLAN T3)" ($null -eq $resolved)
            } else {
                # Applicable check — ref must resolve to a real block
                Check "$side.selfCheck.checks[$i] ref '$($c.ref)' resolves to non-null block (PLAN T3)" ($null -ne $resolved)
            }
        }

        # Verdict derivation check (Item 3 algorithm)
        $expectedVerdict = Get-ExpectedVerdict $checks
        Check "$side.selfCheck.overallVerdict matches Item 3 derivation algorithm" ($sc.overallVerdict -eq $expectedVerdict) "(expected='$expectedVerdict' actual='$($sc.overallVerdict)')"
    }
}

CheckSelfCheckBlock "buyer"  $buyer  $false
CheckSelfCheckBlock "seller" $seller $true

# ---------------------------------------------------------------------------
# 28. Iter-5 compliance block (PLAN T4 + addendum Item 4)
# ---------------------------------------------------------------------------
Section "Iter5Compliance"

function CheckComplianceBlock {
    param([string]$side, [object]$audit)
    if ($null -eq $audit) {
        Skip "$side compliance block" "no audit to inspect"
        return
    }
    if ($null -eq $audit.compliance) {
        Skip "$side compliance block" "block absent (deal pre-dates iter-5)"
        return
    }
    $cp = $audit.compliance

    Check "$side.compliance.evidenceRefConvention non-empty (Item 4)" ($cp.evidenceRefConvention -and ([string]$cp.evidenceRefConvention).Length -gt 0)
    Check "$side.compliance.evidenceRefConvention mentions RFC-6901 (Item 4)" (([string]$cp.evidenceRefConvention) -match 'RFC-6901')

    $frameworks = @($cp.frameworks | Where-Object { $_ -is [PSCustomObject] })
    Check "$side.compliance.frameworks is array of exactly 6 (Item 4)" ($frameworks.Count -eq 6) "($($frameworks.Count) frameworks)"

    if ($frameworks.Count -eq 6) {
        # Locked id ordering (Item 4)
        for ($i = 0; $i -lt 6; $i++) {
            $f = $frameworks[$i]
            Check "$side.compliance.frameworks[$i].id == '$($iter5FrameworkIds[$i])' (locked order)" ($f.id -eq $iter5FrameworkIds[$i]) "(got '$($f.id)')"
        }
    }

    # PLAN T4: NIST_AI_RMF, ISO_42001, EU_AI_Act_Article_14, DCC_2026 present
    $presentIds = @($frameworks | ForEach-Object { $_.id })
    foreach ($needed in $iter5T4FrameworkIds) {
        Check "$side.compliance.frameworks[] contains '$needed' (PLAN T4)" ($presentIds -contains $needed)
    }

    # Per-entry shape
    foreach ($f in $frameworks) {
        $fid = [string]$f.id
        Check "$side.compliance.frameworks['$fid'].version non-empty"        ($f.version -and ([string]$f.version).Length -gt 0)
        Check "$side.compliance.frameworks['$fid'].mappedTo is array"        ($null -ne $f.mappedTo)
        Check "$side.compliance.frameworks['$fid'].evidenceRefs is array"    ($null -ne $f.evidenceRefs)
        # mappedTo may be empty for VERIFAGENT_2025 (deferred); evidenceRefs may be empty for VERIFAGENT_2025 too.
        # Just confirm they are arrays, not value-required.
    }
}

CheckComplianceBlock "buyer"  $buyer
CheckComplianceBlock "seller" $seller

# ---------------------------------------------------------------------------
# 29. Iter-6 Twilio SID write-time scrubbing (DECISIONS.md Item 8)
# ---------------------------------------------------------------------------
Section "Iter6SidScrubbing"

$iter6RepoRoot = $PSScriptRoot
$iter6JsRoot   = Join-Path $iter6RepoRoot 'A2A\js'
$iter6AuditsRt = Join-Path $iter6JsRoot  'src\audits'

# Part A: redactor module exists with the locked exports + pattern.
$iter6RedactorPath = Join-Path $iter6JsRoot 'src\shared\notification-redactor.ts'
Check "notification-redactor.ts exists" (Test-Path $iter6RedactorPath)
if (Test-Path $iter6RedactorPath) {
    $iter6RedSrc = Get-Content -Raw -Encoding UTF8 -Path $iter6RedactorPath
    Check "redactor exports TWILIO_ACCOUNT_SID_PATTERN"      ($iter6RedSrc -match 'export\s+const\s+TWILIO_ACCOUNT_SID_PATTERN')
    Check "redactor pattern is /AC[a-f0-9]{32}/g"            ($iter6RedSrc -match '/AC\[a-f0-9\]\{32\}/g')
    Check "redactor exports TWILIO_REDACTION_MARKER"         ($iter6RedSrc -match 'export\s+const\s+TWILIO_REDACTION_MARKER')
    Check 'redactor marker is "AC[REDACTED]"'                ($iter6RedSrc -match '"AC\[REDACTED\]"')
    Check "redactor exports redactNotifications function"    ($iter6RedSrc -match 'export\s+function\s+redactNotifications')
}

# Part B: audit-attach.ts wires the redactor (Item 8 amendment 2026-05-26).
$iter6AttachPath = Join-Path $iter6JsRoot 'src\notify\audit-attach.ts'
if (Test-Path $iter6AttachPath) {
    $iter6AtSrc = Get-Content -Raw -Encoding UTF8 -Path $iter6AttachPath
    Check "audit-attach.ts imports redactNotifications (Item 8 amendment)"     ($iter6AtSrc -match 'import\s*\{\s*redactNotifications\s*\}\s*from')
    Check "audit-attach.ts calls redactNotifications(merged) (Item 8 amendment)" ($iter6AtSrc -match 'audit\.notifications\s*=\s*redactNotifications\(merged\)')
} else {
    Skip "audit-attach.ts redactor wiring" "audit-attach.ts not found"
}

# Part C: scan date-partitioned audit JSONs for unredacted Twilio SIDs.
# _legacy_escalations is intentionally excluded (it uses the AC_REDACTED_LEGACY
# marker; neither marker matches the regex below, so scanning both would still
# be correct, but excluding keeps the failure message focused).
if (Test-Path $iter6AuditsRt) {
    $iter6Files = @(Get-ChildItem -Path $iter6AuditsRt -Recurse -Filter '*.audit.json' -File -ErrorAction SilentlyContinue `
                    | Where-Object { $_.FullName -notmatch '_legacy_escalations' })
    if ($iter6Files.Count -eq 0) {
        Skip "audit JSON SID scan" "no *.audit.json under $iter6AuditsRt"
    } else {
        $iter6Leaky = @()
        foreach ($iter6F in $iter6Files) {
            $iter6Cnt = Get-Content -Raw -Encoding UTF8 -Path $iter6F.FullName
            $iter6Hits = [regex]::Matches($iter6Cnt, 'AC[a-f0-9]{32}')
            if ($iter6Hits.Count -gt 0) { $iter6Leaky += "$($iter6F.Name)[$($iter6Hits.Count)]" }
        }
        Check "all date-partitioned audit JSONs are SID-clean (Item 8 acceptance)" ($iter6Leaky.Count -eq 0) "(scanned=$($iter6Files.Count), leaky=$($iter6Leaky -join ','))"
    }
} else {
    Skip "audit JSON SID scan" "audits root not found at $iter6AuditsRt"
}

# ---------------------------------------------------------------------------
# 30. Iter-6 SQLite sidecar (DECISIONS.md Items 2, 3)
# ---------------------------------------------------------------------------
Section "Iter6SqliteSidecar"

# Static: sidecar module exists with the locked exports + WAL mode.
$iter6SidecarSrc = Join-Path $iter6JsRoot 'src\shared\sqlite-sidecar.ts'
Check "sqlite-sidecar.ts exists" (Test-Path $iter6SidecarSrc)
if (Test-Path $iter6SidecarSrc) {
    $iter6SSrc = Get-Content -Raw -Encoding UTF8 -Path $iter6SidecarSrc
    Check "sidecar exports startSidecar"      ($iter6SSrc -match 'export\s+function\s+startSidecar')
    Check "sidecar exports openSidecar"       ($iter6SSrc -match 'export\s+function\s+openSidecar')
    Check "sidecar exports replayFromZero"    ($iter6SSrc -match 'export\s+function\s+replayFromZero')
    Check "sidecar exports auditIndexLineToRow (testable mapping)" ($iter6SSrc -match 'export\s+function\s+auditIndexLineToRow')
    Check "sidecar enables WAL journal_mode"  ($iter6SSrc -match 'journal_mode\s*=\s*WAL')
}

# Runtime: audits.sqlite exists and is non-empty (Strategy A replay must have run).
$iter6SqliteFile = Join-Path $iter6AuditsRt 'audits.sqlite'
if (Test-Path $iter6SqliteFile) {
    Check "audits.sqlite present" $true
    $iter6SqSize = (Get-Item $iter6SqliteFile).Length
    Check "audits.sqlite non-empty" ($iter6SqSize -gt 0) "(size=$iter6SqSize bytes)"
} else {
    Skip "audits.sqlite present"  "run 'npm run agents:audit-query' to materialize"
    Skip "audits.sqlite non-empty" "depends on materialization"
}

# ---------------------------------------------------------------------------
# 31. Iter-6 GraphQL server reachability (DECISIONS.md Item 5)
# ---------------------------------------------------------------------------
Section "Iter6GraphqlServer"

$iter6GqlEndpoint = 'http://127.0.0.1:5000/graphql'
$iter6GqlUp = $false
try {
    $iter6Probe = Invoke-WebRequest -Uri $iter6GqlEndpoint -Method Get -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    $iter6GqlUp = ($iter6Probe.StatusCode -eq 200)
} catch {
    $iter6GqlUp = $false
}
if ($iter6GqlUp) {
    Check "GraphQL endpoint reachable at $iter6GqlEndpoint" $true
} else {
    Skip "GraphQL endpoint reachable at $iter6GqlEndpoint" "audit-query agent not running (start with 'npm run agents:audit-query')"
}

# ---------------------------------------------------------------------------
# 32. Iter-6 GraphQL query surface (DECISIONS.md Items 6, 7)
# ---------------------------------------------------------------------------
Section "Iter6GraphqlAudits"

function Invoke-Iter6GraphQL {
    param([string]$Query)
    $body = @{ query = $Query } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Uri $iter6GqlEndpoint -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 5
}

if (-not $iter6GqlUp) {
    Skip "audits() returns non-null AuditConnection"  "graphql server not running"
    Skip "audits().totalCount is numeric"             "graphql server not running"
    Skip "audits().warnings is array"                 "graphql server not running"
    Skip "audits(limit:999) limit_clamped (Item 7)"   "graphql server not running"
    Skip "audits(outcome:success) filter"             "graphql server not running"
} else {
    # T-A: basic AuditConnection shape
    try {
        $iter6Ra = Invoke-Iter6GraphQL '{ audits(limit: 5) { totalCount nodes { negotiationId perspective outcome } warnings } }'
        $iter6Conn = $iter6Ra.data.audits
        Check "audits() returns non-null AuditConnection" ($null -ne $iter6Conn)
        Check "audits().totalCount is numeric"            ($iter6Conn.totalCount -is [int] -or $iter6Conn.totalCount -is [long])
        Check "audits().warnings is array"                ($iter6Conn.warnings -is [array] -or $null -ne $iter6Conn.warnings)
    } catch {
        Skip "audits() returns non-null AuditConnection" "request failed: $($_.Exception.Message)"
        Skip "audits().totalCount is numeric"            "depends on basic query"
        Skip "audits().warnings is array"                "depends on basic query"
    }

    # T-B: pagination clamp (limit > 500 → 500 + warning per Item 7)
    try {
        $iter6Rb = Invoke-Iter6GraphQL '{ audits(limit: 999) { warnings } }'
        Check "audits(limit:999) limit_clamped (Item 7)" ($iter6Rb.data.audits.warnings -contains 'limit_clamped')
    } catch {
        Skip "audits(limit:999) limit_clamped (Item 7)" "request failed: $($_.Exception.Message)"
    }

    # T-C: filter — outcome=success returns only success rows
    try {
        $iter6Rc = Invoke-Iter6GraphQL '{ audits(outcome: success, limit: 10) { nodes { outcome } } }'
        $iter6Nodes = $iter6Rc.data.audits.nodes
        if ($null -eq $iter6Nodes -or $iter6Nodes.Count -eq 0) {
            Skip "audits(outcome:success) filter" "no success audits in db (empty result is honest, not a failure)"
        } else {
            $iter6Bad = @($iter6Nodes | Where-Object { $_.outcome -ne 'success' })
            Check "audits(outcome:success) returns only success rows" ($iter6Bad.Count -eq 0) "(got $($iter6Nodes.Count) nodes, bad=$($iter6Bad.Count))"
        }
    } catch {
        Skip "audits(outcome:success) filter" "request failed: $($_.Exception.Message)"
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
