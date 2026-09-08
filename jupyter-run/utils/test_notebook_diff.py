"""Unit tests for the structural-modification detection in notebook_diff.

Runnable with plain python3 (no kernel / LD_PRELOAD needed):
    python3 utils/test_notebook_diff.py
or under pytest:
    python3 -m pytest utils/test_notebook_diff.py

Covers edit/add/delete detection over notebooks that mix markdown and code
cells (with and without cell ids), the code-cell -> absolute-index mapping, the
single-op guardrails, and the id-free get_cells_reran alignment for add/delete.
"""
import sys, os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.notebook_diff import (
    detect_modification,
    code_index_to_abs_index,
    get_cells_reran,
    relabel_reran_positions,
)


def code(src, cid=None, ec=None):
    c = {"cell_type": "code", "source": src, "outputs": [], "execution_count": ec}
    if cid is not None:
        c["id"] = cid
    return c


def md(src):
    return {"cell_type": "markdown", "source": src}


def nb(cells):
    return {"cells": cells, "nbformat": 4, "nbformat_minor": 5, "metadata": {}}


# --- edit -----------------------------------------------------------------

def test_edit_plain():
    orig = nb([code("a"), code("b"), code("c")])
    mod = nb([code("a"), code("b2"), code("c")])
    m = detect_modification(orig, mod)
    assert m.op == "edit", m
    assert m.code_idx == 1 and m.abs_idx == 1
    assert m.source == "b2" and m.original == "b"


def test_edit_with_markdown_abs_index():
    # markdown before the edited code cell shifts the absolute index.
    orig = nb([md("#"), md("#"), code("a"), md("#"), code("b"), code("c")])
    mod = nb([md("#"), md("#"), code("a"), md("#"), code("b2"), code("c")])
    m = detect_modification(orig, mod)
    assert m.op == "edit" and m.code_idx == 1 and m.abs_idx == 4, m


def test_no_change():
    orig = nb([code("a"), code("b")])
    m = detect_modification(orig, nb([code("a"), code("b")]))
    assert m.op == "none" and m.code_idx == -1 and m.abs_idx == -1, m


def test_edit_list_source():
    # nbformat may store source as a list of lines.
    orig = nb([code(["x = 1\n", "y = 2"])])
    mod = nb([code(["x = 1\n", "y = 3"])])
    m = detect_modification(orig, mod)
    assert m.op == "edit" and m.source == "x = 1\ny = 3", m


# --- add ------------------------------------------------------------------

def test_add_middle():
    orig = nb([code("a"), code("b"), code("c")])
    mod = nb([code("a"), code("x"), code("b"), code("c")])
    m = detect_modification(orig, mod)
    assert m.op == "add" and m.code_idx == 1 and m.source == "x", m


def test_add_start():
    orig = nb([code("a"), code("b")])
    mod = nb([code("x"), code("a"), code("b")])
    m = detect_modification(orig, mod)
    assert m.op == "add" and m.code_idx == 0 and m.abs_idx == 0, m


def test_add_end():
    orig = nb([code("a"), code("b")])
    mod = nb([code("a"), code("b"), code("x")])
    m = detect_modification(orig, mod)
    assert m.op == "add" and m.code_idx == 2, m


def test_add_with_markdown_abs_index():
    orig = nb([md("#"), code("a"), md("#"), code("b")])
    mod = nb([md("#"), code("a"), md("#"), code("x"), code("b")])
    m = detect_modification(orig, mod)
    # x is the 3rd cell (abs index 3) in the modified notebook.
    assert m.op == "add" and m.code_idx == 1 and m.abs_idx == 3, m


def test_add_alongside_separated_edit():
    # forecasting-gmm m1/m3 shape: an incidental edit separated from the insert
    # by unchanged cells -> a clean insert opcode.
    orig = nb([code("a"), code("style=25"), code("c"), code("d")])
    mod = nb([code("a"), code("style=15"), code("c"), code("x"), code("d")])
    m = detect_modification(orig, mod)
    assert m.op == "add" and m.code_idx == 3 and m.source == "x", m


def test_add_adjacent_to_edit():
    # forecasting-gmm m5 shape: the edited cell and the added cell are adjacent,
    # so SequenceMatcher reports one unequal 'replace' block; the added cell is
    # resolved by best-match alignment (the edited cell keeps its close match).
    orig = nb([code("a"), code("style=25"), code("c"), code("d")])
    mod = nb([code("a"), code("style=15"), code("newcell"), code("c"), code("d")])
    m = detect_modification(orig, mod)
    assert m.op == "add" and m.code_idx == 2 and m.source == "newcell", m


# --- delete ---------------------------------------------------------------

def test_delete_middle():
    orig = nb([code("a"), code("b", cid="B"), code("c")])
    mod = nb([code("a"), code("c")])
    m = detect_modification(orig, mod)
    assert m.op == "delete" and m.code_idx == 1 and m.cell_id == "B", m
    assert m.original == "b"


def test_delete_with_markdown_abs_index():
    orig = nb([md("#"), code("a"), code("b"), md("#"), code("c")])
    mod = nb([md("#"), code("a"), md("#"), code("c")])
    m = detect_modification(orig, mod)
    assert m.op == "delete" and m.code_idx == 1 and m.abs_idx == 2, m


# --- guardrails -----------------------------------------------------------

def test_multi_add_raises():
    orig = nb([code("a"), code("b")])
    mod = nb([code("a"), code("b"), code("c"), code("d")])
    try:
        detect_modification(orig, mod)
    except ValueError:
        return
    assert False, "expected ValueError for +2 structural change"


def test_two_structural_blocks_raise():
    # a delete in one place and an add in another net 0 but are two structural
    # blocks under a single-op model -> raise (delta 0 here goes to edit path,
    # so force delta +1 with two count-changing blocks).
    orig = nb([code("a"), code("b"), code("c"), code("d")])
    mod = nb([code("x1"), code("x2"), code("a"), code("c"), code("d")])  # +2 then -1
    try:
        detect_modification(orig, mod)
    except ValueError:
        return
    assert False, "expected ValueError for multiple structural blocks"


# --- code -> absolute index helper ---------------------------------------

def test_code_index_to_abs_index():
    n = nb([md("#"), md("#"), code("a"), md("#"), code("b"), code("c")])
    assert code_index_to_abs_index(n, 0) == 2
    assert code_index_to_abs_index(n, 1) == 4
    assert code_index_to_abs_index(n, 2) == 5
    assert code_index_to_abs_index(n, 3) == -1


# --- get_cells_reran (id-free, count-based) -------------------------------

def test_reran_edit():
    initial = nb([code("a", ec=1), code("b", ec=2), code("c", ec=3)])
    # edit b (count 4), reactive rerun c (count 5)
    reactive = nb([code("a", ec=1), code("b2", ec=4), code("c", ec=5)])
    count, total, positions = get_cells_reran(initial, reactive)
    assert positions == [1, 2] and count == 2 and total == 3, (count, total, positions)


def test_reran_add():
    initial = nb([code("a", ec=1), code("b", ec=2), code("c", ec=3)])
    # added x runs at 4, reactive rerun c at 5
    reactive = nb([code("a", ec=1), code("b", ec=2), code("x", ec=4), code("c", ec=5)])
    count, total, positions = get_cells_reran(initial, reactive)
    assert positions == [2, 3] and count == 2 and total == 4, (count, total, positions)


def test_reran_delete():
    initial = nb([code("a", ec=1), code("b", ec=2), code("c", ec=3), code("d", ec=4)])
    # delete b; reactive reruns c (5) and d (6)
    reactive = nb([code("a", ec=1), code("c", ec=5), code("d", ec=6)])
    count, total, positions = get_cells_reran(initial, reactive)
    assert positions == [1, 2] and count == 2 and total == 3, (count, total, positions)


def test_reran_delete_no_dependents():
    initial = nb([code("a", ec=1), code("b", ec=2)])
    reactive = nb([code("a", ec=1)])
    count, total, positions = get_cells_reran(initial, reactive)
    assert positions == [] and count == 0 and total == 1, (count, total, positions)


# --- relabel_reran_positions (report in original numbering) ----------------

def test_relabel_edit_identity():
    # edit: no structural shift, positions just go 0-based -> 1-based.
    assert relabel_reran_positions([1, 2], "edit", 1) == [2, 3]


def test_relabel_add_middle():
    # user's example: original 1,2,3,4; add between 1 and 2; reactive set
    # {new, orig2, orig3, orig4} at 0-based positions [1,2,3,4], insert at 1.
    assert relabel_reran_positions([1, 2, 3, 4], "add", 1) == ["n", 2, 3, 4]


def test_relabel_add_untouched_before_insert():
    # a rerun before the insertion point keeps its original position.
    assert relabel_reran_positions([0, 2, 3], "add", 2) == [1, "n", 3]


def test_relabel_delete_middle():
    # delete original code cell at idx 2 (1-based 3); survivors at/after it shift
    # up to their original numbering. reactive positions [1,2] -> orig [2, 4].
    assert relabel_reran_positions([1, 2], "delete", 2) == [2, 4]


def _run():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run() else 0)
