# Modification 1: Testing Soundness (Dependency Cascade)
File: [m1_generate_clinical_notes.ipynb](./m1_generate_clinical_notes.ipynb)
The variable n_samples_per_task is changed from 4000 to 1000.

# Modification 2: Testing Precision (No Downstream Dependencies)
File: [m2_generate_clinical_notes.ipynb](./m2_generate_clinical_notes.ipynb)
The verbose argument in the dg.get_pns_dict() function call is changed from False to True.

# Modification 3: Testing Precision and Consistency (Local Filtering)
File: [m3_generate_clinical_notes.ipynb](./m3_generate_clinical_notes.ipynb)
The filter condition string for the "Effect" column is changed from "surgery" to "treatment".
From 
```
l = len(df_factual[(df_factual["Context ID"] == 0) & (df_factual["Effect"] == "surgery")])
print("\nTotal factual q's per quantity per task:", l)
```
to 
```
l = len(df_factual[(df_factual["Context ID"] == 0) & (df_factual["Effect"] == "treatment")])
print("\nTotal factual q's per quantity per task:", l)
```