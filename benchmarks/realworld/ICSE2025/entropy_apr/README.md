# entropy_apr
https://github.com/squaresLab/entropy-apr-replication/blob/main/analysis_notebooks/patch_analysis.ipynb

## Modifications

### m1 (reassignment): cell 7
```python
# original
patch_directory = "../entropy_apr_data/patches/patches_entropy_shibboleth"

# modified
patch_directory = "../entropy_apr_data/patches/patches_entropy_panther"
```

### m2 (mutation): new cell inserted after cell 2
```python
df.loc[df.index[:50], "entropy_delta"] = 0.0
```
