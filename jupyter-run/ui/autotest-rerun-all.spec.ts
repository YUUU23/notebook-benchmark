import { expect, galata, test } from "@jupyterlab/galata";
import type { Page } from "@playwright/test";
import * as path from "path";
import test_config from "../config/mod_config_file.json";
import { ContentsHelper } from "@jupyterlab/galata/lib/contents";

// Rerun-All baseline WITH wall-time timing: run all cells once (cold initial),
// edit the modification cell, then run the ENTIRE notebook again (second, warm
// run-all). Emits initial/reactive/total wall times so the sheet's Rerun-All
// total is a real measurement instead of the definitional 2*initial. The
// "reactive" phase here is the second full run-all (there is no reactive kernel);
// the key name is kept for pipeline parity with the other specs. See
// doc/journal.md.

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
// Modification kind: "edit" (default), "add", or "delete". Mirrors the reactive
// specs (autotest.spec.ts) so add/delete benchmarks apply the correct change; a
// blanket edit-fill would leave the added/deleted cell wrong.
const modOp: string = (modification as any).op ?? "edit";
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
 * Copied verbatim from autotest-python3.spec.ts.
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
 * Wait for "Run All Cells" to finish and return the instant execution settled.
 *
 * Based on the copy in autotest-python3.spec.ts / autotest-baseline.spec.ts (the
 * specs each carry their own copy; there is no shared import), but with a
 * COMPLETION guard the plain idle+stable version lacks. See autotest.spec.ts for
 * why this replaces Galata's waitForRun() (which hangs until the per-test timeout
 * when a run halts partway on an erroring cell).
 *
 * The plain version returns on "kernel idle + counts stable for quietPeriodMs".
 * For a fast notebook that has a short idle gap between cells, that window can
 * elapse before the LAST cell runs, so the download captures an un-run trailing
 * cell (execution_count == null, dropped by NotebookManager.delete_last_empty_cell)
 * -- which made get_cells_reran under-count Rerun-All by one cell (reran "1,2,3"
 * instead of "1,2,3,4"; see doc/journal.md). Rerun-All's reran/total columns are
 * computed by diffing the two downloads, so a complete run matters here in a way
 * it does not for the initial-only specs. We therefore return only when the run
 * has actually FINISHED: every code cell has a non-null execution count, kernel
 * idle, counts stable for quietPeriodMs. If some counts remain null but the kernel
 * has been idle+stable for the longer haltGraceMs, an upstream cell errored (later
 * cells will never run) -> return anyway so an erroring modification never hangs.
 */
async function waitForRunAllToSettle(page: Page): Promise<number> {
  const startTimeoutMs = 180_000;
  const settleTimeoutMs = 20 * 60 * 1000;
  const quietPeriodMs = 1_000;    // idle+stable window for a fully-executed run
  const haltGraceMs = 5_000;      // longer idle+stable window that also accepts
                                  // leftover nulls (an upstream cell errored)
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

  // Wait until a cell actually executes (a count appears), not just "kernel not
  // idle" (which is true during startup and would settle on the pre-run state,
  // capturing an un-run notebook). Fail fast if nothing ever runs.
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

  // Settle once no code cell is pending and the kernel has been idle, counts
  // unchanged, for the window (it starts at the first idle sample after the
  // last busy sample or count change). See doc/journal.md 2026-10-14.
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
    if (await kernelIsIdle()) {
      idleSince ??= performance.now();
    } else {
      idleSince = undefined;
    }
    const pending = await pendingCodeCells(page);
    const parsed = JSON.parse(counts) as (number | null)[];
    const allExecuted = parsed.length > 0 && !parsed.includes(null);
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
      return idleSince;
    }
    await page.waitForTimeout(pollIntervalMs);
  }
  throw new Error("Timed out waiting for Run All Cells to settle");
}

/** Reset execution counts and wait until the kernel is past its startup states.
 * Copied verbatim from autotest-python3.spec.ts / autotest-baseline.spec.ts. */
async function prepareExecution(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).galata.resetExecutionCount();
  });
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
    try {
      await page.evaluate(async () => {
        // Wait for the kernel to be idle for a continuous quiet period before
        // shutting it down, so we never close its ZMQ sockets mid-execute_request
        // (-> ZMQError: ENOTSOCK on the kernel side). Bounded. See doc/journal.md.
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

  test("Run notebook, modify, and rerun all with wall-time timing", async ({
    page,
    tmpPath,
    request,
  }) => {
    // Open notebook
    console.log(`=== [UI] OPENING NOTEBOOK: ${fileName}`);
    await page.notebook.openByPath(`${tmpPath}/${fileName}`);
    await page.notebook.activate(fileName);

    // Snapshot the STAGED INPUTS before the first run generates anything. All
    // inputs (data files, hard-linked oversize data, supporting modules) are
    // staged under tmpPath by beforeAll + benchmark_runner._stage_oversize_data
    // BEFORE this test runs, so whatever is here now is input, not output. The FS
    // reset below spares these and deletes only entries created during run 1 --
    // otherwise the reset wipes the very inputs the second run-all needs, and
    // realworld notebooks fail with "No such file" (see doc/journal.md).
    const contents = galata.newContentsHelper(request);
    const stagedBefore = new Set<string>();
    const stagedMeta = await contents.getContentMetadata(tmpPath, "directory");
    if (stagedMeta && stagedMeta.type === "directory") {
      for (const item of stagedMeta.content) {
        stagedBefore.add(item.name);
      }
    }

    // Initial run all (cold), timed.
    console.log(`=== [UI] RUNNING ALL CELLS`);
    await prepareExecution(page);
    const initialRunStartedAt = performance.now();
    await page.menu.clickMenuItem('Run>Run All Cells');
    const initialRunSettledAt = await waitForRunAllToSettle(page);
    const initialWallTimeSeconds =
      (initialRunSettledAt - initialRunStartedAt) / 1000;
    await page.notebook.save();

    // Download notebook (for identifying how many cells have reran later)
    console.log(
      `=== [UI] SAVING INITIAL RUN NOTEBOOK IN: ${downloadInitialPath}`
    );
    // File>Download via the galata menu helper: a bare getByText("File") matched
    // any element whose text is exactly "File" (e.g. "File ~/..." in tracebacks),
    // tripping Playwright's strict-mode violation and failing the download.
    const downloadOriginalPathPromise = page.waitForEvent("download");
    await page.menu.clickMenuItem("File>Download");
    const downloadOriginal = await downloadOriginalPathPromise;
    await downloadOriginal.saveAs(downloadInitialPath);

    // Make change (untimed). Apply the modification the same way the reactive
    // spec does (autotest.spec.ts) so add/delete land correctly and an edit's
    // source is committed to the cell MODEL -- a bare fill() can leave the
    // windowed editor's source uncommitted, so the cell runs empty on Run All
    // and is dropped (see doc/journal.md).
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
      // "add": insert an empty cell at the target index, then fall through to the
      // same set-source path as "edit".
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
      await page.notebook.selectCells(modification.cellIndex);
      // Commit the edited source onto the cell MODEL before Run All reads it.
      await page.evaluate(
        ({ i, src }) => {
          const nb = (window as any).galata.app.shell.currentWidget?.content;
          nb?.widgets[i]?.model.sharedModel.setSource(src);
        },
        { i: modification.cellIndex, src: modification.source }
      );
    }
    await page.notebook.save();

    // Reset FS (untimed): delete only entries CREATED during run 1 (generated
    // outputs), sparing the notebook and every staged input in stagedBefore, so
    // the second run-all still finds its data/modules. Outputs written INSIDE a
    // spared input dir persist to run 2 (minor warmth); acceptable vs. wiping
    // inputs outright. See doc/journal.md.
    const dirContent = await contents.getContentMetadata(tmpPath, "directory");
    if (!(dirContent && dirContent.type === "directory")) {
      console.log("DIR NOT FOUND!!");
    } else {
      for (const item of dirContent.content) {
        if (item.name.endsWith(".ipynb")) {
          continue;
        }
        if (stagedBefore.has(item.name)) {
          continue;   // staged input -> spare
        }
        console.log("DELETING GENERATED: ", item.name);
        if (item.type === "directory") {
          if (!(await contents.deleteDirectory(item.path))) {
            console.log("deleting failed for: ", item.name);
          }
        } else {
          if (!(await contents.deleteFile(item.path))) {
            console.log("deleting failed for: ", item.name);
          }
        }
      }
    }

    // Rerun entire notebook again (second, warm run-all), timed.
    console.log(`=== [UI] RUN ENTIRE NOTEBOOK AGAIN CELLS`);
    await prepareExecution(page);
    const rerunStartedAt = performance.now();
    await page.menu.clickMenuItem('Run>Run All Cells');
    const rerunSettledAt = await waitForRunAllToSettle(page);
    const reactiveWallTimeSeconds =
      (rerunSettledAt - rerunStartedAt) / 1000;
    await page.notebook.save();

    const totalWallTimeSeconds =
      initialWallTimeSeconds + reactiveWallTimeSeconds;
    console.log(`=== [METRICS] ${JSON.stringify({
      schemaVersion: 1,
      initialWallTimeSeconds,
      reactiveWallTimeSeconds,
      totalWallTimeSeconds,
    })}`);

    // Save modified notebook output (skip for delete: that cell no longer exists).
    if (modOp !== "delete") {
      const cellOutput = await page.notebook.getCellTextOutput(
        modification.cellIndex
      );
      console.log(
        `=== [UI] MODIFIED CELL (${modification.cellIndex}) OUTPUT: ${cellOutput}`
      );
    }

    await page.notebook.save();

    // Download notebook
    console.log(
      `=== [UI] SAVING MODIFIED NOTEBOOK IN: ${downloadReactivePath}`
    );
    // File>Download via the galata menu helper (see note above): avoids the
    // getByText("File") strict-mode violation when cell output contains "File".
    const downloadPromise = page.waitForEvent("download");
    await page.menu.clickMenuItem("File>Download");
    const download = await downloadPromise;
    await download.saveAs(downloadReactivePath);
  });
});
