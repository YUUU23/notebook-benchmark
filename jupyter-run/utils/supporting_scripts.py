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


def _extract_string_literals(source: str) -> list[str]:
    """Return string constants appearing anywhere in Python source."""
    out: list[str] = []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return out
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.append(node.value)
    return out


# Names of nnb/ipyflow run-output artifacts that pollute a benchmark's data/
# dir (written by prior runs); never upload these into the UI working dir.
_OUTPUT_ARTIFACT_NAMES = {"trace.db", "trace.db-wal", "trace.db-shm", "log"}


def _is_output_artifact(path: Path) -> bool:
    if ".ipynb_checkpoints" in path.parts:
        return True
    if path.name in _OUTPUT_ARTIFACT_NAMES:
        return True
    return False


def find_data_dependencies(
    nb_json: dict,
    nb_dir: str,
    exclude: set[str] | None = None,
    size_cap_bytes: int = 200 * 1024 * 1024,
    file_count_cap: int = 500,
) -> list[dict]:
    """
    Detect the relative data files a notebook reads and stage them so the
    Playwright run (which uploads the notebook into a fresh temp dir) can resolve
    paths like ``./data/x.wav`` that only work from the benchmark dir manually.

    Strategy: scan code cells for string literals that resolve to an existing
    path relative to the notebook dir, then stage the referenced FILES
    individually (a directory reference is expanded to its files) preserving the
    relative path, so ``open('./data/x')`` lands at ``<tmp>/data/x``.

    Guardrails (a notebook can reference far more than it needs):
      * skip URLs, non-path-ish strings, absolute paths, and ``.`` / ``..`` /
        the notebook dir itself (uploading the whole working dir is wrong);
      * never escape above the suite dir (nb_dir's parent);
      * skip run-output artifacts (trace.db / log / .ipynb_checkpoints) so the
        accumulated manual-run logs under data/ are not uploaded;
      * skip anything already staged as an import/sys.path dep (``exclude``);
      * skip a reference whose files exceed ``size_cap_bytes`` or
        ``file_count_cap`` (e.g. multi-hundred-MB datasets) -- those stay manual.

    Returns the same {sourcePath, targetRelPath, isDirectory} dicts as
    find_supporting_scripts, so the caller can concatenate the two lists.
    """
    nb_dir_path = Path(nb_dir).resolve()
    suite_root = nb_dir_path.parent  # allow ../dataset style, but no higher
    run_dir = Path.cwd().resolve()
    exclude_resolved = {str(Path(p).resolve()) for p in (exclude or set())}

    # Collect candidate referenced paths.
    candidates: list[Path] = []
    seen_cand: set[str] = set()
    for cell in nb_json.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        source = "".join(cell.get("source", []))
        for s in _extract_string_literals(source):
            s = s.strip()
            if not s or "\n" in s or len(s) > 200:
                continue
            if s.startswith(("http://", "https://", "/")):
                continue
            if s in (".", "./", "..", "../"):
                continue
            # Path-ish: has a separator or a filename extension.
            if "/" not in s and "." not in os.path.basename(s):
                continue
            cand = (nb_dir_path / s).resolve()
            if str(cand) in seen_cand or not cand.exists():
                continue
            # Must stay within the suite dir and not be the working dir itself.
            if cand == nb_dir_path or suite_root not in cand.parents and cand != suite_root:
                continue
            seen_cand.add(str(cand))
            candidates.append(cand)

    results: list[dict] = []
    seen_files: set[str] = set()

    def _staged_entry(f: Path) -> dict | None:
        try:
            source_path = str(f.relative_to(run_dir))
        except ValueError:
            source_path = str(f)
        return {
            "sourcePath": source_path,
            "targetRelPath": os.path.relpath(f, nb_dir_path),
            "isDirectory": False,
        }

    for cand in candidates:
        # Skip anything already covered by an import/sys.path upload.
        if str(cand) in exclude_resolved or any(
            str(cand).startswith(ex + os.sep) for ex in exclude_resolved
        ):
            continue

        # Expand to concrete files, dropping run-output artifacts.
        if cand.is_file():
            files = [cand] if not _is_output_artifact(cand) else []
        else:
            files = [
                p for p in cand.rglob("*")
                if p.is_file() and not _is_output_artifact(p)
                and not any(seg in _OUTPUT_ARTIFACT_NAMES or seg == ".ipynb_checkpoints"
                            for seg in p.relative_to(cand).parts)
            ]

        files = [f for f in files if str(f) not in seen_files]
        if not files:
            continue

        total = sum(f.stat().st_size for f in files)
        if len(files) > file_count_cap or total > size_cap_bytes:
            print(
                f"=== [RUN] WARNING: data dependency {os.path.relpath(cand, nb_dir_path)!r} "
                f"skipped ({len(files)} files, {total / 1e6:.0f}MB exceeds cap) -- "
                f"benchmark may fail; stage it manually"
            )
            continue

        for f in files:
            entry = _staged_entry(f)
            if entry:
                seen_files.add(str(f))
                results.append(entry)

    return results


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
