const express = require("express");
const routes = express.Router();
const plan = require("../controller/plan");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

routes.post("/get_contract_period", plan.get_contract_period);
routes.post("/get_base_plan_details", plan.get_base_plan_details);
routes.post("/get_addons_details", plan.get_addons_details);
routes.post("/post_plan_details", plan.post_plan_details);
routes.post("/delete_addons", plan.delete_addons);
routes.post("/post_selected_locationId", plan.post_selected_locationId);
routes.post("/get_modify_base_plan", plan.get_modify_base_plan);
routes.post("/get_quote_feasability_status", plan.get_quote_feasability_status);
routes.post("/post_excel_plan", upload.single("excelPlanFile"), plan.post_excel_plan);
routes.post("/post_tower_price", plan.post_tower_price);
routes.post("/get_pricing_list",plan.get_pricing_list);
routes.post("/save_quote_version",plan.save_quote_version);
routes.post("/get_total_quote_price",plan.get_total_quote_price);
routes.post("/check_min_price",plan.check_min_price);
routes.post("/get_updation_method",plan.get_updation_method);
routes.post("/split_by_total_price",plan.split_by_total_price);
routes.post("/save_final_quote",plan.post_final_quote);

module.exports = routes;
