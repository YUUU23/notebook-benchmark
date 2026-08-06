# chaomi_rq4_figgen
https://github.com/niMgnoeSeeL/ChaoMI/blob/main/notebook/RQ4-figgen.ipynb

## Modifications

### m1 (direct assignment): cell 2
```python
# original
mi_ground_truth = 3.2198044418207257

# modified
mi_ground_truth = 3.0
```

### m2 (reassignment): cell 3
```python
# original
data_path = "../chaomi_data/data-LocPrivacy/mi-opt.csv"

# modified
data_path = "../chaomi_data/data-LocPrivacy/mi-pg2.csv"
```

### m3 (mutation): new cell inserted after cell 3
```python
df.loc[0, "sample ratio"] = 0.5
```
