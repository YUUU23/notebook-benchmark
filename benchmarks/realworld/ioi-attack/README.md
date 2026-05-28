# ioi-attack
IOI: Invisible One-Iteration Adversarial Attack on No-Reference Image- and Video-Quality Metrics (ICML 2024)

[Github](https://github.com/katiashh/ioi-attack/blob/main/IOI_demo.ipynb)

## Modifications
In order to be able to run the original notebook, the following modifications are made to the baseline notebook.
1. Add monkey patch to torch load to always use weights_only=False
```python
# cell 2
original_load = torch.load
def patched_load(f, *args, **kwargs):
    kwargs['weights_only'] = False
    return original_load(f, *args, **kwargs)

torch.load = patched_load
```
2. Assume all packages are installed, so all `!pip install ...` cells are removed.
3. All cells in the `Evaluating on the NIPS 2017 dataset` section in the original notebook is removed due to missing data in `./nips_dataset/`

### m1: 
```python
# additional cell between cell 11 and 12
# change the order without reloading imgs again
ims.insert(0, ims[-1])
```
ipyflow failed to rerun any cell automatically and suggest running cell 13-18 after running cell 12. 

### m2: external state dep
```python
# additional cell before cell 11
# to use previously downloaded image to ./img/ dir
import os
if os.path.exists('Picture1.jpg'):
    shutil.move('Picture1.jpg', './img/Picture1.jpg')
```
ipyflow failed to rerun any cell automatically
