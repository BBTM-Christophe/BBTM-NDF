const nodemailer = require("nodemailer");

const INVOICES_TO = "factures+cBBT-0584b1@m.inexweb.fr";
const jsonHeaders = { "Content-Type": "application/json" };

function json(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Méthode non autorisée." });
  }

  try {
    const { pdfBase64, name = "" } = JSON.parse(event.body || "{}");

    if (!pdfBase64) {
      return json(400, { ok: false, error: "PDF manquant." });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return json(500, { ok: false, error: "Configuration email manquante." });
    }

    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transport.sendMail({
      from: process.env.EMAIL_USER,
      to: INVOICES_TO,
      subject: `Note de frais - ${name}`,
      text: "Note de frais en pièce jointe.",
      attachments: [
        {
          filename: "note.pdf",
          content: pdfBase64,
          encoding: "base64",
          contentType: "application/pdf",
        },
      ],
    });

    return json(200, { ok: true });
  } catch (error) {
    console.error("Échec de l'envoi de la note de frais", error);
    return json(500, { ok: false, error: "Échec de l'envoi du PDF." });
  }
};
