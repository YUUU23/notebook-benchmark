from itertools import zip_longest


def is_cell_source_diff(actual_cell, modified_cell) -> bool: 
    """
    Return whether or not the source of the actual cell is different from the 
    modified cell. 
    """
    actual_cell_source = actual_cell["source"]
    modified_cell_source = modified_cell["source"]
    return actual_cell_source != modified_cell_source

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

    Uses cell-ID-based matching when the notebooks carry cell IDs (nbformat >= 4.5).
    Falls back to position-based matching for older notebooks that lack cell IDs.
    """
    expected_cells = get_code_cells(nb_expected)
    has_ids = bool(expected_cells) and expected_cells[0].get("id") is not None
    return "\n".join(parse_and_compare(nb_expected, nb_actual, field="outputs", cell_id_must_match=has_ids))

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
            change = modified_cells["source"]
            original = original_cells["source"]
            cell_id = original_cells.get("id", "")
            return (cell_i, cell_id, change, original)
    
    return (-1, "", "", "")

def get_cells_reran(nb_json_original: str, nb_json_modified: str, modified_cell_idx: int, modified_cell_id: str) -> tuple[int, int, list[int]]: 
    """
    Return execution count difference of two notebooks given, and a list of 
    cell indexes for those cells where the execution count differs. 
    """
    original_cells = get_code_cells(nb_json_original)
    modified_cells = get_code_cells(nb_json_modified)
    
    reran_count = 0
    cells_reran = []
    for cell_i, (original_cell, modified_cell) in enumerate(zip(original_cells, modified_cells)):
        if cell_i == modified_cell_idx: 
            orig_id = modified_cell.get("id")
            if orig_id and modified_cell_id and orig_id != modified_cell_id:
                raise ValueError(f"Cell ID mismatch for modified cell {modified_cell_idx}")
            else: 
                continue

        orig_id = original_cell.get("id")
        mod_id = modified_cell.get("id")
        if orig_id and mod_id and orig_id != mod_id:
            raise ValueError("Cell ID mismatch")
        
        if original_cell["execution_count"] != modified_cell["execution_count"]:
            reran_count += 1
            cells_reran.append(cell_i)
    
    return (reran_count, len(original_cells), cells_reran)
        