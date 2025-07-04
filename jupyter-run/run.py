from utils.notebook_diff import get_all_cell_output_diff, get_first_cell_source_diff
from utils.notebook_manager import NotebookManager
import json, subprocess, os

class BenchmarkRunner:
    config_dir = None
    
    kernel_config_path = None
    jupyter_config_path = None
    mod_config_file = None
    default_mod_config_file_name = "mod_config_file.json"
    
    kernel_spec = None
    
    def __init__(self, config_dir: str):
        # Parse config files.
        self.config_dir = config_dir
        self._check_and_parse_config_files()
    
    def run(self, nb_original: str, nb_modified: str): 
        # Set up original notebook and modified notebook. 
        nb_original_manager = NotebookManager(nb_path=nb_original, 
                                              kernel_config=self.kernel_spec)
        nb_modified_manager = NotebookManager(nb_path=nb_modified, 
                                              kernel_config=self.kernel_spec) 
        
        # # Run original notebook, make modification, and save result notebook 
        # # with UI tool. 
        # # cell_idx, change = self.diff_checker.get_first_cell_source_diff()
        # cell_idx = 1 
        # change = 'a += "goodbye"'
        nb_reactive_file = f"reactive_results/{nb_original_manager.nb_file_name}" 
        # self._generate_ui_config_file(cell_idx, change, nb_original_manager.nb_file_name, nb_original_manager.nb_dir, nb_reactive_file) 
        # self._run_ui_to_execute_modifications() 
        
        # Run modified notebook once, save result notebook as expected 
        # and compare rerun modification with expected. 
        nb_expected = nb_modified_manager.nb_run_and_update_file(save_to_original=False) 
        nb_reactive_manager = NotebookManager(nb_path=nb_reactive_file, kernel_config=None)
        get_all_cell_output_diff(nb_actual=nb_reactive_manager.nb_obj, nb_expected=nb_expected)

    def _generate_ui_config_file(self, cell_idx: int, change: str, nb_to_modify_name: str, nb_to_modify_dir: str, save_result_to: str) -> None:
        modification = {"cellIndex": cell_idx, "source": change}
        file_info = {"benchmarkFileName": nb_to_modify_name, "benchmarkFileDir": nb_to_modify_dir}
        config = {"modification": modification, "file": file_info, "downloadResultTo": save_result_to}
        with open(self.mod_config_file, "w") as f:
            json.dump(config, f, indent=4)
        return config
        
    def _run_ui_to_execute_modifications(self) -> None: 
        script_path = "./ui/run_ui.sh"
        try:
            result = subprocess.run([script_path, self.jupyter_config_path], capture_output=True, text=True, check=True)
            print(f"Output from running {script_path}: {result.stdout}") 
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

b = BenchmarkRunner("./config")
nb_dir = "../benchmarks/py-built-in/string_concat/"
original_nb = nb_dir + "string_concat.ipynb"
modified_nb = nb_dir + "m_string_concat.ipynb"
b.run(original_nb, modified_nb)
            