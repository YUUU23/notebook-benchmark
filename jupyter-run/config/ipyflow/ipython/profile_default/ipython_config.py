# Start the ipyflow kernel already in reactive execution mode so a modified
# cell cascades to its dependents without a manual `%flow mode reactive`.
# Read by ipyflow at flow init via shell().config.ipyflow (see ipyflow/flow.py).
c.ipyflow.exec_mode = "reactive"
