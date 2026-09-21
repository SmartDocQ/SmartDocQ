# SmartDoc Information Retrieval (IR) Benchmark: Hybrid RRF vs. BGE Reranker

This benchmark evaluates the retrieval quality and latency of the SmartDocQ hybrid retrieval pipeline using the **BEIR SciFact** benchmark dataset.

---

## 1. Overview & Methodology

The goal is to determine whether adding a Cross-Encoder reranker (`BAAI/bge-reranker-base`) improves retrieval relevance over the baseline **Hybrid Dense Retrieval + BM25 + Reciprocal Rank Fusion (RRF)** pipeline.

Dense and lexical retrieval operate over the 5,183 SciFact corpus documents; the retrieved candidates are treated as the context units for evaluation.

### Evaluated Pipelines

1. **Baseline Hybrid RRF Pipeline**:
   - Dense vector retrieval via ChromaDB (`models/gemini-embedding-2`, Top-20).
   - Lexical retrieval via BM25 (Top-20).
   - Reciprocal Rank Fusion ($k=60$) combining ranks to produce Top-5 context chunks.

2. **Reranked Hybrid RRF + BGE Pipeline**:
   - Same hybrid retrieval candidate generation (Top-15 RRF candidates).
   - `BAAI/bge-reranker-base` Cross-Encoder scoring candidate pairs `(query, document)`.
   - Re-ordered Top-5 context chunks.

---

## 2. Dataset & Scale

- **Dataset**: BEIR SciFact test dataset
- **Corpus Size**: 5,183 scientific abstracts
- **Evaluated Queries**: 300 test-set scientific queries

---

## 3. Benchmark Results

### Retrieval Quality Metrics

| Metric | Hybrid RRF (Baseline) | RRF + BGE Reranker | Relative Change |
| :--- | :---: | :---: | :---: |
| **nDCG@5** | **0.8294** | 0.7337 | **-11.53%** |
| **MRR@5** | **0.8092** | 0.7107 | **-12.18%** |
| **Recall@5** | **0.9146** | 0.8331 | **-8.91%** |
| **Precision@5** | **0.2040** | 0.1833 | **-10.13%** |

### Measured Latency Comparison

> Latency measurements are environment-specific; the BGE cross-encoder timing reflects the CPU hardware/runtime configuration used for this benchmark.

| Component | Hybrid RRF | RRF + BGE |
| :--- | :---: | :---: |
| **Dense Search** | 103.97 ms | 86.26 ms |
| **BM25 Lexical** | 41.99 ms | 40.59 ms |
| **RRF Fusion** | 2.99 ms | 2.78 ms |
| **BGE Cross-Encoder** | — | **15,243.35 ms** |
| **Total Pipeline (excl. LLM)** | **149.09 ms** | **15,373.12 ms** |

---

## 4. Statistical Significance & Analysis

The observed retrieval-quality difference between the two pipelines was statistically significant across paired query comparisons:

- **Paired $t$-test $p$-value**: **$4.75 \times 10^{-8}$**
- **Wilcoxon signed-rank $p$-value**: **$1.73 \times 10^{-7}$**
- **Bootstrap 95% Confidence Interval for $\Delta\text{nDCG@5}$**: **[-0.1295, -0.0622]**

### Candidate Recall & Behavior
Candidate-pool recall was **0.9867**, indicating that relevant documents were already present in the RRF candidate pool for most queries. Therefore, the observed degradation occurred primarily during the reranking/reordering stage rather than from failure to retrieve candidates.

---

## 5. Architectural Recommendation

For the evaluated SmartDocQ configuration, **Hybrid Dense Retrieval + BM25 + RRF without Cross-Encoder reranking** produced higher measured retrieval quality and substantially lower retrieval latency than the evaluated BGE reranking pipeline.

The baseline achieved:

- nDCG@5: **0.8294**
- MRR@5: **0.8092**
- Recall@5: **0.9146**
- Total retrieval latency: **149.09 ms**

The RRF + BGE pipeline achieved lower retrieval metrics while adding approximately **15.24 seconds** of measured cross-encoder latency in the benchmark environment.

Candidate-pool recall was **0.9867**, indicating that relevant documents were already present in the RRF candidate pool for most queries. The benchmark therefore did not demonstrate a retrieval-quality benefit from the evaluated BGE reranking stage.

Based on these empirical results, **BGE reranking was not enabled in production** for the evaluated SmartDocQ configuration.
