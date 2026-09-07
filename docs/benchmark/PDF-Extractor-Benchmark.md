# PDF Extractor Benchmark: Performance & Quality Evaluation Report

This report presents a comprehensive benchmarking of ten widely-used Python PDF extraction libraries across ten diverse PDF documents. The evaluation measures both **system performance** (processing speed, memory footprint, CPU utilization, and disk I/O) and **text extraction quality** (page coverage, word/character count, text density, and formatting preservation).

---

## 1. Executive Summary

Selecting the right PDF text extractor is critical for search indexing, LLM RAG pipelines, and automated document processing. This benchmark compares ten libraries under identical system conditions:
1. **Recommended Default Extractor**: `PyMuPDF` provides the best balance of extraction speed, low memory consumption, complete page coverage, and useful structural extraction among the evaluated libraries.
2. **Speed & Efficiency Leaders**: `pypdfium2` (0.20s mean) and `Apache Tika` (0.30s mean in warm mode) deliver exceptional throughput with low overhead.
3. **Structured Outputs**: `PyMuPDF4LLM` is highly effective for LLM preparation, successfully extracting an average of 115.9 Markdown layout elements (headers, lists, tables) per document at a moderate CPU usage cost.
4. **AI-Based Layout Extraction**: AI-based parsers like `Marker` are designed to perform best with CUDA-enabled GPUs. In a CPU-only environment, Marker's multi-model deep learning pipeline hit the 120-second timeout per run and required peak allocations of up to 8.16 GB RAM.

> [!IMPORTANT]
> **Project Selection Justification**: Although PyMuPDF provided the best overall balance of performance and resource usage, SmartDocQ requires structured Markdown outputs to preserve headings, lists, and tables for downstream chunking and Retrieval-Augmented Generation (RAG). Combined with the project's architectural requirements, the benchmark results supported selecting PyMuPDF4LLM because it consistently preserved document structure while remaining CPU-compatible.

---

## 2. Benchmark Methodology

To ensure reproducibility and fairness, the benchmark followed a rigorous execution methodology:

### 2.1 Evaluation Environment
*   **Operating System**: Windows 11 (`Windows-11-10.0.26200-SP0`)
*   **CPU**: `13th Gen Intel(R) Core(TM) i7-1360P` (12 Cores / 16 Threads)
*   **RAM**: `15.69 GB` Total System Memory
*   **GPU**: Not Available (CPU-only execution mode)
*   **Execution Seed**: `42` (ensuring randomized combinations order reproducibility)
*   **Timed Runs per combination**: 5 timed runs (preceded by 1 warm-up run)

### 2.2 CPU Noise Control
*   All non-essential system services and background applications were closed.
*   System power configuration was locked to "High Performance" mode.
*   The system remained connected to AC power during the entire benchmark execution.

### 2.3 Evaluation Dataset
The evaluation was executed on ten PDFs ranging from 8–43 pages and approximately 195 KB–3.2 MB, representing the following document categories:
*   Academic papers
*   Technical documentation
*   Book chapters
*   Medical reports
*   Presentation/report documents
*   Mixed-layout reports

### 2.4 Execution Architecture
*   **Subprocess Isolation**: To prevent memory leaks, side-effects, or crashes in one library from affecting subsequent runs, each PDF-extractor combination was launched in a separate Python subprocess.
*   **Warm-up Run**: The first extraction run for each combination was completed to load imports, trigger lazy-loaded dependencies, and warm up caches; its metrics were discarded.
*   **Per-Run Timeout**: A thread-level timeout of **120 seconds** was enforced within `run_extractor.py` for each extraction run. If a timeout occurred, the worker reported `Timeout`, stopped subsequent runs, and exited immediately.
*   **Combination-Level Timeout**: A process-level timeout of **15 minutes (900 seconds)** was enforced by `benchmark.py` to forcefully kill the entire child subprocess tree if a library hung.
*   **IPC Protocol**: Communication between child workers and the orchestrator was handled via structured **JSON Lines** printed to `stdout` (e.g., `{"type": "run", "run": 1, "status": "Success", ...}`), avoiding fragile regex-based text parsing.
*   **Resource Monitoring**: A background thread sampled CPU, RAM (RSS), and Disk I/O deltas every **20 milliseconds**. To capture auxiliary processes spawned by libraries (like Tika's client or Marker's multi-processing), the monitor recursively mapped all descendant processes (`process.children(recursive=True)`) and aggregated their footprints.
*   **Disk I/O Attribution**: Measured process-specific read/write bytes via `io_counters()`. This measures active process disk activity rather than system-wide disk activity.
*   **Warm Tika Mode**: Timings for Apache Tika exclude JVM startup time (the server was started once globally prior to benchmarking) but include the local HTTP overhead between Python and the Tika server.
*   **Reference Page Count**: The document's page count extracted from PyMuPDF metadata was used as the reference page count.

---

## 3. Metrics Defined

### 3.1 Performance Metrics
1.  **Time**: Total extraction time per run (using `time.perf_counter()`).
2.  **CPU Avg & Peak**: Average and peak system CPU utilization (%) during the run.
3.  **RAM Peak**: Peak RSS memory consumption (MB) of the worker and all its descendant processes.
4.  **Disk Read / Write**: Delta of read/written bytes (MB) by the process tree.

### 3.2 Quality / Extraction Metrics
1.  **Extracted Pages**: Number of pages returning non-empty text, or page objects returned.
2.  **Page Coverage %**: `(Extracted Pages / Reference Pages) * 100`.
3.  **Words / Characters**: Raw count of words and characters extracted.
4.  **Text Density**: `Words / Extracted Pages`.
5.  **Extraction Ratio**: `Extracted Characters / PDF File Size in KB` (identifying under/over-extraction).
6.  **Empty Pages**: Count of pages returning `page.strip() == ""`.
7.  **Tables Detected**: Count of tables parsed (using library-native detectors for PyMuPDF/pdfplumber, or Markdown syntax rows for PyMuPDF4LLM/Marker).
8.  **Images Detected**: Count of raw image objects embedded in the pages.
9.  **Markdown Structure Count**: Count of complete Markdown formatting structures (headers, lists, tables, code blocks) in PyMuPDF4LLM/Marker outputs.

---

## 4. Final Results

### 4.1 Aggregate Library Performance
The following table shows the overall average metrics calculated across all 10 PDFs (representing 500 individual runs):

| Extractor | Status | Time Mean (s) | RAM Peak Max (MB) | CPU Avg Mean (%) | Page Coverage (%) | Tables Mean | Images Mean | Markdown Structures |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **pypdfium2** | Success | **0.2008** | 91.93 | 38.46% | 100.0% | 0.0 | 91.5 | 0.0 |
| **Apache Tika** | Success | **0.3033** | **42.91** | 53.10% | 100.0% | 0.0 | 0.0 | 0.0 |
| **PyPDF2** | Success | 1.3210 | 144.37 | 34.10% | 100.0% | 0.0 | 8.5 | 0.0 |
| **pypdf** | Success | 2.5394 | 62.65 | 35.85% | 100.0% | 0.0 | 91.8 | 0.0 |
| **PyMuPDF** | Success | 3.1752 | 76.44 | 30.71% | 100.0% | 7.2 | 18.1 | 0.0 |
| **pdfminer.six** | Success | 3.5957 | 56.90 | 31.20% | 100.0% | 0.0 | **92.7** | 0.0 |
| **Unstructured** | Success | 3.7537 | 446.25 | 23.87% | 99.0% | 0.0 | 0.0 | 0.0 |
| **pdfplumber** | Success | 4.0365 | 310.88 | 25.39% | 100.0% | **21.2** | **92.7** | 0.0 |
| **PyMuPDF4LLM** | Success | 16.8983 | 563.97 | **81.49%** | 100.0% | 2.8 | 0.0 | **115.9** |
| **Marker** | Timeout | 120.2091 | 8159.66 | 17.88% | 0.0% | 0.0 | 0.0 | 0.0 |

> [!WARNING]
> *   **Tika RAM RSS**: Tika's RAM RSS only captures the Python wrapper process. It does not reflect Tika's separate background Java JVM server memory.
> *   **Image and Table Counting**: Image and table counts are library-specific and should not be interpreted as absolute counts across different engines (e.g. some count image XObjects, duplicates, or reconstructed layout blocks).

---

## 5. Conclusions & Recommendations

Based on the benchmark findings, we recommend the following library selections depending on project requirements:

### 5.1 Recommended Default Extractor
*   **Recommended Choice**: `PyMuPDF`. PyMuPDF provides the best balance of extraction speed, low memory consumption, complete page coverage, and useful structural extraction among the evaluated libraries. At **3.18s** per document, it is highly optimized, using only **76.44MB** peak RAM while providing robust, native table (7.2/doc) and unique image (18.1/doc) extraction.
*   **SmartDocQ Note**: Although PyMuPDF is the recommended default extractor based on overall benchmark performance, SmartDocQ uses `PyMuPDF4LLM` because preserving document structure in Markdown provides greater value for downstream chunking and Retrieval-Augmented Generation (RAG) than raw extraction speed.

### 5.2 The Speed & Efficiency Tier
For high-volume text indexing or pipelines where latency is the primary constraint:
*   **Recommended Choice**: `pypdfium2`. With a mean processing speed of **0.20s** per document and a lightweight memory profile (91MB peak), it is the most efficient choice.
*   **Alternative**: `Apache Tika`. Averaging **0.30s** in warm mode, it is an excellent enterprise-scale candidate, provided the Tika Java server runs as a separate, persistent service.

### 5.3 The Balanced & Feature-Rich Tier
For pipelines requiring metadata extraction, table extraction, and image analysis:
*   **Recommended Choice**: `pdfplumber`. For advanced tabular parsing, it extracts the most tables (21.2/doc), though it is slower (4.04s) and heavier (310.88MB peak RAM).

### 5.4 The LLM / Markdown Reconstruction Tier
For modern RAG pipelines feeding text chunks to large language models (LLMs):
*   **Recommended Choice**: `PyMuPDF4LLM`. By outputting clean Markdown, it preserves headers, tables, and lists (115.9 structures/doc) to maintain context. While slower (16.90s) and more CPU-heavy (81.49%), it is the best CPU-compatible structured extractor.
*   **Note on Marker**: Marker is designed to perform best with CUDA-enabled GPUs. On a CPU-only environment, its massive multi-model pipeline consistently times out (>120s per run) and demands high RAM (up to 8.16 GB peak RSS).

---