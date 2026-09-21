# SmartDoc Process-Local Counting Bloom Filter Benchmark

This benchmark evaluates the performance accelerator properties and workload break-even characteristics of SmartDoc's process-local Counting Bloom filter (`IndexedDocBloomFilter`).

---

## 1. Scope & Architectural Semantics

The benchmark evaluates the isolated **decision path inside `has_index(doc_id)`**:

```
Bloom ABSENT  ──> Return False immediately (bypass authoritative backend lookup)
Bloom PRESENT ──> Perform authoritative index-state check (never assume indexed due to false positives)
```

### Safety vs. Performance Contract

| Property | Architectural Behavior / Contract |
| :--- | :--- |
| **Can Bloom membership itself cause a false negative?** | No, assuming the filter is correctly maintained and all index mutations are reflected consistently. |
| **Can cause false positive?** | Yes; false positives are inherent to Bloom filters. |
| **False-positive consequence on latency** | Performs the authoritative index-state check. |
| **False-positive consequence on correctness** | None; authoritative state remains the source of truth. |
| **Implementation/state-divergence risk** | A stale or incorrectly maintained filter could incorrectly reject an indexed document; this is not an inherent Bloom-filter false-negative property. |

### Fail-Open & Isolation Behavior
- **Feature Guard (`ENABLE_INDEX_BLOOM`)**: Defaults to `False` in development mode. Zero Bloom overhead or imports when disabled.
- **Fail-Open Ready State**: If Bloom is uninitialized or DB startup reconstruction fails, `is_ready() == False` causes requests to bypass Bloom and hit authoritative state directly.
- **Startup Reconstruction**: Rebuilt directly from persistent Chroma DB metadata at startup.
- **Exact Set Membership Tracking**: Uses `_members: Set[str]` to maintain idempotent set semantics and safe counter decrements on deletion.

---

## 2. Methodology & Rigor

1. **Real Persistent Chroma DB Metadata**: Extracts 100 real indexed document IDs directly from persistent storage.
2. **1,000 Verified Absent Document IDs**: All 1,000 generated missing document IDs (`bloom-benchmark-missing-0001` through `1000`) are explicitly queried and verified absent from persistent Chroma DB during benchmark setup.
3. **Negative-ID Representativeness**: The 1,000 absent IDs are deterministic synthetic identifiers used to test the decision path; therefore, the observed FPR should be interpreted as a sample-specific measurement rather than a characterization of arbitrary production ID distributions.
4. **Cache Invalidation**: In-process index-state cache is explicitly invalidated (`invalidate_cached_index_state`) before each iteration to force lookups through the decision path rather than hitting in-memory TTL cache.
5. **Console I/O Latency Protection**: Logging warning outputs for 404 lookups are disabled during measurement loops to prevent console I/O distortion.

---

## 3. Empirical Benchmark Results

| Benchmark Scenario / Workload Composition | Median (ms) | P95 (ms) | P99 (ms) | Mean (ms) | Speedup / Impact |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Real Existing Docs - Bloom OFF** | 0.0470 ms | 0.1158 ms | 0.1546 ms | 0.1674 ms | Baseline hit lookup |
| **1. Real Existing Docs - Bloom ON** | 0.0347 ms | 0.0724 ms | 0.1461 ms | 0.0483 ms | Measured hit path |
| **2. Real Missing Docs - Bloom OFF** | 0.9613 ms | 1.9583 ms | 2.9215 ms | 1.2123 ms | Authoritative fallback |
| **2. Real Missing Docs - Bloom ON** | 0.0052 ms | 0.0080 ms | 0.0140 ms | 0.0059 ms | **184.86x reduction in median lookup latency** |
| **Sweep: 90% Exist / 10% Miss - OFF** | 0.0327 ms | 0.7455 ms | 1.0015 ms | 0.1447 ms | Baseline 90/10 composition |
| **Sweep: 90% Exist / 10% Miss - ON** | 0.0428 ms | 0.0716 ms | 0.1290 ms | 0.0434 ms | **10.42x P95 tail speedup** |
| **Sweep: 75% Exist / 25% Miss - OFF** | 0.0532 ms | 0.8505 ms | 1.1553 ms | 0.2270 ms | Baseline 75/25 composition |
| **Sweep: 75% Exist / 25% Miss - ON** | 0.0341 ms | 0.1065 ms | 0.2487 ms | 0.1550 ms | **1.56x median / 7.99x P95 speedup** |
| **Sweep: 50% Exist / 50% Miss - OFF** | 0.3883 ms | 1.1662 ms | 1.3099 ms | 0.4987 ms | Baseline 50/50 composition |
| **Sweep: 50% Exist / 50% Miss - ON** | 0.0268 ms | 0.0558 ms | 0.0924 ms | 0.0231 ms | **14.49x median speedup (93.10%)** |
| **Sweep: 25% Exist / 75% Miss - OFF** | 0.8121 ms | 1.1326 ms | 1.5457 ms | 0.7902 ms | Baseline 25/75 composition |
| **Sweep: 25% Exist / 75% Miss - ON** | 0.0058 ms | 0.0461 ms | 0.0784 ms | 0.0153 ms | **140.01x median speedup (99.29%)** |
| **Sweep: 10% Exist / 90% Miss - OFF** | 0.8472 ms | 1.2690 ms | 1.6939 ms | 0.9318 ms | Baseline 10/90 composition |
| **Sweep: 10% Exist / 90% Miss - ON** | 0.0055 ms | 0.0379 ms | 0.0646 ms | 0.0100 ms | **154.05x median speedup (99.35%)** |
| **3. Synthetic 50ms Delay — Bloom Isolation** | 53.54 ms | 73.31 ms | 73.31 ms | 55.36 ms | Synthetic delay baseline |
| **3. Synthetic 50ms Delay — Bloom Isolation ON** | 0.0109 ms | 0.0847 ms | 0.0847 ms | 0.0185 ms | **~4,934x synthetic isolation ratio** |

---

## 4. Efficiency & False-Positive Observations

- **Authoritative backend calls avoided for this sample:** `1,000 / 1,000 (100.0%)` for the 1,000 verified-absent document IDs tested.
- **Configured Bloom target FPR:** `1.00%` (`error_rate=0.01`, `capacity=50,000`).
- **Observed false positives for this sample:** `0 / 1,000` verified-absent IDs.
- **Observed sample FPR:** `0.00%`.
- **Approximate one-sided 95% upper confidence bound:** `< 0.30%` for the underlying false-positive probability under a binomial sampling assumption.

The observed `0.00%` FPR is an empirical result for this benchmark sample and should not be interpreted as a theoretical or guaranteed 0% false-positive rate. The Bloom filter remains configured with a target error rate of `1.00%`.

The benchmark also validates the safety property of the lookup path: Bloom membership is used only for fast negative rejection. A Bloom positive never implies that a document is indexed; it triggers the authoritative index-state check, preserving correctness in the presence of Bloom false positives.

---

## 5. Engineering Workload Insights

- **Positive-hit behavior:** In this benchmark run, existing-document lookups measured `0.0470 ms` median with Bloom OFF and `0.0347 ms` with Bloom ON. The run therefore did not demonstrate measurable positive-hit overhead; the small difference should not be interpreted as a general production performance advantage.

- **Negative acceleration:** Bloom filtering reduced median missing-document lookup latency from `0.9613 ms` to `0.0052 ms` in the local benchmark, corresponding to a `184.86×` reduction in median lookup latency.

- **Observed median-latency crossover:** The Bloom path was slower at 10% negative lookups and faster at 25%; therefore, the crossover lies somewhere between these tested workload points. The exact threshold was not measured.

- **Tail latency:** P95 latency improved at every tested workload composition, including the `10% negative / 90% positive` workload.

- **Synthetic isolation:** With a simulated `50 ms` authoritative lookup delay, Bloom reduced median negative-lookup latency from `53.54 ms` to `0.0109 ms`. This corresponds to approximately `4,934×` synthetic isolation speedup. This experiment demonstrates the potential benefit when authoritative negative checks are expensive, but it is not an end-to-end production latency measurement.

- **Correctness:** Bloom membership is used only as a negative filter. A Bloom positive never establishes that a document is indexed; the authoritative index-state check remains the source of truth.
