#!/usr/bin/env python3
import argparse, os, re, subprocess, shutil
from pathlib import Path
from benchmark_runner import BenchmarkRunner
from utils.rerun_sheet import fetch_rerun_sets, WEB_APP_URL


def run_benchmarks(b: BenchmarkRunner, name:str,
                   original_nb_path: str, modified_nb_path: str,
                   data_directory: str, rerun_set: str = None):
    """
    Run single benchmark with benchmark runner.
    """
    print(f"============================ ")
    print(f"=== [RUN] RUNNING {name} === ")
    try:
        b.run(original_nb_path, modified_nb_path, data_directory, rerun_set)
    except Exception as e:
        print(f"Failed to run benchamrk {name}, with files {original_nb_path} and {modified_nb_path}, {e}")
    print(f"=== [RUN] COMPLETE RUNNING {name} ===")
    print(f"============================ ")
    print('\n')
        
_NUMBERED_MOD_RE = re.compile(r'^m(\d+)_(.+)$')
_LEGACY_MOD_RE  = re.compile(r'^m_(.+)$')
# Matches the marker printed by run_benchmarks() on step completion; used to
# reconstruct which benchmarks already finished when resuming (--resume-log).
_COMPLETE_RE = re.compile(r'^=== \[RUN\] COMPLETE RUNNING (.+?) ===\s*$')


def load_completed_labels(log_path: str) -> set[str]:
    """Scan a prior run's log for '=== [RUN] COMPLETE RUNNING <label> ===' markers
    and return the set of step labels that already finished, so a resumed run can
    skip them. Read once at startup, before this run appends to the same file."""
    completed: set[str] = set()
    try:
        with open(log_path) as f:
            for line in f:
                m = _COMPLETE_RE.match(line.rstrip("\n"))
                if m:
                    completed.add(m.group(1))
    except FileNotFoundError:
        pass
    return completed


def validate_benchmark_directory(directory: str) -> tuple[str, list[tuple[str, str]]]:
    """
    Discover the original notebook and all ordered modification notebooks in a
    benchmark directory and return an ordered chain of (original, modified) step pairs.

    Naming conventions supported:
      Numbered: example.ipynb, m1_example.ipynb, m2_example.ipynb, ...
        Each step applies the diff between example (the base) and mN.
      Legacy: example.ipynb, m_example.ipynb
        Treated as a single step equivalent to m1.

    Returns (base_name, steps) where steps is a list of (original_path, modified_path).
    """
    nb_extension = ".ipynb"
    nb_stems: dict[str, str] = {}  # stem → full path

    for f in os.listdir(directory): 
        file_path = f"{directory}{f}"
        if not Path(file_path).is_file(): 
            continue 
        if not f.endswith(nb_extension): 
            continue
        stem = f[: -len(nb_extension)]
        nb_stems[stem] = file_path

    def _is_modification(stem: str) -> bool:
        return bool(_NUMBERED_MOD_RE.match(stem) or _LEGACY_MOD_RE.match(stem))

    base_stems = [s for s in nb_stems if not _is_modification(s)]
    if len(base_stems) != 1: 
        raise IOError(
            f"{directory}: expected exactly one base notebook, found: {base_stems}"
        )
    base = base_stems[0]

    # Collect numbered modifications: m1_base, m2_base, ...
    mods: dict[int, str] = {}
    for stem, path in nb_stems.items():
        m = _NUMBERED_MOD_RE.match(stem)
        if m and m.group(2) == base:
            mods[int(m.group(1))] = path

    # Fall back to legacy m_base when no numbered modifications are found
    if not mods:
        legacy_stem = f"m_{base}"
        if legacy_stem in nb_stems:
            mods[1] = nb_stems[legacy_stem]

    if not mods:
        raise IOError(f"{directory}: no modification notebooks found for '{base}'")

    ordered = sorted(mods.items())  # [(1, path), (2, path), ...]
    indices = [x for x, _ in ordered]
    if indices != list(range(1, len(indices) + 1)):
        raise IOError(
            f"{directory}: modification indices are not consecutive starting from 1: {indices}"
        )

    # Build steps comparing each modification against the base: base → m1, base → m2, ...
    steps = [(nb_stems[base], path) for _, path in ordered]
    return (base, steps)

def run_cleanup(): 
    """
    Clean up open kernels and remove files generated through the run. 
    """
    script_path = "./scripts/cleanup.sh"
    try:
        print(f"=== [CleanUp] Cleaning up kernel and result files")
        res = subprocess.run([script_path], capture_output=True, text=False, check=False)
        print(f"=== [CleanUp] {res.stderr}") 
    except subprocess.CalledProcessError as e:
        print(f"Error executing ui script: {e} \n {e.stderr}")

def make_copy(src: str, dst: str):
    """
    Make copy of source directory passed in to destination directory. 
    """
    try:
        shutil.copytree(src, dst)
        print(f" === [RUN] '{src}' copied to be ran in '{dst}'.")
    except Exception as e:
        print(f"Copying error: {e}")

def main():
    parser = argparse.ArgumentParser(description="Run Jupyter reactive services automatically.")
    parser.add_argument("-c", "--config", metavar="CONFIG", type=str, help="path to config directory")
    parser.add_argument("-s", "--single_benchmark", type=str, help="run single benchmark directory")
    parser.add_argument("-m", "--multiple_benchmarks", type=str, help="run entire directory holding benchmark directories")
    parser.add_argument("-d", "--data_directory", type=str, help="additional files the benchmark may need")
    parser.add_argument("--start_ui_kernel", action="store_true", help="start UI kernel")
    parser.add_argument("--run_in_copy", action="store_true", help="make copy of original benchmarks and run in copy directory for isolation") 
    parser.add_argument("--auto_cleanup", action="store_true", help="automatically cleanup after run")
    parser.add_argument("--resume-log", type=str, help="prior run log; skip benchmarks already marked COMPLETE in it")
    parser.add_argument("--rerun-sheet-url", type=str, default=WEB_APP_URL,
                        help="Apps Script /exec URL to pull the python3 baseline rerun "
                             "set (results-sheet column D) from; only used for the python3 kernel")
    args = parser.parse_args()
    
    if args.config == None: 
        print("path to config directory not received.", parser.print_help())
        return
    if args.single_benchmark == None and args.multiple_benchmarks == None: 
        print("notebook files to test not recieved.", parser.print_help()) 
        return
    
    if args.config:
        benchmark_to_run = []
        nb_dir = ""
        data_directory = args.data_directory
        if args.single_benchmark: 
            nb_dir = f"{args.single_benchmark}/"
            benchmark_to_run.append(validate_benchmark_directory(nb_dir))
            if args.run_in_copy: 
                dst = args.single_benchmark + "_copy"
                make_copy(args.single_benchmark, dst)
                nb_dir = dst
        else: 
            nb_dir = args.multiple_benchmarks
            if args.run_in_copy: 
                dst = nb_dir + "-copy"
                make_copy(nb_dir, dst)
                nb_dir = dst
            for d in os.listdir(nb_dir):
                if data_directory and f"{nb_dir}/{d}" == data_directory: 
                    continue
                try: 
                    full_path = f"{nb_dir}/{d}/"
                    benchmark_to_run.append(validate_benchmark_directory(full_path))
                except IOError as e:
                    print(f"error parsing directory {d}, {e}")
        
        if benchmark_to_run:
            completed = load_completed_labels(args.resume_log) if args.resume_log else set()
            # The python3 baseline reruns a manually-maintained cell set (sheet
            # column D). Pull it once, keyed by step label (== sheet column A), so
            # column D can be edited in the sheet without a CSV round-trip. Only
            # python3 needs it; reactive kernels cascade on their own.
            kernel_name = os.path.basename(os.path.normpath(args.config))
            rerun_sets = (fetch_rerun_sets(args.rerun_sheet_url)
                          if kernel_name == "python3" else {})
            spawn_ui_kernel = args.start_ui_kernel
            b = BenchmarkRunner(args.config, spawn_ui_kernel=spawn_ui_kernel)
            for name, steps in benchmark_to_run:
                for i, (original_nb_path, modified_nb_path) in enumerate(steps):
                    # Multi-step benchmarks (realworld m1..mN) are labelled
                    # "<name>_m<step>" to match the results sheet's col A. Single
                    # step benchmarks keep the bare name (py-built-in / lib).
                    step_label = f"{name}_m{i + 1}" if len(steps) > 1 else name
                    if step_label in completed:
                        print(f"=== [RUN] SKIP (already complete) {step_label} ===")
                        continue
                    run_benchmarks(b, step_label, original_nb_path, modified_nb_path,
                                   data_directory, rerun_sets.get(step_label))
                    # Reclaim the kernel(s) this step left on the shared server so
                    # memory does not accumulate across benchmarks (see reap_kernels).
                    b.reap_kernels()
        else:
            print(f"no benchmark found under provided directory {args.single_benchmark if args.single_benchmark else args.multiple_benchmarks}")
        
        if args.auto_cleanup: 
            run_cleanup()
            

if __name__ == "__main__":
    main()