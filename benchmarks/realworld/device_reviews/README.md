# device_reviews
Original notebook from [device_reviews](https://github.com/divyashan/device_reviews/blob/main/analysis.ipynb)

## m1: modify source column

```python
# original cell 3
for submission in sorted(os.listdir(reviews_dir)):
    ...
    'pts_vs_samples':  extract_field('Patients vs. Samples', text),

# modified
for submission in sorted(os.listdir(reviews_dir)):
    ...
    'pts_vs_samples':  extract_field('Patients vs Samples', text),
```
ipyflow reruns all cells (1-7) but 1-4 is unnecessary.
 
## m2: partial df filtering

```python
# original cell 6
wh_mask = summary_df['womens_health'].fillna('').str.lower().str.startswith('yes')

# modified
wh_mask = summary_df['womens_health'].fillna('').str.lower().str.contains('obstetric|mammograph|fetal|gynecol')
```
ipyflow correctly reruns cell 6 and 7.

## m3: full df filtering
```python
# add to cell 1 before df.head()
df = df[df['Panel (Lead)'] != 'Radiology']
```
ipyflow reruns all 7 cells but only expected to run 1,2,5,6,7.

