const express = require("express");
const routes = express.Router();
const bill_and_ship = require("../controller/billAndship");

// routes.post("/post_new_address", bill_and_ship.post_new_address);
routes.post("/get_address_info", bill_and_ship.get_address_info);
routes.post("/get_address_list", bill_and_ship.get_address_list);
routes.post("/post_new_address", bill_and_ship.post_new_address);
routes.post("/post_po_no", bill_and_ship.post_po_no);

module.exports = routes;
