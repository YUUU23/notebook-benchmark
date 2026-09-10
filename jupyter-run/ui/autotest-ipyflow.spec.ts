/**
 * ipyflow-only variant of autotest.spec.ts (config/ipyflow uses this via
 * testMatch). It differs from the shared autotest.spec.ts in two ways that are
 * REQUIRED for faithful ipyflow reactive results but WRONG for nnb:
 *   1. completeInitialRun(): ipyflow reactive "Run All Cells" halts at a cell
 *      that reassigns a tracked symbol, so we finish the remaining cells to
 *      reach the fully-executed state a manual run leaves (else the edit does
 *      not refresh ancestors -> stale-data OOM).
 *   2. keyboard edit (insertText) instead of page.notebook.setCell(): ipyflow's
 *      frontend only treats a real keyboard edit as a modification, so the
 *      reactive descendant reruns fire.
 * nnb detects modifications via the frontend content_changed diff, for which
 * setCell gives a clean single-cell signal; the keyboard clear+refill muddies
 * that diff, so nnb keeps the original autotest.spec.ts. See doc/journal.md.
 */
import { expect, galata, test } from "@jupyterlab/galata";
import type { Page } from "@playwright/test";
import * as path from "path";
import test_config from "../config/mod_config_file.json";

const fileName = test_config.file.benchmarkFileName;
const benchmarks_dir = test_config.file.benchmarkFileDir;
const downloadReactivePath = path.join(
  __dirname,
  "..",
  test_config.downloadReactivePath
);
const downloadInitialPath = path.join(
  __dirname,
  "..",
  test_config.downloadInitialPath
);
const modification = test_config.modification;
// "edit" (in-place source change) | "add" (insert + run a new cell) |
// "delete" (remove a cell, reactive cascade with no user execution).
// Default "edit" keeps older mod configs working.
const modOp: string = (modification as any).op ?? "edit";
const datadirectory = test_config.dataDirectory;
const supportingScripts: { sourcePath: string; targetRelPath: string; isDirectory: boolean }[] =
  (test_config as any).supportingScripts ?? [];

/**
 * Wait until reactive execution is finished and return the instant at which
 * the kernel was first observed idle after the final execution-count change.
 *
 * The quiet period confirms that no more reactive work is about to start, but
 * returning the beginning of that period keeps the validation delay out of
 * the wall-clock measurement.
 */
async function waitForReactiveExecutionsToSettle(page: Page): Promise<number> {
  // Long enough for heavy realworld reactive cascades; bounded by the
  // Playwright per-test timeout in the active playwright.config.js.
  const timeoutMs = 20 * 60 * 1000;
  const quietPeriodMs = 1_000;
  const pollIntervalMs = 100;
  const deadline = Date.now() + timeoutMs;
  let previousCounts = "";
  let stableSince = Date.now();
  let idleSince: number | undefined;

  while (Date.now() < deadline) {
    const counts = await page.evaluate(() => {
      const app = (window as any).galata.app;
      const notebook = app.shell.currentWidget?.content;
      return JSON.stringify(
        notebook?.widgets
          .filter((cell: any) => cell.model.type === "code")
          .map((cell: any) => cell.model.executionCount) ?? []
      );
    });

    if (counts !== previousCounts) {
      previousCounts = counts;
      stableSince = Date.now();
      idleSince = undefined;
    }

    const kernelIsIdle = await page
      .locator('#jp-main-statusbar >> text=Idle')
      .isVisible();
    if (kernelIsIdle) {
      idleSince ??= performance.now();
    } else {
      idleSince = undefined;
    }
    if (kernelIsIdle && Date.now() - stableSince >= quietPeriodMs) {
      return idleSince ?? performance.now();
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error("Timed out waiting for reactive cell executions to settle");
}

/**
 * Wait for a "Run All Cells" to finish and return the instant execution settled.
 *
 * Replaces Galata's page.notebook.waitForRun() for the initial run: waitForRun
 * only returns once EVERY code cell has an execution count, so a notebook whose
 * run halts partway (a cell errors -> JupyterLab stops, or a cell blocks the
 * kernel) never satisfies it and hangs until the per-test timeout. This instead
 * (1) confirms the run actually started, then (2) returns as soon as the kernel
 * is idle and execution counts have been stable for a short quiet period --
 * correct whether the run completes, errors partway, or a cell blocks, and
 * immune to the pre-run-idle race that produced bogus near-zero timings.
 */
async function waitForRunAllToSettle(page: Page): Promise<number> {
  const startTimeoutMs = 180_000;
  const settleTimeoutMs = 20 * 60 * 1000;
  const quietPeriodMs = 1_000;
  const pollIntervalMs = 100;

  const codeExecCounts = () => page.evaluate(() => {
    const app = (window as any).galata.app;
    const notebook = app.shell.currentWidget?.content;
    return JSON.stringify(
      notebook?.widgets
        .filter((cell: any) => cell.model.type === "code")
        .map((cell: any) => cell.model.executionCount) ?? []
    );
  });
  const kernelIsIdle = () =>
    page.locator('#jp-main-statusbar >> text=Idle').isVisible();

  // Phase 1: wait until a cell actually executes (an execution count appears),
  // not merely "kernel not idle" -- the kernel can read as busy during startup,
  // which would make phase 2 settle on the pre-run idle state and capture an
  // un-run notebook (bogus near-zero timing). Fail fast if nothing ever runs.
  const before = await codeExecCounts();
  const startDeadline = Date.now() + startTimeoutMs;
  let started = false;
  while (Date.now() < startDeadline) {
    if ((await codeExecCounts()) !== before) {
      started = true;
      break;
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  if (!started) {
    throw new Error(`Run All Cells produced no execution within ${startTimeoutMs / 1000}s`);
  }

  // Phase 2: settle on kernel-idle + stable counts.
  const deadline = Date.now() + settleTimeoutMs;
  let previousCounts = "";
  let stableSince = Date.now();
  let idleSince: number | undefined;
  while (Date.now() < deadline) {
    const counts = await codeExecCounts();
    if (counts !== previousCounts) {
      previousCounts = counts;
      stableSince = Date.now();
      idleSince = undefined;
    }
    if (await kernelIsIdle()) {
      idleSince ??= performance.now();
    } else {
      idleSince = undefined;
    }
    if (idleSince !== undefined && Date.now() - stableSince >= quietPeriodMs) {
      return idleSince;
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  throw new Error("Timed out waiting for Run All Cells to settle");
}

/** code-cell execution counts (null if unrun), in code-cell order. */
async function codeCellExecCounts(page: Page): Promise<(number | null)[]> {
  return page.evaluate(() => {
    const app = (window as any).galata.app;
    const nb = app.shell.currentWidget?.content;
    return (nb?.widgets ?? [])
      .filter((c: any) => c.model.type === "code")
      .map((c: any) => c.model.executionCount ?? null);
  });
}

/** absolute widget indices of the code cells, in order. */
async function codeCellAbsIndices(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const app = (window as any).galata.app;
    const nb = app.shell.currentWidget?.content;
    const out: number[] = [];
    (nb?.widgets ?? []).forEach((c: any, i: number) => {
      if (c.model.type === "code") out.push(i);
    });
    return out;
  });
}

/**
 * Finish executing a notebook whose "Run All Cells" halted early.
 *
 * In ipyflow reactive mode, Run-All stops at a cell that reassigns a tracked
 * symbol, so later cells never run and ipyflow's dependency graph stays
 * incomplete -- which suppresses the reactive ANCESTOR refresh on the following
 * edit (a self-reassigning cell like `data = data.repeat_interleave(...)` then
 * re-applies its transform to already-transformed data). Run any code cell still
 * lacking an execution count so the notebook reaches the fully-executed state a
 * manual run leaves before the modification. No-op when Run-All already
 * completed. Returns the instant execution settled.
 */
async function completeInitialRun(page: Page): Promise<number> {
  const absIdx = await codeCellAbsIndices(page);
  for (let i = 0; i < absIdx.length; i++) {
    const counts = await codeCellExecCounts(page);
    if (counts[i] === null) {
      await page.notebook.runCell(absIdx[i]);
      await waitForReactiveExecutionsToSettle(page);
    }
  }
  return waitForReactiveExecutionsToSettle(page);
}

async function prepareExecution(page: Page, cellIndex?: number): Promise<void> {
  await page.evaluate((index) => {
    (window as any).galata.resetExecutionCount(index);
  }, cellIndex);
  await page.waitForFunction(() => {
    const text = document.querySelector('#jp-main-statusbar')?.textContent ?? '';
    return !['Connecting', 'Initializing', 'Starting'].some(status =>
      text.includes(status)
    );
  });
}

test.use({ tmpPath: "notebook-test" });
test.describe.serial("Notebook Run", () => {
  test.beforeAll(async ({ request, tmpPath }) => {
    const uploadFromPath = path.join(
      __dirname,
      "..",
      `${benchmarks_dir}/${fileName}`
    );
    const contents = galata.newContentsHelper(request);

    console.log(`=== [UI] UPLOADING NOTEBOOK FROM: ${uploadFromPath}`);
    await contents.uploadFile(
      path.resolve(__dirname, `${uploadFromPath}`),
      `${tmpPath}/${fileName}`
    );

    if (datadirectory) {
      const uploadFromPath = path.join(__dirname, "..", `${datadirectory}`);
      const contents = galata.newContentsHelper(request);
      const targetPath = path.basename(datadirectory);

      console.log(
        `=== [UI] UPLOADING DATA DIRECTORY FROM: ${uploadFromPath} to ${targetPath}`
      );
      await contents.uploadDirectory(
        path.resolve(__dirname, `${uploadFromPath}`),
        targetPath
      );
    }

    for (const script of supportingScripts) {
      const localPath = path.resolve(__dirname, "..", script.sourcePath);
      const uploadTarget = path.normalize(path.join(tmpPath, script.targetRelPath));
      console.log(
        `=== [UI] UPLOADING SUPPORTING SCRIPT FROM: ${localPath} to ${uploadTarget}`
      );
      if (script.isDirectory) {
        await contents.uploadDirectory(localPath, uploadTarget);
      } else {
        await contents.uploadFile(localPath, uploadTarget);
      }
    }
  });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.filebrowser.openDirectory(tmpPath);
  });

  test.afterAll(async ({ request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteDirectory(tmpPath);
  });

  test("Run notebook initially and capture cell outputs", async ({
    page,
    tmpPath,
  }) => {
    // Open notebook
    console.log(`=== [UI] OPENING NOTEBOOK: ${fileName}`);
    await page.notebook.openByPath(`${tmpPath}/${fileName}`);
    await page.notebook.activate(fileName);

    // Run all cells
    console.log(`=== [UI] RUNNING ALL CELLS`);
    await prepareExecution(page);
    const initialRunStartedAt = performance.now();
    await page.menu.clickMenuItem('Run>Run All Cells');
    await waitForRunAllToSettle(page);
    // ipyflow reactive Run-All halts at a symbol-reassigning cell; finish the
    // rest so the initial state matches a manual full run (see completeInitialRun).
    const initialRunSettledAt = await completeInitialRun(page);
    const initialWallTimeSeconds =
      (initialRunSettledAt - initialRunStartedAt) / 1000;
    await page.notebook.save();

    // Download notebook (for identifying how many cells have reran later)
    console.log(
      `=== [UI] SAVING INITIAL RUN NOTEBOOK IN: ${downloadInitialPath}`
    );
    // Open File>Download via the galata menu helper (same one used for
    // Run>Run All Cells above). A bare getByText("File") matched any element
    // whose text is exactly "File" -- including cell outputs / tracebacks that
    // print "File ~/..." -- so notebooks with such output hit Playwright's
    // strict-mode violation and the download click failed the whole benchmark.
    const downloadOriginalPathPromise = page.waitForEvent("download");
    await page.menu.clickMenuItem("File>Download");
    const downloadOriginal = await downloadOriginalPathPromise;
    await downloadOriginal.saveAs(downloadInitialPath);

    // Make change. cellIndex is the ABSOLUTE JupyterLab cell index (markdown
    // included), which is what the Galata helpers below address by.
    console.log(
      `=== [UI] MAKING MODIFICATION (${modOp}) AT CELL INDEX: ${modification.cellIndex}`
    );

    let reactiveRunStartedAt: number;

    if (modOp === "delete") {
      // Deletion has no user-triggered execution: the reactive cascade is
      // driven by the frontend's debounced content_changed message, which the
      // nnb kernel diffs to detect the removed cell and returns rerun_cells.
      // Start the timer immediately before the delete and settle afterwards.
      const beforeCount = await page.notebook.getCellCount();
      await page.notebook.selectCells(modification.cellIndex);
      await prepareExecution(page);
      reactiveRunStartedAt = performance.now();
      await page.notebook.deleteCells();
      await page.waitForFunction(
        (c) => {
          const app = (window as any).galata.app;
          const nb = app.shell.currentWidget?.content;
          return (nb?.widgets.length ?? 0) === c - 1;
        },
        beforeCount
      );
    } else {
      // "add": insert an empty cell at the target index, then fall through to
      // the same "set source + run one cell" path used by "edit".
      if (modOp === "add") {
        const beforeCount = await page.notebook.getCellCount();
        if (modification.cellIndex === 0) {
          // Insert above the first cell ('a' = insert above in command mode).
          await page.notebook.selectCells(0);
          await page.keyboard.press("a");
        } else {
          // Insert below the preceding cell (same toolbar item Galata's
          // addCell uses), which lands the new cell at cellIndex.
          await page.notebook.selectCells(modification.cellIndex - 1);
          await page.notebook.clickToolbarItem("insert");
        }
        await page.waitForFunction(
          (c) => {
            const app = (window as any).galata.app;
            const nb = app.shell.currentWidget?.content;
            return (nb?.widgets.length ?? 0) === c + 1;
          },
          beforeCount
        );
      }

      // Apply the edit through the KEYBOARD (enter edit mode, select-all,
      // delete, insert text) rather than Galata's setCell. setCell writes the
      // cell model programmatically and ipyflow's frontend does not treat it as
      // a human edit, so the reactive DESCENDANT reruns are suppressed; a
      // keyboard edit reproduces the manual reactive cascade. enterCellEditingMode
      // is windowing-aware (scrolls the cell in, materializes CodeMirror);
      // keyboard.insertText avoids the auto-indent that mangles multi-line source
      // typed key-by-key.
      const entered = await page.notebook.enterCellEditingMode(
        modification.cellIndex
      );
      if (!entered) {
        console.log(
          `=== [UI] COULD NOT EDIT CELL ${modification.cellIndex}, CLOSING TEST`
        );
        return;
      }
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Delete");
      await page.keyboard.insertText(modification.source);
      await page.keyboard.press("Escape");
      await page.notebook.selectCells(modification.cellIndex);
      await prepareExecution(page, modification.cellIndex);
      reactiveRunStartedAt = performance.now();
      await page.keyboard.press('Control+Enter');
      await page.notebook.waitForRun();
    }

    const reactiveRunSettledAt = await waitForReactiveExecutionsToSettle(page);
    const reactiveWallTimeSeconds =
      (reactiveRunSettledAt - reactiveRunStartedAt) / 1000;
    const totalWallTimeSeconds =
      initialWallTimeSeconds + reactiveWallTimeSeconds;
    console.log(`=== [METRICS] ${JSON.stringify({
      schemaVersion: 1,
      initialWallTimeSeconds,
      reactiveWallTimeSeconds,
      totalWallTimeSeconds,
    })}`);
    await page.notebook.save();

    // Save modified notebook output. For a deletion the target cell no longer
    // exists, so there is nothing to read.
    if (modOp !== "delete") {
      const cellOutput = await page.notebook.getCellTextOutput(
        modification.cellIndex
      );
      console.log(
        `=== [UI] MODIFIED CELL (${modification.cellIndex}) OUTPUT: ${cellOutput}`
      );
    }

    // Note: a second waitForRun()+save() used to happen here, immediately
    // after the one above with nothing state-changing in between besides a
    // read-only getCellTextOutput() call. JupyterLab's save() re-fetches the
    // server's current content hash right before writing and compares it to
    // what the client last cached (see DocumentWidgetManager._maybeSave /
    // _raiseConflict in @jupyterlab/docregistry, bundled into
    // jlab_core.*.js): two save() calls fired back-to-back was the suspected
    // trigger for a "File Changed on disk" conflict dialog blocking the
    // download step below. Removed as the fix; if a second save is later
    // found necessary, re-add it but confirm this race doesn't reappear.

    // Download notebook
    console.log(
      `=== [UI] SAVING MODIFIED NOTEBOOK IN: ${downloadReactivePath}`
    );
    // See note above: menubar-scoped File>Download avoids the getByText("File")
    // strict-mode violation when cell output contains the text "File".
    const downloadPromise = page.waitForEvent("download");
    await page.menu.clickMenuItem("File>Download");
    const download = await downloadPromise;
    await download.saveAs(downloadReactivePath);

    // await page.pause();
  });
});
