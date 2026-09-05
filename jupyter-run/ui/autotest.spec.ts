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
    const initialRunSettledAt = await waitForRunAllToSettle(page);
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

    // Make change
    console.log(
      `=== [UI] MAKING MODIFICATION TO CELL INDEX: ${modification.cellIndex}`
    );
    // Use Galata's setCell to replace the cell source: it is windowing-aware
    // (scrolls the target cell into the windowed viewport and enters edit mode
    // to materialize the CodeMirror editor before typing). The previous manual
    // getByRole("textbox").press(...) skipped edit-mode entry, so for a cell
    // scrolled out of view after "Run All" the editor never became actionable
    // and the step hung until the test timeout.
    const modApplied = await page.notebook.setCell(
      modification.cellIndex, "code", modification.source
    );
    if (!modApplied) {
      console.log(
        `=== [UI] COULD NOT SET CELL ${modification.cellIndex}, CLOSING TEST`
      );
      return;
    }
    await page.notebook.selectCells(modification.cellIndex);
    await prepareExecution(page, modification.cellIndex);
    const reactiveRunStartedAt = performance.now();
    await page.keyboard.press('Control+Enter');
    await page.notebook.waitForRun();
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

    // Save modified notebook output
    const cellOutput = await page.notebook.getCellTextOutput(
      modification.cellIndex
    );
    console.log(
      `=== [UI] MODIFIED CELL (${modification.cellIndex}) OUTPUT: ${cellOutput}`
    );

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
