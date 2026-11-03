"""Fetch the manual python3 rerun set (results-sheet column D) at run time.

The python3 baseline cannot compute which cells a modification would cascade to,
so that set is maintained by hand in the results sheet's column D (keyed by the
column-A step label). This reads it live from a Google Apps Script web app
(its doGet returns {column A -> column D}), so
column D can be edited in the sheet without a CSV download/upload/rerun cycle.
"""
import json
import urllib.request

# Older deployment: serves the micro-benchmark rows but not the osdi-eval tab's ICSE2025
# rows; for those pass --rerun-sheet-url with scripts/tosheet.py's WEB_APP_URL.
WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzMGyhMt6tbL50Knc-W4dhFl6m8TzdO-NltJElCM_DUh8sTU9jbvn1N1hHqRPlMccU7/exec"


def fetch_rerun_sets(url: str = WEB_APP_URL, timeout: int = 30) -> dict[str, str]:
    """Return {step_label -> column-D rerun-set string}, e.g. {"foo_m1": "n,2,3"}.

    Best-effort: any network/parse failure returns {} so a run never aborts just
    because the sheet was unreachable (the step then runs with an empty rerun set).
    """
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.load(resp)
    except Exception as e:
        print(f"=== [RUN] WARNING: could not fetch rerun sets from sheet: {e}")
        return {}
    if not isinstance(data, dict):
        print(f"=== [RUN] WARNING: unexpected rerun-set payload: {type(data)}")
        return {}
    return {str(k): str(v) for k, v in data.items() if str(v).strip()}
