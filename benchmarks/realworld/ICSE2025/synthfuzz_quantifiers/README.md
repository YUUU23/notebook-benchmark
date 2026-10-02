# synthfuzz_quantifiers
https://github.com/UCLA-SEAL/SynthFuzz/blob/main/eval/mlir/notebooks/extract_quantifiers.ipynb

## Modifications

### m1 (direct assignment): cell 4
```python
# original
parser_rules = [rule for rule in graph.rules if isinstance(rule, UnparserRuleNode)]

# modified
parser_rules = [rule for rule in graph.rules if isinstance(rule, UnparserRuleNode)][:100]
```

### m2 (mutation): new cell inserted after cell 4
```python
insert_patterns.pop(list(insert_patterns)[0])
```
