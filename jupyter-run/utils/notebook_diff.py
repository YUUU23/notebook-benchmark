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

def parse_and_compare_cell(
        expected_cell_json: dict[str, any],
        actual_cell_json: dict[str, any], 
        field: str) -> str:
    """
    Parse and compare cell from expected notebook and actual notebook 
    based on notebook metadata field. 
    
    Deatils returns result of diff with metadata such as line numbers. 
    Without deatils, the diff is returned directly without metadata. 
    """
    if field == None:
        raise ValueError(f'field not provided for comparing cells')
    
    exp_outputs = expected_cell_json[field]
    if exp_outputs is None:
        raise ValueError(
            f"{field} field of orig cell {expected_cell_json['id', '']} is missing"
        )
    
    act_outputs = actual_cell_json[field]
    if act_outputs is None:
        raise ValueError(
            f"{field} field of rerun cell {actual_cell_json['id', '']} is missing"
        )

    expected_only_lines, actual_only_lines = [], []
    for exp_output, act_output in zip_longest(exp_outputs, act_outputs, fillvalue={}):
        # TODO: make sure it can register text/plain also. 
        exp_only, act_only = create_diff(exp_output.get("text", ""), act_output.get("text", ""))
        expected_only_lines.extend(exp_only)
        actual_only_lines.extend(act_only)
        
    return format_diff_msg(expected_only_lines, actual_only_lines)

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
        expected_cell_id = expected_cell["id"]
        if expected_cell_id is None:
            if cell_id_must_match: 
                raise ValueError(f"cell in expected notebook at index {i} does not have a valid cell id")
            else: 
                expected_cell_id = f'expected_cell {i}'
        
        actual_cell_id = actual_cell["id"]
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
    """
    return "\n".join(parse_and_compare(nb_expected, nb_actual, field="outputs", cell_id_must_match=True))

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
            cell_id = original_cells["id"]
            # print("!! ORIGINAL: ", original_cells["source"])
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
            if modified_cell["id"] != modified_cell_id: 
                raise ValueError(f"Cell ID mismatch for modified cell {modified_cell_idx}")
            else: 
                continue
            
        if original_cell["id"] != modified_cell["id"]:
            raise ValueError("Cell ID mismatch")
        
        if original_cell["execution_count"] != modified_cell["execution_count"]:
            reran_count += 1
            cells_reran.append(cell_i)
    
    return (reran_count, len(original_cells), cells_reran)
        