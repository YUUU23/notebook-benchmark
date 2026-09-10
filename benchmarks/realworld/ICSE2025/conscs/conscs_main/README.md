# conscs_main
https://github.com/jinan789/ConsCS/blob/main/scripts/get_benchmark_results_main_comparison.ipynb

## Modifications

### m1 (reassignment): cell 7
```python
# original
log_path = "../conscs_data/logs/ours/our_logs_111_4.log"

# modified
log_path = "../conscs_data/logs/ours/our_logs_011_4.log"
```

### m2 (mutation): new cell inserted after cell 7
```python
all_circuit_stats[list(all_circuit_stats)[0]]["category"] = "large"
```
