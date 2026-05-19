# Modification 1: Testing Soundness (Dependency Cascade)
File: [m1_complexity_analysis.ipynb](./m1_complexity_analysis.ipynb)
Modification to the loop parameters cell 2: The graph generation range is changed by updating smallest from 1 to 10 and largest from 10 to 20.
From
```
utils = Utils()
graphs = []
smallest = 1
largest = 10
for n in range(smallest,largest):
    G = utils.get_cct(n)
    utils.plot_nx(adjacency_matrix = nx.to_numpy_array(G),
                  labels = list(G.nodes),
                  dpi = 70,
                  figsize = (3,3))
    graphs.append(G)

    # Print total nodes.
    print("Total nodes:", len(G))
    
    # Print total edges.
    print("Total edges:", G.size())
    print()
```
to 
```
utils = Utils()
graphs = []
smallest = 10
largest = 20
for n in range(smallest,largest):
    G = utils.get_cct(n)
    utils.plot_nx(adjacency_matrix = nx.to_numpy_array(G),
                  labels = list(G.nodes),
                  dpi = 70,
                  figsize = (3,3))
    graphs.append(G)

    # Print total nodes.
    print("Total nodes:", len(G))
    
    # Print total edges.
    print("Total edges:", G.size())
    print()
```

# Modification 2: Testing Consistency (Visual Update)
File: m2_complexity_analysis.ipynb
Modification to the plotting cell 4: The linestyle for the Quadratic plot is changed from "dotted" to "dashed".
From
```
...
plt.plot(node_counts, [x**2 for x in node_counts], label = "Quadratic", linestyle = "dotted")
...
```
to
```
...
plt.plot(cutpoint_counts, [x**2 for x in cutpoint_counts], label = "Quadratic", linestyle = "dashed")
...
```