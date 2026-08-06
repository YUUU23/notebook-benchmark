# opioid_regression
https://github.com/cmu-soda/FairSense/blob/main/SensitivityAnalysis/OpioidRisk/opioid_risk_regression.ipynb

## Modifications

### m1 (direct assignment): cell 7
```python
# original
lm = ols('max_increase_unfairness_risk ~ (model + scale(threshold) + n_hosp_mode + n_prescription_mode)**2', data=data).fit()

# modified
lm = ols('max_increase_unfairness_risk ~ (model + scale(threshold) + n_hosp_mode + n_prescription_mode)', data=data).fit()
```

### m2 (reassignment): cell 13
```python
# original
lm_2 = ols('max_increase_unfairness_risk ~ (model + scale(threshold) + n_hosp_mode + n_prescription_mode)**2', data=sample_data_2).fit()

# modified
lm_2 = ols('max_increase_unfairness_risk ~ (model + scale(threshold) + n_hosp_mode + n_prescription_mode)**2', data=data).fit()
```

### m3 (mutation): new cell inserted after cell 3
```python
data.loc[data.index[:10], 'threshold'] = data['threshold'].mean()
```
