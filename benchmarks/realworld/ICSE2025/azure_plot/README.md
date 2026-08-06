# azure_plot
https://github.com/xlab-uiuc/cloudtest/blob/main/miscellaneous/cost_savings/Azure/plot.ipynb

## Modifications

### m1 (direct assignment): cell 10
```python
# original
apps = ['alpakka','orleans_azure', 'durabletask', 'streamstone']

# modified
apps = ['alpakka','orleans_azure', 'streamstone']
```

### m2 (mutation): new cell inserted after cell 2
```python
apps.remove('alpakka')
```
