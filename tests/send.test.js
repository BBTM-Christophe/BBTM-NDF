const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("send function sends the PDF to the test mailbox and returns success JSON", async () => {
  const sentMessages = [];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "nodemailer") {
      return {
        createTransport(options) {
          assert.equal(options.auth.user, "sender@example.com");
          assert.equal(options.auth.pass, "secret");

          return {
            async sendMail(message) {
              sentMessages.push(message);
              return { messageId: "test-message" };
            },
          };
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  process.env.EMAIL_USER = "sender@example.com";
  process.env.EMAIL_PASS = "secret";
  delete require.cache[require.resolve("../netlify/functions/send.js")];

  try {
    const { handler } = require("../netlify/functions/send.js");
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        pdfBase64: Buffer.from("pdf").toString("base64"),
        name: "Benjamin",
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(response.body), { ok: true });
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, "factures+cBBT-0584b1@m.inexweb.fr");
    assert.equal(sentMessages[0].subject, "Dépense - Benjamin");
    assert.equal(sentMessages[0].text, "Dépense en pièce jointe.");
    assert.equal(sentMessages[0].attachments[0].filename, "note.pdf");
  } finally {
    Module._load = originalLoad;
  }
});

test("send function reports SMTP failures instead of returning success", async () => {
  const originalLoad = Module._load;
  const originalConsoleError = console.error;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "nodemailer") {
      return {
        createTransport() {
          return {
            async sendMail() {
              throw new Error("SMTP unavailable");
            },
          };
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  process.env.EMAIL_USER = "sender@example.com";
  process.env.EMAIL_PASS = "secret";
  delete require.cache[require.resolve("../netlify/functions/send.js")];
  console.error = () => {};

  try {
    const { handler } = require("../netlify/functions/send.js");
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        pdfBase64: Buffer.from("pdf").toString("base64"),
        name: "Benjamin",
      }),
    });

    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(response.body).ok, false);
  } finally {
    Module._load = originalLoad;
    console.error = originalConsoleError;
  }
});
