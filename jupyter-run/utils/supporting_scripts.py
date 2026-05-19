import ast
import os
from pathlib import Path


def _extract_imported_names(source: str) -> set[str]:
    """Return top-level module names from import statements in Python source."""
    names = set()
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return names
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                names.add(node.module.split(".")[0])
    return names


def _extract_sys_path_dirs(source: str) -> list[str]:
    """
    Return string-literal paths from sys.path.append(...) and sys.path.insert(_, ...) calls.
    Only handles cases where the path is a plain string constant.
    """
    dirs = []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return dirs
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr in ("append", "insert")):
            continue
        val = func.value
        if not (isinstance(val, ast.Attribute) and val.attr == "path"):
            continue
        if not (isinstance(val.value, ast.Name) and val.value.id == "sys"):
            continue
        # sys.path.append(path) – first arg is the path
        # sys.path.insert(idx, path) – second arg is the path
        arg_idx = 0 if func.attr == "append" else 1
        if len(node.args) > arg_idx:
            arg = node.args[arg_idx]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                dirs.append(arg.value)
    return dirs


def find_supporting_scripts(nb_json: dict, nb_dir: str) -> list[dict]:
    """
    Scan notebook cells for imports and sys.path manipulation that resolve to local files.

    Two detection strategies:

    1. sys.path.append / sys.path.insert with a string literal path:
       The resolved directory is uploaded whole (isDirectory=True).  This covers
       patterns like  sys.path.append('../compositional_causal_reasoning')  where
       many modules live side-by-side in one folder that is NOT a Python package.

    2. import / from-import statements:
       For each top-level module name, search for a matching .py file or package
       (directory with __init__.py) in:
         • nb_dir  (same directory as the notebook)
         • nb_dir/../  (parent directory)
         • nb_dir/src/, nb_dir/lib/, nb_dir/utils/  (common sub-directories)
       sys.path-added directories are excluded from this search since they are
       already covered by strategy 1.

    Returns a list of dicts:
      sourcePath    – path relative to cwd (jupyter-run/), used by the TS uploader
      targetRelPath – path relative to the notebook's working directory, which
                      determines where the file lands in JupyterLab.
                      Examples: "helper.py", "src/utils.py", "../shared_lib"
      isDirectory   – True when the entry should be uploaded as a directory
    """
    nb_dir_path = Path(nb_dir).resolve()
    run_dir = Path.cwd().resolve()

    seen: set[str] = set()
    results: list[dict] = []

    # ── Strategy 1: sys.path-added directories ─────────────────────────────────
    sys_path_added: set[Path] = set()
    for cell in nb_json.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        source = "".join(cell.get("source", []))
        for rel in _extract_sys_path_dirs(source):
            candidate = (nb_dir_path / rel).resolve()
            if candidate.is_dir() and str(candidate) not in seen:
                seen.add(str(candidate))
                sys_path_added.add(candidate)
                try:
                    source_path = str(candidate.relative_to(run_dir))
                except ValueError:
                    source_path = str(candidate)
                target_rel = os.path.relpath(candidate, nb_dir_path)
                results.append({
                    "sourcePath": source_path,
                    "targetRelPath": target_rel,
                    "isDirectory": True,
                })

    # ── Strategy 2: import statements, searched in fixed locations ─────────────
    search_dirs = [nb_dir_path, nb_dir_path.parent]
    for subdir in ("src", "lib", "utils"):
        candidate = nb_dir_path / subdir
        # Only add if not already being uploaded whole via sys.path
        if candidate.is_dir() and candidate not in sys_path_added:
            search_dirs.append(candidate)

    imported_names: set[str] = set()
    for cell in nb_json.get("cells", []):
        if cell.get("cell_type") == "code":
            source = "".join(cell.get("source", []))
            imported_names.update(_extract_imported_names(source))

    for name in sorted(imported_names):
        for search_dir in search_dirs:
            # Skip directories already covered by a whole-directory upload
            if search_dir in sys_path_added:
                continue

            # Single .py file
            py_file = search_dir / f"{name}.py"
            if py_file.exists() and str(py_file) not in seen:
                seen.add(str(py_file))
                try:
                    source_path = str(py_file.relative_to(run_dir))
                except ValueError:
                    source_path = str(py_file)
                target_rel = os.path.relpath(py_file, nb_dir_path)
                results.append({
                    "sourcePath": source_path,
                    "targetRelPath": target_rel,
                    "isDirectory": False,
                })
                break

            # Package directory (must have __init__.py)
            pkg_dir = search_dir / name
            if (pkg_dir / "__init__.py").exists() and str(pkg_dir) not in seen:
                seen.add(str(pkg_dir))
                try:
                    source_path = str(pkg_dir.relative_to(run_dir))
                except ValueError:
                    source_path = str(pkg_dir)
                target_rel = os.path.relpath(pkg_dir, nb_dir_path)
                results.append({
                    "sourcePath": source_path,
                    "targetRelPath": target_rel,
                    "isDirectory": True,
                })
                break

    return results
