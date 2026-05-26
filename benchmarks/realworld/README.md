## Realworld Benchmark Summary: 
Notebook modifications and ipyflow behaviors collected from manually running ipyflow with reactive mode on. 

---

### 1. [complexity_analysis](./complexity_analysis/)

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–5) | — |
| m1 — Direct assignment | `smallest = 1 → 10`, `largest = 10 → 20` in cell 2 | Reruns all cells (cell 1 is unnecessary) |
| m2 — Mutation | Add standalone cell between 2 & 3: `graphs.append(utils.get_cct(12))` | Does NOT cascade to cells 3–5 |
| m3 — Mutation | After run-all with m2, modify appended cell: `graphs[:] = [g for i, g in enumerate(graphs) if i % 2 == 0]` | Reruns all cells (cell 1 unnecessary); if m2 not present and list comprehension is added fresh, ipyflow does NOT rerun any cell |

---

### 2. [explore_siren](./explore_siren/)
**Baseline changes:** `total_steps` downsized (500/1000 → 10); `hidden_features` downsized (256 → 16)

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–22) | — |
| m1 — Direct assignment | `lr=1e-4 → 1e-3` in cell 7 (Adam optimizer) | Reruns cells 1, 2, 5–17, 19, 21, 22. **Overly conservative** — only cells 6, 7, 9 needed |
| m2 — Direct assignment | `Normalize(0.5, 0.5) → Normalize(0.0, 1.0)` in cell 4 | Reruns cells 1, 2, 4–17, 19, 21, 22. **Overly conservative** — only image/Poisson cells (6, 7, 9, 17, 19) needed |
| m3 — Direct assignment | `first_omega_0=30 → 60` in `Siren.__init__` (cell 2) | Reruns cells 1, 2, 5–17, 19, 21, 22. **Overly conservative** — unnecessary reruns of cell 1, 5, 8, 10, 11, 12–15, 16 |
| m4 — Mutation | Add standalone cell: in-place weight perturbation via `p.add_(...)` | Does NOT rerun any cell (but after running same cell 3 times it seems to rerun all) |

---

### 3. [forecasting-gmm / in-place](./forecasting-gmm/in-place/)
**Source:** ICML '24 — Probabilistic Forecasting with Stochastic Interpolants and Föllmer Processes

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–27) | — |
| Mutation | Add standalone cell between exec 11 & 12: `train_now.mul_(2.0)` | Does NOT rerun any cell. ipyflow cannot detect that the underlying tensor data changed without a name rebinding |

---

### 4. [forecasting-gmm / plot](./forecasting-gmm/plot/)

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–27) | — |
| m1 — Direct assignment | `plt.rcParams['font.size'] = 15 → 25` in cell 2 | Reruns almost all cells **except** cells 5, 7, 15, 22 |
| m2 — Mutation | Add standalone cell (exec count 51) between exec 1 & 2: `plt.rcParams['lines.linestyle'] = '--'` | Does NOT cascade any change |

---

### 5. [forecasting-gmm / random-seed](./forecasting-gmm/random-seed/)

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–27) | — |
| Direct assignment | `torch.manual_seed(0 → 20)` in cell 11, rerun as exec count 28 | Reruns cells 17–22 and 24–28 (correct), **but also** reruns cells 1–4, 6, 8–15 unnecessarily. **Overly conservative** |

---

### 6. [forecasting-gmm / RAW-IO](./forecasting-gmm/RAW-IO/)

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–27) | — |
| Mutation | Add standalone cell between exec 7 & 8: `traj = simulate_dynamics(...); np.save('GMM_dt001_1e6samples.npy', traj)` | Does NOT rerun any cell. ipyflow sees no Python variable connecting the cells (`traj` is not read by the cache cell), so it misses the file-level side effect |

---

### 7. [llm-elicited-priors / effects_of_bad_descriptions](./llm-elicited-priors/effects_of_bad_descriptions)

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–16) | — |
| m1 — Mutation | Add standalone cell between 13 & 14: `priors_dict.pop("adverserial")` | Does NOT rerun any cell; cell 14 **should** be rerun |
| m2 — Direct assignment | Modify `.assign(sample=...)` lambda in cell 6 to reverse `np.arange` | Reruns cells 1, 4, 5–11, 13–16. **Overly conservative** — cells 1 and 4 are unnecessary |
| m3 — Mutation | Add cell between 7 & 8: in-place `drop` on `metric_results_line_plot` | Does NOT rerun cells that use `metric_results_line_plot` (cells 7, 8) |

---

### 8. [QuEST-flops](./QuEST-flops)
**Cells:** (1) function definitions, (2) model dict definitions, (3–12) analysis cells

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–12) | — |
| m1 — Direct assignment | `multiple_of = 256 → 128` in cell 2 | Reruns cells 2–12 correctly |
| m2 — Reassignment | `model = tiny2 → model = mini` in cell 5 | Reruns cells 2–12 (cell 2 is unnecessary) |
| m3 — Mutation | Add standalone cell between 2 & 3: `_210M["vocab_size"] = 10` | **Fails** to rerun cell 11 |

---

### 9. [QuEST-mse-fitting](./QuEST-mse-fitting)
**Source:** ICML '24 — QuEST: Stable Training of LLMs with 1-Bit Weights and Activations

| Modification | Change | ipyflow Behavior |
|---|---|---|
| Baseline | Run-all (exec count 1–7) | — |
| m1 — Direct assignment | `for bits in [1,2,3,4,8] → [1,2,4,8]` in cell 3 | Reruns cells 2, 3, 4, 5 |
| m2 — Direct assignment | Add grid scaling `grid *= 1.05` inside `compute_mse` in cell 1 | Reruns all cells (1–7) |
| m3 — Direct assignment | `N = 16 → N = 8` in cell 4 | Reruns cells 4, 5 |
| m4 — Mutation | Add standalone cell between 4 & 5: `GRID_MSES[6] = compute_mse(get_uniform_grid(2.05, 8))` | **Fails** to rerun any cell |

---

### Summary of ipyflow Behavior Patterns

| Pattern | Behavior |
|---|---|
| Direct assignment to a scalar | Generally reruns dependents correctly, but tends to **overshoot** (reruns unrelated cells like imports) |
| In-place mutation (`.append`, `.mul_`, `.pop`, `dict[key]=`) | Consistently **fails** to propagate — ipyflow does not track mutations without name rebinding |
| File I/O side effects (`np.save`) | **Fails** — ipyflow does not track file-level dependencies between cells |
| `plt.rcParams` direct assignment | Reruns most downstream cells (correct direction, may miss some) |
| `plt.rcParams` mutation (no rebinding) | **Fails** to cascade |