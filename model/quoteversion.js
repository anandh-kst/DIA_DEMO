const mongoose = require('mongoose');

const quoteSchema = new mongoose.Schema({
    version: {
        type: String,
        required: true
    },
    quote: {
        type: Object,
        required: true
    }
})
const mailEntrySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    mail: {
        type: String,
        required: true
    }
}, { _id: false });
const quoteVersionSchema = new mongoose.Schema({
    reqId: {
        type: String,
        required: true
    },
    ebsAccountNo: {
        type: String,
        required: true
    },
    companyId: {
        type: String,
        required: true
    },
    companyName: {
        type: String,
        required: true
    },
    product: {
        type: String,
        required: true
    },
    productCategory: {
        type: String,
        required: true
    },
    quoteVersion: [quoteSchema],
    createdBy: {
        type: String,
        required: true
    },
    updatedBy: [{
        type: String,
        required: true
    }],
    createdDate: {
        type: Date,
        default: Date.now()
    },
    updatedBy: [{
        type: String,
        default: Date.now()
    }],
    sharedToMailId: { type: [mailEntrySchema], default: [] },
    sharedCcMailId: { type: [mailEntrySchema], default: [] },
    sharedToCount: { type: Number, default: 0 },
    sharedCcCount: { type: Number, default: 0 }
})

// const QuoteVersion = networkDB.model("priceversions",quoteVersionSchema);
module.exports = quoteVersionSchema;