from dataclasses import dataclass
from difflib import SequenceMatcher
from itertools import zip_longest


def _source_str(cell) -> str:
    """Return a cell's source as a single string.

    nbformat stores ``source`` either as one string or as a list of line
    strings; normalize to a string so sources are hashable (SequenceMatcher)
    and comparable regardless of how the file was written.
    """
    src = cell.get("source", "")
    return "".join(src) if isinstance(src, list) else src


def is_cell_source_diff(actual_cell, modified_cell) -> bool:
    """
    Return whether or not the source of the actual cell is different from the
    modified cell.
    """
    return _source_str(actual_cell) != _source_str(modified_cell)

def get_code_cells(nb_json: str) -> list[str]: 
    """
    Get the code cells of a notebook. 
    """
    nb_json_cells = nb_json["cells"]
    if nb_json_cells is None:
        raise ValueError(
            "Notebook json does not contain cells list"
            f" Got: {nb_json}")
    return [
        c for c in nb_json_cells if c["cell_type"] == "code"
    ] 

def create_diff(expected: str, actual: str) -> tuple[list[str], list[str]]:
    """
    Returns a list of lines only in the actual string
    and a list of lines only in the expected string.
    """
    expected_lines = expected.split('\n')
    actual_lines = actual.split('\n')
    
    expected_only_lines = []
    actual_only_lines = []
    for line_num, (exp, act) in enumerate(zip_longest(expected_lines, actual_lines, fillvalue=None)):
        if act is None:
            expected_only_lines.append(f"{line_num}: {repr(exp)}")
        elif exp is None:
            actual_only_lines.append(f"{line_num}: {repr(act)}")
        elif act != exp:
            expected_only_lines.append(f"{line_num}: {repr(exp)}")
            actual_only_lines.append(f"{line_num}: {repr(act)}")
    return expected_only_lines, actual_only_lines

def format_diff_msg(expected_only_lines: list[str], actual_only_lines: list[str]) -> str:
    """
    Displays which lines are only in original and which are only in rerun. 
    Formats into a diff msg. Example:
    Output lines only in original:
    Hello World!

    Output lines only in rerun:
    Goodbye!
    """
    msg = ""
    if expected_only_lines or actual_only_lines:
        expected_lines = '\n'.join(expected_only_lines)
        actual_lines = '\n'.join(actual_only_lines)
        msg = (
            "Output lines only in expected notebook:\n"
            f"{expected_lines}\n"
            "Output lines only in actual notebook:\n"
            f"{actual_lines}"
        )
    return msg

def _collect_output_text(outputs: list) -> str:
    """
    Concatenate text from all output objects in a cell into a single normalized
    string.  Normalization:
      - output objects are joined in order (boundaries between objects ignored)
      - each line is right-stripped of whitespace
      - blank lines are removed

    This removes spurious diffs caused by the kernel splitting identical text
    across different numbers of output objects (common when comparing a
    nbconvert-run notebook against a JupyterLab-run notebook) and by trailing
    newlines being present or absent at the end of individual output objects.
    """
    parts = []
    for output in outputs:
        text = output.get("text", "")
        if not text and output.get("data"):
            text = output.get("data").get("text/plain", "")
        if isinstance(text, list):
            text = "".join(text)
        parts.append(text)
    combined = "".join(parts)
    non_blank = [line.rstrip() for line in combined.splitlines() if line.strip()]
    return "\n".join(non_blank)


def parse_and_compare_cell(
        expected_cell_json: dict[str, any],
        actual_cell_json: dict[str, any], 
        field: str) -> str:
    """
    Parse and compare cell from expected notebook and actual notebook 
    based on notebook metadata field. 

    All output objects for each cell are merged into a single normalized string
    before diffing, so differences that only arise from blank lines or from the
    kernel splitting output across different numbers of stream objects are
    suppressed.
    """
    if field is None:
        raise ValueError(f'field not provided for comparing cells')

    exp_outputs = expected_cell_json.get(field)
    if exp_outputs is None:
        raise ValueError(
            f"{field} field of expected cell {expected_cell_json.get('id', '')} is missing"
        )

    act_outputs = actual_cell_json.get(field)
    if act_outputs is None:
        raise ValueError(
            f"{field} field of actual cell {actual_cell_json.get('id', '')} is missing"
        )

    exp_text = _collect_output_text(exp_outputs)
    act_text = _collect_output_text(act_outputs)
    exp_only, act_only = create_diff(exp_text, act_text)
    return format_diff_msg(exp_only, act_only)

def parse_and_compare(nb_json_expected: dict[str, any], nb_json_actual: dict[str, any], field: str, cell_id_must_match: int):
    """
    Given a field in the notebook json, compare line by line and print diff for 
    where the different is. 
    
    cell_id_must_match requires that the cell id of each order-corresponding
    cells of the notebooks being compared must match. 
    """
    expected_code_cells = get_code_cells(nb_json_expected)
    actual_code_cells = get_code_cells(nb_json_actual)
    
    msg = []
    for i, (expected_cell, actual_cell) in enumerate(zip_longest(expected_code_cells, actual_code_cells, fillvalue={})):
        expected_cell_id = expected_cell.get("id")
        if expected_cell_id is None:
            if cell_id_must_match: 
                raise ValueError(f"cell in expected notebook at index {i} does not have a valid cell id")
            else: 
                expected_cell_id = f'expected_cell {i}'

        actual_cell_id = actual_cell.get("id")
        if actual_cell_id is None:
            if cell_id_must_match:
                raise ValueError(f"cell in actual notebook at index {i} does not have a valid cell id")
            else: 
                actual_cell_id = f'actual_cell {i}'

        if cell_id_must_match and expected_cell_id != actual_cell_id:
            print(
                "Cell id has changed from original"
                f" Expected cell id: {expected_cell_id}"
                f" Actual cell id: {actual_cell_id}")

        diff_msg = parse_and_compare_cell(expected_cell, actual_cell, field=field)
        if diff_msg:
            msg.append(
                f"Expected and actual output differ for cell at index {i}, cell id {actual_cell_id}"
                f"\n{diff_msg}\n"
            )
    
    return msg

def get_all_cell_output_diff(nb_expected, nb_actual) -> str:
    """
    Print diff of two notebook outputs.

    The actual (reactive) notebook and the expected notebook (the modified
    notebook run fresh) represent the same final notebook, so they have the same
    code cells in the same order and are matched by position. Their cell ids are
    NOT comparable -- they come from two independent pipelines (JupyterLab vs
    nbconvert) -- so id matching is not required. This position matching is what
    lets add/delete steps produce a real output diff instead of misaligning.
    """
    return "\n".join(parse_and_compare(nb_expected, nb_actual, field="outputs", cell_id_must_match=0))

def get_first_cell_source_diff(nb_json_original: str, nb_json_modified: str) -> tuple[int, str, str, str]: 
    """
    Find the first cell where the source (code) is different from original 
    notebook to a modified notebook. 
    
    Return the source of the modified and original notebook and 
    index and cell id of this cell. 
    Otherwise, return (-1, "") if no cell differ in source. 
    """
    original_cells = get_code_cells(nb_json_original)
    modified_cells = get_code_cells(nb_json_modified)
    
    for cell_i, (original_cells, modified_cells) in enumerate(zip(original_cells, modified_cells)):
        if is_cell_source_diff(original_cells, modified_cells):
            change = _source_str(modified_cells)
            original = _source_str(original_cells)
            cell_id = original_cells.get("id", "")
            return (cell_i, cell_id, change, original)

    return (-1, "", "", "")


def code_index_to_abs_index(nb_json, code_idx: int) -> int:
    """Map a code-cell ordinal to its absolute cell index in the notebook.

    The diff functions count code cells only, but JupyterLab (Galata's
    setCell/getCellLocator/selectCells/deleteCells) addresses cells by their
    absolute position in the full cell list, markdown included. Returns -1 if
    code_idx is out of range.
    """
    seen = 0
    for abs_i, cell in enumerate(nb_json["cells"]):
        if cell["cell_type"] != "code":
            continue
        if seen == code_idx:
            return abs_i
        seen += 1
    return -1


@dataclass
class Modification:
    """A single structural change between an original and a modified notebook.

    op        -- "edit" | "add" | "delete" | "none"
    code_idx  -- code-cell index of the change (in the modified notebook for
                 edit/add, in the original for delete); -1 for "none"
    abs_idx   -- absolute cell index for the UI to act on; -1 for "none"
    source    -- new source for edit/add; "" for delete/none
    cell_id   -- id of the target cell if the source file carries one; "" otherwise
    original  -- original source for edit; "" otherwise
    """
    op: str
    code_idx: int
    abs_idx: int
    source: str
    cell_id: str
    original: str


def _best_match_extra(shorter: list[str], longer: list[str]) -> int:
    """Return the index in ``longer`` of its one 'extra' element.

    Precondition: len(longer) == len(shorter) + 1. Tries removing each element
    of ``longer`` and scores how well the remainder aligns positionally with
    ``shorter`` (exact match, else SequenceMatcher ratio); the removal that
    aligns best identifies the added/deleted cell. This disambiguates an
    add/delete that sits adjacent to an in-place edit, which SequenceMatcher
    reports as one unequal-length 'replace' block.
    """
    best_p, best_score = 0, -1.0
    for p in range(len(longer)):
        remaining = longer[:p] + longer[p + 1:]
        score = sum(1.0 if a == b else SequenceMatcher(a=a, b=b, autojunk=False).ratio()
                    for a, b in zip(shorter, remaining))
        if score > best_score:
            best_score, best_p = score, p
    return best_p


def detect_modification(nb_json_original, nb_json_modified) -> Modification:
    """Classify the modification between two notebooks as edit / add / delete.

    Uses the code-cell-count delta as the structural signal and
    difflib.SequenceMatcher over code-cell sources to locate the change, so it
    is independent of whether the source files carry cell ids (they often do
    not). Only a single structural op per step is supported (the runner's
    model): exactly one op block may change the code-cell count, by +/-1.
    Incidental in-place edits elsewhere are tolerated; a multi-cell or
    otherwise un-isolable structural change raises ValueError so the step fails
    loudly rather than silently mislabelling the modification.
    """
    orig_code = get_code_cells(nb_json_original)
    mod_code = get_code_cells(nb_json_modified)
    delta = len(mod_code) - len(orig_code)

    if delta == 0:
        code_idx, cell_id, change, original = get_first_cell_source_diff(
            nb_json_original, nb_json_modified)
        if code_idx < 0:
            return Modification("none", -1, -1, "", "", "")
        abs_idx = code_index_to_abs_index(nb_json_modified, code_idx)
        return Modification("edit", code_idx, abs_idx, change, cell_id, original)

    if abs(delta) > 1:
        raise ValueError(
            f"unsupported multi-cell structural change: code-cell count differs "
            f"by {delta} (only a single add/delete per step is supported)")

    orig_srcs = [_source_str(c) for c in orig_code]
    mod_srcs = [_source_str(c) for c in mod_code]
    opcodes = SequenceMatcher(a=orig_srcs, b=mod_srcs, autojunk=False).get_opcodes()

    # Exactly one opcode may change the count (equal-length 'replace' blocks are
    # incidental edits and ignored). Its net change must equal the overall delta.
    structural = [(tag, i1, i2, j1, j2) for tag, i1, i2, j1, j2 in opcodes
                  if (i2 - i1) != (j2 - j1)]
    if len(structural) != 1:
        raise ValueError(
            f"could not isolate a single structural change; found {len(structural)} "
            f"count-changing blocks: {structural}")
    tag, i1, i2, j1, j2 = structural[0]
    if (j2 - j1) - (i2 - i1) != delta:
        raise ValueError(f"structural block {structural[0]} does not net {delta:+d}")

    if delta == 1:
        # Pure insert -> whole block is the added cell; replace(+1) -> the extra
        # modified cell in the block is the add, the rest are edits.
        offset = 0 if tag == "insert" else _best_match_extra(
            orig_srcs[i1:i2], mod_srcs[j1:j2])
        j = j1 + offset
        added = mod_code[j]
        return Modification("add", j, code_index_to_abs_index(nb_json_modified, j),
                            _source_str(added), added.get("id", ""), "")

    # delta == -1
    offset = 0 if tag == "delete" else _best_match_extra(
        mod_srcs[j1:j2], orig_srcs[i1:i2])
    i = i1 + offset
    removed = orig_code[i]
    return Modification("delete", i, code_index_to_abs_index(nb_json_original, i),
                        "", removed.get("id", ""), _source_str(removed))

def get_cells_reran(nb_initial_json, nb_reactive_json) -> tuple[int, int, list[int]]:
    """
    Return the ordered execution events of a reactive episode.

    Both arguments are JupyterLab downloads from the same session: the initial
    run (before the modification) and the result after the modification plus its
    reactive cascade. A cell participated in the episode iff its execution count
    in the reactive notebook exceeds every count present in the initial run --
    i.e. it is >= baseline, where baseline = max(initial counts) + 1. The
    user-triggered cell (edit or added cell) executes at exactly baseline; the
    scheduler's reactive reruns get successively higher counts. Ordering by
    execution count therefore puts the triggering cell first (for edit/add) and
    the reactive reruns after it. A deletion has no triggering execution, so
    every participating cell is a reactive rerun.

    This reads only the reactive notebook's counts, so it is immune to the
    positional/id shifts introduced by an added or deleted cell.

    Returns (count, total_code_cells, positions) where positions are 0-based
    code-cell indices in the reactive notebook.
    """
    initial_cells = get_code_cells(nb_initial_json)
    reactive_cells = get_code_cells(nb_reactive_json)

    initial_counts = [
        cell.get("execution_count")
        for cell in initial_cells
        if isinstance(cell.get("execution_count"), int)
    ]
    baseline = max(initial_counts, default=0) + 1

    events = []
    for pos, cell in enumerate(reactive_cells):
        ec = cell.get("execution_count")
        if isinstance(ec, int) and ec >= baseline:
            events.append((ec, pos))

    events.sort()
    cells_executed = [pos for _, pos in events]
    return (len(cells_executed), len(reactive_cells), cells_executed)


def relabel_reran_positions(positions, op, code_idx):
    """Map 0-based reactive code-cell positions to 1-based ORIGINAL numbering.

    Reran positions from get_cells_reran count code cells in the post-modification
    notebook, so an add/delete shifts every downstream original cell. Relabel so
    the report uses the original notebook's numbering: the added cell is "n" and
    the surviving originals keep their pre-modification positions. code_idx is the
    change's code-cell index (in the modified notebook for add, in the original for
    delete). edit/none are identity.
    """
    labels = []
    for p in positions:
        if op == "add":
            if p == code_idx:
                labels.append("n")
            elif p < code_idx:
                labels.append(p + 1)
            else:
                labels.append(p)  # original 0-based p-1 -> 1-based p
        elif op == "delete":
            orig = p if p < code_idx else p + 1
            labels.append(orig + 1)
        else:
            labels.append(p + 1)
    return labels


def rerun_labels_to_abs_indices(labels, op, code_idx, nb_modified_json) -> list[int]:
    """Map manual rerun-set labels to absolute cell indices in the modified notebook.

    Inverse of relabel_reran_positions: labels use ORIGINAL 1-based code-cell
    numbering ("n" == the added cell), the convention maintained by hand in the
    results sheet's column D. Each label is resolved to a 0-based code-cell
    position in the MODIFIED notebook (accounting for the add/delete shift), then
    to an absolute cell index (markdown included) via code_index_to_abs_index --
    which is what the Galata helpers in the python3 spec address by.

    labels may be an iterable of ints/strings or a comma string like "n,2,3".
    code_idx is the change's code-cell index (modified notebook for add/edit,
    original for delete). Unresolvable labels (the deleted cell itself, or an
    out-of-range index) are skipped. Returns positions sorted ascending so the
    baseline reruns cells top-to-bottom.
    """
    if isinstance(labels, str):
        labels = [t for t in labels.replace(" ", "").split(",") if t]

    positions = []
    for label in labels:
        label = str(label).strip()
        if not label:
            continue
        if label == "n":
            pos = code_idx if op == "add" else -1  # "n" only meaningful for add
        else:
            try:
                v = int(label)
            except ValueError:
                continue
            if op == "add":
                pos = v - 1 if v <= code_idx else v
            elif op == "delete":
                orig0 = v - 1
                if orig0 == code_idx:
                    continue  # the deleted cell cannot be rerun
                pos = orig0 if orig0 < code_idx else orig0 - 1
            else:  # edit / none: no structural shift
                pos = v - 1
        if pos < 0:
            continue
        abs_idx = code_index_to_abs_index(nb_modified_json, pos)
        if abs_idx >= 0:
            positions.append(abs_idx)

    return sorted(set(positions))
