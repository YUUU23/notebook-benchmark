from execute import BenchmarkExecutor

original_nb_path = "../benchmarks/py-built-in/string_concat.ipynb"
modified_nb_path = ""
kernel_name = "echo"
executor = BenchmarkExecutor(original_nb_path, modified_nb_path, kernel_name) 
# executor.run_benchmark()
