# energydebug
https://github.com/enriquebarba97/EnergyDebug/blob/main/energydebug.ipynb

## Modifications

### m1 (direct assignment): cell 3
```python
# original
fig, ax = plt.subplots(figsize=[20,12])

# modified
fig, ax = plt.subplots(figsize=[18,12])
```

### m2 (reassignment): cell 6
```python
# original
alpine_power = dataframes["alpinejem"].norm_dfs["median"]["CPU_POWER (Watts)"].iloc[time]

# modified
alpine_power = dataframes["alpinemusl"].norm_dfs["median"]["CPU_POWER (Watts)"].iloc[time]
```

### m3 (mutation): new cell inserted after cell 20
```python
aggregate.drop(aggregate.index[:10], inplace=True)
```
