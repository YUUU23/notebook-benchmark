# type4py_rq2
https://github.com/20001LastOrder/icse2025-type4py/blob/main/measurements/rq2.ipynb

## Modifications

### m1 (direct assignment): cell 14
```python
# original
betas = np.linspace(0.5, 3, 26)

# modified
betas = np.linspace(0.5, 3, 21)
```

### m2 (reassignment): cell 9
```python
# original
filename = setting_map["codebert"]

# modified
filename = setting_map["ggnn"]
```

### m3 (mutation): new cell inserted after cell 4
```python
setting_map.pop("great")
```
