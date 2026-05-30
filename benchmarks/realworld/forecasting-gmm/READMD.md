# forecasting-gmm
Original notebook from ICML '24 paper: Probabilistic Forecasting with Stochastic Interpolants and Follmer Processes (generative AI for forecasting)
[Github](https://github.com/interpolants/forecasting/blob/main/gmm/Gaussian-mixture.ipynb)

## Changes made to the original notebook 
For shorter processing time. However, we need to change them back to get the performance metrics.
- train data split to be `0.001 * N` instead of `0.9 * N`
- cell 20:
```python 
n_samples = 2000  # Smaller for quick demo
em_steps = 1000 # Smaller for quick demo
```
For precise diffs
- print statements that will produce undeterministic results (e.g., time) are commented out 

## Modifications

### in-place modification
Dir: [in-place](./in-place)
Add an additional cell containing `train_now.mul_(2.0)`.

**ipyflow did not rerun** \
It cannot detect that `train_now`'s underlying tensor data changed without a name rebinding.
Reproduce steps (connect to ipyflow kernel):
1. Run-all (execution count 1-27)
2. Add `train_now.mul_(2.0)` as a standalone cell between execution count 11 and 12, and run as execution count 28.
3. Expect to see all cells using `train_now` being automatically re-run.
4. `ipyflow` did not rerun any cell automatically and suggest to rerun cell 12 and 18.
5. When rerunning cell 18, cell 1-4,6,8-14,16-21,23-27 all got triggered to rerun. 

### random seed
Dir: [random-seed](./random-seed)
Modify the torch seed from 0 to 20. 

**ipyflow did rerun** \
Reproduce steps (connect to ipyflow kernel):
1. Run-all (execution count 1-27)
2. Changed execution count 11's torch seed from 0 to 20 and rerun this cell as execution count 28.
```python
# cell 11
torch.manual_seed(20)
...
# cell 18
class Trainer:
    def __init__(...):
        self.train_loader = torch.utils.data.DataLoader(
            torch.utils.data.TensorDataset(..., shuffle=True)
        )
```
3. Since Trainer definition does use torch random seed, we are expecting to see cell 17-22 and 24-28 (23 is all commented out) to be automatically re-run.
4. `ipyflow` did not rerun any cell automatically and suggest cell 12,13. When rerunning suggested cells, cell 1-4,6,8-14,16-21,23-27 also got rerun. 

### file IO
Dir: [RAW-IO](./RAW-IO)
**ipyflow did not rerun** \
Reproduce steps (connect to ipyflow kernel):
1. Run-all (execution count 1-27)
2. Add the following as a standalone cell between execution count 7 and 8, and run as execution count 28.
```python
# New standalone cell
traj = simulate_dynamics(mus[0], lam=2.0, dt=0.02, n_steps=10**6, seed=0)
np.save('GMM_dt001_1e6samples.npy', traj)
```
3. `ipyflow` sees no Python variable connecting the two cells: `traj` is not read by the cache cell. So it does not rerun cells. But the expected result (fresh nbconvert run) would load the new `CACHE` into res, and all downstream cells would produce different outputs.

### plot
Dir: [plot](./plot)
**ipyflow** \
1. Run-all (execution count 1-27)
2. Dirct assignment (m1): ipyflow reruns cell 1-4,6,8-14,16-21,23-27.
```python
# original cell 2
plt.rcParams['font.size'] = 15

# modified cell 2
plt.rcParams['font.size'] = 25
```
3. Mutation (m2): ipyflow failed to cascade any change
```python
# New standalone cell between execution count 1 and 2,
# and run as execution count 51
plt.rcParams['lines.linestyle'] = '--'
```
