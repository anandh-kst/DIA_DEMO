const express = require("express");
const routes = express.Router();
const list = require("../controller/list");
const auth = require("../auth");

routes.post("/feasibility", list.feasibility);
routes.post("/cxm_tower_feasibility", list.cxm_tower_feasibility);
routes.post("/all_links", list.all_links);
routes.post("/my_links",auth, list.my_links);
routes.post("/get_links_excel", list.get_links_excel);
routes.post("/get_my_links_excel", list.get_my_links_excel);
routes.post("/get_all_links_excel", list.get_all_links_excel);
routes.post("/get_feasibility_excel_by_reqid", list.get_feasibility_excel_by_reqid);

module.exports = routes;
