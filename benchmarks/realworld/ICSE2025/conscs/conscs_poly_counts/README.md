# conscs_poly_counts
https://github.com/jinan789/ConsCS/blob/main/scripts/get_benchmark_results_poly_counts.ipynb

## Modifications

### m1 (direct assignment): cell 4
```python
# original
for type_folder in ["utils", "core"]:

# modified
for type_folder in ["utils"]:
```

### m2 (mutation): new cell inserted after cell 4
```python
all_d_counts.pop(max(all_d_counts))
```
