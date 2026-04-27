const mongoose = require("mongoose");

const excelTempSchema = new mongoose.Schema({
  reqId: { type: Number },
  quoteType: { type: String },
  count: { type: Object },
  data: [{ type: Object }],
  product: { type: String },
});

module.exports = excelTempSchema;
// module.exports = mongoose.model("exceltemp", excelTempSchema);