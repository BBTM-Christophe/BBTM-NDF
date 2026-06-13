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
    textContent: "",
    className: "",
    innerHTML: "",
    complete: false,
  };
}

function setupPdfSandbox() {
  const elements = {
    form: { reset() {}, onsubmit: null },
    name: createElement(),
    payment: createElement(),
    object: createElement(),
    description: createElement(),
    photos: createElement(),
    preview: createElement(),
    submit: createElement("Envoyer"),
    status: createElement(),
    logo: createElement(),
  };

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
      return { pages: this.pages };
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
    },
    window: {
      jspdf: { jsPDF: FakePDF },
    },
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
  return { context, elements, getLastDoc: () => lastDoc };
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

test("PDF omits the expense summary page when only photos were added", async () => {
  const { context, elements, getLastDoc } = setupPdfSandbox();

  elements.photos.onchange({
    target: {
      files: [{ dataUrl: "data:image/jpeg;base64,receipt" }],
    },
  });

  await context.genPDF();

  const doc = getLastDoc();
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.pages[0].some((entry) => entry.value === "NOTE DE FRAIS"), false);
  assert.equal(doc.pages[0].filter((entry) => entry.kind === "image").length, 1);
});

test("PDF receipt images keep their original aspect ratio instead of stretching to A4", async () => {
  const { context, elements, getLastDoc } = setupPdfSandbox();

  elements.photos.onchange({
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

test("PDF includes the expense summary page when a non-photo field changed", async () => {
  const { context, elements, getLastDoc } = setupPdfSandbox();

  elements.description.value = "Dejeuner chantier";
  elements.photos.onchange({
    target: {
      files: [{ dataUrl: "data:image/jpeg;base64,receipt" }],
    },
  });

  await context.genPDF();

  const doc = getLastDoc();
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.pages[0].some((entry) => entry.value === "NOTE DE FRAIS"), true);
  assert.equal(doc.pages[1].filter((entry) => entry.kind === "image").length, 1);
});
