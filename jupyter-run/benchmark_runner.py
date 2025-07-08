from utils.notebook_diff import get_all_cell_output_diff, get_first_cell_source_diff, get_cells_reran
from utils.notebook_manager import NotebookManager
import json, subprocess, os

class BenchmarkRunner:
    config_dir = None
    kernel_config_path = None
    jupyter_config_path = None
    mod_config_file = None
    default_mod_config_file_name = "mod_config_file.json"
    kernel_spec = None
    
    def __init__(self, config_dir: str, spawn_ui_kernel: bool = True):
        self.config_dir = config_dir
        self._check_and_parse_config_files()
        if spawn_ui_kernel: 
            self._setup_ui_kernel()
    
    def run(self, nb_original: str, nb_modified: str): 
        """
        1. Set up original notebook and modified notebook. 
        2. Identify modification. 
        3. Run with UI tool for reactive notebok result. 
        4. Compare reactive notebook result to modiied notebook result ran 
        with a fresh kernel. 
        """
        nb_original_manager = NotebookManager(nb_path=nb_original, 
                                              kernel_config=self.kernel_spec)
        nb_modified_manager = NotebookManager(nb_path=nb_modified, 
                                              kernel_config=self.kernel_spec) 
        
        cell_idx, cell_id, change, original = get_first_cell_source_diff(nb_original_manager.nb_json, nb_modified_manager.nb_json)
        print(f"=== [RUN] Found source diff: at cell index: {cell_idx} with cell ID: {cell_id}")
        print(f"=== [RUN] Code of original cell {cell_idx}: \n{original}")
        print(f"=== [RUN] Code to be changed into cell {cell_idx}: \n{change}") 
        if cell_idx > -1:
            nb_initial_file = f"reactive-results/initial/{nb_original_manager.nb_file_name}"
            nb_reactive_file = f"reactive-results/reactive/{nb_original_manager.nb_file_name}" 
            self._generate_ui_config_file(cell_idx, change, nb_original_manager.nb_file_name, 
                                          nb_original_manager.nb_dir, nb_reactive_file, nb_initial_file) 
            self._run_ui_to_execute_modifications() 
        
            nb_initial_run_manager = NotebookManager(nb_path=nb_initial_file)
            nb_after_reactive_manager = NotebookManager(nb_path=nb_reactive_file)
            nb_after_reactive_manager.delete_last_empty_cell() 
            nb_expected_json = nb_modified_manager.nb_run(save_to_original_file=False) 
            
            print("=== [RUN] PRINTING DIFF: ")
            print(get_all_cell_output_diff(nb_actual=nb_after_reactive_manager.nb_json, nb_expected=nb_expected_json))
            
            print(f"=== [RUN] PRINTING CELLS EXECUTED:") 
            reran_count, total_cells, cells_reran = get_cells_reran(nb_initial_run_manager.nb_json, nb_after_reactive_manager.nb_json, cell_idx, cell_id)
            print(f"=== [RUN] {reran_count} / {total_cells} cells reran; reran cells are: {cells_reran}; modification made to cell: {cell_idx}")
        else:
            print(f'notebooks is not different after modification; no rerun will trigger')
    

    def _setup_ui_kernel(self):
        script_path = "./ui/ui_setup.sh"
        try:
            print("=== [SETUP] Executing UI SETUP script")
            subprocess.run([script_path, self.jupyter_config_path], capture_output=False, text=False, check=False)
            # print(f"Output from running {script_path}: {result.stdout}") 
        except subprocess.CalledProcessError as e:
            print(f"Error executing ui script: {e} \n {e.stderr}")
         
    def _generate_ui_config_file(self, 
                                 cell_idx: int, 
                                 change: str, 
                                 nb_to_modify_name: str,
                                 nb_to_modify_dir: str, 
                                 save_reactive_result_to: str, 
                                 save_initial_result_to: str) -> None:
        modification = {"cellIndex": cell_idx, "source": change}
        benchmark_file_info = {"benchmarkFileName": nb_to_modify_name, "benchmarkFileDir": nb_to_modify_dir}
        config = {"modification": modification, "file": benchmark_file_info, 
                  "downloadReactivePath": save_reactive_result_to, 
                  "downloadInitialPath": save_initial_result_to}
        with open(self.mod_config_file, "w") as f:
            json.dump(config, f, indent=4)
        return config
    
    def _run_ui_to_execute_modifications(self) -> None: 
        script_path = "./ui/run_ui.sh"
        try:
            subprocess.run([script_path], capture_output=True, text=True, check=True)
            # print(f"Output from running {script_path}: {result.stdout}") 
        except subprocess.CalledProcessError as e:
            print(f"Error executing ui script: {e} \n {e.stderr}")
    
    def _check_and_parse_config_files(self): 
        dir_path = self.config_dir
        for file in os.listdir(dir_path):
            path = f"{self.config_dir}/{file}"
            if "jupyter" in file:
                self.jupyter_config_path = path
            elif "kernel" in file:
                self.kernel_config_path = path
                self._get_kernelspec()  # Read and set kernel spec. 
            elif "mod" in file:
                self.mod_config_file = path
        
        if self.mod_config_file == None:
            self.mod_config_file = f"{self.config_dir}/{self.default_mod_config_file_name}"
        
        if self.jupyter_config_path == None or self.kernel_config_path == None or self.mod_config_file == None:
            raise FileNotFoundError(f"config file not sufficient, jupyter: {self.jupyter_config_path}, kernel: {self.kernel_config_path}")
    
    def _get_kernelspec(self) -> None: 
        with open(self.kernel_config_path, 'r') as f:
            config = json.load(f)
            self.kernel_spec = config['kernelspec']