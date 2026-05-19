# Modification 1: Testing Precision and Soundness (Direct Assignment)
File: [m1_fedgo.ipynb](./m1_fedgo.ipynb)
Modification to cell 2: The `BATCH_SIZE` is changed from 64 to 128.
From
```
BATCH_SIZE = 64
```
to 
```
BATCH_SIZE = 128
```

# Modification 2: Testing Soundness (Class Redefinition)
File: [m2_fedgo.ipynb](./m2_fedgo.ipynb)
Modification to cell 4: The negative slope of the LeakyReLU activation in the Classifier class is changed from 0.2 to 0.1.
From
```
class Classifier(nn.Module):
    def __init__(self): 
        ...
        self.lrelu = nn.LeakyReLU(0.2) 
    ...
```
to
```
class Classifier(nn.Module):
    def __init__(self): 
        ...
        self.lrelu = nn.LeakyReLU(0.1) 
    ...
```

# Modification 3: Testing Consistency (Function Modification)
File: [m3_fedgo.ipynb](./m3_fedgo.ipynb)
Modification to cell 3: The color mapping for label 1 in the c_dict within the plot_data function is changed from 'lime' to 'g'.
From
```
def plot_data(data, labels=None, title=None, show=True): # Plot data as scatter plot with optional labels and title 
    # plt.figure() 
    if labels is None: 
        plt.scatter(data[:,0], data[:,1], edgecolor='black') 
    else: 
        c_dict = {0:'r', 1:'lime', 2:'b'}
    ...
```
to
```
def plot_data(data, labels=None, title=None, show=True): # Plot data as scatter plot with optional labels and title 
    # plt.figure() 
    if labels is None: 
        plt.scatter(data[:,0], data[:,1], edgecolor='black') 
    else: 
        c_dict = {0:'r', 1:'g', 2:'b'}
    ...
```