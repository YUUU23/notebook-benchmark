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
  const timeoutMs = 30_000;
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
    await page.notebook.waitForRun();
    const initialWallTimeSeconds =
      (performance.now() - initialRunStartedAt) / 1000;
    await page.notebook.save();

    // Download notebook (for identifying how many cells have reran later)
    console.log(
      `=== [UI] SAVING INITIAL RUN NOTEBOOK IN: ${downloadInitialPath}`
    );
    await page.getByText("File", { exact: true }).click();
    const downloadOriginalPathPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download" }).click();
    const downloadOriginal = await downloadOriginalPathPromise;
    await downloadOriginal.saveAs(downloadInitialPath);

    // Make change
    console.log(
      `=== [UI] MAKING MODIFICATION TO CELL INDEX: ${modification.cellIndex}`
    );
    const cell = await page.notebook.getCellLocator(modification.cellIndex);
    if (!cell) {
      console.log(
        `=== [UI] CELL WITH CELL INDEX ${modification.cellIndex} FOUND, CLOSING TEST`
      );
      return;
    }
    await cell.getByRole("textbox").press("ControlOrMeta+a");
    await cell.getByRole("textbox").press("Backspace");
    await cell.getByRole("textbox").fill(modification.source);
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
    await page.getByText("File", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download" }).click();
    const download = await downloadPromise;
    await download.saveAs(downloadReactivePath);

    // await page.pause();
  });
});
