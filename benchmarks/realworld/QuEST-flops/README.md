# QuEST-flops
Original notebook from ICML '24 paper: QuEST: Stable Training of LLMs with 1-Bit Weights and Activations
[Github](https://github.com/IST-DASLab/QuEST/blob/main/notebooks/flops.ipynb)

cell 1: function definition \
cell 2: model (dict) definition \

## Modifications
**ipyflow** \
1. Run-all (execution count 1-12)
2. Direct assignment (m1): ipyflow reruns cell 2-12 correctly
```python
# cell 2 
multiple_of = 256

# modified
multiple_of = 128
```
3. Reassignment (m2): ipyflow reruns cell 2-12 (but cell 2 is unnecessary)
```python
# original cell 5
model = tiny2

# modified
model = mini
```
4. Mutation (m3): ipyflow failed to rerun cell 11
```python
# Add additional cell between cell 2 and 3
_210M["vocab_size"] = 10
```