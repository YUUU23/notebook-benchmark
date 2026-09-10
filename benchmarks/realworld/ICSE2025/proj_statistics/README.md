# proj_statistics
https://github.com/xlab-uiuc/cloudtest/blob/main/projects_statistics/proj_statistics.ipynb

## Modifications

### m1 (direct assignment): cell 10
```python
# original
projects = ['alpakka','orleans_azure', 'durabletask', 'streamstone']

# modified
projects = ['alpakka','orleans_azure', 'streamstone']
```

### m2 (direct assignment): cell 5
```python
# original
projects = ['alpakka','orleans_azure','identityazuretable','ironpigeon','sleet','attachmentplugin', 'insights', 'durabletask', 'streamstone']

# modified
projects = ['alpakka','orleans_azure','identityazuretable','ironpigeon','sleet','attachmentplugin', 'durabletask', 'streamstone']
```

### m3 (mutation): new cell inserted after cell 3
```python
projects.remove("alpakka")
```
