# forecasting-gmm
Original notebook from ICML '24 paper: QuEST: Stable Training of LLMs with 1-Bit Weights and Activations
[Github](https://github.com/IST-DASLab/QuEST/blob/main/notebooks/mse_fitting.ipynb)

## Changes made to the original notebook 

For precise diffs
- print statements that will produce undeterministic results (e.g., time) are commented out 

## Modifications

### plot
Dir: [plot](./plot)
**ipyflow** \
1. Run-all (execution count 1-7)
2. Direct assignment (m1): ipyflow reruns cell 2,3,4,5
```python
# original cell 3
for bits in [1, 2, 3, 4, 8]:

# modified
for bits in [1, 2, 4, 8]:
```
3. Direct assignment (m2): ipyflow reruns all cell (1-7)
```python
# original cell 1
def compute_mse(grid):
    q = [-np.inf] + [(grid[i] + grid[i+1]) / 2 for i in range(len(grid) - 1)] + [np.inf]  # Quantization boundaries

# modified
def compute_mse(grid):
    grid = np.asarray(grid, dtype=float)
    grid *= 1.05 # Add a 5% scaling perturbation to the grid
    
    q = [-np.inf] + [(grid[i] + grid[i+1]) / 2 for i in range(len(grid) - 1)] + [np.inf]  # Quantization boundaries
```
4. Direct assignment (m3): ipyflow reruns cell 4,5
```python
# original cell 4
N = 16  # You can change this value as needed

# modified
N = 8  # You can change this value as needed
```
5. Mutation (m4): ipyflow failed to rerun any cell
```python
# add additional cell between cell 4 and 5
GRID_MSES[6] = compute_mse(get_uniform_grid(2.05, 8))
```
