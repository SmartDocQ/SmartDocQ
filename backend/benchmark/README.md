# SmartDocQ Benchmarking

This directory contains benchmark suites for evaluating the performance and retrieval quality of the SmartDocQ backend.

## Benchmark Suites

### 1. Retrieval Benchmark

**Report:** [`retrieval_benchmark.md`](./retrieval_benchmark.md)

Evaluates the SmartDocQ retrieval pipeline using the BEIR SciFact dataset.

The benchmark compares:

- Hybrid Dense Retrieval + BM25 + Reciprocal Rank Fusion (RRF)
- Hybrid Dense Retrieval + BM25 + RRF + BGE Cross-Encoder Reranking

The evaluation measures:

- nDCG@5
- MRR@5
- Recall@5
- Precision@5
- Candidate recall
- Query latency
- Per-component latency
- Statistical significance of retrieval-quality differences

The final evaluation uses the complete SciFact corpus of **5,183 abstracts** and **300 evaluation queries**.

---

### 2. Bloom Filter Benchmark

**Report:** [`bloom_benchmark.md`](./bloom_benchmark.md)

Evaluates the `IndexedDocBloomFilter` component used to accelerate negative document-index lookups.

The benchmark evaluates:

- Real indexed document lookups
- Verified missing document lookups
- Bloom filter ON/OFF latency
- Authoritative backend calls avoided
- Observed sample false-positive rate
- Workload composition from 90% positive / 10% negative to 10% positive / 90% negative
- Synthetic authoritative lookup latency
- Negative-lookup speedup and break-even behavior

The benchmark distinguishes between the Bloom filter's configured theoretical false-positive rate and the observed false-positive rate measured on the benchmark sample.

---

## Directory Structure

```text
benchmark/

├── datasets/
│   └── scifact/
│
├── results/
│   ├── scifact_metrics.json
│   └── bloom_metrics.json
│
├── scripts/
│   ├── benchmark_reranker.py
│   └── benchmark_index_bloom.py
│
├── retrieval_benchmark.md
├── bloom_benchmark.md
└── README.md