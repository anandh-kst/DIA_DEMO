const express = require("express");
const routes = express.Router();
const newConnection = require("../controller/newConnection");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

routes.post("/get_service_provider", newConnection.get_service_provider);
routes.post("/post_new_connection", newConnection.post_new_connection);
routes.post("/get_connectiontype", newConnection.get_connectiontype);
routes.post("/get_bandwidth_list", newConnection.get_bandwidth_list);
routes.post("/get_bandwidth_by_connectiontype", newConnection.get_bandwidth_by_connectiontype);
routes.post("/get_floor_list", newConnection.get_floor_list);
routes.post("/get_new_connection_list", newConnection.get_new_connection_list);
routes.post("/delete_new_connection", newConnection.delete_new_connection);
routes.post("/post_feasibility", newConnection.post_feasibility);
routes.post("/post_modify_feasibility", newConnection.post_modify_feasibility);
routes.post("/check_linkid_exist", newConnection.check_linkid_exist);
routes.post("/get_excel_template", newConnection.get_excel_template);
routes.post("/post_excel_template", upload.single("excelFile"), newConnection.post_excel_template);
routes.post("/get_excel_data", newConnection.get_excel_data);
routes.post("/get_all_data_as_excel", newConnection.get_all_data_as_excel);
routes.post("/post_excel_data", newConnection.post_excel_data);
routes.post("/post_feasibile_to_new_reqId", newConnection.post_feasibile_to_new_reqId);
routes.post("/is_fiber_city", newConnection.is_fiber_city);

module.exports = routes;
