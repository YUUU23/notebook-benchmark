# nsda_study
https://github.com/UTD-FAST-Lab/NDSAStudy/blob/main/code/NDDetector/scripts/notebooks/graphs.ipynb

## Modifications

### m1 (direct assignment): cell 2
```python
# original
df['%consistent_result'] = df['%consistent_result'] * 100

# modified
df['%consistent_result'] = df['%consistent_result'] * 10
```

### m2 (mutation): new cell inserted after cell 2
```python
df.loc[df['tool'] == 'pycg', '%consistent_result'] = 50
```
