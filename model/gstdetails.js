const mongoose = require("mongoose");

const gstdetailsSchema = new mongoose.Schema({
  companyId: {
    type: String,
  },
  companyName: {
    type: String,
  },
  state: {
    type: String,
  },
  hasGst: {
    type: Boolean,
    default: false,
  },
  declarationUrl: {
    type: String,
  },
  gstNo: {
    type: String,
  },
});

module.exports = gstdetailsSchema;
// module.exports = mongoose.model("gstdetails", gstdetailsSchema);