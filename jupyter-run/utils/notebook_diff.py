from itertools import zip_longest

def create_diff(expected: str, actual: str) -> tuple[list[str], list[str]]:
    """
    Returns a list of lines only in the actual string
    and a list of lines only in the expected string.
    """
    expected_lines = expected.split('\n')
    actual_lines = actual.split('\n')
    
    expected_only_lines = []
    actual_only_lines = []
    for line_num, (orig, rerun) in enumerate(zip_longest(expected_lines, actual_lines, fillvalue=None)):
        if orig is None:
            expected_only_lines.append(f"{line_num}: {repr(rerun)}")
        elif rerun is None:
            actual_only_lines.append(f"{line_num}: {repr(orig)}")
        elif orig != rerun:
            expected_only_lines.append(f"{line_num}: {repr(orig)}")
            actual_only_lines.append(f"{line_num}: {repr(rerun)}")
    
    return expected_only_lines, actual_only_lines

def format_diff_msg(orig_only_lines: list[str], rerun_only_lines: list[str]) -> str:
    """
    Displays which lines are only in original and which are only in rerun. 
    Formats into a diff msg. Example:
    Output lines only in original:
    Hello World!

    Output lines only in rerun:
    Goodbye!
    """
    msg = ""
    if orig_only_lines or rerun_only_lines:
        orig_lines = '\n'.join(orig_only_lines)
        rerun_lines = '\n'.join(rerun_only_lines)
        msg = (
            "Output lines only in original:\n"
            f"{orig_lines}\n"
            "Output lines only in rerun:\n"
            f"{rerun_lines}"
        )
    return msg

def parse_and_compare_cell(
        cell_json_orig: dict[str, any],
        cell_json_rerun: dict[str, any]) -> str:
    
    orig_outputs = cell_json_orig["outputs"]
    if orig_outputs is None:
        raise ValueError(
            f"Outputs field of orig cell {cell_json_orig['id', '']} is missing"
        )
    
    rerun_outputs = cell_json_rerun["outputs"]
    if rerun_outputs is None:
        raise ValueError(
            f"Outputs field of rerun cell {cell_json_rerun['id', '']} is missing"
        )
    
    # print("ORIG OUT: ", orig_outputs)
    # print("RERUN OUT: ", rerun_outputs)
    orig_only_lines, rerun_only_lines = [], []
    for orig_output, rerun_output in zip_longest(orig_outputs, rerun_outputs, fillvalue={}):
        # TODO: make sure it can register text/plain also. 
        
        orig_only, rerun_only = create_diff(orig_output.get("text", ""), rerun_output.get("text", ""))
        orig_only_lines.extend(orig_only)
        rerun_only_lines.extend(rerun_only)

    # print("orig_only_lines, ", orig_only_lines)
    # print("rerun_only_lines, ", rerun_only_lines)
    return format_diff_msg(orig_only_lines, rerun_only_lines)

def parse_and_compare(nb_json_orig: dict[str, any], nb_json_rerun: dict[str, any]):
    orig_cells = nb_json_orig["cells"]
    if orig_cells is None:
        raise ValueError(
            "Original notebook json does not contain cells list"
            f" Got: {nb_json_orig}")
    orig_code_cells = [
        c for c in orig_cells if c["cell_type"] == "code"
    ]
    orig_code_cells = delete_last_empty_cell(orig_code_cells) 

    reran_cells = nb_json_rerun["cells"]
    if reran_cells is None:
        raise ValueError(
            "Reran notebook json does not contain cells list"
            f" Got: {nb_json_rerun}"
        )
    reran_code_cells = [
        c for c in reran_cells if c["cell_type"] == "code"
    ]
    
    msg = []
    for i, (orig_cell, reran_cell) in enumerate(zip_longest(orig_code_cells, reran_code_cells, fillvalue={})):
        orig_cell_id = orig_cell["id"]
        if orig_cell_id is None:
            orig_cell_id = 'orig_cell none'
        reran_cell_id = reran_cell["id"]
        if reran_cell_id is None:
            raise ValueError(f"Reran cell does not have id, cell val: {reran_cell}")
        if reran_cell_id != orig_cell_id:
            raise ValueError(
                "Cell id has changed from original"
                f" Original cell id: {orig_cell_id}"
                f" Reran cell id: {reran_cell_id}")
        
        diff_msg = parse_and_compare_cell(orig_cell, reran_cell)
        if diff_msg:
            msg.append(
                f"Original output and reran output differ for cell {orig_cell_id}, cell index {i}"
                f"\n{diff_msg}\n"
            )
    
    return msg

def get_all_cell_output_diff(nb_actual, nb_expected): 
    print("=== PRINTING DIFF: ")
    print("\n".join(parse_and_compare(nb_actual, nb_expected)))

def get_first_cell_source_diff(nb_json_orig: str, nb_json_rerun: str): 
    # print("**** ORIG CELL ****")
    # print(json.dumps(nb_json_orig, indent=4))
    # print("**** MODIFIED CELL ****")
    # print(json.dumps(nb_json_rerun, indent=4))
    
    orig_cells = nb_json_orig["cells"]
    if orig_cells is None:
        raise ValueError(
            "Original notebook json does not contain cells list"
            f" Got: {nb_json_orig}")
    orig_code_cells = [
        c for c in orig_cells if c["cell_type"] == "code"
    ]

    reran_cells = nb_json_rerun["cells"]
    if reran_cells is None:
        raise ValueError(
            "Reran notebook json does not contain cells list"
            f" Got: {nb_json_rerun}"
        )
    reran_code_cells = [
        c for c in reran_cells if c["cell_type"] == "code"
    ]
    
    for cell_i, (orig_cell, reran_cell) in enumerate(zip(orig_code_cells, reran_code_cells)):
        if is_cell_source_diff(orig_cell, reran_cell):
            source = reran_cell["source"]
            print(f"=== Found source diff: at cell index: {cell_i}, code: {source} ") 
            return (cell_i, source)
    
    return (-1, "")

def is_cell_source_diff(orig_cell, modified_cell): 
    orig_cell_source = orig_cell["source"]
    modified_cell_source = modified_cell["source"]
    return orig_cell_source != modified_cell_source

def get_execution_count_diff(nb_json_orig: str, nb_json_rerun: str): 
    orig_cells = nb_json_orig["cells"]
    if orig_cells is None:
        raise ValueError(
            "Original notebook json does not contain cells list"
            f" Got: {nb_json_orig}")
    orig_code_cells = [
        c for c in orig_cells if c["cell_type"] == "code"
    ]

    reran_cells = nb_json_rerun["cells"]
    if reran_cells is None:
        raise ValueError(
            "Reran notebook json does not contain cells list"
            f" Got: {nb_json_rerun}"
        )
    reran_code_cells = [
        c for c in reran_cells if c["cell_type"] == "code"
    ]
    reran_count = 0
    for cell_i, (orig_cell, reran_cell) in enumerate(zip(orig_code_cells, reran_code_cells)):
        if orig_cell["id"] != reran_cell["id"]:
            raise ValueError("Cell ID mismatch")
        
        if orig_cell["execution_count"] != reran_cell["execution_count"]:
            reran_count += 1
    
    return reran_count

def delete_last_empty_cell(nb_json_cells: str) -> str: 
    if nb_json_cells: 
        last_cell = nb_json_cells[-1]
        if last_cell["execution_count"] == None and len(last_cell["outputs"]) == 0:
            return nb_json_cells[:-1]
        else:
            return nb_json_cells
        