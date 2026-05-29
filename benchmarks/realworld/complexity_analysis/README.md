# compositional_causal_reasoning
Original notebook from ICML '25 paper: Compositional Causal Reasoning Evaluation in Language Models

[Github](https://github.com/jmaasch/compositional_causal_reasoning/blob/main/complexity_analysis.ipynb)

cell 1: imports \
cell 2: graph generation (`utils`, `graphs` list) \
cell 3: path length computation \
cell 4: node count plot \
cell 5: cutpoint count plot \

## Modifications
1. Run-all (execution count 1-5)
2. Direct assignment (m1): ipyflow reruns all cells (where cell 1 is unnecessary)
```python
# original cell 2
smallest = 1
largest = 10

# modified
smallest = 10
largest = 20
```
3. Mutation (m2): ipyflow does not rerun any cell automatically and suggested 3,4,5. While rerunning, all cells got triggered to rerun.
```python
# new standalone cell added between cell 2 and 3, run as execution count 6
# for scenario when the user wants to append more graphs without having to rerun previous cell
graphs.append(utils.get_cct(12))
```
4. Mutation (m3): ipyflow does not rerun any cell automatically and suggested 3,4,5. While rerunning, all cells got triggered to rerun.
```python
# added between cell 2 and 3
graphs[:] = [g for i, g in enumerate(graphs) if i % 2 == 0]
```