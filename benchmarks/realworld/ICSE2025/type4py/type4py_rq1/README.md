# type4py_rq1
https://github.com/20001LastOrder/icse2025-type4py/blob/main/measurements/rq1.ipynb

## Modifications

### m1 (direct assignment): cell 3
```python
# original
def get_error_types(error_msgs, errors_counts=4):

# modified
def get_error_types(error_msgs, errors_counts=3):
```

### m2 (mutation): new cell inserted after cell 12
```python
error_counts_synthetic_1[0] = error_counts_synthetic_1[0] + 100
```
