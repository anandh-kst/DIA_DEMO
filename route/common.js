const express = require("express");
const routes = express.Router();
const common = require("../controller/common");
const auth = require("../auth");

routes.post("/get_quote", auth, common.get_quote);
routes.post("/change_quote_status", common.change_quote_status);
routes.post("/post_updated_feasibility", common.post_updated_feasibility);
routes.post("/get_erp_order_json", common.get_erp_order_json);
routes.post("/post_po_doc", auth, common.post_po_doc);
routes.post("/view_upload_po/:reqId", auth, common.view_upload_po);
routes.post("/remove_poDoc/:reqId", auth, common.remove_poDoc);
routes.get("/share_and_sign/:reqId/:name/:mail", common.share_and_sign);
routes.post("/get_booking_no", common.ORDER_NUMBER);
routes.post("/get_erp_order_json", common.get_erp_order_json);
routes.post("/orm_view_validation", common.orm_view_validation);
routes.post("/get_export_excel", common.get_export_excel);
routes.post("/updatae_page_tracker", auth, common.updatae_page_tracker);
if (process.env.ENVIRONMENT === "PRODUCTION") {
  routes.post("/post_blob_file", common.post_blob_file);
}

module.exports = routes;
