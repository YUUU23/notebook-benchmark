# type4py_rq3
https://github.com/20001LastOrder/icse2025-type4py/blob/main/measurements/rq3.ipynb

## Modifications

### m1 (direct assignment): cell 3
```python
# original
def measure_result_classification(df, type_check_failed=False, typecheck=True, sample_weight=1, beta=1):

# modified
def measure_result_classification(df, type_check_failed=False, typecheck=True, sample_weight=2, beta=1):
```

### m2 (mutation): new cell inserted after cell 7
```python
setting_map.pop("great")
```
