# police_regression
https://github.com/cmu-soda/FairSense/blob/main/SensitivityAnalysis/PredictivePolicing/police_regression.ipynb

## Modifications

### m1 (direct assignment): cell 5
```python
# original
lm = ols('max_increase_unfairness_rln ~ (scale(hot_spot_discover_rate) + scale(non_hot_spot_discover_rate) + scale(hot_spot_effect_size))**2', data=data).fit()

# modified
lm = ols('max_increase_unfairness_rln ~ (scale(hot_spot_discover_rate) + scale(non_hot_spot_discover_rate) + scale(hot_spot_effect_size))', data=data).fit()
```

### m2 (reassignment): cell 12
```python
# original
lm_2 = ols('max_increase_unfairness_rln ~ (scale(hot_spot_discover_rate) + scale(non_hot_spot_discover_rate) + scale(hot_spot_effect_size))**2', data=sample_data_2).fit()

# modified
lm_2 = ols('max_increase_unfairness_rln ~ (scale(hot_spot_discover_rate) + scale(non_hot_spot_discover_rate) + scale(hot_spot_effect_size))**2', data=data).fit()
```

### m3 (mutation): new cell inserted after cell 3
```python
data.loc[data.index[:10], 'hot_spot_discover_rate'] = data['hot_spot_discover_rate'].mean()
```
