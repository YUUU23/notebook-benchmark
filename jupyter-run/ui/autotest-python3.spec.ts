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
//      column D, translated to absolute indices by benchmark_runner) in order,
//      timed                                    -> rerun portion
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

      const modApplied = await page.notebook.setCell(
        modification.cellIndex, "code", modification.source
      );
      if (!modApplied) {
        console.log(
          `=== [UI] COULD NOT SET CELL ${modification.cellIndex}, CLOSING TEST`
        );
        return;
      }
    }

    // Rerun the manual set (sheet column D) top-to-bottom, timed. Each runCell
    // runs one cell and waits for it, so the loop is sequential like a user
    // manually re-executing the affected cells.
    console.log(
      `=== [UI] RERUNNING MANUAL CELL SET (col D): ${JSON.stringify(rerunCellIndices)}`
    );
    await prepareExecution(page);
    const rerunStartedAt = performance.now();
    for (const idx of rerunCellIndices) {
      await page.notebook.runCell(idx, true);
    }
    const rerunSettledAt = performance.now();
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
