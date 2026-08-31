import { galata, test } from "@jupyterlab/galata";
import type { Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import test_config from "../config/mod_config_file.json";

// Baseline "run all cells top-to-bottom" timing (Google Sheet column E). Unlike
// autotest.spec.ts this makes no modification and does no reactive cascade:
// it opens the notebook, runs all cells once, and reports only
// initialWallTimeSeconds. Used with the plain python3 kernel (config/python3).
//
// It still downloads the executed notebook to BOTH the initial and reactive
// paths that BenchmarkRunner.run() reads back for its diff step, so run()
// completes cleanly instead of throwing on a missing file (the diff result is
// irrelevant here -- only column E is consumed for python3).

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
const datadirectory = test_config.dataDirectory;
const supportingScripts: { sourcePath: string; targetRelPath: string; isDirectory: boolean }[] =
  (test_config as any).supportingScripts ?? [];

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
  });

  test.afterAll(async ({ request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteDirectory(tmpPath);
  });

  test("Run notebook initially and capture wall time", async ({
    page,
    tmpPath,
  }) => {
    console.log(`=== [UI] OPENING NOTEBOOK: ${fileName}`);
    await page.notebook.openByPath(`${tmpPath}/${fileName}`);
    await page.notebook.activate(fileName);

    console.log(`=== [UI] RUNNING ALL CELLS`);
    await prepareExecution(page);
    const initialRunStartedAt = performance.now();
    await page.menu.clickMenuItem('Run>Run All Cells');
    await page.notebook.waitForRun();
    const initialWallTimeSeconds =
      (performance.now() - initialRunStartedAt) / 1000;
    await page.notebook.save();

    console.log(`=== [METRICS] ${JSON.stringify({
      schemaVersion: 1,
      initialWallTimeSeconds,
    })}`);

    // Download the executed notebook and place a copy at both paths run()
    // reads (initial + reactive), so its diff step doesn't fail on a missing
    // file. The diff outcome is unused for the python3 baseline.
    console.log(`=== [UI] SAVING INITIAL RUN NOTEBOOK IN: ${downloadInitialPath}`);
    await page.getByText("File", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download" }).click();
    const download = await downloadPromise;
    await download.saveAs(downloadInitialPath);
    fs.mkdirSync(path.dirname(downloadReactivePath), { recursive: true });
    fs.copyFileSync(downloadInitialPath, downloadReactivePath);
  });
});
