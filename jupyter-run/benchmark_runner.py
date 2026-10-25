from utils.notebook_diff import get_all_cell_output_diff, get_cells_reran, detect_modification, relabel_reran_positions, rerun_labels_to_abs_indices, get_code_cells
from utils.notebook_manager import NotebookManager
from utils.supporting_scripts import find_supporting_scripts, find_data_dependencies
import json, subprocess, os, time, urllib.request

class BenchmarkRunner:
    config_root_dir = "./config"
    config_dir = None
    playwright_config_path = None
    kernel_config_path = None
    jupyter_config_path = None
    mod_config_file = None
    default_mod_config_file_name = "mod_config_file.json"
    kernel_spec = None
    
    def __init__(self, config_dir: str, spawn_ui_kernel: bool = True):
        self.config_dir = config_dir
        # Pin the Galata server root_dir to a fixed dir on the repo filesystem.
        # Galata otherwise defaults it to a fresh mkdtemp("galata-test-") (often
        # tmpfs, and an unpredictable path each launch). A fixed path lets
        # _stage_oversize_data locate notebook-test AND hardlink into it (source
        # data and the staging target must share a filesystem). Honor an
        # external override. The env var must be set before the server launches
        # so its child (ui_setup.sh) inherits it. See configure_jupyter_server.
        self.ui_root_dir = os.environ.setdefault(
            "JUPYTERLAB_GALATA_ROOT_DIR", os.path.abspath("galata-root"))
        os.makedirs(self.ui_root_dir, exist_ok=True)
        self._check_and_parse_config_files()
        if spawn_ui_kernel:
            self._setup_ui_kernel()
    
    def run(self, nb_original: str, nb_modified: str, data_directory: str,
            rerun_set: str = None):
        """
        1. Set up original notebook and modified notebook.
        2. Identify modification.
        3. Run with UI tool for reactive notebok result.
        4. Compare reactive notebook result to modiied notebook result ran
        with a fresh kernel.

        rerun_set is the python3 baseline's manual rerun set (results-sheet
        column D, e.g. "n,2,3"); when given, its labels are translated to absolute
        cell indices in the modified notebook and passed to the UI so the baseline
        reruns exactly those cells. Ignored (None) for the reactive kernels, which
        cascade on their own.
        """
        nb_original_manager = NotebookManager(nb_path=nb_original, 
                                              kernel_config=self.kernel_spec)
        nb_modified_manager = NotebookManager(nb_path=nb_modified, 
                                              kernel_config=self.kernel_spec) 
        
        mod = detect_modification(nb_original_manager.nb_json, nb_modified_manager.nb_json)
        code_idx_print = mod.code_idx + 1
        abs_idx_print = mod.abs_idx + 1
        print(f"=== [RUN] Detected modification: op={mod.op} at code-cell {code_idx_print} "
              f"(abs cell {abs_idx_print}) with cell ID: {mod.cell_id}")
        if mod.op == "edit":
            print(f"=== [RUN] Code of original cell {code_idx_print}: \n{mod.original}")
            print(f"=== [RUN] Code to be changed into cell {code_idx_print}: \n{mod.source}")
        elif mod.op == "add":
            print(f"=== [RUN] Code of cell to be added at cell {code_idx_print}: \n{mod.source}")
        elif mod.op == "delete":
            print(f"=== [RUN] Code of cell to be deleted at cell {code_idx_print}: \n{mod.original}")
        if mod.op != "none":
            # Key result files by the MODIFIED notebook name (unique per step, e.g.
            # m2_explore_siren.ipynb) so a step's download never collides with, or
            # reads back, another step's file. The UI still uploads/runs the ORIGINAL
            # notebook -- these are only the download destinations.
            nb_initial_file = f"reactive-results/initial/{nb_modified_manager.nb_file_name}"
            nb_reactive_file = f"reactive-results/reactive/{nb_modified_manager.nb_file_name}"
            supporting_scripts = find_supporting_scripts(nb_original_manager.nb_json, nb_original_manager.nb_dir)
            # Also stage relative data files the notebook reads (e.g. ./data/x),
            # which break once the notebook is uploaded to a fresh temp dir.
            # Over-cap dirs (too big for per-file HTTP upload) come back in
            # oversize_data_deps for filesystem (hardlink) staging below.
            oversize_data_deps: list[dict] = []
            supporting_scripts += find_data_dependencies(
                nb_original_manager.nb_json, nb_original_manager.nb_dir,
                exclude={s["sourcePath"] for s in supporting_scripts},
                oversize_out=oversize_data_deps,
            )
            rerun_cell_indices = []
            if rerun_set:
                rerun_cell_indices = rerun_labels_to_abs_indices(
                    rerun_set, mod.op, mod.code_idx, nb_modified_manager.nb_json)
                print(f"=== [RUN] python3 baseline rerun set (col D) {rerun_set!r} "
                      f"-> absolute cell indices {rerun_cell_indices}")
            self._generate_ui_config_file(mod, nb_original_manager.nb_file_name,
                                          nb_original_manager.nb_dir, nb_reactive_file, nb_initial_file,
                                          data_directory, supporting_scripts,
                                          rerun_cell_indices)
            # Remove any stale result files from a prior run of THIS step so a UI
            # failure (e.g. a timeout) surfaces as ERROR on the missing-file read
            # below instead of silently reporting the previous run's numbers.
            for stale in (nb_initial_file, nb_reactive_file):
                if os.path.exists(stale):
                    os.remove(stale)
            # Hardlink over-cap data dirs into the server working dir so the
            # uploaded notebook can read them (the spec only HTTP-uploads the
            # under-cap files). Done just before the UI run; the spec's afterAll
            # deleteDirectory() unlinks them afterwards, so re-stage each step.
            self._stage_oversize_data(oversize_data_deps)
            self._run_ui_to_execute_modifications()

            nb_initial_run_manager = NotebookManager(nb_path=nb_initial_file)
            nb_after_reactive_manager = NotebookManager(nb_path=nb_reactive_file)
            nb_after_reactive_manager.delete_last_empty_cell()

            # Reran cells needs only the initial + reactive notebooks, so compute
            # and print it FIRST -- this drives the reactive-kernel reran column
            # (G for nnb / J for ipyflow) and must survive even if
            # the (heavier) expected-output run or the fragile output diff below
            # fails. Realworld notebooks with added/idless/output-less cells make
            # get_all_cell_output_diff / nb_run raise; isolate those so a
            # correctness-diff failure never costs us the reran + wall-time data.
            print(f"=== [RUN] PRINTING CELLS EXECUTED:")
            try:
                reran_count, total_cells, cells_reran = get_cells_reran(nb_initial_run_manager.nb_json, nb_after_reactive_manager.nb_json)
                # Report in ORIGINAL numbering: added cell -> "n", originals keep
                # their pre-modification positions.
                labels = relabel_reran_positions(cells_reran, mod.op, mod.code_idx)
                mod_cell_label = "n" if mod.op == "add" else code_idx_print
                # nnb runs the modified/added cell FIRST (the trigger), then runs a
                # one-shot, de-duplicated reactive cascade. get_cells_reran orders by
                # each cell's FINAL execution count, so for nnb that ordering equals
                # the true execution order and only the trigger can appear twice.
                # Reconstruct the faithful sequence WITHOUT blindly prepending:
                #   - if the trigger re-ran inside the cascade (its reactive exec
                #     count exceeds the baseline), it lands at its cascade slot in
                #     `labels` and is missing only its leading trigger run -> prepend
                #     it (e.g. [7, 6,7,8,...]).
                #   - if it ran only once (exec count == baseline), it is already the
                #     first entry in the count-ordered `labels` -> do NOT prepend, or
                #     it would be double-counted (e.g. [4, 6,7,...], not [4,4,...]).
                # Reactive kernels that refresh ancestors first (ipyflow) keep the
                # plain count-ordered list. reran_count stays the unique-cell count.
                kernel_name = (self.kernel_spec or {}).get("name", "")
                if kernel_name == "nnb" and mod.op in ("edit", "add"):
                    initial_counts = [c.get("execution_count")
                                      for c in get_code_cells(nb_initial_run_manager.nb_json)
                                      if isinstance(c.get("execution_count"), int)]
                    baseline = max(initial_counts, default=0) + 1
                    reactive_code = get_code_cells(nb_after_reactive_manager.nb_json)
                    trigger_ec = (reactive_code[mod.code_idx].get("execution_count")
                                  if 0 <= mod.code_idx < len(reactive_code) else None)
                    if isinstance(trigger_ec, int) and trigger_ec > baseline:
                        labels = [mod_cell_label] + labels
                reran_str = "[" + ", ".join(str(x) for x in labels) + "]"
                print(f"=== [RUN] {reran_count} / {total_cells} cells reran; reran cells are: {reran_str}; modification ({mod.op}) made to cell: {mod_cell_label}")
            except Exception as e:
                print(f"=== [RUN] WARNING: cells-reran computation failed: {e}")

            # Correctness diff is best-effort and must not abort the step.
            try:
                nb_expected_json = nb_modified_manager.nb_run(save_to_original_file=False)
                print("=== [RUN] PRINTING DIFF: ")
                print(get_all_cell_output_diff(nb_actual=nb_after_reactive_manager.nb_json, nb_expected=nb_expected_json))
            except Exception as e:
                print(f"=== [RUN] WARNING: correctness diff skipped: {e}")
        else:
            print(f'notebooks is not different after modification; no rerun will trigger')
    

    def _setup_ui_kernel(self):
        script_path = "./ui/ui_setup.sh"
        try:
            print("=== [SETUP] Executing UI SETUP script")
            subprocess.run([script_path, self.jupyter_config_path], capture_output=False, text=False, check=False)
            # print(f"Output from running {script_path}: {result.stdout}")
            self._wait_for_jupyter_server()
        except subprocess.CalledProcessError as e:
            print(f"Error executing ui script: {e} \n {e.stderr}")

    def _wait_for_jupyter_server(self, url: str = "http://localhost:8888/lab", timeout: float = 30.0) -> None:
        """ui_setup.sh backgrounds `jupyter lab &` and returns immediately,
        before the server has actually finished starting. Without this wait,
        Playwright's webServer.reuseExistingServer check can race ahead of it,
        find nothing responding yet, and start its own server on the same
        port -- which then fails with "port already in use" once this server
        finishes binding a moment later ("Process from config.webServer was
        not able to start. Exit code: 1")."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                urllib.request.urlopen(url, timeout=2)
                print(f"=== [SETUP] Jupyter server responding at {url}")
                return
            except Exception:
                # Anything here (connection refused, timeout, ...) just means
                # "not ready yet" -- keep polling until the deadline.
                time.sleep(0.5)
        print(f"=== [SETUP] WARNING: Jupyter server did not respond at {url} within {timeout}s")
         
    def reap_kernels(self, base_url: str = "http://localhost:8888") -> None:
        """Shut down every kernel on the shared Jupyter server.

        The server started by _setup_ui_kernel is reused for the whole suite, but
        the Playwright test (ui/autotest.spec.ts) never shuts down the kernel it
        spawns per notebook -- its afterAll only deletes uploaded files. Without
        this, each benchmark leaves a fully-populated kernel resident (up to several
        GB), memory grows across benchmarks, and the run gets OOM-killed. Called at
        each benchmark-step boundary (main.py) so at most ~1 kernel stays resident.
        Best-effort: a failed reap must never abort the run.
        """
        try:
            with urllib.request.urlopen(f"{base_url}/api/kernels", timeout=10) as resp:
                kernels = json.load(resp)
        except Exception as e:
            print(f"=== [RUN] WARNING: could not list kernels to reap: {e}")
            return
        reaped = 0
        for k in kernels:
            kid = k.get("id")
            if not kid:
                continue
            try:
                req = urllib.request.Request(f"{base_url}/api/kernels/{kid}", method="DELETE")
                urllib.request.urlopen(req, timeout=10)
                reaped += 1
            except Exception as e:
                print(f"=== [RUN] WARNING: failed to reap kernel {kid}: {e}")
        print(f"=== [RUN] REAPED {reaped} kernels")

    def _generate_ui_config_file(self,
                                 mod,
                                 nb_to_modify_name: str,
                                 nb_to_modify_dir: str,
                                 save_reactive_result_to: str,
                                 save_initial_result_to: str,
                                 data_directory: str,
                                 supporting_scripts: list = None,
                                 rerun_cell_indices: list = None) -> None:
        # cellIndex is the ABSOLUTE JupyterLab cell index (markdown included),
        # which is what the Galata helpers in the UI spec address by. op tells
        # the spec whether to edit in place, insert, or delete the cell.
        # rerunCellIndices (absolute indices, ascending) is the python3 baseline's
        # explicit rerun set; only that spec reads it, reactive specs ignore it.
        modification = {"op": mod.op, "cellIndex": mod.abs_idx, "source": mod.source,
                        "rerunCellIndices": rerun_cell_indices or []}
        benchmark_file_info = {"benchmarkFileName": nb_to_modify_name, "benchmarkFileDir": nb_to_modify_dir}
        config = {"modification": modification, "file": benchmark_file_info,
                  "downloadReactivePath": save_reactive_result_to,
                  "downloadInitialPath": save_initial_result_to,
                  "dataDirectory": data_directory,
                  "supportingScripts": supporting_scripts or []}
        with open(self.mod_config_file, "w") as f:
            json.dump(config, f, indent=4)
        return config
    
    def _stage_oversize_data(self, oversize_deps: list[dict]) -> None:
        """Hardlink over-HTTP-cap data dependencies into the server working dir.

        The spec uploads the notebook under tmpPath "notebook-test" relative to
        the server root_dir (pinned to self.ui_root_dir in __init__), and the
        kernel's cwd is that notebook dir -- so the notebook's ``./data`` paths
        resolve to <root_dir>/notebook-test. The spec's beforeAll only
        HTTP-uploads under-cap files; large dirs (e.g. the 655MB
        llm-elicited-priors results) would be prohibitively slow to upload one
        file at a time, so hardlink them instead -- same filesystem, instant, no
        extra space. The spec's afterAll deleteDirectory() unlinks these copies
        (the SOURCE data is untouched); re-staged each step.
        """
        tmp_dir = os.path.join(self.ui_root_dir, "notebook-test")
        for dep in oversize_deps:
            src = dep["sourcePath"]
            dst = os.path.normpath(os.path.join(tmp_dir, dep["targetRelPath"]))
            if not os.path.exists(src):
                print(f"=== [RUN] WARNING: oversize data dep source missing: {src}")
                continue
            if os.path.exists(dst):
                subprocess.run(["rm", "-rf", dst], check=False)
            os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
            # cp -al: recursive hardlink copy (requires src+dst on one filesystem).
            res = subprocess.run(["cp", "-al", src, dst], capture_output=True, text=True)
            if res.returncode != 0:
                print(f"=== [RUN] WARNING: hardlink staging failed for "
                      f"{dep['targetRelPath']}: {res.stderr.strip()}; copying instead")
                subprocess.run(["cp", "-a", src, dst], check=False)
            else:
                print(f"=== [RUN] filesystem-staged {dep['targetRelPath']} -> {dst}")

    # Bound the UI run above the 20-min Playwright per-test timeout (+ up to 2-min
    # webServer startup) so a stuck run fails loudly instead of freezing forever.
    ui_run_timeout_s = 25 * 60

    def _run_ui_to_execute_modifications(self) -> None:
        script_path = "./ui/run_ui.sh"
        # Inherit the parent's stdout/stderr (no capture) so the Playwright/[UI] output
        # streams live into the run log; a hang is then visible instead of silent.
        try:
            subprocess.run([script_path, self.playwright_config_path],
                           check=True, timeout=self.ui_run_timeout_s)
        except subprocess.TimeoutExpired:
            print(f"=== [RUN] ERROR: {script_path} timed out after "
                  f"{self.ui_run_timeout_s}s (config {self.playwright_config_path})")
        except subprocess.CalledProcessError as e:
            print(f"=== [RUN] ERROR: {script_path} exited {e.returncode}")
    
    def _check_and_parse_config_files(self): 
        dir_path = self.config_dir
        for file in os.listdir(dir_path):
            path = f"{self.config_dir}/{file}"
            if "jupyter" in file:
                self.jupyter_config_path = path
            elif "playwright" in file:
                self.playwright_config_path = path
            elif "kernel" in file:
                self.kernel_config_path = path
                self._get_kernelspec()  # Read and set kernel spec. 
            elif "mod" in file:
                self.mod_config_file = f"{self.config_root_dir}/{file}"
        
        if self.mod_config_file == None:
            self.mod_config_file = f"{self.config_root_dir}/{self.default_mod_config_file_name}"
        
        if self.jupyter_config_path == None or self.kernel_config_path == None or self.mod_config_file == None:
            raise FileNotFoundError(f"config file not sufficient, jupyter: {self.jupyter_config_path}, kernel: {self.kernel_config_path}")
    
    def _get_kernelspec(self) -> None: 
        with open(self.kernel_config_path, 'r') as f:
            config = json.load(f)
            self.kernel_spec = config['kernelspec']