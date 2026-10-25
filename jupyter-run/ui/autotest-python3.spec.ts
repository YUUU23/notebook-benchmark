import { expect, galata, test } from "@jupyterlab/galata";
import type { Page } from "@playwright/test";
import * as path from "path";
import test_config from "../config/mod_config_file.json";

// python3 BASELINE spec (Google Sheet columns E + F).
//
// Unlike autotest.spec.ts (reactive kernels, which cascade on their own) the
// plain python3 kernel does not rerun dependents. This spec instead:
//   1. runs the notebook top-to-bottom once   -> initialWallTimeSeconds (col E)
//   2. applies the modification (edit/add/delete), NOT timed
//   3. reruns exactly the cells in the manually-maintained rerun set (sheet
//      column D, translated to absolute indices by benchmark_runner) as ONE
//      batch (all queued at once, like Run All), timed  -> rerun portion
//   4. reports totalWallTimeSeconds = initial + rerun   (col F)
// so column F is comparable to the reactive kernels' initial+reactive total.

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
const modOp: string = (modification as any).op ?? "edit";
// Absolute cell indices (markdown included, ascending) to rerun after the
// modification -- the baseline's manual dependency set. Empty => rerun nothing.
const rerunCellIndices: number[] = (modification as any).rerunCellIndices ?? [];
const datadirectory = test_config.dataDirectory;
const supportingScripts: { sourcePath: string; targetRelPath: string; isDirectory: boolean }[] =
  (test_config as any).supportingScripts ?? [];

/**
 * Resolves once the kernel has handled every request sent before it: a
 * kernel_info request is queued behind cell executions on the shell channel
 * (checked 2026-10-22 for the nnb, python3 and ipyflow-monitoring kernels). Used
 * when cells are still pending although the status bar reads Idle, which it can
 * while a cell is still running (GGAE cell 5; doc/journal.md 2026-10-22).
 */
async function kernelBarrier(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const app = (window as any).galata.app;
    await app.shell.currentWidget?.sessionContext?.session?.kernel?.requestKernelInfo();
  });
}

/**
 * Number of code cells JupyterLab still marks as running or queued
 * (`executionState === 'running'`; cleared when the execute reply arrives,
 * including the aborted replies for cells skipped after an error).
 */
async function pendingCodeCells(page: Page): Promise<number> {
  return page.evaluate(() => {
    const app = (window as any).galata.app;
    const cells = app.shell.currentWidget?.content?.widgets ?? [];
    return cells.filter((c: any) =>
      c.model.type === "code" && c.model.executionState === "running"
    ).length;
  });
}

/**
 * Wait for a "Run All Cells" to finish and return the instant execution settled.
 *
 * Replaces Galata's page.notebook.waitForRun() for the initial run: waitForRun
 * only returns once EVERY code cell has an execution count, so a notebook whose
 * run halts partway (a cell errors -> JupyterLab stops, or a cell blocks the
 * kernel) never satisfies it and hangs until the per-test timeout. This instead
 * (1) confirms the run actually started, then (2) returns once no code cell is
 * pending and the kernel has stayed idle, counts unchanged, for a short quiet
 * period -- correct whether the run completes or errors partway, and immune to
 * the pre-run-idle race that produced bogus near-zero timings and to the
 * sub-second idle gaps between queued cells. If cells stay pending while the
 * kernel is idle for pendingGraceMs (a lost reply), it returns with a warning.
 */
async function waitForRunAllToSettle(page: Page): Promise<number> {
  const startTimeoutMs = 180_000;
  const settleTimeoutMs = 20 * 60 * 1000;
  const quietPeriodMs = 1_000;
  const pendingGraceMs = 10_000;
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

  // Phase 2: settle once no code cell is pending and the kernel has been idle,
  // counts unchanged, for quietPeriodMs (window starts at the first idle sample
  // after the last busy sample or count change). See doc/journal.md 2026-10-14.
  const trace = !!process.env.REACTIVE_TRACE;
  const t0 = performance.now();
  let lastTrace = "";
  const deadline = Date.now() + settleTimeoutMs;
  let previousCounts = "";
  let idleSince: number | undefined;
  let barrierDone = false;
  while (Date.now() < deadline) {
    const counts = await codeExecCounts();
    if (counts !== previousCounts) {
      previousCounts = counts;
      idleSince = undefined;
    }
    const idle = await kernelIsIdle();
    if (idle) {
      idleSince ??= performance.now();
    } else {
      idleSince = undefined;
    }
    const pending = await pendingCodeCells(page);
    if (trace) {
      const line = `idle=${idle} pending=${pending} counts=${counts}`;
      if (line !== lastTrace) {
        console.log(`=== [UI][trace] +${((performance.now() - t0) / 1000).toFixed(2)}s ${line}`);
        lastTrace = line;
      }
    }
    const quietFor = idleSince === undefined ? 0 : performance.now() - idleSince;
    if (quietFor >= quietPeriodMs && pending === 0) {
      return idleSince!;
    }
    if (quietFor >= pendingGraceMs) {
      if (pending > 0 && !barrierDone) {
        // Idle with cells pending: confirm with the kernel before assuming lost replies.
        await kernelBarrier(page);
        barrierDone = true;
        idleSince = undefined;
        continue;
      }
      console.log(`=== [UI] WARNING: run-all settled with ${pending} cell(s) still pending`);
      return idleSince!;
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  throw new Error("Timed out waiting for Run All Cells to settle");
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

/**
 * Run a SET of cells (absolute indices) as one batch and return the instant the
 * kernel settled.
 *
 * Mirrors "Run All Cells": select every target cell, fire ONE
 * `notebook:run-cell` (= NotebookActions.run -> runSelected -> runCells, the
 * same path Run All takes), so all execute requests are queued in one go and
 * the kernel runs them back to back. There is no Playwright round-trip between
 * cells, so the measured reactive time is kernel work, comparable with the
 * Run All timings of the other specs. Caller must prepareExecution() first (it
 * nulls every code cell's executionCount, which is what "executed" is tested
 * against).
 *
 * Settles like waitForRunAllToSettle: no cell pending and kernel idle + counts
 * stable for quietPeriodMs once every target cell has a count; or, if a target cell never
 * gets one (an earlier cell errored -> JupyterLab halts the batch, or the
 * intermittent kernel-message-drop race, see doc/journal.md), after the longer
 * haltGraceMs idle+stable window, with the un-executed cells logged. Returns
 * the idle instant, so the quiet window never inflates the timing.
 */
async function runCellsBatchedAndSettle(
  page: Page,
  cellIndices: number[]
): Promise<number> {
  // A cell gets its count only when it finishes, so this covers the first cell's
  // full run (mimic_mlp_m2 starts with Adam training).
  const startTimeoutMs = 20 * 60 * 1000;
  const settleTimeoutMs = 20 * 60 * 1000;
  const quietPeriodMs = 1_000;
  const haltGraceMs = 5_000;
  const pollIntervalMs = 100;

  const targetExecCounts = () => page.evaluate((idxs) => {
    const app = (window as any).galata.app;
    const widgets = app.shell.currentWidget?.content?.widgets ?? [];
    return JSON.stringify(
      idxs.map((i: number) => widgets[i]?.model?.executionCount ?? null)
    );
  }, cellIndices);
  const kernelIsIdle = () =>
    page.locator('#jp-main-statusbar >> text=Idle').isVisible();

  // Sample BEFORE dispatch: a tiny batch can finish inside one round-trip.
  const before = await targetExecCounts();

  // Select all targets, then one run command. Set activeCellIndex FIRST: its
  // setter trims the selection, so selecting before it would lose cells.
  // Fire-and-forget (void) so the deadline below stays authoritative.
  await page.evaluate(async (idxs) => {
    const app = (window as any).galata.app;
    const panel = app.shell.currentWidget;
    const nb = panel.content;
    await panel.sessionContext?.ready;
    nb.mode = "command";
    nb.activeCellIndex = idxs[0];
    nb.deselectAll();
    for (const i of idxs) nb.select(nb.widgets[i]);
    void app.commands.execute("notebook:run-cell");
  }, cellIndices);

  // Phase 1: confirm something ran.
  const startDeadline = Date.now() + startTimeoutMs;
  let started = false;
  while (Date.now() < startDeadline) {
    if ((await targetExecCounts()) !== before) {
      started = true;
      break;
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  if (!started) {
    throw new Error(
      `Batched rerun of cells ${JSON.stringify(cellIndices)} produced no ` +
      `execution within ${startTimeoutMs / 1000}s`
    );
  }

  // Phase 2: settle on kernel-idle + stable counts + nothing pending; the
  // quiet window starts at the first idle sample after the last busy sample
  // or count change (see waitForRunAllToSettle).
  const deadline = Date.now() + settleTimeoutMs;
  let previousCounts = "";
  let idleSince: number | undefined;
  let barrierDone = false;
  while (Date.now() < deadline) {
    const counts = await targetExecCounts();
    if (counts !== previousCounts) {
      previousCounts = counts;
      idleSince = undefined;
    }
    if (await kernelIsIdle()) {
      idleSince ??= performance.now();
    } else {
      idleSince = undefined;
    }
    const pending = await pendingCodeCells(page);
    const parsed = JSON.parse(counts) as (number | null)[];
    const allExecuted = !parsed.includes(null);
    const quietFor = idleSince === undefined ? 0 : performance.now() - idleSince;
    if (idleSince !== undefined && quietFor >= haltGraceMs && pending > 0 && !barrierDone) {
      // Idle with cells pending: confirm with the kernel before accepting a halt.
      await kernelBarrier(page);
      barrierDone = true;
      idleSince = undefined;
      continue;
    }
    if (idleSince !== undefined &&
        ((allExecuted && pending === 0 && quietFor >= quietPeriodMs) ||
         quietFor >= haltGraceMs)) {
      if (!allExecuted) {
        const missing = cellIndices.filter((_, k) => parsed[k] === null);
        console.log(
          `=== [UI] WARNING: rerun cells never executed: ${JSON.stringify(missing)}`
        );
      }
      return idleSince;
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  throw new Error(
    `Batched rerun of cells ${JSON.stringify(cellIndices)} did not settle ` +
    `within ${settleTimeoutMs / 1000}s`
  );
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
    // A "File Changed on disk" conflict dialog (docregistry context._raiseConflict)
    // is a server/client mtime race that otherwise intercepts pointer events and
    // hangs a click for the full test timeout (see doc/journal.md, explore_siren m2).
    // Auto-dismiss it by keeping the in-browser executed version ("Overwrite" ->
    // contents.save), which is the version we then download.
    await page.addLocatorHandler(
      page.getByRole("dialog", { name: /File Changed/ }),
      async (dialog) => {
        await dialog.getByRole("button", { name: "Overwrite" }).click();
      }
    );
  });

  test.afterEach(async ({ page }) => {
    // Shut down every running kernel through the app's authenticated kernel
    // manager before the page + per-test webServer are torn down. Playwright
    // kills the "jlpm start" webServer abruptly, orphaning its kernels; across a
    // multi-step run they accumulate and OOM the machine, and
    // benchmark_runner.reap_kernels() cannot reach the per-step server between
    // steps (Connection refused). See doc/journal.md.
    //
    // First wait (bounded) for the notebook's kernel to be idle for a continuous
    // quiet period: shutting a kernel down mid-request closes its ZMQ sockets while
    // an execute_request is still being handled, so the reply send raises
    // `ZMQError: ENOTSOCK` on the kernel side (harmless -- outputs are already saved
    // -- but noisy). A single idle check is not enough for a reactive (ipyflow)
    // kernel: it flickers idle between cascade steps, so a trailing reactive
    // execute can still race the shutdown. See doc/journal.md.
    try {
      await page.evaluate(async () => {
        const app = (window as any).galata?.app;
        const kernelOf = () =>
          app?.shell?.currentWidget?.sessionContext?.session?.kernel;
        const deadline = Date.now() + 15_000;
        const quietMs = 1_500;
        let idleSince = 0;
        while (Date.now() < deadline) {
          const k = kernelOf();
          if (!k || k.status === "dead") break;
          if (k.status === "idle") {
            if (idleSince === 0) idleSince = Date.now();
            if (Date.now() - idleSince >= quietMs) break;
          } else {
            idleSince = 0;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        const km = app?.serviceManager?.kernels;
        if (!km) return;
        await km.refreshRunning();
        const ids = Array.from(km.running()).map((m: any) => m.id);
        await Promise.all(ids.map((id: string) => km.shutdown(id)));
      });
    } catch (e) {
      console.log(`=== [UI] WARNING: kernel shutdown in afterEach failed: ${e}`);
    }
  });

  test.afterAll(async ({ request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteDirectory(tmpPath);
  });

  test("Run notebook, modify, then rerun the manual cell set (python3 baseline)", async ({
    page,
    tmpPath,
  }) => {
    // Open notebook
    console.log(`=== [UI] OPENING NOTEBOOK: ${fileName}`);
    await page.notebook.openByPath(`${tmpPath}/${fileName}`);
    await page.notebook.activate(fileName);

    // Run all cells (column E)
    console.log(`=== [UI] RUNNING ALL CELLS`);
    await prepareExecution(page);
    const initialRunStartedAt = performance.now();
    await page.menu.clickMenuItem('Run>Run All Cells');
    const initialRunSettledAt = await waitForRunAllToSettle(page);
    const initialWallTimeSeconds =
      (initialRunSettledAt - initialRunStartedAt) / 1000;
    await page.notebook.save();

    // Download the initial run notebook.
    console.log(
      `=== [UI] SAVING INITIAL RUN NOTEBOOK IN: ${downloadInitialPath}`
    );
    // menubar-scoped File>Download avoids the getByText("File") strict-mode
    // violation when cell output contains the text "File".
    const downloadOriginalPathPromise = page.waitForEvent("download");
    await page.menu.clickMenuItem("File>Download");
    const downloadOriginal = await downloadOriginalPathPromise;
    await downloadOriginal.saveAs(downloadInitialPath);

    // Apply the modification (NOT timed -- matches autotest.spec.ts which times
    // execution, not typing). cellIndex is the ABSOLUTE JupyterLab cell index.
    console.log(
      `=== [UI] MAKING MODIFICATION (${modOp}) AT CELL INDEX: ${modification.cellIndex}`
    );

    if (modOp === "delete") {
      const beforeCount = await page.notebook.getCellCount();
      await page.notebook.selectCells(modification.cellIndex);
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
      if (modOp === "add") {
        const beforeCount = await page.notebook.getCellCount();
        if (modification.cellIndex === 0) {
          await page.notebook.selectCells(0);
          await page.keyboard.press("a");
        } else {
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

      // Enter the edit with one keyboard.insertText, not Galata's setCell: setCell
      // types key by key and CodeMirror's auto-indent mangles multi-line source
      // (same edit as autotest-ipyflow.spec.ts; doc/journal.md 2026-10-24).
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
    }

    // Rerun the manual set (sheet column D) as ONE batch, timed like Run All:
    // every cell queued at once, settle once on kernel idle. See
    // runCellsBatchedAndSettle.
    console.log(
      `=== [UI] RERUNNING MANUAL CELL SET (col D): ${JSON.stringify(rerunCellIndices)}`
    );
    await prepareExecution(page);
    const rerunStartedAt = performance.now();
    const rerunSettledAt = await runCellsBatchedAndSettle(page, rerunCellIndices);
    const reactiveWallTimeSeconds = (rerunSettledAt - rerunStartedAt) / 1000;
    const totalWallTimeSeconds =
      initialWallTimeSeconds + reactiveWallTimeSeconds;
    console.log(`=== [METRICS] ${JSON.stringify({
      schemaVersion: 1,
      initialWallTimeSeconds,
      reactiveWallTimeSeconds,
      totalWallTimeSeconds,
    })}`);
    await page.notebook.save();

    // Download the modified notebook so benchmark_runner post-processing works.
    console.log(
      `=== [UI] SAVING MODIFIED NOTEBOOK IN: ${downloadReactivePath}`
    );
    const downloadPromise = page.waitForEvent("download");
    await page.menu.clickMenuItem("File>Download");
    const download = await downloadPromise;
    await download.saveAs(downloadReactivePath);
  });
});
