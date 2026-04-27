const express = require("express");
const routes = express.Router();
const mail = require("../controller/mail");

routes.post("/send_mail_to_all", mail.send_mail_to_all);
routes.post("/send_mail_to_sign", mail.send_mail_to_sign);
routes.post("/test_pdf", mail.test_pdf);
routes.post("/send_proposal_mail",mail.send_proposal_mail);
routes.post("/get_shared_mails",mail.getSharedMails);

module.exports = routes;
