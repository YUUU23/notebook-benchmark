# Modification 1: Testing Precision and Soundness (Direct Assignment)
File: m1_generate_flu_vaccine.ipynb
Modification to cell 5: The n_samples_per_task is changed from 2000 to 4000.
From

```
# x levels of graphical complexity (captured by BCC size).
# y tasks per graphical complexity level.
# z samples per task.
# w replicates per sample.
# = x*y*z*w subtasks.
graph_sizes = [[6,4,6],[7,5,7],[8,6,8]]
n_tasks_per_size = 1
n_samples_per_task = 2000
reps_per_sample = 5
bcc_type = "wheel"
causal_functions = "random"

df = dg.get_dataset(task_generator = FluVaccine,
                    graph_sizes = graph_sizes,
                    n_tasks_per_size = n_tasks_per_size,
                    n_samples_per_task = n_samples_per_task, 
                    reps_per_sample = reps_per_sample, 
                    causal_functions = causal_functions, 
                    bcc_type = bcc_type)

print(df.info())
display(df.head(5))
display(df.tail(5))
```

to

```
# x levels of graphical complexity (captured by BCC size).
# y tasks per graphical complexity level.
# z samples per task.
# w replicates per sample.
# = x*y*z*w subtasks.
graph_sizes = [[6,4,6],[7,5,7],[8,6,8]]
n_tasks_per_size = 1
n_samples_per_task = 4000
reps_per_sample = 5
bcc_type = "wheel"
causal_functions = "random"

df = dg.get_dataset(task_generator = FluVaccine,
                    graph_sizes = graph_sizes,
                    n_tasks_per_size = n_tasks_per_size,
                    n_samples_per_task = n_samples_per_task, 
                    reps_per_sample = reps_per_sample, 
                    causal_functions = causal_functions, 
                    bcc_type = bcc_type)

print(df.info())
display(df.head(5))
display(df.tail(5))
```

# Modification 2: Testing Precision (No Downstream Dependencies)
File: m2_generate_flu_vaccine.ipynb
Modification to cell 14: The verbose argument is changed from False to True.
From
```
pns_dict = dg.get_pns_dict(verbose = False)
display(pns_dict)
```
to
```
pns_dict = dg.get_pns_dict(verbose = True)
display(pns_dict)
```

# Modification 3: Testing Consistency (Local Filtering)
File: m3_generate_flu_vaccine.ipynb
Modification to cell 11: The filter string is changed from "surgery" to "vaccination".
From

```
l = len(df_factual[(df_factual["Context ID"] == 0) & (df_factual["Effect"] == "surgery")])
print("\nTotal factual q's per quantity per task:", l)
```
to

```
l = len(df_factual[(df_factual["Context ID"] == 0) & (df_factual["Effect"] == "vaccination")])
print("\nTotal factual q's per quantity per task:", l)
```