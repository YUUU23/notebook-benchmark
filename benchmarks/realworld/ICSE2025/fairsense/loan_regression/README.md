# loan_regression
https://github.com/cmu-soda/FairSense/blob/main/SensitivityAnalysis/LoanLending/loan_lending_regression.ipynb

## Modifications

### m1 (direct assignment): cell 6
```python
# original
lm = ols(formula="max_increase_unfairness_dp ~ (...)**2", data=data).fit()

# modified
lm = ols(formula="max_increase_unfairness_dp ~ (...)", data=data).fit()
```

### m2 (reassignment): cell 15
```python
# original
               agent + scale(utility_default))**2", data=sample_data_2).fit()

# modified
(see notebook)
```

### m3 (mutation): new cell inserted after cell 3
```python
data.loc[data.index[:10], 'score_change_repay'] = data['score_change_repay'].mean()
```
