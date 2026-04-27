const jwt = require("jsonwebtoken");
const fs = require("fs");
require("dotenv").config();
const axios = require("axios");
const logger = require("./config/winston");
const https = require("https");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const auth = async (req, res, next) => {
  const userToken = req.header("Authorization") ? req.header("Authorization").replace("Bearer ", "") : null;
  if (!userToken) return res.send({ status: "Error", message: "Not Logged In" });
  try {
    const isLogged = await axios.get(`${process.env.APP_PATH}/onesify/auth/api/v1/is_auth/${userToken}`, { httpsAgent });
    if (isLogged.data.status == "Success") {
      let userDoc = isLogged.data.data;
      const decoded = jwt.verify(userToken, `${process.env.JWT_SECRET}`);
      req.createdBy = decoded._id;
      req.companyId = userDoc[0].companyId;
      req.companyName = userDoc[0].companyName;
      req.roles = decoded.roles;
      req.parentRole = decoded.parentRole;
      req.customermail = userDoc[0].email;
      req.ebsAccountNo = userDoc[0].ebsaccountNo;
      req.partyNo = userDoc[0].partyNo;
      req.panNo = userDoc[0].panNo;
      req.customerNumber = userDoc[0].mobileNo;
      req.firstName = userDoc[0].firstName.charAt(0).toUpperCase() + userDoc[0].firstName.slice(1);
      req.lastName = userDoc[0].lastName.charAt(0).toUpperCase() + userDoc[0].lastName.slice(1);
      const userExist = await axios.get(`${process.env.APP_PATH}/onesify/auth/api/v1/users/${userDoc[0].email}`, { httpsAgent });
      if (Array.isArray(userExist.data) && userExist.data.length) {
        next();
      } else {
        logger.error({ status: "Error", message: `User ID Not Registerd. Please contact One Sify Admin -- Local DB` });
        res.status(200).send({ status: "Error", message: `User ID Not Registerd. Please contact One Sify Admin  -- Local DB` });
        return;
      }
    } else if (isLogged.data.status == "Error") {
      let publicKEY = fs.readFileSync("./sso_public.key", "utf8");
      let verifyOptions = {
        algorithm: ["HS256"],
      };
      let legit = jwt.verify(userToken, publicKEY, verifyOptions);
      req.createdBy = legit.onesify._id;
      req.companyId = legit.onesify.companyId;
      req.roles = legit.onesify.roles;
      req.customermail = legit.onesify.email;
      req.customerNumber = legit.onesify.mobileNo;
      req.parentRole = legit.onesify.parentRole;
      req.ebsAccountNo = legit.onesify.ebsaccountNo;
      req.partyNo = legit.onesify.partyNo;
      req.panNo = legit.onesify.panNo;
      req.oscpartyId = legit.onesify.oscpartyId;
      req.firstName = legit.onesify.firstName.charAt(0).toUpperCase() + legit.onesify.firstName.slice(1);
      req.lastName = legit.onesify.lastName.charAt(0).toUpperCase() + legit.onesify.lastName.slice(1);
      req.token = userToken;
      const userExist = await axios.get(`${process.env.APP_PATH}/onesify/auth/api/v1/users/${legit.onesify.email}`, { httpsAgent });
      if (Array.isArray(userExist.data) && userExist.data.length) {
        const allowedPaths = ["/get_quote","/get_new_connection_list"];

        if (!allowedPaths.some((allowedPath) => req.path.startsWith(allowedPath))) {
          const quote = await Quote.findOne({ reqId: req?.body?.reqId || 0 });

          if (quote && !["DRAFT", "CHECKING FEASIBILITY", "Feasible", "Awaiting Signature", "Partially Feasible"].includes(quote.status)) {
            logger.error({ status: "Error", message: "Quote Already Submitted" });
            return res.status(200).send({ status: "Error", message: "Quote Already Submitted" });
          }
        }
        next();
      } else {
        logger.error({ status: "Error", message: `User ID Not Registerd. Please contact One Sify Admin -- SSO` });
        res.status(200).send({ status: "Error", message: `User ID Not Registerd. Please contact One Sify Admin` });
        return;
      }
      return;
    } else {
      logger.error({ status: "Error", message: `Please Authenticate / Contact Admin` });
      res.status(200).send({ status: "Error", message: `Please Authenticate / Contact Admin` });
      return;
    }
  } catch (e) {
    logger.error({ status: "Error", message: `Please Authenticate` });
    res.status(401).send({ status: "Error", message: "Please Authenticate" });
  }
};

module.exports = auth;
