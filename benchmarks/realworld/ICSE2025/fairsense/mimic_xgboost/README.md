# mimic_xgboost
https://github.com/cmu-soda/FairSense/blob/main/Simulation/OpioidRisk/mimic-model/opioid_XGBoost_model.ipynb

## Modifications

### m1 (direct assignment): cell 12
```python
# original
n_estimators=200,

# modified
n_estimators=100,
```

### m2 (reassignment): cell 14
```python
# original
probas_ = model_cpu.predict_proba(test_features)
fpr, tpr, thresholds = roc_curve(test_labels, probas_[:, 1])
auc = roc_auc_score(test_labels, probas_[:, 1])

# modified
probas_ = model_cpu.predict_proba(vali_features)
fpr, tpr, thresholds = roc_curve(vali_labels, probas_[:, 1])
auc = roc_auc_score(vali_labels, probas_[:, 1])
```

### m3 (mutation): new cell inserted after cell 9
```python
train_labels.iloc[:100] = 0
```
