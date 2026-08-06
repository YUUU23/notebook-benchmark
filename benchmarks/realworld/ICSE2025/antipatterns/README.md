# antipatterns
https://github.com/nabsonp/ICSE-2025/blob/main/Statistical_tests.ipynb

## Modifications

### m1 (direct assignment): cell 3
```python
# original
'Mega Frontend': [7, 6, 7, 7, 5, 9, 9, 5, 7, 6, 6, 6, 7, 9, 10, 8, 7, 9, 10, 9],

# modified
# line removed
```

### m2 (mutation): new cell inserted after cell 3
```python
df_melted_harmfulness_scores.loc[:19, 'Harmfulness'] = 10
```
