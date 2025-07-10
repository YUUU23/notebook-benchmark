#!/usr/bin/env python3
import argparse, os, subprocess, shutil
from pathlib import Path
from benchmark_runner import BenchmarkRunner
    

def run_benchmarks(b: BenchmarkRunner, name:str, 
                   original_nb_path: str, modified_nb_path: str, 
                   data_directory: str): 
    """
    Run single benchmark with benchmark runner. 
    """
    print(f"============================ ")
    print(f"=== [RUN] RUNNING {name} === ")
    try: 
        b.run(original_nb_path, modified_nb_path, data_directory)
    except Exception as e:
        print(f"Failed to run benchamrk {name}, with files {original_nb_path} and {modified_nb_path}, {e}")
    print(f"=== [RUN] COMPLETE RUNNING {name} ===")
    print(f"============================ ")
    print('\n')
        
def validate_benchmark_directory(directory: str) -> tuple[str, str, str]:
    """
    Given valid benchmark directory, return suggested name to original notebook 
    and modified notebook file paths 
    if the benchmark directory contains valid files only.  
    
    A valid benchmark directory looks like, 
    list_concat.ipynb and m_list_concat.ipynb, 
    this function will return [list_concat, [list_concat.ipynb, m_list_concat.ipynb]].
    """
    file_names = []
    file_paths = {}
    nb_extension = ".ipynb"
    modification_prefix = "m_"
    
    for f in os.listdir(directory): 
        file_path = f"{directory}{f}"
        if not Path(file_path).is_file(): 
            raise IOError(f"{file_path} is not a file")
        if not f.endswith(nb_extension): 
            raise IOError(f"{f} is not a {nb_extension} notebook file")
        name = f.split(".")[0]
        file_names.append(name)
        file_paths[name] = file_path
    
    if len(file_names) != 2:
        raise IOError(f"{directory} should contain notebook file and modification notebook file. Recieved: {file_names}")
    
    for f_name in file_names: 
        if not f_name.startswith(modification_prefix): 
            if not f"m_{f_name}" in file_names:
                raise IOError(f"{file_names} does not contain original notebook file and modification notebook file prefix with {modification_prefix}")
            return [f_name] + [file_paths[f_name], file_paths[f'm_{f_name}']]

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
            spawn_ui_kernel = args.start_ui_kernel
            b = BenchmarkRunner(args.config, spawn_ui_kernel=spawn_ui_kernel)
            for name, original_nb_path, modified_nb_path in benchmark_to_run: 
                # print("name: ", name, "original_nb: ", original_nb_path, "modified_nb: ", modified_nb_path)
                run_benchmarks(b, name, original_nb_path, modified_nb_path, data_directory)
        else:
            print(f"no benchmark found under provided directory {args.single_benchmark if args.single_benchmark else args.multiple_benchmarks}")
        
        if args.auto_cleanup: 
            run_cleanup()
            

if __name__ == "__main__":
    main()