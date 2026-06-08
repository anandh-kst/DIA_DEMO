const express = require("express");
const routes = express.Router();
const purchaseSummary = require("../controller/purchaseSummary");
const auth = require("../auth");

routes.post("/get_purchase_summary_by_linkid", auth, purchaseSummary.get_purchase_summary_by_linkid);

module.exports = routes;
