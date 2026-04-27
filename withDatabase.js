const { connectDatabase, closeConnection } = require("./db_config");
const illSchema = require("./model/quote");
const excelTempSchema = require("./model/exceltemp");
const feasibilityidSchema = require("./model/feasibilityIds");
const gstdetailsSchema = require("./model/gstdetails");
const reqIdSchema = require("./model/reqId");
const networkerrorlogSchema = require("./model/networkerrorlogs");
const quoteVersionSchema = require("./model/quoteversion");

const withDatabase = async (req, res, next) => {
  try {
    const { db, loginDB } = await connectDatabase();
    req.db = db; // Assign DB connection to request
    req.loginDB = loginDB; // Assign login DB connection to request
    req.Quote = db.model("quoteills", illSchema);
    req.Exceltemp = db.model("exceltemp", excelTempSchema);
    req.FeasibilityIds = db.model("feasibilityids", feasibilityidSchema);
    req.Gstdetails = db.model("gstdetails", gstdetailsSchema);
    req.reqID = db.model("reqIds", reqIdSchema);
    req.NetworkErrorLogs = db.model("networkerrorlogs", networkerrorlogSchema);
    req.QuoteVersion = db.model("quoteversion",quoteVersionSchema);

    next();
  } catch (error) {
    console.log(error);
    next(error);
  }
};

// Close the database connection automatically when the response is sent
const closeDbAfterResponse = (req, res, next) => {
  res.on("finish", async () => {
    await closeConnection(req.db, req.loginDB);
  });
  next();
};

module.exports = { withDatabase, closeDbAfterResponse };
