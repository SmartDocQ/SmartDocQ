
import re
from datetime import datetime, timezone
from db.chroma import collection
from config import (
    EMBED_MODEL,
    INDEX_PIPELINE_VERSION,
    INDEX_BATCH_SIZE,
    CHUNKING_VERSION,
)
from utils.table_extraction import render_markdown_table, flatten_table_for_embedding
from services.embedding_service import embed_document
import indexing.chunking as chunking
from indexing.chunking import (
    remove_page_artifacts_and_repeated_headers,
    normalize_markdown_page,
    parse_markdown_blocks,
    extract_sections_and_headings,
    pack_blocks_into_chunks,
    estimate_token_count,
)

import hashlib

def compute_chunk_hash(text: str) -> str:
    """Stable SHA-256 chunk text hash function used uniformly."""
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()

class IndexBuildError(Exception):
    pass

class BatchWriter:
    def __init__(self, collection_ref, batch_size: int, flush_fn):
        self.collection_ref = collection_ref
        self.batch_size = batch_size
        self.flush_fn = flush_fn
        self.batch_embeddings = []
        self.batch_documents = []
        self.batch_metadatas = []
        self.batch_ids = []
        self.added = 0

    def add(self, embedding, document, metadata, chunk_id):
        self.batch_embeddings.append(embedding)
        self.batch_documents.append(document)
        self.batch_metadatas.append(metadata)
        self.batch_ids.append(chunk_id)
        if len(self.batch_ids) >= self.batch_size:
            self.flush()

    def flush(self):
        if not self.batch_ids:
            return 0
        self.added += self.flush_fn(
            self.collection_ref,
            self.batch_embeddings,
            self.batch_documents,
            self.batch_metadatas,
            self.batch_ids,
        )
        self.batch_embeddings = []
        self.batch_documents = []
        self.batch_metadatas = []
        self.batch_ids = []
        return self.added

def _make_batch_writer():
    return BatchWriter(collection, INDEX_BATCH_SIZE, _flush_batch)

# ===== CORE PIPELINE LOGIC & BATCHING =====

MIN_CHUNK_LEN = 40
MIN_WORDS = 4
MAX_MD_META_LEN = 800
_MD_TRUNC_SUFFIX = "...[truncated]"

_JUNK_PATTERN = re.compile(r"\b(fig\.?|figure|table|page)\b")
IDENTIFIER_RE = re.compile(
    r"\b(team\s*\d+|[0-9]{2}[A-Z]{2}[0-9A-Z]+)\b",
    re.IGNORECASE,
)

def _truncate_markdown(md: str, *, max_len: int = MAX_MD_META_LEN) -> str:
    limit = max_len
    try:
        md = "" if md is None else str(md)
    except Exception:
        return ""

    md = md.strip()
    if not md:
        return ""
    if limit <= 0:
        return _MD_TRUNC_SUFFIX
    if len(md) <= limit:
        return md

    suffix = _MD_TRUNC_SUFFIX
    keep = max(0, int(limit) - len(suffix))
    return md[:keep].rstrip() + suffix

def _build_contextual_header(
    filename: str,
    section: str | None = None,
    subsection: str | None = None,
    start_page: int | None = None,
    end_page: int | None = None,
    sheet_name: str | None = None,
    source_type: str | None = None,
    include_filename: bool = True,
) -> str:
    """Build a contextual header prepended ONLY to embedding input."""
    parts = []
    if include_filename:
        filename_val = (filename or "").strip() or "document"
        parts.append(f"Document: {filename_val}")
    
    if sheet_name:
        sheet_name = (sheet_name or "").strip()
        if sheet_name:
            parts.append(f"Sheet: {sheet_name}")
            
    if section:
        parts.append(f"Section: {section}")
        
    if subsection:
        parts.append(f"Subsection: {subsection}")
        
    if source_type == "pdf" and start_page is not None and end_page is not None:
        if start_page == end_page:
            parts.append(f"Page: {start_page}")
        else:
            parts.append(f"Pages: {start_page}-{end_page}")
            
    return "\n".join(parts)

def build_chunk_metadata(
    doc_id: str,
    reserved_chunk_index: int,
    filename: str,
    source_type: str,
    section: str | None = None,
    subsection: str | None = None,
    heading_level: int | None = None,
    start_page: int = 1,
    end_page: int = 1,
    section_index: int = 0,
    chunk_index: int = 0,
    chunk_type: str = "paragraph",
    paragraph_count: int = 1,
    token_count: int = 0,
    chunk_header: str = "",
    file_hash: str | None = None,
    sheet: str | None = None,
    is_table: bool = False,
    table_id: str | None = None,
    table_index: int | None = None,
    row_start: int | None = None,
    row_end: int | None = None,
    markdown: str | None = None,
    index_version: str | None = None,
    chunk_hash: str | None = None,
) -> dict:
    """Consolidated helper to build consistent vector metadata dicts."""
    cv = CHUNKING_VERSION
    ipv = INDEX_PIPELINE_VERSION

    meta = {
        "doc_id": doc_id,
        "index_version": index_version or "",
        "chunk": reserved_chunk_index,
        "filename": filename,
        "source_type": source_type,
        "section": section or "",
        "subsection": subsection or "",
        "heading_level": heading_level if heading_level is not None else -1,
        "start_page": start_page,
        "end_page": end_page,
        "section_index": section_index,
        "chunk_index": chunk_index,
        "embedding_model": EMBED_MODEL,
        "pipeline_version": ipv,
        "chunking_version": cv,
        "chunk_type": chunk_type,
        "paragraph_count": paragraph_count,
        "token_count": token_count,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
        "chunk_header": chunk_header,
    }
    if chunk_hash:
        meta["chunk_hash"] = chunk_hash
    if file_hash:
        meta["file_hash"] = file_hash
    if sheet:
        meta["sheet"] = sheet
    if is_table:
        meta["is_table"] = True
        if table_id is not None:
            meta["table_id"] = table_id
        if table_index is not None:
            meta["table_index"] = table_index
        if row_start is not None:
            meta["row_start"] = row_start
        if row_end is not None:
            meta["row_end"] = row_end
        if markdown is not None:
            meta["markdown"] = markdown
    return meta

def _flush_batch(collection_ref, batch_embeddings, batch_documents, batch_metadatas, batch_ids):
    if not batch_ids:
        return 0
    collection_ref.upsert(
        embeddings=batch_embeddings,
        documents=batch_documents,
        metadatas=batch_metadatas,
        ids=batch_ids,
    )
    return len(batch_ids)

def _is_noise(c: str) -> bool:
    if not c or not c.strip():
        return True

    c = c.strip()
    words = c.split()

    if IDENTIFIER_RE.search(c):
        return False

    if len(c) < MIN_CHUNK_LEN and len(words) < MIN_WORDS:
        return True

    if len(words) == 1:
        token = words[0]
        alpha_ratio = sum(ch.isalpha() for ch in token) / max(len(token), 1)
        if alpha_ratio < 0.5:
            return True

    if len(words) <= 3 and _JUNK_PATTERN.search(c.lower()):
        return True

    return False

def _index_blocks_pipeline(
    doc_id: str,
    filename: str,
    source_type: str,
    pages: list[dict],
    chunk_records_out: list,
    index_version: str,
    file_hash: str | None = None,
) -> tuple[int, int]:
    writer = _make_batch_writer()

    # 1. Clean page artifacts & repeated headers/footers
    pages = remove_page_artifacts_and_repeated_headers(pages)

    # 2. Normalize markdown syntax page-by-page
    for p in pages:
        p["text"] = normalize_markdown_page(p["text"])

    # 3. Extensible block parsing
    blocks = []
    for p in pages:
        blocks.extend(parse_markdown_blocks(p["text"], p["page"]))

    # 4. Heading stack extraction & section split
    sections = extract_sections_and_headings(blocks)

    # 5. Pack blocks into chunks
    packed_chunks = pack_blocks_into_chunks(sections)
    normalized_chunks = []
    for idx, chunk in enumerate(packed_chunks):
        if isinstance(chunk, str):
            normalized_chunks.append({
                "text": chunk,
                "start_page": 1,
                "end_page": 1,
                "section": None,
                "subsection": None,
                "heading_level": -1,
                "section_index": 0,
                "chunk_index": idx,
                "chunk_type": "paragraph",
                "paragraph_count": 1,
                "token_count": estimate_token_count(chunk),
            })
        else:
            normalized_chunks.append(chunk)
    packed_chunks = normalized_chunks
    
    seen = set()
    chunk_index = 0

    for chunk in packed_chunks:
        c = (chunk["text"] or "").strip()
        if not c:
            continue
            
        norm = " ".join(c.lower().split())
        is_dup = norm in seen
        if not is_dup:
            seen.add(norm)
            
        reserved_chunk_index = chunk_index
        chunk_index += 1
        
        if is_dup:
            continue
            
        meta_header = _build_contextual_header(
            filename=filename,
            section=chunk["section"],
            subsection=chunk["subsection"],
            start_page=chunk["start_page"],
            end_page=chunk["end_page"],
            source_type=source_type
        )
        embed_header = _build_contextual_header(
            filename=filename,
            section=chunk["section"],
            subsection=chunk["subsection"],
            start_page=chunk["start_page"],
            end_page=chunk["end_page"],
            source_type=source_type,
            include_filename=False
        )
        emb = embed_document(text=c, title=filename, context=embed_header)
        if not emb:
            raise IndexBuildError(f"Failed to generate embedding for block chunk {reserved_chunk_index}")
            
        meta = build_chunk_metadata(
            doc_id=doc_id,
            reserved_chunk_index=reserved_chunk_index,
            filename=filename,
            source_type=source_type,
            section=chunk["section"],
            subsection=chunk["subsection"],
            heading_level=chunk["heading_level"],
            start_page=chunk["start_page"],
            end_page=chunk["end_page"],
            section_index=chunk["section_index"],
            chunk_index=chunk["chunk_index"],
            chunk_type=chunk["chunk_type"],
            paragraph_count=chunk["paragraph_count"],
            token_count=chunk["token_count"],
            chunk_header=meta_header,
            file_hash=file_hash,
            index_version=index_version,
            chunk_hash=compute_chunk_hash(c)
        )

        chunk_id = f"{doc_id}:{index_version}:{reserved_chunk_index}"
        writer.add(emb, c, meta, chunk_id)
        
        chunk_records_out.append({
            "chunk": reserved_chunk_index,
            "text": c,
            "start_page": chunk["start_page"],
            "end_page": chunk["end_page"],
            "section": chunk["section"] or None,
            "subsection": chunk["subsection"] or None
        })
        
    writer.flush()
    return writer.added, chunk_index

def _index_sections_spreadsheet(
    doc_id: str,
    filename: str,
    source_type: str,
    sections: list,
    chunk_records_out: list,
    index_version: str,
    file_hash: str | None = None,
) -> tuple[int, int]:
    writer = _make_batch_writer()
    chunk_index = 0
    seen = set()

    noise_fn = _is_noise

    for sheet_name, body in sections:
        for chunk in chunking.chunk_text(body):
            c = (chunk or "").strip()
            if not c:
                continue

            if noise_fn(c):
                continue

            norm = " ".join(c.lower().split())
            is_dup = norm in seen
            if not is_dup:
                seen.add(norm)

            reserved_chunk_index = chunk_index
            chunk_index += 1

            if is_dup:
                continue

            meta_header = _build_contextual_header(filename, sheet_name=sheet_name)
            embed_header = _build_contextual_header(filename, sheet_name=sheet_name, include_filename=False)
            emb = embed_document(text=c, title=filename, context=embed_header)
            if not emb:
                raise IndexBuildError(f"Failed to generate embedding for spreadsheet section chunk {reserved_chunk_index}")

            meta = build_chunk_metadata(
                doc_id=doc_id,
                reserved_chunk_index=reserved_chunk_index,
                filename=filename,
                source_type=source_type,
                chunk_index=reserved_chunk_index,
                paragraph_count=len(c.split("\n\n")),
                token_count=estimate_token_count(c),
                chunk_header=meta_header,
                file_hash=file_hash,
                sheet=sheet_name,
                index_version=index_version
            )

            chunk_id = f"{doc_id}:{index_version}:{reserved_chunk_index}"
            writer.add(emb, c, meta, chunk_id)

            chunk_records_out.append({
                "chunk": reserved_chunk_index,
                "sheet": sheet_name or None,
                "text": c,
                "start_page": 1,
                "end_page": 1
            })

    writer.flush()
    return writer.added, chunk_index

def _index_tables_spreadsheet(
    doc_id: str,
    filename: str,
    source_type: str,
    tables: list[dict],
    *,
    start_chunk_index: int,
    chunk_records_out: list,
    index_version: str,
    file_hash: str | None = None,
) -> int:
    if not tables:
        return 0

    writer = _make_batch_writer()
    chunk_index = int(start_chunk_index or 0)
    seen_tables = set()

    render_fn = render_markdown_table

    for table_index, t in enumerate(tables):
        headers = list(t.get("headers") or [])
        rows = [list(r) for r in (t.get("rows") or [])]
        if not headers or not rows:
            continue

        sheet_name = t.get("sheet") or None
        table_id = t.get("table_id")

        groups = _iter_table_row_groups(headers, rows, sheet=sheet_name)
        for row_start, row_end, subset, flat in groups:
            md = render_fn(headers, subset)
            if not flat.strip() or not md.strip():
                continue

            md_meta = _truncate_markdown(md)

            norm = " ".join(flat.lower().split())
            is_dup = norm in seen_tables
            if not is_dup:
                seen_tables.add(norm)

            reserved_chunk_index = chunk_index
            chunk_index += 1

            if is_dup:
                continue

            meta_header = _build_contextual_header(filename, sheet_name=sheet_name)
            embed_header = _build_contextual_header(filename, sheet_name=sheet_name, include_filename=False)
            emb = embed_document(text=flat, title=filename, context=embed_header)
            if not emb:
                raise IndexBuildError(f"Failed to generate embedding for spreadsheet table chunk {reserved_chunk_index}")

            meta = build_chunk_metadata(
                doc_id=doc_id,
                reserved_chunk_index=reserved_chunk_index,
                filename=filename,
                source_type=source_type,
                chunk_index=reserved_chunk_index,
                chunk_type="table",
                paragraph_count=1,
                token_count=estimate_token_count(flat),
                chunk_header=meta_header,
                file_hash=file_hash,
                sheet=sheet_name,
                is_table=True,
                table_id=table_id,
                table_index=table_index,
                row_start=row_start,
                row_end=row_end,
                markdown=md_meta,
                index_version=index_version,
                chunk_hash=compute_chunk_hash(flat)
            )

            chunk_id = f"{doc_id}:{index_version}:{reserved_chunk_index}"
            writer.add(emb, flat, meta, chunk_id)

            chunk_records_out.append({
                "chunk": reserved_chunk_index,
                "sheet": sheet_name or None,
                "text": flat,
                "is_table": True,
                "table_id": table_id,
                "table_index": table_index,
                "markdown": md_meta,
                "start_page": 1,
                "end_page": 1
            })

    writer.flush()
    return writer.added

def _iter_table_row_groups(
    headers: list[str],
    rows: list[list[str]],
    *,
    max_rows_per_group: int = 50,
    max_flat_chars: int = 4500,
    sheet: str | None = None,
) -> list[tuple[int, int, list[list[str]], str]]:
    if not rows:
        return []

    if len(rows) <= max_rows_per_group:
        flat = flatten_table_for_embedding(sheet=sheet, headers=headers, rows=rows)
        if len(flat) <= max_flat_chars:
            return [(0, len(rows), rows, flat)]

    groups: list[tuple[int, int, list[list[str]], str]] = []
    start = 0
    while start < len(rows):
        end = min(len(rows), start + max_rows_per_group)
        while end > start + 1:
            subset = rows[start:end]
            flat_group = flatten_table_for_embedding(sheet=sheet, headers=headers, rows=subset)
            if len(flat_group) <= max_flat_chars:
                break
            end -= 1
        if end <= start:
            end = min(len(rows), start + 1)

        subset = rows[start:end]
        flat_group = flatten_table_for_embedding(sheet=sheet, headers=headers, rows=subset)
        groups.append((start, end, subset, flat_group))
        start = end

    return groups
