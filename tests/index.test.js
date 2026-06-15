const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function createElement(value = "") {
  return {
    value,
    checked: false,
    disabled: false,
    readOnly: false,
    textContent: "",
    className: "",
    innerHTML: "",
    complete: false,
    addEventListener() {},
  };
}

function setupPdfSandbox() {
  const blobRegistry = new Map();
  let blobId = 1;

  function registerPages(pages) {
    const id = blobId;
    blobId += 1;
    const blob = new Blob([Uint8Array.of(id)], { type: "application/pdf" });
    blobRegistry.set(id, {
      pages,
      getPageIndices() {
        return pages.map((_, index) => index);
      },
    });
    return blob;
  }

  async function getBlobPages(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return blobRegistry.get(bytes[0])?.pages || [[{ kind: "pdf-page", source: bytes[0] }]];
  }

  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        transform() {},
        drawImage() {},
      };
    },
    toDataURL() {
      return `data:image/jpeg;w=${this.width};h=${this.height};base64,normalized`;
    },
  };

  const elements = {
    form: { reset() {}, onsubmit: null },
    formTitle: createElement(),
    modeExpense: createElement(),
    modeMileage: createElement(),
    expenseFields: createElement(),
    mileageFields: createElement(),
    name: createElement(),
    payment: createElement(),
    object: createElement(),
    description: createElement(),
    ikName: createElement(),
    ikFunction: createElement(),
    ikPeriod: createElement(),
    vehicleModel: createElement(),
    fiscalPower: createElement(),
    fuelEssence: createElement(),
    fuelDiesel: createElement(),
    fuelElectric: createElement(),
    fuelHybrid: createElement(),
    mileageTotal: createElement(),
    photos: createElement(),
    preview: createElement(),
    submit: createElement("Envoyer"),
    status: createElement(),
    logo: createElement(),
  };

  for (let index = 0; index < 6; index += 1) {
    elements[`mileageDate${index}`] = createElement();
    elements[`mileageRoute${index}`] = createElement();
    elements[`mileageReason${index}`] = createElement();
    elements[`mileageKm${index}`] = createElement();
    elements[`mileageRate${index}`] = createElement();
    elements[`mileageAmount${index}`] = createElement();
  }

  let lastDoc;

  class FakePDF {
    constructor() {
      this.pages = [[]];
      this.internal = {
        pageSize: {
          getWidth: () => 210,
          getHeight: () => 297,
        },
      };
      lastDoc = this;
    }

    addPage() {
      this.pages.push([]);
    }

    addImage(image, type, x, y, width, height) {
      this.pages.at(-1).push({ kind: "image", image, type, x, y, width, height });
    }

    text(value) {
      this.pages.at(-1).push({ kind: "text", value });
    }

    output() {
      return registerPages(this.pages);
    }

    setTextColor() {}
    setDrawColor() {}
    setFillColor() {}
    setLineWidth() {}
    setFont() {}
    setFontSize() {}
    rect() {}
    line() {}
    circle() {}
    roundedRect() {}
    splitTextToSize(value) {
      return [value];
    }
  }

  const context = {
    document: {
      getElementById(id) {
        return elements[id];
      },
      createElement(tagName) {
        if (tagName === "canvas") {
          return canvas;
        }
        throw new Error(`Unexpected element: ${tagName}`);
      },
    },
    window: {
      jspdf: { jsPDF: FakePDF },
      PDFLib: {
        PDFDocument: {
          async create() {
            return {
              pages: [],
              async copyPages(source, indices) {
                return indices.map((index) => source.pages[index]);
              },
              addPage(page) {
                this.pages.push(page);
              },
              async save() {
                const blob = registerPages(this.pages);
                return new Uint8Array(await blob.arrayBuffer());
              },
            };
          },
          async load(bytes) {
            const id = new Uint8Array(bytes)[0];
            return blobRegistry.get(id) || {
              pages: [[{ kind: "pdf-page", source: id }]],
              getPageIndices() {
                return [0];
              },
            };
          },
        },
      },
    },
    atob(value) {
      return Buffer.from(value, "base64").toString("binary");
    },
    Blob,
    FileReader: class {
      readAsDataURL(file) {
        this.onload({ target: { result: file.dataUrl } });
      }
    },
    Image: class {
      set src(value) {
        const width = value.match(/w=(\d+)/)?.[1] || "1000";
        const height = value.match(/h=(\d+)/)?.[1] || "500";
        this.naturalWidth = Number(width);
        this.naturalHeight = Number(height);
        this.onload?.();
      }
    },
    fetch() {
      throw new Error("fetch should not be called in PDF generation tests");
    },
    console,
  };

  vm.runInNewContext(script, context);
  return { context, elements, getLastDoc: () => lastDoc, getBlobPages };
}

function jpegDataUrlWithExifOrientation(orientation, width, height) {
  const bytes = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a,
    0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12,
    0x00, 0x03,
    0x00, 0x00, 0x00, 0x01,
    0x00, orientation,
    0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xd9,
  ]);

  return `data:image/jpeg;w=${width};h=${height};base64,${bytes.toString("base64")}`;
}

test("form has an inline status message area", () => {
  assert.match(html, /id=['"]status['"]/);
  assert.match(html, /role=['"]status['"]/);
});

test("French labels are stored as valid UTF-8 text", () => {
  assert.match(html, /Prénom et NOM/);
  assert.match(html, /Sélectionner/);
  assert.match(html, /décrire la nature de la dépense/);
  assert.doesNotMatch(html, /Ã|Â|â/);
});

test("script uses explicit DOM references instead of fragile window globals", () => {
  assert.match(html, /document\.getElementById\(['"]status['"]\)/);
  assert.match(html, /document\.getElementById\(['"]name['"]\)/);
  assert.match(html, /document\.getElementById\(['"]payment['"]\)/);
  assert.match(html, /document\.getElementById\(['"]object['"]\)/);
});

test("dropdowns show selection placeholder by default", () => {
  assert.match(
    html,
    /<select id="payment"[\s\S]*?<option value="" selected>Sélectionner<\/option>/
  );
  assert.match(
    html,
    /<select id="object"[\s\S]*?<option value="" selected>Sélectionner<\/option>/
  );
});

test("PDF first page follows the BBTM expense summary layout", () => {
  assert.match(html, /function drawExpenseSummaryPage\(doc\)/);
  assert.match(html, /BENJAMIN BON TRAVAUX MARITIMES/);
  assert.match(html, /15 impasse du Pou/);
  assert.match(html, /drawExpenseRow\(doc,rowY,'Collaborateur',name\.value/);
  assert.match(html, /drawExpenseRow\(doc,rowY,'Mode de paiement',payment\.value/);
  assert.match(html, /drawExpenseRow\(doc,rowY,'Objet',object\.value/);
  assert.match(html, /drawExpenseRow\(doc,rowY,'Description',description\.value/);
});

test("PDF values are normalized before rendering to avoid broken accent glyphs", () => {
  assert.match(html, /function pdfText\(value\)/);
  assert.match(html, /\.normalize\('NFD'\)/);
  assert.match(html, /replace\(\x2F\[\\u0300-\\u036f\]\+\/g,''\)/);
  assert.match(html, /const text=pdfText\(value\)/);
});

test("submit flow checks the Netlify response before showing success", () => {
  assert.match(html, /response\.ok/);
  assert.match(html, /throw new Error/);
  assert.doesNotMatch(html, /alert\(['"]Envoy/);
});

test("successful submit resets fields, photos, and preview for the next expense", () => {
  assert.match(html, /form\.reset\(\)/);
  assert.match(html, /images\s*=\s*\[\]/);
  assert.match(html, /photos\.value\s*=\s*['"]/);
  assert.match(html, /render\(\)/);
});

test("file input accepts photos and PDF receipts", () => {
  assert.match(html, /accept=["']image\/\*,application\/pdf["']/);
});

test("form exposes a switch between expense and mileage reimbursement modes", () => {
  assert.match(html, /id=["']modeExpense["']/);
  assert.match(html, /id=["']modeMileage["']/);
  assert.match(html, /id=["']expenseFields["']/);
  assert.match(html, /id=["']mileageFields["']/);
  assert.match(html, /Indemnit(?:\u00e9|e)s Kilom(?:\u00e9|e)triques/);
});

test("mileage reimbursement fields include vehicle, fuel, six detail rows and attachment area", () => {
  assert.match(html, /id=["']ikName["']/);
  assert.match(html, /id=["']ikFunction["']/);
  assert.match(html, /id=["']ikPeriod["']/);
  assert.match(html, /id=["']vehicleModel["']/);
  assert.match(html, /id=["']fiscalPower["']/);
  assert.match(html, /id=["']fuelEssence["']/);
  assert.match(html, /id=["']fuelDiesel["']/);
  assert.match(html, /id=["']fuelElectric["']/);
  assert.match(html, /id=["']fuelHybrid["']/);
  assert.match(html, /id=["']mileageKm5["']/);
  assert.match(html, /id=["']mileageTotal["']/);
  assert.match(html, /id=["']photos["']/);
});

test("mileage rows calculate rate, capped amount and total for thermal vehicles", () => {
  const { context, elements } = setupPdfSandbox();

  elements.mileageKm0.value = "120";
  elements.mileageKm1.value = "200";

  context.updateMileageCalculations();

  assert.equal(elements.mileageRate0.value, "0,606");
  assert.equal(elements.mileageAmount0.value, "72,72");
  assert.equal(elements.mileageAmount1.value, "100,00");
  assert.equal(elements.mileageTotal.value, "172,72");
});

test("electric mileage rows use manual amounts and display a dash for the rate", () => {
  const { context, elements } = setupPdfSandbox();

  elements.fuelElectric.checked = true;
  elements.mileageKm0.value = "120";
  elements.mileageAmount0.value = "42,50";

  context.updateMileageCalculations();

  assert.equal(elements.mileageRate0.value, "-");
  assert.equal(elements.mileageAmount0.value, "42,50");
  assert.equal(elements.mileageAmount0.readOnly, false);
  assert.equal(elements.mileageTotal.value, "42,50");
});

test("switching to electric clears previously calculated thermal amounts", () => {
  const { context, elements } = setupPdfSandbox();

  elements.mileageKm0.value = "120";
  elements.mileageKm1.value = "200";
  context.updateMileageCalculations();

  elements.fuelElectric.checked = true;
  elements.fuelElectric.onchange();

  assert.equal(elements.mileageRate0.value, "-");
  assert.equal(elements.mileageAmount0.value, "");
  assert.equal(elements.mileageAmount1.value, "");
  assert.equal(elements.mileageTotal.value, "");
});

test("PDF omits the expense summary page when only photos were added", async () => {
  const { context, elements, getBlobPages } = setupPdfSandbox();

  await elements.photos.onchange({
    target: {
      files: [{ dataUrl: "data:image/jpeg;base64,receipt" }],
    },
  });

  const blob = await context.genPDF();

  const pages = await getBlobPages(blob);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].some((entry) => entry.value === "NOTE DE FRAIS"), false);
  assert.equal(pages[0].filter((entry) => entry.kind === "image").length, 1);
});

test("PDF receipt images keep their original aspect ratio instead of stretching to A4", async () => {
  const { context, elements, getLastDoc } = setupPdfSandbox();

  await elements.photos.onchange({
    target: {
      files: [{ dataUrl: "data:image/jpeg;w=1000;h=500;base64,receipt" }],
    },
  });

  await context.genPDF();

  const image = getLastDoc().pages[0].find((entry) => entry.kind === "image");
  assert.equal(image.width / image.height, 2);
  assert.equal(image.width, 210);
  assert.equal(image.height, 105);
});

test("PDF receipt images honor phone EXIF orientation before placement", async () => {
  const { context, elements, getLastDoc } = setupPdfSandbox();

  await elements.photos.onchange({
    target: {
      files: [{ dataUrl: jpegDataUrlWithExifOrientation(6, 1000, 500) }],
    },
  });

  await context.genPDF();

  const image = getLastDoc().pages[0].find((entry) => entry.kind === "image");
  assert.equal(image.width / image.height, 0.5);
  assert.equal(image.width < image.height, true);
});

test("fallback image normalization does not double-rotate already oriented browser images", async () => {
  const { context } = setupPdfSandbox();
  const src = jpegDataUrlWithExifOrientation(6, 500, 1000);

  const normalized = await context.normalizeDataUrlOrientation(src, 6, {
    width: 1000,
    height: 500,
  });

  assert.match(normalized, /w=500;h=1000/);
});

test("PDF places receipts before the expense summary page when a non-photo field changed", async () => {
  const { context, elements, getBlobPages } = setupPdfSandbox();

  elements.description.value = "Dejeuner chantier";
  await elements.photos.onchange({
    target: {
      files: [{ dataUrl: "data:image/jpeg;base64,receipt" }],
    },
  });

  const blob = await context.genPDF();

  const pages = await getBlobPages(blob);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].filter((entry) => entry.kind === "image").length, 1);
  assert.equal(pages[1].some((entry) => entry.value === "NOTE DE FRAIS"), true);
});

test("PDF places receipts before the mileage reimbursement summary page", async () => {
  const { context, elements, getBlobPages } = setupPdfSandbox();

  context.setFormMode("mileage");
  elements.ikName.value = "Benjamin BON";
  elements.ikFunction.value = "Chef de projet";
  elements.ikPeriod.value = "Juin 2026";
  elements.vehicleModel.value = "Peugeot 308";
  elements.fiscalPower.value = "5 CV";
  elements.mileageDate0.value = "15/06/2026";
  elements.mileageRoute0.value = "Cherbourg -> Le Rozel";
  elements.mileageReason0.value = "Chantier";
  elements.mileageKm0.value = "200";
  context.updateMileageCalculations();
  await elements.photos.onchange({
    target: {
      files: [{ dataUrl: "data:image/jpeg;base64,receipt" }],
    },
  });

  const blob = await context.genPDF();
  const pages = await getBlobPages(blob);

  assert.equal(pages.length, 2);
  assert.equal(pages[0].filter((entry) => entry.kind === "image").length, 1);
  assert.equal(pages[1].some((entry) => entry.value === "INDEMNITES KILOMETRIQUES"), true);
  assert.equal(pages[1].some((entry) => entry.value === "100,00"), true);
});

test("PDF receipt files are merged into the generated note instead of rendered as images", async () => {
  const { context, elements, getBlobPages } = setupPdfSandbox();

  await elements.photos.onchange({
    target: {
      files: [{ name: "facture.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,Yw==" }],
    },
  });

  const blob = await context.genPDF();
  const pages = await getBlobPages(blob);

  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0], [{ kind: "pdf-page", source: 99 }]);
  assert.match(elements.preview.innerHTML, /facture\.pdf/);
});

test("PDF preview escapes receipt file names before rendering", async () => {
  const { elements } = setupPdfSandbox();

  await elements.photos.onchange({
    target: {
      files: [{ name: '<img src=x onerror=alert(1)>.pdf', type: "application/pdf", dataUrl: "data:application/pdf;base64,Yw==" }],
    },
  });

  assert.doesNotMatch(elements.preview.innerHTML, /<img src=x/);
  assert.match(elements.preview.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;\.pdf/);
});
