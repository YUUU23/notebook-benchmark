# conscs_contrib
https://github.com/jinan789/ConsCS/blob/main/scripts/get_benchmark_results_withcontribution_plus_misc.ipynb

## Modifications

### m1 (reassignment): cell 3
```python
# original
our_results = get_contribution_results_from_logs(log_path)

# modified
our_results = get_contribution_results_from_logs(log_path)
our_results = {k: v for k, v in our_results.items() if not k.startswith("Pedersen")}
```

### m2 (mutation): new cell inserted after cell 8
```python
all_circuit_stats[list(all_circuit_stats)[0]]["category"] = "large"
```
