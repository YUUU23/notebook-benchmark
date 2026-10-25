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
async function waitForReactiveExecutionsToSettle(
  page: Page,
  opts: { startGraceMs?: number; quietPeriodMs?: number } = {}
): Promise<number> {
  // A reactive cascade does NOT begin the instant the trigger cell finishes:
  // the nnb frontend debounces its content_changed trigger by 500ms
  // (kernels/nnb/frontend/src/connect.ts) then does a kernel round-trip before
  // running descendants, and ipyflow's kernel-side reactive scheduler has its
  // own latency. So there is an idle+stable window right AFTER the trigger, and
  // gaps BETWEEN reran cells. A single "idle + counts stable for 1s" check
  // settles inside one of those gaps and saves a half-run notebook, which
  // get_cells_reran then reports as a truncated (and flaky) reran set.
  //
  // Two bounded phases fix this without reintroducing the 20-min hang the no-arg
  // page.notebook.waitForRun() had (it required EVERY code cell to be non-null,
  // so an initial run that halted partway never satisfied it):
  //   Phase A -- wait up to startGraceMs for the cascade to START (a code-cell
  //     exec count changes, or the kernel goes Busy). If nothing starts, the
  //     modification has no reactive dependents (or the initial run errored) --
  //     return the trigger-idle instant.
  //   Phase B -- once started, settle on kernel-Idle + counts stable for
  //     quietPeriodMs (sized above inter-cell gaps).
  // Returns idleSince (the START of the final quiet window), so enlarging either
  // window never inflates the caller's reactiveWallTimeSeconds -- only real
  // wall-clock. Both windows are env-tunable (REACTIVE_START_GRACE_MS /
  // REACTIVE_QUIET_MS) and both phases are bounded by timeoutMs. See doc/journal.md.
  const startGraceMs =
    opts.startGraceMs ?? Number(process.env.REACTIVE_START_GRACE_MS ?? 6_000);
  const quietPeriodMs =
    opts.quietPeriodMs ?? Number(process.env.REACTIVE_QUIET_MS ?? 3_000);
  const timeoutMs = 20 * 60 * 1000;
  const pollIntervalMs = 100;
  const trace = !!process.env.REACTIVE_TRACE;
  const t0 = performance.now();

  const codeCounts = () =>
    page.evaluate(() => {
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
  const logTrace = (phase: string, counts: string, idle: boolean) => {
    if (trace)
      console.log(
        `=== [TRACE] ${JSON.stringify({
          t: Math.round(performance.now() - t0),
          phase,
          idle,
          counts: JSON.parse(counts),
        })}`
      );
  };

  const overallDeadline = Date.now() + timeoutMs;
  const entryCounts = await codeCounts();

  // Phase A: bounded wait for the cascade to START. No settling here -- this is
  // exactly the pre-cascade idle window the old 1s quiet period settled on.
  const graceDeadline = Date.now() + startGraceMs;
  let idleSince: number | undefined = (await kernelIsIdle())
    ? performance.now()
    : undefined;
  let cascadeStarted = false;
  let seedCounts = entryCounts;
  while (Date.now() < graceDeadline) {
    const counts = await codeCounts();
    const idle = await kernelIsIdle();
    logTrace("A", counts, idle);
    if (counts !== entryCounts) {
      cascadeStarted = true;
      seedCounts = counts;
      break;
    }
    if (!idle) {
      cascadeStarted = true;
      break;
    }
    idleSince ??= performance.now();
    await page.waitForTimeout(pollIntervalMs);
  }
  if (!cascadeStarted) {
    // No dependents fired (or the initial run halted early so they cannot).
    // Bounded return -> never the 20-min hang.
    return idleSince ?? performance.now();
  }

  // Phase B: settle once the kernel has stayed Idle, with counts unchanged, for
  // quietPeriodMs, the window starting at the first idle sample. The nnb
  // frontend runs rerun cells one at a time, so the kernel is idle for ~0.1 s
  // between them with nothing pending; timing the window from the last count
  // change instead let a rerun cell longer than quietPeriodMs end the wait in
  // that gap. Seed previousCounts with the last-seen array (not "") so the
  // first poll does not read as a spurious change.
  let previousCounts = seedCounts;
  idleSince = undefined;
  while (Date.now() < overallDeadline) {
    const counts = await codeCounts();
    if (counts !== previousCounts) {
      previousCounts = counts;
      idleSince = undefined;
    }
    const idle = await kernelIsIdle();
    logTrace("B", counts, idle);
    if (!idle) {
      idleSince = undefined;
    } else if (idleSince === undefined) {
      idleSince = performance.now();
    } else if (performance.now() - idleSince >= quietPeriodMs) {
      return idleSince;
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error("Timed out waiting for reactive cell executions to settle");
}

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
  const deadline = Date.now() + settleTimeoutMs;
  let previousCounts = "";
  let idleSince: number | undefined;
  let barrierDone = false;
  let lastTrace = 0;
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
    const quietFor = idleSince === undefined ? 0 : performance.now() - idleSince;
    if (process.env.REACTIVE_TRACE && Date.now() - lastTrace >= 1000) {
      lastTrace = Date.now();
      const statusText = await page.evaluate(
        () => document.querySelector('#jp-main-statusbar')?.textContent ?? '');
      console.log(`=== [TRACE runall] ${JSON.stringify({ idle: idleSince !== undefined, quietFor: Math.round(quietFor),
        pending, counts: JSON.parse(counts), status: statusText })}`);
    }
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
    // kills the "jlpm start" webServer abruptly, orphaning its kernels (each
    // heavy nnb/torch kernel ~1.3GB); across a multi-step run they accumulate
    // and OOM the machine, and benchmark_runner.reap_kernels() cannot reach the
    // per-step server between steps (Connection refused). See doc/journal.md.
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

      // Use Galata's setCell to write the cell source: it is windowing-aware
      // (scrolls the target cell into the windowed viewport and enters edit
      // mode to materialize the CodeMirror editor before typing).
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
      // Force the edited source onto the cell MODEL before executing. setCell
      // types into the windowed CodeMirror editor, which can be re-virtualized
      // before Ctrl+Enter reads the model -- leaving the manual execute_request
      // with EMPTY source. The nnb kernel then hits its empty-cell bypass so the
      // changed cell's body never runs, and nnb (which drops the changed cell
      // from its own rerun set assuming the manual run executed it) yields a
      // TRUNCATED cascade that diverges from a real manual run (see doc/journal.md,
      // explore_siren m1/m3). Committing to sharedModel guarantees the execute
      // carries the real code.
      await page.evaluate(
        ({ i, src }) => {
          const nb = (window as any).galata.app.shell.currentWidget?.content;
          nb?.widgets[i]?.model.sharedModel.setSource(src);
        },
        { i: modification.cellIndex, src: modification.source }
      );
      await prepareExecution(page, modification.cellIndex);
      const changedEcBefore = await page.evaluate((i) => {
        const nb = (window as any).galata.app.shell.currentWidget?.content;
        return nb?.widgets[i]?.model.executionCount ?? null;
      }, modification.cellIndex);
      reactiveRunStartedAt = performance.now();
      await page.keyboard.press('Control+Enter');
      // Confirm the MODIFIED cell actually executed its new body: its execution
      // count must move off the pre-run (reset) value. An empty execute_request
      // leaves it unchanged, so the bare waitForRun() -- satisfied by any
      // non-null count -- would silently accept a no-op run. If it never
      // advances, log loudly; waitForReactiveExecutionsToSettle below still
      // captures whatever cascade occurred. See doc/journal.md.
      try {
        await page.waitForFunction(
          ({ i, before }) => {
            const nb = (window as any).galata.app.shell.currentWidget?.content;
            const ec = nb?.widgets[i]?.model.executionCount ?? null;
            return ec !== null && ec !== before;
          },
          { i: modification.cellIndex, before: changedEcBefore },
          { timeout: 120000, polling: 100 }
        );
      } catch {
        console.log(
          `=== [UI] WARNING: modified cell ${modification.cellIndex} never registered a real execution (count stayed ${changedEcBefore}); nnb cascade may be truncated`
        );
      }
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
