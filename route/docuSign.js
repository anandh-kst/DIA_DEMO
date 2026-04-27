const express = require("express");
const routes = express.Router();
const docuSign = require("../controller/docuSign");

routes.get("/get_pd_doc/:reqId/:version?", docuSign.get_pd_doc);
routes.get("/get_modify_pd_doc/:withPrice/:reqId", docuSign.get_modify_pd_doc);
routes.get("/get_gst_doc/:reqId", docuSign.get_gst_doc);
routes.get("/get_sign_order/:reqId", docuSign.get_sign_order);
routes.get("/get_modify_sign_order/:withPrice/:reqId", docuSign.get_modify_sign_order);
routes.get("/view_pd_doc/:reqId", docuSign.view_pd_doc);
routes.get("/view_modify_pd_doc/:reqId", docuSign.view_pd_doc);
routes.get("/view_gst_doc/:reqId", docuSign.view_gst_doc);
routes.get("/view_sign_order/:reqId", docuSign.view_sign_order);
routes.get("/view_modify_sign_order/:reqId", docuSign.view_modify_sign_order);


module.exports = routes;
