# LLM Cost & Rate-Limit Safety Architecture

## Overview

The AMEN agent implements strict safeguards to minimize LLM API costs and prevent rate-limit issues. The Gemini LLM is used **ONLY as a reasoning layer**, not for monitoring.

---

## Cost Safety Principles

### ❌ NEVER Call LLM For:
- Every block/cycle
- Normal price movements
- Expected user activity  
- Routine monitoring
- Events already analyzed
- Identical contexts

### ✅ ONLY Call LLM When:
- **Price deviation >5%** (flash loan indicator)
- **Multiple oracle updates in same block** (manipulation)
- **Multiple large swaps in same block** (>10 WETH)
- **Same-block price recovery** (flash loan signature)
- **Liquidation during price drop** (unfair liquidation)
- **Extreme price movement >10%** in recent blocks

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    AMEN Agent Loop                            │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 1: OBSERVE                                              │
│  - Collect on-chain data (always runs)                       │
│  - Get prices, reserves, events                              │
│  - Calculate derived metrics                                 │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 2: QUICK CHECK (Deterministic - No LLM)                │
│  ✓ Is price deviation >5%?                                   │
│  ✓ Multiple oracle updates in same block?                    │
│  ✓ Multiple large swaps?                                     │
│  ✓ Same-block price recovery pattern?                        │
│  ✓ Liquidation after price drop?                             │
│  ✓ Extreme price change >10%?                                │
└──────────────────────────────────────────────────────────────┘
                          │
                    ┌─────┴─────┐
                    │           │
                NO  │           │  YES
                    │           │
                    ▼           ▼
        ┌─────────────────┐  ┌──────────────────────────────────┐
        │  Skip LLM       │  │  Step 3: DEDUPLICATION CHECK      │
        │  Return NATURAL │  │  ✓ Same block already analyzed?   │
        │  (FREE)         │  │  ✓ Identical context hash?        │
        └─────────────────┘  │  ✓ Event already in cache?        │
                             └──────────────────────────────────┘
                                          │
                                    ┌─────┴─────┐
                                    │           │
                              DUPE  │           │  UNIQUE
                                    │           │
                                    ▼           ▼
                        ┌─────────────────┐  ┌──────────────────┐
                        │  Skip LLM       │  │  🤖 CALL GEMINI  │
                        │  (Cached)       │  │  (COSTS MONEY)   │
                        └─────────────────┘  └──────────────────┘
```

---

## Implementation Details

### 1. Quick Check (reasoner.py)

**Purpose**: Deterministic anomaly detection without LLM

**Location**: `reasoner.py::Reasoner::quick_check()`

**Thresholds**:
```python
# Strict thresholds - only flag REAL anomalies
PRICE_DEVIATION_THRESHOLD = 5.0%     # Significant manipulation
ORACLE_UPDATES_PER_BLOCK = >1        # Unusual behavior
LARGE_SWAP_THRESHOLD = >10 WETH      # Flash loan size
MULTIPLE_SWAPS_THRESHOLD = >3        # Attack pattern
EXTREME_PRICE_CHANGE = >10%          # Flash loan signature
```

**Returns**:
- `True` → Anomaly detected, proceed to deduplication
- `False` → Normal activity, skip LLM entirely

### 2. Block-Level Deduplication

**Purpose**: Prevent analyzing same block multiple times

**Location**: `reasoner.py::Reasoner::analyze()`

**Mechanism**:
```python
# Track last analyzed block
self.last_llm_block: int

# Check before LLM call
if current_block == self.last_llm_block:
    return NATURAL  # Already analyzed
```

**Result**: Maximum 1 LLM call per block

### 3. Content Hash Deduplication

**Purpose**: Skip identical contexts even across blocks

**Location**: `reasoner.py::Reasoner::analyze()`

**Mechanism**:
```python
# Generate SHA-256 hash of context
content_hash = hashlib.sha256(
    json.dumps(context, sort_keys=True).encode()
).hexdigest()[:16]

# Check against last call
if content_hash == self.last_llm_call_hash:
    return NATURAL  # Identical context
```

**Result**: No redundant LLM calls for same data

### 4. Event Cache

**Purpose**: Don't re-analyze same events (liquidations, etc.)

**Location**: `reasoner.py::Reasoner::quick_check()`

**Mechanism**:
```python
# Cache analyzed events
self.analyzed_events: set = set()

# Generate event key
event_key = f"liq_{user}_{block}"

# Check cache
if event_key in self.analyzed_events:
    return False  # Already analyzed

# Add to cache
self.analyzed_events.add(event_key)
```

**Result**: Each event analyzed only once

**Cache Management**: 
- Limited to 1000 entries
- Auto-clears when full
- Prevents memory bloat

---

## Metrics & Monitoring

### LLM Usage Statistics

The agent tracks:
- **LLM Calls Count**: Total Gemini API calls
- **Blocks Processed**: Total blocks monitored
- **Efficiency Ratio**: Blocks per LLM call (higher = better)

### Expected Efficiency

| Scenario | Expected Ratio | Notes |
|----------|---------------|-------|
| Normal Market | >100:1 | LLM rarely called |
| Volatile Market | 50:1 - 100:1 | Some anomalies |
| Attack Occurring | 10:1 - 20:1 | Frequent analysis |
| Continuous Attack | 5:1 - 10:1 | Multiple calls |

### Viewing Stats

**During Runtime**:
```
✅ No anomalies - skipping LLM
  block: 12345
  deviation: 1.23%
  swaps: 1
```

**Or**:
```
🚨 Anomaly detected: Large price deviation
  deviation: 8.45%

🤖 CALLING GEMINI LLM
  block: 12346
  total_llm_calls: 3
  blocks_processed: 247
```

**At Shutdown**:
```
📊 Session Summary
Cycles: 500
Threats Detected: 2
Actions Taken: 1

💰 LLM Cost Efficiency:
LLM Calls: 5
Blocks Processed: 500
Efficiency: 100.0 blocks/call
```

---

## Cost Analysis

### Gemini Pricing (as of 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| gemini-1.5-pro | $3.50 | $10.50 |
| gemini-1.5-flash | $0.35 | $1.05 |

### Per-Call Cost Estimate

**Typical Analysis**:
- Input: ~2000 tokens (market context)
- Output: ~200 tokens (JSON response)

**Cost per call (gemini-1.5-pro)**:
- Input: $0.007
- Output: $0.002
- **Total: ~$0.009 per LLM call**

### Monthly Cost Projection

**Scenario 1: Normal Market (100:1 efficiency)**
- Blocks per day: ~7200 (12s polling)
- LLM calls per day: 72
- Daily cost: $0.65
- **Monthly cost: ~$20**

**Scenario 2: Volatile Market (50:1 efficiency)**
- LLM calls per day: 144
- Daily cost: $1.30
- **Monthly cost: ~$40**

**Scenario 3: Under Attack (10:1 efficiency)**
- LLM calls per day: 720
- Daily cost: $6.50
- **Monthly cost: ~$200** (expected during attack period)

### Free Tier

Gemini offers:
- **1500 requests/day** free tier
- At 12s polling: 7200 blocks/day
- With 100:1 efficiency: 72 calls/day
- **Stays within free tier!**

---

## Rate Limits

### Gemini Rate Limits

| Tier | RPM (Requests/Min) | RPD (Requests/Day) |
|------|-------------------|-------------------|
| Free | 15 | 1500 |
| Pay-as-you-go | 360 | Unlimited |

### AMEN Agent Polling

- **Poll interval**: 12 seconds
- **Max calls per minute**: 5 (if LLM called every cycle)
- **With 100:1 efficiency**: 0.05 calls/min
- **Well under rate limits**

### Rate Limit Safety

Even in worst case (LLM every block):
- 5 calls/min << 15 calls/min limit
- **No rate limit issues expected**

---

## Testing LLM Safety

### Verify Deduplication Works

```bash
cd agent
python main.py
```

**Expected logs**:
```
✅ Normal activity - LLM call skipped
✅ Normal activity - LLM call skipped
✅ Normal activity - LLM call skipped
🚨 Anomaly detected: Large price deviation
🤖 CALLING GEMINI LLM
  total_llm_calls: 1
  blocks_processed: 247
✅ Normal activity - LLM call skipped
```

### Run Attack Simulation

```bash
# Terminal 1: Start agent
cd agent
python main.py

# Terminal 2: Run attack
cd scripts
node attack-simulation.js
```

**Expected behavior**:
1. Agent runs normally (no LLM calls)
2. Attack starts → Anomaly detected
3. **Single LLM call** for analysis
4. Agent pauses protocol
5. Attack fails
6. No duplicate LLM calls for same event

### Check Efficiency Metrics

After running for 1 hour:
```bash
# Agent will show:
LLM Calls: 3
Blocks Processed: 300
Efficiency: 100.0 blocks/call
```

**Good**: >50:1 ratio  
**Excellent**: >100:1 ratio  
**Concerning**: <10:1 ratio (check thresholds)

---

## Configuration

### Adjusting Thresholds

Edit `agent/config.py` or set in `.env`:

```env
# Price deviation before LLM analysis (default 5%)
PRICE_DEVIATION_THRESHOLD=0.05

# Polling interval (default 12s)
POLL_INTERVAL=12
```

**Lower thresholds** → More LLM calls → Higher cost  
**Higher thresholds** → Fewer LLM calls → Lower cost (but may miss attacks)

### Recommended Settings

**Production (cost-optimized)**:
```env
PRICE_DEVIATION_THRESHOLD=0.05  # 5%
POLL_INTERVAL=12
```

**High-Security (attack-sensitive)**:
```env
PRICE_DEVIATION_THRESHOLD=0.03  # 3%
POLL_INTERVAL=10
```

**Testing (frequent LLM for validation)**:
```env
PRICE_DEVIATION_THRESHOLD=0.01  # 1%
POLL_INTERVAL=5
```

---

## Troubleshooting

### Issue: Too Many LLM Calls

**Symptoms**: Efficiency <20:1, high costs

**Causes**:
1. Thresholds too low
2. Volatile market
3. Deduplication not working

**Solutions**:
```bash
# Check logs for anomaly triggers
grep "Anomaly detected" agent.log

# Verify deduplication
grep "already analyzed" agent.log

# Increase thresholds if needed
export PRICE_DEVIATION_THRESHOLD=0.07  # 7%
```

### Issue: Not Detecting Attacks

**Symptoms**: Attack succeeds, no LLM call

**Causes**:
1. Thresholds too high
2. Attack pattern not in quick_check
3. Polling too slow

**Solutions**:
```bash
# Lower thresholds
export PRICE_DEVIATION_THRESHOLD=0.03  # 3%

# Faster polling
export POLL_INTERVAL=8

# Add custom detection rule in reasoner.py::quick_check()
```

### Issue: Rate Limited

**Symptoms**: `429 Too Many Requests` errors

**Causes**:
1. Free tier limit exceeded (1500/day)
2. Burst of calls

**Solutions**:
```bash
# Upgrade to paid tier (360 RPM)
# Or increase poll interval
export POLL_INTERVAL=15
```

---

## Summary

✅ **LLM is NOT called every cycle** - only when anomalies detected  
✅ **Block-level deduplication** - max 1 call per block  
✅ **Content hash deduplication** - no redundant calls  
✅ **Event caching** - each event analyzed once  
✅ **Strict thresholds** - only real anomalies trigger LLM  
✅ **Metrics tracked** - efficiency ratio monitored  
✅ **Cost optimized** - stays within free tier for normal operation  
✅ **Rate-limit safe** - well under Gemini limits  

**Expected efficiency**: 100+ blocks per LLM call in normal conditions.

**LLM is a reasoning layer, NOT a monitoring layer.**
