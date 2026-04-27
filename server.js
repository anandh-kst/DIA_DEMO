const express = require("express");
const app = express();
const path = require("path");
const hbs = require("hbs");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const https = require("https");
let fs = require("fs");
const logger = require("./config/winston");
const { errorHandler } = require("./errorHandler");
const auth = require("./auth");
const { withDatabase } = require('./withDatabase');
const initializeModels = require('./model/initializeModels');
app.use(withDatabase);
app.use(initializeModels);
require("dotenv").config();

global.appRoot = path.resolve(__dirname);

const publicDirectoryPath = path.join(__dirname, "/public");
const viewsPath = path.join(__dirname, "/templates");

const swaggerJsDoc = YAML.load("./api.yaml");

app.set("view engine", "hbs");
hbs.registerPartials(viewsPath);

app.use(express.static(publicDirectoryPath));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// app.use(cors());

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

const swaggerOptions = {
  swaggerOptions: {
    displayRequestDuration: true,
  }
};

app.use("/onesify/network/docs", swaggerUi.serve, swaggerUi.setup(swaggerJsDoc,swaggerOptions));

//Routes
const newConnection_r = require("./route/newConnection");
const list_r = require("./route/list");
const plan_r = require("./route/plan");
const common_r = require("./route/common");
const billAndship_r = require("./route/billAndship");
const docuSign_r = require("./route/docuSign");
const mail_r = require("./route/mail");
const purchaseSummary_r = require("./route/purchaseSummary");

app.use("/onesify/network/new_connection", auth, newConnection_r);
app.use("/onesify/network/list", auth, list_r);
app.use("/onesify/network/plan",auth, plan_r);
app.use("/onesify/network/common", common_r);
app.use("/onesify/network/bill_and_ship", auth, billAndship_r);
app.use("/onesify/network/docu_sign", docuSign_r);
app.use("/onesify/network/mail", auth, mail_r);
app.use("/onesify/network/purchase_summary", auth, purchaseSummary_r);

const readLogFile = (filePath, res) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.status(404).send("Error Fetch Log File");
    } else {
      res.status(200).send(data);
    }
  });
};

const ErrorLog = function (req, res) {
  const file = `${appRoot}/logs/onesify_network_ill_api_errors.log`;
  readLogFile(file, res);
};

const ActivityLog = function (req, res) {
  const file = `${appRoot}/logs/onesify_network_ill_api_activity.log`;
  readLogFile(file, res);
};

app.get("/onesify/network/index", async (req, res) => {
  res.status(200).send({ status: "Success", message: "One Sify Network API" });
});

app.get("/onesify/network/logs/:logname", async (req, res) => {
  if (req.params.logname === "error") {
    ErrorLog(req, res);
  } else if (req.params.logname === "activity") {
    ActivityLog(req, res);
  } else {
    res.status(404).send("No Log File Found");
  }
});

// Error Handler
app.use(errorHandler);

// Start Server
const port = process.env.PORTWOSSL || 4009;
const currentDate = new Date();

app.listen(port, () => {
  // console.log("port is working on 4020")
  logger.info(`One Sify Network ILL API is running on port ${process.env.PORTWOSSL} at ${currentDate}`);
  console.log(`One Sify Network ILL API is running on port ${process.env.PORTWOSSL} at ${currentDate}`);
});
