const mongoose = require("mongoose");

const feasibilityidSchema = new mongoose.Schema({
  feasibilityId: {
    type: String,
    required: true,
  },
  serviceType: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    required: true,
  },
});

module.exports = feasibilityidSchema;
// module.exports = mongoose.model("feasibilityids", feasibilityidSchema);