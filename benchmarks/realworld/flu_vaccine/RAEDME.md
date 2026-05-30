# compositional_causal_reasoning
Automatic task generation for compositional causal reasoning (CCR) evaluation in language models. (ICML '25)

[Github](https://github.com/jmaasch/compositional_causal_reasoning/tree/main)

## m1: direct assignment
```python
# original cell 3
n_samples_per_task = 2000

# modified
n_samples_per_task = 500

```
ipyflow reruns 3-12 correctly.

## m2: in-place mutation

```python
# new standalone cell between cell 4 and 5
df_cf.loc[df_cf["Cause"] == "Shari", "True (cause = True)"] = 0
```
Expect to run: {new cell, 6,7,9}
ipyflow does not rerun nor suggest any cell.

## m3: mutation via func

```python
# add standalone cell between cell 4 and 5
def remove_replicate(df, rep_id):
    df.drop(index=df[df["Replicate ID"] == rep_id].index, inplace=True)

remove_replicate(df_factual, 0)
```
Expect to run: {new cell, 5,8}
ipyflow does not rerun nor suggest any cell.