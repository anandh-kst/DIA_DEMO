const mongoose = require("mongoose");
const common = require("../common");

const networkerrorlogSchema = new mongoose.Schema({
  reqId: {
    type: mongoose.Schema.Types.Mixed,
  },
  date: { type: Date, default: Date.now },
  message: { type: String },
  response: { type: mongoose.Schema.Types.Mixed },
  stack: { type: mongoose.Schema.Types.Mixed },
  path: { type: String },
  filter: { type: String },
  status: {
    type: String,
    default: "Pending",
  },
  product: {
    type: String,
    default: "DIA",
  },
});

networkerrorlogSchema.pre("save", function (next) {
  if (this.reqId && typeof this.reqId === "string") {
    const reqID = this.reqId.match(/\d+/g).join("");
    this.reqId = parseInt(reqID, 10);
  }
  next();
});

async function sendEmail(logDetails) {
  const toArray = ["technical@kstinfotech.com"];
  const subject = `Error Logged in DIA Application: ${logDetails.reqId || ""}`;
  const html = `
    <h2>A new DIA error log has been created with the following details:</h2>
    <p><strong>Request ID:</strong> ${logDetails.reqId}</p>
    <p><strong>Date:</strong> ${logDetails.date}</p>
    <p><strong>Message:</strong> ${logDetails.message}</p>
    <p><strong>Stack Trace:</strong><br><pre>${logDetails.stack}</pre></p>
    <p><strong>Filter:</strong> ${logDetails.filter}</p>
    <p><strong>Path:</strong> ${logDetails.path}</p>
    <p><strong>Response Data:</strong><br><pre>${JSON.stringify(logDetails.response, null, 2)}</pre></p>
    <p><strong>Status:</strong> ${logDetails.status}</p>
  `;

  const sendLogMail = await common.send_mail(toArray, [], subject, html, (attachments = null));
  console.log("sendLogMail", sendLogMail);
}

// networkerrorlogSchema.post("save", function (doc) {
//   sendEmail(doc);
// });

module.exports = networkerrorlogSchema;
// module.exports = mongoose.model("networkerrorlogs", networkerrorlog);
