const express = require("express");
const routes = express.Router();
const purchaseSummary = require("../controller/purchaseSummary");

routes.post("/get_purchase_summary_by_linkid", purchaseSummary.get_purchase_summary_by_linkid);

module.exports = routes;
