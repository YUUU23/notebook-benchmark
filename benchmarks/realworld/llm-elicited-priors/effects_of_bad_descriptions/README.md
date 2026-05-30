# llm-elicited-priors
Original notebook from ICML '24 paper: AutoElicit: Using Large Language Models for Expert Prior Elicitation in Predictive Modelling
[Github](https://github.com/alexcapstick/llm-elicited-priors/blob/main/effects_of_bad_descriptions.ipynb)

## Modifications
Modification made to the original notebook to avoid introducing randomness:
- pass `random_seed=0` to `pm.sample_prior_predictive()`

**ipyflow** \
1. Run-all (execution count 1-16)
2. Mutation (m1): ipyflow does not rerun any cell, where cell 14 is expected to be rerun 
```python
# new standalone cell added between cell 13 and 14
priors_dict.pop("adverserial")
```
3. Direct assignnment (m2): ipyflow rerun cell 1, 4, 5-11, 13-16 where 1 and 4 are unnecessary
```python
# original cell 6
metric_results = (
    results_df
    ...
    .assign(sample=lambda x: x["metrics_to_plot"].apply(lambda x: np.arange(len(x))))
)
# modified
metric_results = (
    results_df
    ...
    .assign(sample=lambda x: x["metrics_to_plot"].apply(lambda x: len(x)-np.arange(len(x))))
)
```
4. Mutation (m3): ipyflow does not rerun cells that use `metric_results_line_plot` (cell 7,8)
```python
# added cell between cell 7 and 8
temp = metric_results_line_plot
temp.drop(
    index=temp[temp["description_type"] == "uninformative"].index,
    inplace=True
)
```