#!/usr/bin/env bash
# phase7-benchmark.sh — Phase 7 Reasoning Quality LLM Benchmark
#
# Compares LLM reasoning quality WITH vs WITHOUT Phase 7 features:
#   - Beam Search Thinking (multi-path reasoning + confidence scoring)
#   - Self-Correction Loop (high-risk output self-check)
#   - Skill-level Learning (memory store skill_patches)
#
# Requires:
#   - OPENAI_API_KEY or LLM_API_KEY env var
#   - curl + jq
#   - Phase 7 implemented memory-store.mjs (for skill_patch integration test)
#
# Usage:
#   export OPENAI_API_KEY="sk-..."
#   bash benchmarks/phase7-benchmark.sh [--model gpt-4o] [--runs 1] [--debug]
#
# Output: scores/phase7-benchmark-<date>.json + summary table

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="$PROJECT_DIR/benchmarks/scores"
mkdir -p "$OUTPUT_DIR"

# ── Config ─────────────────────────────────────────────────────────────────
MODEL="${MODEL:-gpt-4o}"
API_URL="${LLM_API_URL:-https://api.openai.com/v1/chat/completions}"
API_KEY="${LLM_API_KEY:-${OPENAI_API_KEY:-}}"
RUNS="${RUNS:-1}"
DEBUG="${DEBUG:-false}"

if [ -z "$API_KEY" ]; then
  echo "❌ LLM_API_KEY or OPENAI_API_KEY not set"
  echo "Usage: export OPENAI_API_KEY='sk-...' && bash $0"
  exit 1
fi

# ── Test Scenarios ─────────────────────────────────────────────────────────
# Each scenario: { id, category, prompt, ground_truth_keywords, risk_level }

SCENARIOS=(
  # ── Debug scenarios (10) ──
  '{"id":"D01","cat":"debug","prompt":"A user reports clicking submit does nothing and console is clean. What could cause this and how to debug?","checks":["event","validation","preventDefault","console"],"risk":"medium"}'
  '{"id":"D02","cat":"debug","prompt":"API fetch works in dev but returns 403 in production. The endpoint uses JWT. What to check?","checks":["token","CORS","environment","header"],"risk":"medium"}'
  '{"id":"D03","cat":"debug","prompt":"React component re-renders infinitely even with useEffect empty deps. Why?","checks":["reference","object","array","memo"],"risk":"medium"}'
  '{"id":"D04","cat":"debug","prompt":"Node.js process crashes with ECONNRESET on high traffic. Root cause?","checks":["pool","keep-alive","connection","timeout"],"risk":"high"}'
  '{"id":"D05","cat":"debug","prompt":"CSS animation stutters on Safari but smooth on Chrome. Likely cause?","checks":["GPU","composite","transform","will-change"],"risk":"low"}'
  '{"id":"D06","cat":"debug","prompt":"TypeError: Cannot read properties of undefined (reading map) in production but not dev. Why?","checks":["async","timing","undefined","optional"],"risk":"medium"}'
  '{"id":"D07","cat":"debug","prompt":"Docker build succeeds locally but fails in CI with exit code 137. What is happening?","checks":["memory","OOM","limit","resource"],"risk":"high"}'
  '{"id":"D08","cat":"debug","prompt":"WebSocket connection drops every 60 seconds exactly. Most likely cause?","checks":["timeout","keepalive","proxy","ping"],"risk":"medium"}'
  '{"id":"D09","cat":"debug","prompt":"Database query is slow on first call but fast afterwards. Why?","checks":["cache","buffer","pool","warm"],"risk":"low"}'
  '{"id":"D10","cat":"debug","prompt":"New Relic shows 100% CPU for 2 seconds every 5 minutes in Node.js. What to investigate?","checks":["GC","garbage","event","cycle"],"risk":"high"}'

  # ── Architecture scenarios (10) ──
  '{"id":"A01","cat":"arch","prompt":"We have a monolithic Express app. What is the safest migration path to microservices?","checks":["strangler","facade","incremental","domain"],"risk":"high"}'
  '{"id":"A02","cat":"arch","prompt":"Compare Redis vs PostgreSQL for a real-time leaderboard with 10K concurrent writes/second.","checks":["sorted","atomic","persistence","memory"],"risk":"medium"}'
  '{"id":"A03","cat":"arch","prompt":"How to design a file upload service that handles 100MB files reliably?","checks":["stream","chunk","resume","multipart"],"risk":"medium"}'
  '{"id":"A04","cat":"arch","prompt":"Event-driven vs request-driven architecture for an order processing system — tradeoffs?","checks":["consistency","retry","eventual","saga"],"risk":"high"}'
  '{"id":"A05","cat":"arch","prompt":"Design a caching strategy for a social media feed with 1M DAU.","checks":["cache","invalidat","stale","write-through"],"risk":"medium"}'
  '{"id":"A06","cat":"arch","prompt":"How to handle cross-cutting concerns (logging, auth, rate-limit) in a microservices setup?","checks":["gateway","middleware","sidecar","decorator"],"risk":"medium"}'
  '{"id":"A07","cat":"arch","prompt":"Compare REST, GraphQL, and gRPC for internal service-to-service communication.","checks":["schema","stream","codegen","binary"],"risk":"medium"}'
  '{"id":"A08","cat":"arch","prompt":"How to ensure exactly-once message processing in a distributed system?","checks":["idempotent","dedup","offset","commit"],"risk":"high"}'
  '{"id":"A09","cat":"arch","prompt":"Design a multi-tenant database strategy for SaaS: shared vs isolated vs hybrid.","checks":["tenant","isolation","row-level","pool"],"risk":"high"}'
  '{"id":"A10","cat":"arch","prompt":"How to migrate from a cron-based batch job to event-driven real-time processing?","checks":["event","stream","CDC","trigger"],"risk":"medium"}'
)

# ── Scoring ─────────────────────────────────────────────────────────────────

# Count how many required keywords appear in the response
score_coverage() {
  local response="$1"
  local checks_json="$2"
  local score=0
  local total=0

  while IFS= read -r keyword; do
    [ -z "$keyword" ] && continue
    total=$((total + 1))
    if echo "$response" | grep -iq "$keyword"; then
      score=$((score + 1))
    fi
  done < <(echo "$checks_json" | jq -r '.[]')

  if [ "$total" -eq 0 ]; then
    echo "0"
  else
    echo "$((score * 100 / total))"
  fi
}

# Check for hallucination indicators
score_hallucination() {
  local response="$1"
  local hallucinations=0

  # Common hallucination patterns
  if echo "$response" | grep -qi "according to the documentation" && ! echo "$response" | grep -qi "I don't have access to the actual documentation"; then
    hallucinations=$((hallucinations + 1))
  fi
  if echo "$response" | grep -qi "I would recommend using the XYZ library" && echo "$response" | grep -qi "which is the most popular"; then
    hallucinations=$((hallucinations + 1))
  fi
  if echo "$response" | grep -qi "as of 2025" || echo "$response" | grep -qi "as of 2024"; then
    hallucinations=$((hallucinations + 1))
  fi

  # Normalize: 100 = no hallucination, 0 = many hallucinations
  local hscore=$(( (3 - hallucinations) * 33 ))
  [ "$hscore" -lt 0 ] && hscore=0
  echo "$hscore"
}

# ── LLM Call ───────────────────────────────────────────────────────────────

call_llm() {
  local system_prompt="$1"
  local user_prompt="$2"

  curl -s "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d "$(jq -n \
      --arg model "$MODEL" \
      --arg system "$system_prompt" \
      --arg user "$user_prompt" \
      '{
        model: $model,
        messages: [
          {role: "system", content: $system},
          {role: "user", content: $user}
        ],
        temperature: 0.3,
        max_tokens: 1024
      }')" | jq -r '.choices[0].message.content // .error.message // "ERROR: unknown"'
}

# ── System Prompts ─────────────────────────────────────────────────────────

SYSTEM_WITHOUT_PHASE7="You are an expert software engineer. Answer the question concisely and accurately. Do NOT use multi-path reasoning, do NOT assign confidence scores, do NOT self-check your answer. Just give your single best answer."

SYSTEM_WITH_PHASE7="You are an expert software engineer using Phase 7 enhanced reasoning:

1. BEAM SEARCH: For complex questions, explicitly explore 2-3 independent reasoning paths (labeled Path A, Path B, etc.) before concluding.
2. CONFIDENCE SCORING: Assign a confidence score (1-10) to each path.
3. SELF-CORRECTION: For high-risk topics (security, architecture, production debugging), self-check your answer before finalizing.
4. CONVERGENCE: Select the best path and explain why it's best.

Structure your answer as:
## Beam Search
- Path A: [approach] (confidence: X/10)
- Path B: [approach] (confidence: X/10)
- Path C: [approach] (confidence: X/10) [if applicable]

## Selected Path
[your best answer]

## Self-Correction
[verify your answer, note any potential issues]"

# ── Main Loop ──────────────────────────────────────────────────────────────

echo "════════════════════════════════════════════════════"
echo "  Phase 7 Benchmark — $MODEL × ${#SCENARIOS[@]} scenarios × $RUNS runs"
echo "  $(date)"
echo "════════════════════════════════════════════════════"
echo ""

RESULTS_FILE="$OUTPUT_DIR/phase7-results-$TIMESTAMP.json"
ALL_RESULTS='[]'

for run in $(seq 1 "$RUNS"); do
  for scenario_json in "${SCENARIOS[@]}"; do
    ID=$(echo "$scenario_json" | jq -r '.id')
    CAT=$(echo "$scenario_json" | jq -r '.cat')
    PROMPT=$(echo "$scenario_json" | jq -r '.prompt')
    CHECKS=$(echo "$scenario_json" | jq -r '.checks')
    RISK=$(echo "$scenario_json" | jq -r '.risk')

    echo "▶ [$ID] $CAT | $RISK risk"

    # ── Without Phase 7 ──
    echo "   Calling WITHOUT Phase 7..."
    RESP_WITHOUT=$(call_llm "$SYSTEM_WITHOUT_PHASE7" "$PROMPT")
    COV_WITHOUT=$(score_coverage "$RESP_WITHOUT" "$CHECKS")
    HAL_WITHOUT=$(score_hallucination "$RESP_WITHOUT")

    # ── With Phase 7 ──
    echo "   Calling WITH Phase 7..."
    RESP_WITH=$(call_llm "$SYSTEM_WITH_PHASE7" "$PROMPT")
    COV_WITH=$(score_coverage "$RESP_WITH" "$CHECKS")
    HAL_WITH=$(score_hallucination "$RESP_WITH")

    # Beam structure check: look for "Path" labels & "confidence" in Phase 7 response
    BEAM_SCORE=0
    if echo "$RESP_WITH" | grep -qi "path [ABC]"; then
      BEAM_SCORE=$((BEAM_SCORE + 50))
    fi
    if echo "$RESP_WITH" | grep -qi "confidence"; then
      BEAM_SCORE=$((BEAM_SCORE + 50))
    fi

    # Self-correction check: look for self-check in high risk
    SELF_CHECK=0
    if [ "$RISK" = "high" ]; then
      if echo "$RESP_WITH" | grep -qiE "(self.check|verify|caveat|could be wrong|limitation|risk)"; then
        SELF_CHECK=100
      fi
    else
      # Low/medium should NOT trigger self-check (token saving)
      if ! echo "$RESP_WITH" | grep -qiE "(self.check|caveat|could be wrong)"; then
        SELF_CHECK=100
      else
        SELF_CHECK=50  # half credit — they self-checked unnecessarily
      fi
    fi

    # Calculate delta
    DELTA_COV=$((COV_WITH - COV_WITHOUT))
    DELTA_HAL=$((HAL_WITH - HAL_WITHOUT))

    # Print row
    printf "   ┌─────────────────────┬──────┬──────┬──────┐\n"
    printf "   │ %-19s │ Cov  │ Hal  │ Beam │\n" ""
    printf "   ├─────────────────────┼──────┼──────┼──────┤\n"
    printf "   │ %-19s │ %3d%% │ %3d%% │  N/A │\n" "Without Phase 7" "$COV_WITHOUT" "$HAL_WITHOUT"
    printf "   │ %-19s │ %3d%% │ %3d%% │ %3d%% │\n" "With Phase 7" "$COV_WITH" "$HAL_WITH" "$BEAM_SCORE"
    printf "   │ %-19s │ %+3d  │ %+3d  │      │\n" "Delta" "$DELTA_COV" "$DELTA_HAL"
    printf "   └─────────────────────┴──────┴──────┴──────┘\n"
    echo ""

    # Store result
    RESULT=$(jq -n \
      --arg id "$ID" \
      --arg cat "$CAT" \
      --arg risk "$RISK" \
      --argjson run "$run" \
      --argjson cov_without "$COV_WITHOUT" \
      --argjson cov_with "$COV_WITH" \
      --argjson hal_without "$HAL_WITHOUT" \
      --argjson hal_with "$HAL_WITH" \
      --argjson beam "$BEAM_SCORE" \
      --argjson self_check "$SELF_CHECK" \
      '{
        id: $id, category: $cat, risk: $risk, run: $run,
        coverage_without: $cov_without, coverage_with: $cov_with,
        hallucination_without: $hal_without, hallucination_with: $hal_with,
        beam_score: $beam, self_check: $self_check
      }')

    ALL_RESULTS=$(echo "$ALL_RESULTS" | jq --argjson r "$RESULT" '. + [$r]')

    # Rate limiting
    sleep 1
  done
done

# ── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════"
echo "  SUMMARY"
echo "════════════════════════════════════════════════════"

# Compute averages
AVG_COV_WITHOUT=$(echo "$ALL_RESULTS" | jq '[.[].coverage_without] | add / length')
AVG_COV_WITH=$(echo "$ALL_RESULTS" | jq '[.[].coverage_with] | add / length')
AVG_HAL_WITHOUT=$(echo "$ALL_RESULTS" | jq '[.[].hallucination_without] | add / length')
AVG_HAL_WITH=$(echo "$ALL_RESULTS" | jq '[.[].hallucination_with] | add / length')
AVG_BEAM=$(echo "$ALL_RESULTS" | jq '[.[].beam_score] | add / length')
AVG_SELF_CHECK=$(echo "$ALL_RESULTS" | jq '[.[].self_check] | add / length')

echo ""
printf "  %-30s %10s %10s %10s\n" "Metric" "w/o Phase7" "w/ Phase7" "Delta"
printf "  %-30s %10s %10s %10s\n" "──────────────────────────────" "──────────" "──────────" "──────────"
printf "  %-30s %8.1f%% %8.1f%% %+8.1f\n" "Coverage (keyword match)" "$AVG_COV_WITHOUT" "$AVG_COV_WITH" "$(echo "$AVG_COV_WITH - $AVG_COV_WITHOUT" | bc -l)"
printf "  %-30s %8.1f%% %8.1f%% %+8.1f\n" "Hallucination-free score" "$AVG_HAL_WITHOUT" "$AVG_HAL_WITH" "$(echo "$AVG_HAL_WITH - $AVG_HAL_WITHOUT" | bc -l)"
printf "  %-30s %10s %8.1f%% %10s\n" "Beam structure compliance" "N/A" "$AVG_BEAM" ""
printf "  %-30s %10s %8.1f%% %10s\n" "Self-correction (high risk)" "N/A" "$AVG_SELF_CHECK" ""

# Write results
echo "$ALL_RESULTS" | jq '
  {
    meta: {
      model: $model,
      scenarios: ($scenarios | length),
      runs: $runs,
      timestamp: $timestamp
    },
    summary: {
      avg_coverage_without: ($avg_cov_without | floor),
      avg_coverage_with: ($avg_cov_with | floor),
      avg_hallucination_without: ($avg_hal_without | floor),
      avg_hallucination_with: ($avg_hal_with | floor),
      avg_beam_score: ($avg_beam | floor),
      avg_self_check: ($avg_self_check | floor)
    },
    results: $results
  }' \
  --arg model "$MODEL" \
  --argjson scenarios "$(echo "${SCENARIOS[@]}" | jq -s '. | length')" \
  --argjson runs "$RUNS" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson avg_cov_without "$AVG_COV_WITHOUT" \
  --argjson avg_cov_with "$AVG_COV_WITH" \
  --argjson avg_hal_without "$AVG_HAL_WITHOUT" \
  --argjson avg_hal_with "$AVG_HAL_WITH" \
  --argjson avg_beam "$AVG_BEAM" \
  --argjson avg_self_check "$AVG_SELF_CHECK" \
  --argjson results "$ALL_RESULTS" \
  > "$RESULTS_FILE"

echo ""
echo "✅ Results saved to: $RESULTS_FILE"
echo ""
echo "To compare with baseline: jq .summary $RESULTS_FILE"
