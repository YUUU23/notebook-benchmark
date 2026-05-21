# forecasting-gmm
Original notebook from ICML '24 paper: Probabilistic Forecasting with Stochastic Interpolants and Follmer Processes (generative AI for forecasting)
[Github](https://github.com/interpolants/forecasting/blob/main/gmm/Gaussian-mixture.ipynb)

## Changes made to the original notebook for shorter processing time
1. train data split to be `0.01 * N` instead of `0.9 * N`
2. prints that will produce undeterministic results (e.g., time) are commented out for precise diffs


Each sub-directory contains subset of cells extracted from the original notebook to isolate causes to failed reactivity. 
- [random-seed](./random-seed/) contains modification to torch seed.
```python
# cell 11
torch.manual_seed(0)

# cell 17
class Trainer:
    def __init__(...):
        self.train_loader = torch.utils.data.DataLoader(
            torch.utils.data.TensorDataset(..., shuffle=True)
        )
```

- [RAW-IO](./RAW-IO/) contains write from previously saved checkpoints (disk IO).
```python
# cell 18
torch.save(model.state_dict(), 'GMM_model_checkpoint.pth')

# cell 19
checkpoint = torch.load('GMM_model_checkpoint.pth', map_location=device)
model.load_state_dict(checkpoint)
```

-[in-place](./in-place/) contains in-place modification to torch array via `.mul_()`.
```python
# cell 11
train_now = data[:n_train]
```
