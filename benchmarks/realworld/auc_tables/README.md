# dgm_ood_detection 
"A Geometric Explanation of the Likelihood OOD Detection Paradox" (ICML 2024)
[Github](https://github.com/layer6ai-labs/dgm_ood_detection/tree/main/notebooks)

## auc_tables.ipynb

**m1: modification to global variable**
```python
# original cell 1
def get_scatter(in_distr, ood, type, all_tasks): 
    global likelihood_generated, lid_generated
    likelihood_generated = in_vs_out[in_vs_out['name'] == 'generated']['log-likelihood'].values
    ...

# modified
def get_scatter(in_distr, ood, type, all_tasks): 
    global likelihood_generated, lid_generated
    likelihood_generated = in_vs_out[in_vs_out['name'] == 'generated']['log-likelihood'].values.copy()
    likelihood_generated *= 1.25
    ...
```

ipflow rerun 1,3,4.

**m2: deeply nested dict mutation**
```python
# added cell before cell 4
all_tasks['grayscale']['mnist']['emnist']['log-likelihood'] *= -1
```

ipyflow does not rerun any cell automatically but suggest cell 4. 

**m3?: modification to the .py file that defined locally**
Even with `%load_ext autoreload`, ipyflow does not detect changes to locally defined modules like `utils`.

## 