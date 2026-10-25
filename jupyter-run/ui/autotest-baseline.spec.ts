import { galata, test } from "@jupyterlab/galata";
import type { Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import test_config from "../config/mod_config_file.json";

// Plain "run all cells top-to-bottom" timing, no modification, no rerun: opens
// the notebook, runs all cells once, and reports only initialWallTimeSeconds.
//
// NOTE: config/python3 now uses autotest-python3.spec.ts (run-all for column E
// PLUS a manual rerun set for column F). This spec is kept as a standalone
// run-all-only baseline; point a config's testMatch at it to use it.
//
// It still downloads the executed notebook to BOTH the initial and reactive
// paths that BenchmarkRunner.run() reads back for its diff step, so run()
// completes cleanly instead of throwing on a missing file (the diff result is
// irrelevant here).

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

/**
 * Wait for "Run All Cells" to finish and return the instant execution settled.
 * See autotest.spec.ts for why this replaces Galata's waitForRun() (which hangs
 * until the per-test timeout when a run halts partway on an erroring cell).
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
        // (-> ZMQError: ENOTSOCK on the kernel side). A single idle check is not
        // enough for a reactive (ipyflow) kernel: it flickers idle between cascade
        // steps, so a trailing reactive execute can still race the shutdown.
        // Bounded. See doc/journal.md.
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
    const initialRunSettledAt = await waitForRunAllToSettle(page);
    const initialWallTimeSeconds =
      (initialRunSettledAt - initialRunStartedAt) / 1000;
    await page.notebook.save();

    console.log(`=== [METRICS] ${JSON.stringify({
      schemaVersion: 1,
      initialWallTimeSeconds,
    })}`);

    // Download the executed notebook and place a copy at both paths run()
    // reads (initial + reactive), so its diff step doesn't fail on a missing
    // file. The diff outcome is unused for the python3 baseline.
    console.log(`=== [UI] SAVING INITIAL RUN NOTEBOOK IN: ${downloadInitialPath}`);
    // Open File>Download via the galata menu helper (as with Run>Run All Cells).
    // A bare getByText("File") matched any element whose text is exactly "File"
    // (incl. cell output / tracebacks printing "File ~/..."), tripping
    // Playwright's strict-mode violation and failing the download.
    const downloadPromise = page.waitForEvent("download");
    await page.menu.clickMenuItem("File>Download");
    const download = await downloadPromise;
    await download.saveAs(downloadInitialPath);
    fs.mkdirSync(path.dirname(downloadReactivePath), { recursive: true });
    fs.copyFileSync(downloadInitialPath, downloadReactivePath);
  });
});
