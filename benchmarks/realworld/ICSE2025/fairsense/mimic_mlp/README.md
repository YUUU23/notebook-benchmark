# mimic_mlp
https://github.com/cmu-soda/FairSense/blob/main/Simulation/OpioidRisk/mimic-model/opioid_MLP_pytorch.ipynb

## Modifications

### m1 (direct assignment): cell 14
```python
# original
acc = train_and_eval(model, train_loader, test_loader, optimizer, criterion, epochs=20)

# modified
acc = train_and_eval(model, train_loader, test_loader, optimizer, criterion, epochs=10)
```

### m2 (reassignment): cell 14
```python
# original
optimizer = optim.SGD(model.parameters(), 0.001)

# modified
optimizer = optim.Adam(model.parameters(), 0.001)
```

### m3 (mutation): new cell inserted after cell 12
```python
y_train[:100] = 0
```
