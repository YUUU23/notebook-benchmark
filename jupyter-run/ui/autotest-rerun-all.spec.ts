import { expect, galata, test } from "@jupyterlab/galata";
import * as path from "path";
import test_config from "../config/mod_config_file.json";
import { ContentsHelper } from "@jupyterlab/galata/lib/contents";

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
    request,
  }) => {
    // Open notebook
    console.log(`=== [UI] OPENING NOTEBOOK: ${fileName}`);
    await page.notebook.openByPath(`${tmpPath}/${fileName}`);
    await page.notebook.activate(fileName);

    // Run all cells
    console.log(`=== [UI] RUNNING ALL CELLS`);
    await page.notebook.run();
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
    // await page.notebook.runCell(modification.cellIndex, true);
    // await page.notebook.waitForRun();
    await page.notebook.save();

    // Reset FS by deleting all files excluding uploaded one
    const contents = galata.newContentsHelper(request);
    const dirContent = await contents.getContentMetadata(tmpPath, "directory");
    if (!(dirContent && dirContent.type === "directory")) {
      console.log("DIR NOT FOUND!!");
    } else {
      let anyFailed = false;
      // delete directory contents first
      for (const item of dirContent.content) {
        console.log("DELETING THIS: ", item);
        if (item.name.endsWith(".ipynb")) {
          continue;
        } else {
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
    }

    // Rerun entire notebook again
    console.log(`=== [UI] RUN ENTIRE NOTEBOOK AGAIN CELLS`);
    await page.notebook.run();
    await page.notebook.save();

    // Save modified notebook output
    const cellOutput = await page.notebook.getCellTextOutput(
      modification.cellIndex
    );
    console.log(
      `=== [UI] MODIFIED CELL (${modification.cellIndex}) OUTPUT: ${cellOutput}`
    );

    await page.notebook.waitForRun();
    await page.notebook.save();

    // Download notebook
    console.log(
      `=== [UI] SAVING MODIFIED NOTEBOOK IN: ${downloadReactivePath}`
    );
    await page.getByText("File", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download" }).click();
    const download = await downloadPromise;
    await download.saveAs(downloadReactivePath);
    await page.pause();
  });
});
