# cost_savings
https://github.com/xlab-uiuc/cloudtest/blob/main/cost_savings/calculations.ipynb

## Modifications

### m1 (direct assignment): cell 2
```python
# original
projects = ['streamstone', 'orleans','identityazuretable', 'insights', 'durabletask']

# modified
projects = ['streamstone', 'orleans','identityazuretable', 'durabletask']
```

### m2 (mutation): new cell inserted after cell 2
```python
projects.pop()
```
