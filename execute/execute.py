import nbformat
from nbconvert.preprocessors import ExecutePreprocessor
from jupyter_client.manager import KernelManager

class BenchmarkExecutor: 
    original_nb = None
    modified_nb = None
    
    kernel_name = None
    nb_kernel = None
    nb_km = None
    nb_kc = None
    check_kernel = None
    notebook_node = None 
    
    def __init__(self, original_nb_path, modified_nb_path, kernel_name) -> None:
        self.original_nb = original_nb_path
        self.modified_nb = modified_nb_path
        self.kernel_name = kernel_name
        self._set_up_kernels()
        self._shutdown()
    
    def run_benchmark(self) -> str:
        # self.clear_kernel()
        self.open_and_run_notebok(self.original_nb, self.nb_kernel, "execute_out.ipynb")
        self.open_and_run_cell("execute_out.ipynb", self.nb_kernel, "execute_out_2.ipynb")
        # original_nb_modified = self.make_code_modification_to_nb(self.original_nb, self.modified_nb)
        # self.run_notebok(original_nb_modified, self.nb_kernel)
        
        # self.run_notebok(self.modified_nb, self.check_kernel)
        # self.check_cell_output(self.modified_nb, self.original_nb)
        # self.get_cell_reran()
        self._shutdown()

    def open_and_run_notebok(self, nb_path, kernel_instance, nb_out_path): 
        with open(nb_path) as f:
            nb_in = nbformat.read(f, nbformat.NO_CONVERT)
        nb_out, _ = kernel_instance.preprocess(nb_in, km=self.nb_km) 
        with open(nb_out_path, 'w') as out_f:
            nbformat.write(nb_out, out_f)
        self.notebook_node = nb_out
    
    def open_and_run_cell(self, nb_path, kernel_instance, nb_out_path):
        # with open(nb_path) as f:
        #     nb_in = nbformat.read(f, nbformat.NO_CONVERT)

        for i, cell in enumerate(self.notebook_node.cells):
            print(i, cell)
            if i == 1: 
                cell.source = "a = '3' \nprint(a)"
                cell, _ = kernel_instance.preprocess_cell(cell, kernel_instance.resources, i)
                print(self.notebook_node.cells.outputs)
        with open(nb_out_path, 'w') as out_f:
            nbformat.write(self.notebook_node, out_f)

    def make_code_modification_to_notebook(original_nb, modification_nb):
        pass 
    
    def check_cell_output(actual_nb, expected_nb): 
        pass

    def get_cell_reran(): 
        pass

    def _set_up_kernels(self) -> None: 
        print("running")
        self.nb_km = KernelManager(kernel_name = "ipyflow")
        self.nb_km.start_kernel()
        self.nb_kc = self.nb_km.client()
        self.nb_kc.start_channels()
        self.nb_kc.wait_for_ready()

        self.nb_kc.execute("%flow toggle-reactivity")
        self.nb_kc.execute('a = 3 \nprint(a)')
        self.nb_kc.execute('a += 3 \nprint(a)')
        self.nb_kc.execute('a = 4 \nprint(a)')
        while True:
            try:
                kc_msg = self.nb_kc.get_iopub_msg(timeout=1)
                print(kc_msg)
                if 'content' in kc_msg and 'data' in kc_msg['content']:
                    print('the kernel produced data {}'.format(kc_msg['content']['data']))
                    break        
            except:
                print('timeout kc.get_iopub_msg')
                break
        
        # self.nb_kernel = ExecutePreprocessor(timeout=600)
        # self.check_kernel = ExecutePreprocessor(timeout=600, kernel_name=self.kernel_name)
    
    def _clear_kernel(self) -> None:
        pass
    
    def _shutdown(self) -> None:
        self.nb_kc.stop_channels()
        self.nb_km.shutdown_kernel()
