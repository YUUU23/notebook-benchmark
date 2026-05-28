# GGAE-public
Original notebook from ICML '24 paper: Graph Geometry-Preserving Autoencoders
[Github](https://github.com/JungbinLim/GGAE-public/blob/main/notebook/01_RotatingMNIST_dataset_generation.ipynb)

## Modifications
Added a new cell to show diffs for all notebook variations. 

### m1: direct assignment
[Dir](./parameter-change)
```python
# original cell 4
EPISODES_PER_IMAGE = 1

# modified
EPISODES_PER_IMAGE = 3
```
ipyflow reruns all cells (1-7) where only cell 3-7 is necessary.

### m2: in-place mutation
[Dir](./change-scope)
To make sure the diff is not from torch randomness, additional `torch.manual_seed(0)` is added to both original and modified notebook.
```python
# original cell 5
for i_idx in trange(data.shape[0]):
    theta_init = torch.rand(()) * 360
    for j_idx in range(data.shape[-1]):
        theta = theta_init.item() + ANGLE_STEP * j_idx
        data[i_idx, :, :, :, j_idx] = transforms.functional.affine(img=data[i_idx, :, :, :, j_idx], angle=theta, translate=[0, 0], scale=1., shear=0)

# modified
theta_init = torch.rand(()) * 360
for i_idx in trange(data.shape[0]):
    
    for j_idx in range(data.shape[-1]):
        theta = theta_init.item() + ANGLE_STEP * j_idx
        data[i_idx, :, :, :, j_idx] = transforms.functional.affine(img=data[i_idx, :, :, :, j_idx], angle=theta, translate=[0, 0], scale=1., shear=0)
```
ipyflow failed to rerun cell 6,7

### m3: in-place
[Dir](./in-place)
```python
# Add to end of Cell 5
data.add_(0.1)  # Shift all values up by 0.1
```
ipyflow failed to rerun any cell automatically but suggested rerun for cell 6,7.
