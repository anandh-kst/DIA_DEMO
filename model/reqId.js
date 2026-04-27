const mongoose = require("mongoose");

const reqIdSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
  },
  reqId: {
    type: Number,
    required: true,
  },
});

module.exports = reqIdSchema;
// module.exports = mongoose.model("reqIds", reqIdSchema);