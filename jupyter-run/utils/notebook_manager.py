import nbformat, os
from nbconvert.preprocessors import ExecutePreprocessor
from typing import Optional, Any

class NotebookManager:
    nb_dir = None 
    nb_file_name = None 
    nb_path = None
    nb_json = None
    ep = None
    kernel_spec = None
    
    def __init__(self, nb_path: str, kernel_config: Optional[dict[str, Any]] = None, set_up_processor: bool = True): 
        # Read in notebook. 
        self.nb_path = nb_path
        if not self._validate_path(): 
            raise FileExistsError()
        self.nb_dir = os.path.dirname(self.nb_path)
        self.nb_file_name = os.path.basename(self.nb_path)
        self._read_nb_from_ipynb()

        # Change kernel of notebook. 
        self.kernel_spec = kernel_config
        if self.kernel_spec: 
            self._change_kernel_spec()
        
        # Set-up notebook executor. 
        if set_up_processor and kernel_config: 
            self.ep = self._setup_nb_executor(kernel_name=self.kernel_spec["name"])
    
    def nb_run(self, save_to_original_file: bool = True) -> str:
        if self.ep: 
            nb_res = self.ep.preprocess(self.nb_json)
            if save_to_original_file: 
                self.nb_json = nb_res
                self._write_nb_to_ipynb()
                return None 
            else:
                return nb_res[0]
    
    def delete_last_empty_cell(self) -> str: 
        nb_json_cells = self.nb_json["cells"]
        code_cells = [c for c in nb_json_cells if c["cell_type"] == "code"] 
        if code_cells: 
            last_cell = code_cells[-1]
            if last_cell["execution_count"] == None and len(last_cell["outputs"]) == 0:
                self.nb_json = nb_json_cells[:-1]
    
    def _change_kernel_spec(self) -> bool: 
        if self.kernel_spec:
            self.nb_json['metadata']['kernelspec'] = self.kernel_spec
            self._write_nb_to_ipynb() 
            print(f"=== [RUN] Changing kernel of {self.nb_path} to {self.kernel_spec['name']}")
            return True 
        return False
    
    def _read_nb_from_ipynb(self) -> None: 
        with open(self.nb_path) as ff:
            nb_in = nbformat.read(ff, nbformat.NO_CONVERT)
            self.nb_json = nb_in
    
    def _write_nb_to_ipynb(self) -> None: 
        with open(self.nb_path, 'w') as f:
            nbformat.write(self.nb_json, f)
        
    def _validate_path(self) -> bool:   
        return os.path.exists(self.nb_path)

    def _setup_nb_executor(self, kernel_name: Optional[str] = None) -> ExecutePreprocessor: 
        if kernel_name:
            return ExecutePreprocessor(timeout=600, kernel_name=kernel_name)
        else:
            return ExecutePreprocessor(timeout=600)
