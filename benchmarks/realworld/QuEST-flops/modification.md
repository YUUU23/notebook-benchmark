# Modification 1: Direct Assignment
File: 
Which cell is modified: Cell 2

What is changed: The alignment multiplier is changed from multiple_of = 256 to multiple_of = 128 to evaluate how a tighter feed-forward network rounding impacts total parameter counts across all model configurations.
From
```
multiple_of = 256
```
to
```
multiple_of = 128
```

# Modification 2: Reassignment
This modification evaluates how a reactive system handles changes to variables that were originally defined in upstream cells but are being overwritten downstream.  

File:

Which cell is modified: Cell 5  
What is changed: The active model assignment is changed from model = tiny2 to model = mini to compare the mini architecture against the specific iteration milestones defined locally in Cell 5.  

From 
```
model = tiny2
```
to
```
model = mini
```

# Modification 3: Mutation
This modification tests in-place mutations on collections.  

File:

Which cell is modified: Cell 4  
What is changed: The code builds a nested list of arrays. To create a flat, 1D array of all recorded FLOP computations instead, the list mutation method is changed from all_flops.append(flops_all) to all_flops.extend(flops_all).  

From 
```
all_flops.append(flops_all)
```
to
```
all_flops.extend(flops_all)
```