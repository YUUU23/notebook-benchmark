import { expect, galata, test } from "@jupyterlab/galata";
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

test.use({ tmpPath: "notebook-test" });
test.describe.serial("Notebook Run", () => {
  test.beforeAll(async ({ request, tmpPath }) => {
    const uploadFromPath = path.join(
      __dirname,
      "..",
      `${benchmarks_dir}/${fileName}`
    );
    const contents = galata.newContentsHelper(request);

    console.log(`== UPLOADING NOTBEOOK FROM: ${uploadFromPath}`);
    await contents.uploadFile(
      path.resolve(__dirname, `${uploadFromPath}`),
      `${tmpPath}/${fileName}`
    );
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
    console.log(`== OPENING NOTBEOOK: ${fileName}`);
    await page.notebook.openByPath(`${tmpPath}/${fileName}`);
    await page.notebook.activate(fileName);

    // Run all cells
    console.log(`== RUNNING ALL CELLS`);
    await page.notebook.run();
    await page.notebook.save();

    // Download notebook (for identifying how many cells have reran later)
    console.log(`== SAVING INITIAL RUN NOTEBOOK IN: ${downloadInitialPath}`);
    await page.getByText("File", { exact: true }).click();
    const downloadOriginalPathPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download" }).click();
    const downloadOriginal = await downloadOriginalPathPromise;
    await downloadOriginal.saveAs(downloadInitialPath);

    // Make change
    console.log(
      `== MAKING MODIFICATION TO CELL INDEX: ${modification.cellIndex}`
    );
    const cell = await page.notebook.getCellLocator(modification.cellIndex);
    if (!cell) {
      console.log(
        `== NO CELL WITH CELL INDEX ${modification.cellIndex} FOUND, CLOSING TEST`
      );
      return;
    }
    await cell.getByRole("textbox").press("ControlOrMeta+a");
    await cell.getByRole("textbox").press("Backspace");
    await page.notebook.setCell(
      modification.cellIndex,
      "code",
      modification.source
    );
    await page.notebook.runCell(modification.cellIndex);

    // Save modified notebook output
    const cellOutput = await page.notebook.getCellTextOutput(
      modification.cellIndex
    );
    console.log(
      `== MODIFIED CELL (${modification.cellIndex}) OUTPUT: ${cellOutput}`
    );
    await page.notebook.save();
    await page.notebook.waitForRun();

    // Download notebook
    console.log(`== SAVING MODIFIED NOTEBOOK IN: ${downloadReactivePath}`);
    await page.getByText("File", { exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download" }).click();
    const download = await downloadPromise;
    await download.saveAs(downloadReactivePath);
  });
});
