from run import BenchmarkRunner

b = BenchmarkRunner("./config", spawn_ui_kernel=False)
benchmark_names = ["loop_append_1", "list_pop"]
for b_name in benchmark_names: 
    print(f"=== RUNNING {b_name}")
    nb_benchmark_name = b_name
    nb_dir = f"../benchmarks/py-built-in/{nb_benchmark_name}/"
    original_nb = nb_dir + f"{nb_benchmark_name}.ipynb"
    modified_nb = nb_dir + f"m_{nb_benchmark_name}.ipynb"
    b.run(original_nb, modified_nb)
            