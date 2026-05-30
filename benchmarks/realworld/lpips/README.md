# dgm_ood_detection
A Geometric Explanation of the Likelihood OOD Detection Paradox (ICML '24)
[lpips.ipynb](https://github.com/layer6ai-labs/dgm_ood_detection/blob/main/notebooks/lpips.ipynb)

## Modification
Fixed seed added to both cell 4 and 7 for reproducible results.

### m1: in-place tensor operation
```python
# new cell after cell 3
svhn_batch.clamp_(0, 0.5)
```
Expected: {3, new cell, 4}
ipyflow does not rerun any cell automatically and suggest 4. Rerunning cell 4 triggers rerunning cell 2-8 as well.

### m2: mutate via function
```python
# new cell after cell 3
def normalize(tensor):
    tensor.sub_(tensor.mean()).div_(tensor.std())

normalize(svhn_batch)
```
Expected: {3, new cell, 4}
ipyflow does not rerun any cell automatically and suggest 4. Rerunning cell 4 triggers rerunning cell 2-8 as well.