import glob
import json

import pandas as pd


def load_csv(file_path):
    df = pd.read_csv(file_path, index_col=0)
    df.set_index("sample_id", inplace=True)
    return df


def compute_accs(df, gt_df):
    combined = df.join(gt_df, how="inner", lsuffix="_ggnn", rsuffix="_gt")
    loc_correct = combined["loc_pred"] == combined["error_location"]
    is_buggy = combined["error_location"] != 0
    if (~is_buggy).sum() == 0:
        no_bug_acc = 0
    else:
        no_bug_acc = loc_correct[~is_buggy].sum() / (~is_buggy).sum()
    loc_acc = loc_correct[is_buggy].sum() / is_buggy.sum()

    full_acc = loc_correct.sum() / len(loc_correct)

    cls_pred = combined["loc_pred"] > 0
    cls_gt = combined["error_location"] > 0
    cls_acc = (cls_pred == cls_gt).sum() / len(cls_pred)

    # # target_correct = combined["target_probs"] >= 0.5
    # target_correct = combined["loc_pred"] > 0
    # target_loc_acc = target_correct[is_buggy].sum() / is_buggy.sum()
    # joint_acc = (loc_correct & target_correct)[is_buggy].sum() / is_buggy.sum()

    return no_bug_acc, loc_acc, cls_acc, full_acc  # @ target_loc_acc, joint_acc


def load_typecheck(folder):
    files = sorted(glob.glob(folder + "/*.csv"))
    df = pd.concat([pd.read_csv(file, index_col=0) for file in files])
    df.reset_index(inplace=True)
    df["sample_id"] = df.index
    df.set_index("sample_id", inplace=True)
    return df


def measure_result_classification_pipeline(df, correct_weight=1, beta=1):
    df["gt_label"] = df["gt_error_loc"] > 0
    df["pred_label"] = (df["loc_pred"] == df["gt_error_loc"]) & (df["gt_label"])
    df["sample_weight"] = correct_weight * (~df["gt_label"]) + df["gt_label"]

    tp = ((df["loc_pred"] == df["gt_error_loc"]) | df["type_check_failed"]) & (
        df["gt_label"]
    )
    tp = (tp * df["sample_weight"]).sum()
    tn = ((df["loc_pred"] == 0) & (~df["type_check_failed"])) & (~df["gt_label"])
    tn = (tn * df["sample_weight"]).sum()
    pp = (df["loc_pred"] > 0) | df["type_check_failed"]
    pp = (pp * df["sample_weight"]).sum()
    fp = pp - tp
    fn = ((df["loc_pred"] == 0) & (~df["type_check_failed"])) & (df["gt_label"])
    fn = (fn * df["sample_weight"]).sum()

    # print(f"tp: {tp}, tn: {tn}, fp: {fp}, fn: {fn}")

    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    f1 = 2 * (precision * recall) / (precision + recall)
    csi = tp / (tp + fn + fp)

    fb = (1 + beta**2) * precision * recall / (beta**2 * precision + recall)

    return precision, recall, fb


def measure_result_classification(
    df, type_check_failed=False, typecheck=True, correct_weight=1, beta=1
):
    if typecheck:
        df = df[df["type_check_failed"] == type_check_failed].copy()

    df["gt_label"] = df["gt_error_loc"] > 0
    df["pred_label"] = (df["loc_pred"] == df["gt_error_loc"]) & (df["gt_label"])
    df["sample_weight"] = correct_weight * (~df["gt_label"]) + df["gt_label"]

    tp = (df["loc_pred"] == df["gt_error_loc"]) & (df["gt_label"])
    tp = (tp * df["sample_weight"]).sum()
    tn = (df["loc_pred"] == 0) & (~df["gt_label"])
    tn = (tn * df["sample_weight"]).sum()
    pp = df["loc_pred"] > 0
    pp = (pp * df["sample_weight"]).sum()
    fp = pp - tp
    fn = (df["loc_pred"] == 0) & (df["gt_label"])
    fn = (fn * df["sample_weight"]).sum()

    # print(f"tp: {tp}, tn: {tn}, fp: {fp}, fn: {fn}")
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    f1 = 2 * (precision * recall) / (precision + recall)
    csi = tp / (tp + fn + fp)

    fb = (1 + beta**2) * precision * recall / (beta**2 * precision + recall)

    return precision, recall, fb


def get_no_bug_data(prediction_fname: str):
    no_bug_starts = 1293
    original_type_checking = (
        "results/real_1/typechecking_pipeline/varmisuse_real_no_bug.jsonl.txt.csv"
    )
    manual_annotated = "results/manual_annotated_no_bugs.jsonl"

    predictions = pd.read_csv(prediction_fname).to_dict(orient="records")
    original_type_checking = pd.read_csv(original_type_checking).to_dict(
        orient="records"
    )

    original_data = []
    with open("../data/eval_real/eval__VARIABLE_MISUSE__SStuB.txt-no_bug", "r") as f:
        for line in f:
            original_data.append(json.loads(line))

    data_map = {}
    for i, record in enumerate(original_data):
        data_map[record["id"]] = record
        record["original_type_checked"] = not original_type_checking[i][
            "type_check_failed"
        ]

    if "sample_id" not in predictions[0]:
        predictions = predictions[no_bug_starts:]

    for i, record in enumerate(predictions):
        if "sample_id" in record:
            i = record["sample_id"]
            if i not in data_map:
                continue
        else:
            i = original_data[i]["id"]

        data_record = data_map[i]
        data_record["loc_pred"] = record["loc_pred"]
        data_record["gt_error_loc"] = record["gt_error_loc"]

    manual_results = []
    with open(manual_annotated, "r", encoding="utf-8") as f:
        for line in f:
            manual_results.append(json.loads(line))

    new_results = []
    for result in manual_results:
        new_result = {}
        id = result["id"]
        new_result["original_type_checked"] = data_map[id]["original_type_checked"]
        new_result["loc_pred"] = data_map[id]["loc_pred"]
        new_result["gt_error_loc"] = data_map[id]["gt_error_loc"]
        new_result["type_checked_mypy"] = result.get("type_checked_mypy", True)
        new_result["type_checked_pytype"] = result.get("type_checked_pytype", True)
        new_results.append(new_result)

    return new_results


def calculate_fb(model_name, betas, typechecker="pytype"):
    no_bug_results = pd.DataFrame(get_no_bug_data(f"results/real_1/{model_name}.csv"))
    bug_results = pd.DataFrame(get_bug_data(f"results/real_2/{model_name}.csv"))

    df = pd.concat([no_bug_results, bug_results])

    df["type_check_failed"] = ~df[f"type_checked_{typechecker}"]

    results = []
    pipeline_results = []
    for beta in betas:
        metrics = measure_result_classification(df, typecheck=False, beta=beta)
        metrics_pipeline = measure_result_classification_pipeline(df, beta=beta)

        results.append(metrics[2])
        pipeline_results.append(metrics_pipeline[2])

    return results, pipeline_results


def calculate_precision_recall(prediction, gt, correct_weight=1):
    tp = sum(prediction & gt)
    fp = sum(prediction & ~gt)
    fn = sum(~prediction & gt)

    fp = correct_weight * fp

    precision = tp / (tp + fp)
    recall = tp / (tp + fn)

    return precision, recall


def get_bug_data(prediction_fname: str, return_program_map=False):
    # prediction_fname = "real_2/codebert.csv"
    typecheck_results = "results/real_2/typechecking/varmisuse_pypi.json.csv"
    manual_annotated = "results/manual_annotated_bugs.jsonl"

    programs = []
    with open("../data/eval_real_2/eval__VARIABLE_MISUSE__SStuB.txt-pypi") as f:
        for line in f:
            programs.append(json.loads(line))

    results = []

    with open(manual_annotated, "r") as f:
        for line in f:
            results.append(json.loads(line))

    program_map = {}
    for i, program in enumerate(programs):
        program_map[
            program["repo"] + program["hash"] + str(program["error_location"])
        ] = i

    predictions = pd.read_csv(prediction_fname).to_dict(orient="records")
    if "sample_id" in predictions[0]:
        predictions = {p["sample_id"]: p for p in predictions}

    original_type_checks = pd.read_csv(typecheck_results).to_dict(orient="records")

    records = []
    for idx, result in enumerate(results):
        i = program_map[result["repo"] + result["hash"] + str(result["error_location"])]
        record = {}
        if (
            type(predictions) is dict
            and i not in predictions
            or predictions[i]["gt_error_loc"] == 0
        ):
            continue
        record["loc_pred"] = predictions[i]["loc_pred"]
        record["gt_error_loc"] = predictions[i]["gt_error_loc"]
        record["type_checked_mypy"] = result.get("type_checked_mypy", True)
        record["type_checked_pytype"] = result.get("type_checked_pytype", True)

        if "indirect" in result.get("type_error_label", ""):
            record["type_checked_mypy"] = True
            record["type_checked_pytype"] = True

        record["original_type_checked"] = not original_type_checks[i][
            "type_check_failed"
        ]
        records.append(record)

    if return_program_map:
        return records, program_map
    return records


def get_performance(model_name, correct_weight=14.33):
    no_bug_results = pd.DataFrame(get_no_bug_data(f"results/real_1/{model_name}.csv"))
    bug_results = pd.DataFrame(get_bug_data(f"results/real_2/{model_name}.csv"))

    results_df = pd.concat([no_bug_results, bug_results])
    correct_weight = 1

    result = {}

    original_pytype_performance = calculate_precision_recall(
        ~results_df["original_type_checked"],
        results_df["gt_error_loc"] > 0,
        correct_weight,
    )
    result["original_pytype"] = original_pytype_performance

    mypy_performance = calculate_precision_recall(
        ~results_df["type_checked_mypy"], results_df["gt_error_loc"] > 0, correct_weight
    )
    result["mypy"] = mypy_performance

    pytype_performance = calculate_precision_recall(
        ~results_df["type_checked_pytype"],
        results_df["gt_error_loc"] > 0,
        correct_weight,
    )
    result["pytype"] = pytype_performance

    original_performance = measure_result_classification(
        results_df, typecheck=False, correct_weight=correct_weight
    )
    result["original_performance"] = original_performance

    results_df["type_check_failed"] = ~results_df["original_type_checked"]
    original_pipeline_performance = measure_result_classification_pipeline(
        results_df, correct_weight=correct_weight
    )
    result["original_pipeline_performance"] = original_pipeline_performance

    results_df["type_check_failed"] = ~results_df["type_checked_pytype"]
    new_pipeline_performance = measure_result_classification_pipeline(
        results_df, correct_weight=correct_weight
    )
    result["new_pipeline_performance"] = new_pipeline_performance

    results_df["type_check_failed"] = ~results_df["type_checked_mypy"]
    new_pipeline_performance_mypy = measure_result_classification_pipeline(
        results_df, correct_weight=correct_weight
    )
    result["new_pipeline_performance_mypy"] = new_pipeline_performance_mypy

    results_df["type_check_failed"] = ~(
        results_df["type_checked_pytype"] | (results_df["gt_error_loc"] == 0)
    )
    filtered_performance = measure_result_classification(
        results_df, correct_weight=correct_weight
    )
    filtered_beta = measure_result_classification(
        results_df, correct_weight=correct_weight, beta=1.5
    )
    result["filtered_performance"] = (
        filtered_performance[0],
        filtered_performance[1],
        filtered_performance[2],
        filtered_beta[2],
    )

    no_bug_results = pd.DataFrame(
        get_no_bug_data(f"results/real_1/{model_name}_typecheck_oversample.csv")
    )
    bug_results = pd.DataFrame(
        get_bug_data(f"results/real_2/{model_name}_typecheck_oversample.csv")
    )

    results_df_oversampled = pd.concat([no_bug_results, bug_results])
    results_df_oversampled["type_check_failed"] = ~results_df_oversampled[
        "type_checked_pytype"
    ]
    oversampled_performance = measure_result_classification(
        results_df_oversampled, typecheck=True, correct_weight=correct_weight
    )
    oversampled_beta = measure_result_classification(
        results_df_oversampled, typecheck=True, correct_weight=correct_weight, beta=1.5
    )

    result["oversampled_performance"] = (
        oversampled_performance[0],
        oversampled_performance[1],
        oversampled_performance[2],
        oversampled_beta[2],
    )

    return result
