import logging
import re
from config import CHUNK_TARGET_TOKENS, CHUNK_SOFT_LIMIT, CHUNK_HARD_LIMIT, CHUNK_OVERLAP_TOKENS, IGNORE_REFERENCE_SECTIONS
from config import NOISE_HEADERS

logger = logging.getLogger(__name__)

# Spreadsheets/Legacy splitters
_SHEET_PATTERN = re.compile(r"^\s*#\s*Sheet:\s*(.*)", re.IGNORECASE)
_PARAGRAPH_SPLITTER = re.compile(r"\n\s*\n")
_MIN_OVERLAP_RATIO = 0.5
_BULLET_PREFIX_RE = re.compile(r"^(\s*)([\*\+])(\s+)")
_HEADING_FIX_RE = re.compile(r"^(\s*)(#+)\s*([^\s#].*)$")
_HEADING_MATCH_RE = re.compile(r"^(\s*)(#+)\s+(.+)$")
_LIST_ITEM_RE = re.compile(r"^([\*\-\+]|\d+\.)\s")
_HTML_BLOCK_START_RE = re.compile(r"^<\s*(?:[A-Za-z][\w:-]*|!--|/|\?)")
_DISPLAY_MATH_START_RE = re.compile(r"^(?:\$\$|\\\[)\s*$")
_DISPLAY_MATH_END_RE = re.compile(r"^(?:\$\$|\\\])\s*$")
ISOLATED_BLOCK_TYPES = {
    "table",
    "code",
    "html",
    "equation",
}

# ===== TOKENIZER & ESTIMATION =====

_tokenizer = None
_tokenizer_checked = False

def _fallback_words(text: str) -> list[str]:
    return re.findall(r"\w+|[^\w\s]+", text)

def _estimate_tokens_fallback(text: str) -> int:
    return int(len(_fallback_words(text)) * 1.3)

def get_tokenizer():
    global _tokenizer, _tokenizer_checked
    if _tokenizer_checked:
        return _tokenizer
        
    _tokenizer_checked = True
    try:
        import tiktoken
        # NOTE: We use OpenAI's cl100k_base tokenizer as a local, deterministic
        # approximation of token counts to guide chunk boundaries. This is an
        # approximation only; the actual Gemini embedding model uses a different tokenizer.
        _tokenizer = tiktoken.get_encoding("cl100k_base")
    except ImportError:
        logger.warning("tiktoken package is not available. Using regex word tokenizer fallback.")
    except Exception as e:
        logger.warning(f"Error loading tiktoken encoding: {e}. Using regex word tokenizer fallback.")
    return _tokenizer

def estimate_token_count(text: str) -> int:
    """Estimate token count for a text chunk.

    Uses tiktoken's cl100k_base tokenizer if available, otherwise falls back
    to a regex word tokenizer, estimating ~1.3 tokens per word.
    
    This is an approximation designed to pack chunks, not the exact count
    from the Gemini embedding API.
    """
    if not text:
        return 0
    tokenizer = get_tokenizer()
    if tokenizer is not None:
        try:
            return len(tokenizer.encode(text))
        except Exception as e:
            logger.debug(f"tiktoken encoding error: {e}. Falling back.")

    return _estimate_tokens_fallback(text)


# ===== MARKDOWN NORMALIZATION =====

def normalize_markdown_page(text: str) -> str:
    """Clean and normalize markdown syntax page-by-page.

    - Standardizes bullets (+ and * to -)
    - Fixes broken headings (space after #)
    - Standardizes code fences (~~~ to ```)
    - Limits empty lines between blocks
    - Merges wrapped lines within paragraphs
    """
    if not text:
        return ""

    lines = text.splitlines()
    normalized_lines = []
    
    for line in lines:
        # 1. Normalize list bullets (* and + to -) at start of lines (possibly indented)
        line = _BULLET_PREFIX_RE.sub(r"\1-\3", line)
        # 2. Fix broken headings: e.g. ##Heading -> ## Heading or ##   Heading -> ## Heading
        line = _HEADING_FIX_RE.sub(r"\2 \3", line)
        # 3. Normalize code fences: ~~~ to ```
        if line.strip().startswith("~~~"):
            line = line.replace("~~~", "```")
        normalized_lines.append(line)
        
    text = "\n".join(normalized_lines)
    
    # 4. Remove extra blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    
    # 5. Merge wrapped lines
    lines = text.splitlines()
    merged_lines = []
    
    for line in lines:
        stripped = line.strip()
        if not stripped:
            merged_lines.append("")
            continue
            
        if merged_lines and merged_lines[-1].strip():
            prev = merged_lines[-1].strip()
            
            # Check if current line starts with markdown block structures
            is_md_start = (
                stripped.startswith("#") or
                stripped.startswith(">") or
                stripped.startswith("|") or
                stripped.startswith("```") or
                _LIST_ITEM_RE.match(stripped)
            )
            # Check if previous line starts with markdown block structures that block merging
            prev_md_start = (
                prev.startswith("#") or
                prev.startswith("|") or
                prev.startswith("```")
            )
            # Check if previous line ends with two spaces or trailing backslash (explicit line break)
            prev_ends_break = prev.endswith("  ") or prev.endswith("\\")
            
            if not is_md_start and not prev_md_start and not prev_ends_break:
                # Merge into previous line
                merged_lines[-1] = merged_lines[-1] + " " + stripped
                continue
                
        merged_lines.append(line)
        
    return "\n".join(merged_lines)


def remove_page_artifacts_and_repeated_headers(pages: list[dict]) -> list[dict]:
    """Identify and remove repeated page headers/footers and page number lines across pages."""
    if not pages:
        return []
    if len(pages) == 1:
        return pages

    page_lines_list = []
    for p in pages:
        lines = [line.strip() for line in (p["text"] or "").splitlines()]
        page_lines_list.append(lines)
        
    # Analyze first/last lines to find headers/footers
    from collections import Counter
    first_lines = []
    last_lines = []
    
    for lines in page_lines_list:
        non_empty = [l for l in lines if l]
        if non_empty:
            first_lines.append(non_empty[0])
            if len(non_empty) > 1:
                last_lines.append(non_empty[-1])
                
    # Headers/footers are lines present in >= max(2, 50% of pages) pages
    min_occurrence = max(2, (len(pages) + 1) // 2)
    repeated_headers = {line for line, count in Counter(first_lines).items() if count >= min_occurrence}
    repeated_footers = {line for line, count in Counter(last_lines).items() if count >= min_occurrence}
    
    # Page number regex
    PAGE_NUM_RE = re.compile(
        r"^(page\s+\d+(\s+of\s+\d+)?|\d+\s+of\s+\d+|\d+|-\s*\d+\s*-)$",
        re.IGNORECASE
    )
    
    cleaned_pages = []
    for p, lines in zip(pages, page_lines_list):
        non_empty_indices = [i for i, l in enumerate(lines) if l]
        indices_to_remove = set()
        
        # Check first 2 non-empty lines
        for idx in non_empty_indices[:2]:
            line = lines[idx]
            if line in repeated_headers or PAGE_NUM_RE.match(line):
                indices_to_remove.add(idx)
                
        # Check last 2 non-empty lines
        for idx in non_empty_indices[-2:]:
            line = lines[idx]
            if line in repeated_footers or PAGE_NUM_RE.match(line):
                indices_to_remove.add(idx)
                
        cleaned_lines = [line for idx, line in enumerate(lines) if idx not in indices_to_remove]
        cleaned_pages.append({
            "page": p["page"],
            "text": "\n".join(cleaned_lines)
        })
        
    return cleaned_pages


# ===== EXTENSIBLE BLOCK PARSER =====

def parse_markdown_blocks(text: str, page_num: int) -> list[dict]:
    """Parse markdown string into a list of generic structured blocks.

    Supported block types: 'paragraph', 'table', 'code', 'list', 'blockquote', 'heading', 'html', 'equation'.
    """
    lines = text.splitlines()
    blocks = []
    current_block_lines = []
    current_type = None
    
    in_code_block = False
    code_fence = None
    in_html_block = False
    in_equation_block = False
    
    for line in lines:
        stripped = line.strip()
        
        # Handle code block state
        if in_code_block:
            current_block_lines.append(line)
            if stripped.startswith(code_fence):
                blocks.append({
                    "type": "code",
                    "content": "\n".join(current_block_lines),
                    "page": page_num
                })
                current_block_lines = []
                in_code_block = False
                current_type = None
            continue

        if in_html_block:
            if not stripped:
                blocks.append({
                    "type": "html",
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
                in_html_block = False
                current_type = None
                continue

            if stripped.startswith("<") or stripped.startswith("</") or stripped.startswith("<!--"):
                current_block_lines.append(line)
                continue

            blocks.append({
                "type": "html",
                "content": "\n".join(current_block_lines).strip(),
                "page": page_num
            })
            current_block_lines = []
            in_html_block = False
            current_type = None

        if in_equation_block:
            current_block_lines.append(line)
            if _DISPLAY_MATH_END_RE.match(stripped):
                blocks.append({
                    "type": "equation",
                    "content": "\n".join(current_block_lines),
                    "page": page_num
                })
                current_block_lines = []
                in_equation_block = False
                current_type = None
            continue
            
        # Check for code fence start
        if stripped.startswith("```") or stripped.startswith("~~~"):
            if current_block_lines:
                blocks.append({
                    "type": current_type or "paragraph",
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
            in_code_block = True
            code_fence = "```" if stripped.startswith("```") else "~~~"
            current_block_lines.append(line)
            current_type = "code"
            continue

        # Check for display math fences / single-line display equations
        if _DISPLAY_MATH_START_RE.match(stripped):
            if current_block_lines:
                blocks.append({
                    "type": current_type or "paragraph",
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
            in_equation_block = True
            current_block_lines.append(line)
            current_type = "equation"
            continue

        if stripped.startswith("$$") and stripped.endswith("$$") and len(stripped) > 4:
            if current_block_lines:
                blocks.append({
                    "type": current_type or "paragraph",
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
                current_type = None
            blocks.append({
                "type": "equation",
                "content": line.strip(),
                "page": page_num
            })
            continue

        if stripped.startswith("\\[") and stripped.endswith("\\]") and len(stripped) > 4:
            if current_block_lines:
                blocks.append({
                    "type": current_type or "paragraph",
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
                current_type = None
            blocks.append({
                "type": "equation",
                "content": line.strip(),
                "page": page_num
            })
            continue

        if _HTML_BLOCK_START_RE.match(stripped):
            if current_block_lines:
                blocks.append({
                    "type": current_type or "paragraph",
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
            in_html_block = True
            current_block_lines.append(line)
            current_type = "html"
            continue
            
        # Check for heading
        is_heading = False
        heading_match = _HEADING_MATCH_RE.match(line)
        if heading_match:
            is_heading = True
            
        # Empty line ends current block
        if not stripped:
            if current_block_lines:
                blocks.append({
                    "type": current_type or "paragraph",
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
                current_type = None
            continue
            
        # Determine line block type
        line_type = "paragraph"
        if is_heading:
            line_type = "heading"
        elif stripped.startswith("- ") or stripped.startswith("* ") or _LIST_ITEM_RE.match(stripped):
            line_type = "list"
        elif stripped.startswith(">"):
            line_type = "blockquote"
        elif stripped.startswith("|"):
            line_type = "table"
            
        # Flush if type changes
        if current_type is not None and current_type != line_type:
            if current_block_lines:
                blocks.append({
                    "type": current_type,
                    "content": "\n".join(current_block_lines).strip(),
                    "page": page_num
                })
                current_block_lines = []
            current_type = line_type
            
        if current_type is None:
            current_type = line_type
            
        current_block_lines.append(line)
        
        # Heading is a single line block
        if current_type == "heading":
            blocks.append({
                "type": "heading",
                "content": "\n".join(current_block_lines).strip(),
                "page": page_num
            })
            current_block_lines = []
            current_type = None
            
    # Flush remaining lines
    if current_block_lines:
        blocks.append({
            "type": current_type or "paragraph",
            "content": "\n".join(current_block_lines).strip(),
            "page": page_num
        })
        
    return blocks


# ===== DYNAMIC HEADING HIERARCHY & SECTION SPLITTING =====

def extract_sections_and_headings(blocks: list[dict]) -> list[dict]:
    """Process blocks sequentially to track headings stack dynamically and split by sections.

    Applies the references/noise section filter and maps contextual headings to blocks.
    """
    heading_stack = []  # list of (level, title)
    sections = []
    current_section_blocks = []
    current_section_title = None
    current_section_level = None
    
    def finalize_section():
        nonlocal current_section_blocks, current_section_title, current_section_level
        if current_section_blocks:
            is_noise = False
            if IGNORE_REFERENCE_SECTIONS and current_section_title:
                title_lower = current_section_title.lower().strip()
                if title_lower in NOISE_HEADERS:
                    is_noise = True
                    
            if not is_noise:
                sections.append({
                    "section_title": current_section_title,
                    "blocks": list(current_section_blocks)
                })
            current_section_blocks = []
            current_section_title = None
            current_section_level = None
            
    for b in blocks:
        if b["type"] == "heading":
            m = re.match(r"^(#+)\s+(.+)$", b["content"])
            if m:
                level = len(m.group(1))
                title = m.group(2).strip()
                
                # Update dynamic stack
                heading_stack = [h for h in heading_stack if h[0] < level]
                heading_stack.append((level, title))
                
                # Start a new section whenever we hit the top-most heading for the current section.
                if current_section_level is None or level <= current_section_level:
                    finalize_section()
                    current_section_title = title
                    current_section_level = level
                    
        # Map dynamic heading context to current block
        if heading_stack:
            b["section"] = heading_stack[0][1]
            if len(heading_stack) > 1:
                b["subsection"] = " > ".join(h[1] for h in heading_stack[1:])
            else:
                b["subsection"] = None
            b["heading_level"] = heading_stack[-1][0]
        else:
            b["section"] = None
            b["subsection"] = None
            b["heading_level"] = None
            
        current_section_blocks.append(b)
        
    finalize_section()
    
    # Assign section indices
    for idx, sec in enumerate(sections):
        sec["section_index"] = idx
        
    return sections


# ===== BLOCK-AWARE CHUNKING PACKER =====

def split_large_table_block(table_content: str, max_tokens: int) -> list[str]:
    """Splits exceptionally large table blocks by row groups instead of arbitrary token cuts.

    Prepend headers to every sub-table chunk to preserve column semantics.
    """
    lines = table_content.splitlines()
    if len(lines) < 2:
        return [table_content]

    separator_index = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*\|?[\s:\-|+]+\|?\s*$", line):
            separator_index = i
            break

    allow_overlap = separator_index is not None

    if separator_index is not None:
        headers = lines[: separator_index + 1]
        data_rows = lines[separator_index + 1 :]
    else:
        headers = [lines[0]]
        data_rows = lines[1:]

    if not data_rows:
        return [table_content]
    
    sub_tables = []
    current_rows = []
    header_tokens = estimate_token_count("\n".join(headers))
    current_tokens = header_tokens

    for row in data_rows:
        row_tokens = estimate_token_count(row)

        # If adding row exceeds limit, flush
        if current_rows and current_tokens + row_tokens > max_tokens:
            sub_tables.append("\n".join(headers + current_rows))
            # Only keep a 1-row overlap for well-formed markdown tables.
            if allow_overlap:
                overlap_row = current_rows[-1]
                current_rows = [overlap_row]
                current_tokens = header_tokens + estimate_token_count(overlap_row)
            else:
                current_rows = []
                current_tokens = header_tokens

        current_rows.append(row)
        current_tokens += row_tokens

    if current_rows:
        sub_tables.append("\n".join(headers + current_rows))

    return sub_tables


def split_large_block_content(text: str, max_tokens: int, overlap_tokens: int) -> list[str]:
    """Slice exceptionally large single block text into token limits with overlap."""
    tokenizer = get_tokenizer()
    if tokenizer is not None:
        try:
            tokens = tokenizer.encode(text)
            chunks = []
            start = 0
            while start < len(tokens):
                end = start + max_tokens
                chunks.append(tokenizer.decode(tokens[start:end]).strip())
                if end >= len(tokens):
                    break
                start = end - overlap_tokens
            return chunks
        except Exception:
            pass
            
    # Fallback tokenizer slicing
    words = _fallback_words(text)
    chunks = []
    start = 0
    max_words = int(max_tokens / 1.3)
    overlap_words = int(overlap_tokens / 1.3)
    
    while start < len(words):
        end = start + max_words
        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        start = end - overlap_words
    return chunks


def get_overlap_tokens_text(text: str, target_overlap: int) -> str:
    """Retrieve exactly target_overlap tokens from the end of text."""
    tokenizer = get_tokenizer()
    if tokenizer is not None:
        try:
            tokens = tokenizer.encode(text)
            if len(tokens) <= target_overlap:
                return text
            return tokenizer.decode(tokens[-target_overlap:]).strip()
        except Exception:
            pass
            
    # Fallback word-based slice
    words = _fallback_words(text)
    overlap_words = int(target_overlap / 1.3)
    if len(words) <= overlap_words:
        return text
    return " ".join(words[-overlap_words:])


def get_overlap_blocks(current_chunk_blocks: list[dict], target_overlap: int) -> list[dict]:
    """Calculate overlap from the end of the previous chunk, snapping to block boundaries.

    If a block is too large, we fall back to slicing its tokens.
    """
    overlap_blocks = []
    overlap_tokens = 0
    
    for cb in reversed(current_chunk_blocks):
        if cb.get("is_overlap"):
            break  # Don't propagate overlap recursively
            
        if overlap_tokens + cb["tokens"] <= int(target_overlap * 1.5):
            overlap_blocks.insert(0, {
                "type": cb["type"],
                "content": cb["content"],
                "page": cb["page"],
                "section": cb["section"],
                "subsection": cb["subsection"],
                "heading_level": cb["heading_level"],
                "tokens": cb["tokens"],
                "is_overlap": True
            })
            overlap_tokens += cb["tokens"]
        else:
            # If no blocks have been collected, slice the oversized block
            if not overlap_blocks:
                sliced_text = get_overlap_tokens_text(cb["content"], target_overlap)
                sliced_tokens = estimate_token_count(sliced_text)
                overlap_blocks.append({
                    "type": cb["type"],
                    "content": sliced_text,
                    "page": cb["page"],
                    "section": cb["section"],
                    "subsection": cb["subsection"],
                    "heading_level": cb["heading_level"],
                    "tokens": sliced_tokens,
                    "is_overlap": True
                })
            break
            
    return overlap_blocks


def create_chunk_dict(chunk_blocks: list[dict], section_index: int, chunk_index: int) -> dict:
    content = "\n\n".join(cb["content"] for cb in chunk_blocks)
    
    new_blocks = [cb for cb in chunk_blocks if not cb.get("is_overlap")]
    if not new_blocks:
        new_blocks = chunk_blocks
    first_new = new_blocks[0]
        
    pages = [cb["page"] for cb in new_blocks if cb.get("page") is not None]
    start_page = min(pages) if pages else 1
    end_page = max(pages) if pages else 1
    
    # Identify chunk type based on blocks
    types = [cb["type"] for cb in new_blocks]
    if "table" in types:
        chunk_type = "table"
    elif "code" in types:
        chunk_type = "code"
    elif "list" in types:
        chunk_type = "list"
    elif "blockquote" in types:
        chunk_type = "blockquote"
    else:
        chunk_type = "paragraph"
        
    return {
        "text": content,
        "start_page": start_page,
        "end_page": end_page,
        "section": first_new["section"],
        "subsection": first_new["subsection"],
        "heading_level": first_new["heading_level"],
        "section_index": section_index,
        "chunk_index": chunk_index,
        "chunk_type": chunk_type,
        "paragraph_count": len(new_blocks),
        "token_count": estimate_token_count(content)
    }


def pack_blocks_into_chunks(sections: list[dict]) -> list[dict]:
    """Pack generic structured blocks into chunks based on configurable limits.

    Keep code and table blocks fully isolated. For regular blocks, packs them
    to CHUNK_TARGET_TOKENS without exceeding CHUNK_SOFT_LIMIT, applying
    80 tokens overlap from previous chunk.
    """
    chunks = []
    
    for sec in sections:
        sec_title = sec["section_title"]
        sec_idx = sec["section_index"]
        
        # Pre-process blocks: split any single block exceeding CHUNK_HARD_LIMIT
        processed_blocks = []
        for b in sec["blocks"]:
            t_count = estimate_token_count(b["content"])
            if t_count > CHUNK_HARD_LIMIT:
                if b["type"] == "table":
                    sub_contents = split_large_table_block(b["content"], CHUNK_TARGET_TOKENS)
                else:
                    sub_contents = split_large_block_content(b["content"], CHUNK_TARGET_TOKENS, CHUNK_OVERLAP_TOKENS)
                    
                for sub_txt in sub_contents:
                    processed_blocks.append({
                        "type": b["type"],
                        "content": sub_txt,
                        "page": b["page"],
                        "section": b["section"],
                        "subsection": b["subsection"],
                        "heading_level": b["heading_level"],
                        "tokens": estimate_token_count(sub_txt)
                    })
            else:
                processed_blocks.append({
                    "type": b["type"],
                    "content": b["content"],
                    "page": b["page"],
                    "section": b["section"],
                    "subsection": b["subsection"],
                    "heading_level": b["heading_level"],
                    "tokens": t_count
                })
                
        # Pack blocks
        i = 0
        current_chunk_blocks = []
        current_chunk_tokens = 0
        chunk_idx_in_sec = 0
        
        while i < len(processed_blocks):
            b = processed_blocks[i]
            
            # Isolated blocks rule (table/code/html/equation)
            if b["type"] in ISOLATED_BLOCK_TYPES:
                if current_chunk_blocks:
                    chunks.append(create_chunk_dict(current_chunk_blocks, sec_idx, chunk_idx_in_sec))
                    chunk_idx_in_sec += 1
                    current_chunk_blocks = []
                    current_chunk_tokens = 0
                    
                chunks.append(create_chunk_dict([b], sec_idx, chunk_idx_in_sec))
                chunk_idx_in_sec += 1
                i += 1
                continue
                
            # Pack regular blocks
            if current_chunk_tokens + b["tokens"] > CHUNK_SOFT_LIMIT:
                if current_chunk_blocks:
                    # Flush current chunk
                    chunks.append(create_chunk_dict(current_chunk_blocks, sec_idx, chunk_idx_in_sec))
                    chunk_idx_in_sec += 1
                    
                    # Create overlap snapping to block boundaries
                    overlap_blocks = get_overlap_blocks(current_chunk_blocks, CHUNK_OVERLAP_TOKENS)
                    current_chunk_blocks = overlap_blocks
                    current_chunk_tokens = sum(ob["tokens"] for ob in overlap_blocks)
                    continue
                else:
                    current_chunk_blocks.append(b)
                    current_chunk_tokens += b["tokens"]
                    i += 1
            else:
                current_chunk_blocks.append(b)
                current_chunk_tokens += b["tokens"]
                i += 1
                
        if current_chunk_blocks:
            has_new = any(not cb.get("is_overlap") for cb in current_chunk_blocks)
            if has_new:
                chunks.append(create_chunk_dict(current_chunk_blocks, sec_idx, chunk_idx_in_sec))
                
    return chunks


# ===== LEGACY SPREADSHEETS HELPERS =====

def split_sheet_sections(text: str) -> list:
    """Spreadsheet helper: splits text based on Sheet boundaries."""
    lines = (text or "").splitlines()
    sections = []
    current_name = None
    current_lines = []
    found = False

    for ln in lines:
        m = _SHEET_PATTERN.match(ln)
        if m:
            found = True
            if current_lines:
                sections.append((current_name, "\n".join(current_lines).strip()))
                current_lines = []
            current_name = m.group(1).strip() or None
        else:
            current_lines.append(ln)

    if current_lines:
        sections.append((current_name, "\n".join(current_lines).strip()))

    if not found:
        return [(None, text or "")]

    return [(name, body) for (name, body) in sections if (body or "").strip()]


def _nearest_word_boundary(text: str, cut: int) -> int | None:
    if not text:
        return None
    if cut <= 0:
        return 0
    if cut >= len(text):
        return len(text)

    try:
        if not text[cut].isspace():
            for i in range(cut - 1, -1, -1):
                if text[i].isspace():
                    return i + 1
            return None
    except Exception:
        pass

    back: int | None = None
    for i in range(min(cut - 1, len(text) - 1), -1, -1):
        if text[i].isspace():
            back = i
            break

    forward: int | None = None
    for i in range(max(cut, 0), len(text)):
        if text[i].isspace():
            forward = i
            break

    if back is None and forward is None:
        return None
    if back is None:
        return forward
    if forward is None:
        return back + 1

    if (cut - back) <= (forward - cut):
        return back + 1
    return forward


def _word_boundary_tail(text: str, desired_len: int) -> str:
    if not text or desired_len <= 0:
        return ""
    if len(text) <= desired_len:
        return text

    cut = len(text) - desired_len
    para_match = re.search(r"\n\s*\n", text[cut:])
    if para_match:
        start = cut + para_match.end()
        tail = text[start:].strip()
        if tail and len(tail) >= int(desired_len * _MIN_OVERLAP_RATIO):
            return tail

    nearest = _nearest_word_boundary(text, cut)
    if nearest is not None:
        cut = nearest

    tail = text[cut:].strip()
    if tail:
        return tail
    return text[-desired_len:].strip()


def _split_large_para(p: str, size: int) -> list[str]:
    p = (p or "").strip()
    if not p:
        return []
    if len(p) <= size:
        return [p]

    parts = []
    start = 0
    while start < len(p):
        end = min(start + size, len(p))
        if end >= len(p):
            parts.append(p[start:].strip())
            break
        snap = p.rfind(" ", start, end)
        if snap <= start:
            snap = end
        piece = p[start:snap].strip()
        if piece:
            parts.append(piece)
        start = snap
        while start < len(p) and p[start].isspace():
            start += 1
    return parts


def chunk_text(text: str, size: int = 1000, overlap: int = 200) -> list[str]:
    """Legacy character-based chunking for spreadsheet/CSV texts."""
    if size <= 0:
        raise ValueError("size must be positive")
    if overlap < 0:
        raise ValueError("overlap must be non-negative")
    if overlap >= size:
        overlap = size // 2

    text = (text or "").strip()
    if not text:
        return []

    paras = [p.strip() for p in _PARAGRAPH_SPLITTER.split(text) if p.strip()]
    if not paras:
        paras = [text]

    windows = []
    buf = []
    cur_len = 0

    for p in paras:
        if len(p) > size:
            if buf:
                windows.append("\n\n".join(buf))
                buf = []
                cur_len = 0
            windows.extend(_split_large_para(p, size))
            continue

        p_len = len(p) + 2
        if cur_len + p_len <= size or not buf:
            buf.append(p)
            cur_len += p_len
        else:
            joined = "\n\n".join(buf)
            windows.append(joined)
            if overlap > 0 and len(joined) > overlap:
                tail = _word_boundary_tail(joined, overlap)
                buf = [tail, p]
                cur_len = len(tail) + p_len + 2
            else:
                buf = [p]
                cur_len = p_len

    if buf:
        windows.append("\n\n".join(buf))
    return windows