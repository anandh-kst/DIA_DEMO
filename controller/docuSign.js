const logger = require("../config/winston");
const puppeteer = require("puppeteer");
const handlebars = require("handlebars");
const fs = require("fs");
const axios = require("axios");
const moment = require("moment");
const common = require("../common");
const https = require("https");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const send_po_mail = async (reqId, fileName, quote, isNew) => {
  try {
    const toArray = [quote.customermail];

    const subject = `One Sify - Request ID: ${reqId} - Proposal Document for DIA Services`;

    const templateSource = fs.readFileSync(`${appRoot}/template/Proposal_To_Mail.hbs`, "utf-8");

    const mailTemplate = handlebars.compile(templateSource);

    function capitalizeFirstLetter(str) {
      return str.replace(/\b\w/g, (char) => char.toUpperCase());
    }

    const templateData = {
      reqId,
      fileName,
      // quoteType: capitalizeFirstLetter(docs[0].quoteType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()),
      quoteType: isNew ? "New-Link" : capitalizeFirstLetter(quote.quoteType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()),
      //quoteType: isNew ? quote.quoteType : quote.provisionType,
      customerName: quote.customerName,
      customerNumber: quote.customerNumber,
      createdDate: moment().format("DD-MMM-YYYY"),
      url: process.env.APP_PATH,
      isNew,
    };
    const attachment = {
      filename: `${fileName}.pdf`,
      content: fs.createReadStream(`${appRoot}/public/pd/${fileName}.pdf`),
    };
    const html = mailTemplate(templateData);
    common.sendMailUntilSuccess(reqId, toArray, [], subject, html, attachment);
  } catch (error) {
    logger.error({ statusCode: error.statusCode || 200, status: "Error", message: error });
    console.log(error);
  }
};
const updateOpportunityPrice = async (reqId) => {
  let apiUrl, payload;
  try {
    const quote = await Quote.findOne({ reqId, isActive: true }).lean();
    console.log("quote", quote)
    const { opportunityNo, parentRole } = quote;

    const allowedRoles = ["CP + Customer"];

    if (!allowedRoles.includes(parentRole)) return true;

    apiUrl = `${process.env.APP_PATH}/onesify/channelPartner/common/updateOpportunityPrice`;
    payload = { reqId: parseInt(reqId), product: "ills", opportunityNo };
    console.log("Opportunity Update Price API Payload:", payload);

    let response = await axios.post(apiUrl, payload);

    console.log("Opportunity Update Price API Response:", response.data);

    if (response?.data?.status === "Error") {
      throw new Error(response.data.message);
    }
  } catch (error) {
    await common.errorLog({ stack: error.stack, message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}`, filter: "opportunity" }, reqId);
    logger.error({ statusCode: 200, status: "Error", message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}` });
    console.error("Error calling opportunityUpdatePrice API:", error.response?.data || error.message || error);
  }
};
const updateOpportunityDate = async (reqId) => {
  let apiUrl, payload;
  try {
    const quote = await Quote.findOne({ reqId, isActive: true }).lean();
    const { isOpportunitySent, opportunityNo, parentRole } = quote;
    console.log("updateOpportunityDate")
    const allowedRoles = ["CP + Customer"];

    if (!allowedRoles.includes(parentRole)) return true;
    await updateOpportunityPrice(reqId);

    if (isOpportunitySent) return true;

    apiUrl = `${process.env.APP_PATH}/onesify/channelPartner/common/opportunityUpdateDate`;
    payload = { opportunityNo };
    console.log("Opportunity Update Date API Payload:", payload);

    let response = await axios.post(apiUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from("onesify@sifycorp.com:Onesify@123").toString("base64"),
      },
      httpsAgent,
    });

    console.log("Opportunity Update Date API Response:", response.data);

    if (response?.data?.status === "Error") {
      throw new Error(response.data.message);
    }

    await Quote.updateOne({ reqId }, { $set: { isOpportunitySent: true } });

    console.log("Opportunity updated to true in the database.");
  } catch (error) {
    await common.errorLog({ stack: error.stack, message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}`, filter: "opportunity" }, reqId);
    logger.error({ statusCode: 200, status: "Error", message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}` });
    console.error("Error calling opportunityUpdateDate API:", error.response?.data || error.message || error);
  }
};


const getProcessedQuote = async (reqId, documentType) => {
  let quote = await Quote.findOne({ reqId }).lean();
  const locationDetailsList = quote.locationDetails.filter((item) => item.isSelect === true);

  let hasManaged = false;
  let sdsPrice = {
    arc: 0,
    otc: 0,
  };

  for (const locationDetails of locationDetailsList) {
    let managedBundled = [];
    let valueAddedService = [];
    locationDetails.hasManaged = false;

    for (const data of locationDetails.valueAddedService || []) {
      if (data.serviceType === "managed" || data.serviceType === "bundled") {
        managedBundled.push(data);
        sdsPrice.arc += data.arc;
        sdsPrice.otc += data.otc;
        locationDetails.hasManaged = true;
        if (!hasManaged) {
          hasManaged = true;
        }
      } else {
        valueAddedService.push(data);
      }
    }

    locationDetails.valueAddedService = valueAddedService;
    locationDetails.managedBundled = managedBundled;
  }

  quote.stlPrice = {
    arc: quote.totalARC - sdsPrice.arc,
    otc: quote.totalOTC - sdsPrice.otc,
  };
  quote.sdsPrice = sdsPrice;
  quote.hasManaged = hasManaged;
  quote.locationDetails = locationDetailsList;

  const terms = await db.collection("terms").findOne({ product: "DIA", quoteType: quote.quoteType, for: documentType });
  quote.terms = terms;
  return quote;
};
const getPdfBuffer = async (quote, templateFile, pdfPath) => {
  console.log("getPdfBuffer")
  const template = handlebars.compile(templateFile);

  let serialNumber = 0;
  let serialNumber1 = 0;
  let serialNumber2 = 0;
  handlebars.registerHelper("incSerial", function () {
    return ++serialNumber;
  });
  handlebars.registerHelper("incSerial1", function () {
    return ++serialNumber1;
  });
  handlebars.registerHelper("incSerial2", function () {
    return ++serialNumber2;
  });
  handlebars.registerHelper("now", function (data) {
    const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
    const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
    // const date = new Date().toLocaleDateString("en-GB").split("/").join(" - ");
    const time = formattedTime;

    const currentDate = moment().format("DD-MMM-YYYY");
    const currentYear = moment().format("YYYY");
    if (data === "date") {
      return currentDate;
    } else if (data === "year") {
      return currentYear;
    } else if (data === "endDate") {
      const currentDate = new Date();
      currentDate.setDate(currentDate.getDate() + 15);
      const formattedDate = currentDate.toLocaleDateString("en-GB").split("/").join(" - ");

      return formattedDate;
    } else {
      return time;
    }
  });
  handlebars.registerHelper("isEqualOr", function (value1, value2, value3, options) {
    if (value1 === value2 || value1 === value3) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  });
  handlebars.registerHelper("isEqualForShift", function (provisionType, options) {
    if (provisionType === "Shift" || provisionType === "Shift-Downgrade" || provisionType === "Shift-Upgrade") {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  });
  handlebars.registerHelper("bw", function () {
    // const maxBandwidth = docs.locationDetails.reduce((max, value) => {
    //   return value.reqBandwidth > max.reqBandwidth ? value : max;
    // }, docs.locationDetails[0]);

    // const bandwidth = `${maxBandwidth.reqBandwidth} ${maxBandwidth.reqBandwidthUOM}`;
    const bandwidth = quote.locationDetails.map((data) => `${data.reqBandwidth} ${data.reqBandwidthUOM}`).join(" / ");
    return bandwidth;
  });
  handlebars.registerHelper("add", function (a, b) {
    return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b);
  });

  const companies = loginDB.collection("companies");

  const companyDetails = await companies.find({ officialcompanyName: quote.companyName }).toArray();
  // const htmlContent = template({ ...quote, withPrice, companyDetails: companyDetails[0], companyName: quote.companyName.toUpperCase() });
  const connectionTypes = new Set(quote.locationDetails.map((data) => data.connectionType));
  const erpDatas = companyDetails?.[0]?.erpData
  console.log("companyDetails", companyDetails)
  console.log("erpDatas", erpDatas)
  const cpUser = await loginDB.collection("users").findOne({ email: quote.customermail });
  const companyData = await loginDB
    .collection("companies")
    .findOne({ _id: cpUser.companyId });
  console.log("User:", cpUser);
  console.log("Company:", companyData);
  console.log("Company:", companyData.companyName);
  let isFiber = ["Fiber", "Other ISP"].some((type) => connectionTypes.has(type));
  let isWireless = connectionTypes.has("Wireless");

  const hasBoth = isFiber && isWireless;
  if (hasBoth) {
    isFiber = true;
    isWireless = true;
  }
  quote.shipToAddressForAll = quote.locationDetails[0].shippingAddress;
  quote.contractPeriod = quote.locationDetails[0].contractPeriod;
  quote.contractUnit = quote.locationDetails[0].contractUnit;
  quote.contactDetails = quote.locationDetails[0].contactDetails;
  quote.isFiber = isFiber;
  quote.isWireless = isWireless;
  quote.accountManagerName = companyData?.accountManager_name || "-";

  const currentDate = new Date();
  currentDate.setDate(currentDate.getDate() + 15);
  const dateString = moment(currentDate).format("DD-MMM-YYYY");

  quote.validTillDate = dateString;

  const htmlContent = template({ ...quote, cpCompany: companyData.companyName, companyDetails: companyDetails[0], accountManagerName: companyData?.accountManager_name, companyName: quote.companyName.toUpperCase(), billingPattenLink: erpDatas.billingPattenLink, noticePeriod: erpDatas.noticePeriod });

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();

  await page.emulateMediaType("screen");
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });

  const pdfOptions = {
    path: pdfPath,
    format: "A4",
    preferCSSPageSize: true,
    margin: {
      left: "30px",
      right: "30px",
      top: "30px",
      bottom: "30px",
    },
  };

  await page.pdf(pdfOptions);

  await browser.close();

  const pdfBuffer = fs.readFileSync(`${pdfPath}`);
  return pdfBuffer;
};
const verifyOpportunity = async (reqId) => {
  try {
    const opportunityData = await db
      .collection("opportunityDetails")
      .findOne({ reqId });

    if (!opportunityData) {
      return {
        success: false,
        message: "Opportunity record not found"
      };
    }

    if (opportunityData.opportunityStatus === "Cancelled") {
      return {
        success: false,
        message: `Opportunity is already cancelled with status code "${opportunityData.statusCode || "N/A"}" due to reason "${opportunityData.cancelReason || "N/A"}".`
      };
    }

    return {
      success: true,
      message: "Opportunity is valid"
    };

  } catch (error) {
    console.error("verifyOpportunity Error:", error);

    return {
      success: false,
      message: "Something went wrong while verifying opportunity"
    };
  }
};
exports.get_pd_doc = async (req, res, next) => {
  try {
    const fileName = req.params.reqId;
    if (!fileName) throw new Error("Missing required parameters");

    let reqId = fileName.match(/\d+/g).join("");
    reqId = parseInt(reqId);

    const quote = await getProcessedQuote(reqId, "pd");
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const templateFile = fs.readFileSync(`${appRoot}/template/ILL_PROPOSAL.hbs`, "utf-8");
    const pdfPath = `${appRoot}/public/pd/${fileName}.pdf`;

    const pdfBuffer = await getPdfBuffer(quote, templateFile, pdfPath);

    const updatePlan = await Quote.findOneAndUpdate(
      { reqId },
      {
        pageTracker: "proposal",
      }
    );

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.contentType("application/pdf");
    res.send(pdfBuffer);
    // send_po_mail(reqId, fileName, quote, true);
  } catch (error) {
    next(error);
  }
};
exports.get_modify_pd_doc = async (req, res, next) => {
  try {
    const fileName = req.params.reqId;
    let withPrice = req.params.withPrice;
    withPrice = withPrice === "true";
    if (!fileName) throw new Error("Missing required parameters");

    let reqId = fileName.match(/\d+/g).join("");
    reqId = parseInt(reqId);
    await new Promise(resolve => setTimeout(resolve, 1000));
    let quote = await Quote.findOne({ reqId }).lean();
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const locationDetailsList = quote.locationDetails.filter((item) => item.isSelect === true);
    quote.locationDetails = locationDetailsList;
    const connectionTypes = new Set(quote.locationDetails.map((data) => data.connectionType));

    let isFiber = ["Fiber", "Other ISP"].some((type) => connectionTypes.has(type));
    let isWireless = connectionTypes.has("Wireless");

    const hasBoth = isFiber && isWireless;
    if (hasBoth) {
      isFiber = true;
      isWireless = true;
    }

    let towerOTC = 0;
    quote.locationDetails.map(async (data) => {
      if (data.additionalPrice && data.additionalPrice.length > 0) {
        data.additionalPrice.forEach((additionalPrice) => {
          towerOTC += additionalPrice.otc;
        });
      }
    });

    const currentDate = new Date();
    currentDate.setDate(currentDate.getDate() + 15);
    const dateString = moment(currentDate).format("DD-MMM-YYYY");

    quote.validTillDate = dateString;

    const terms = await db.collection("terms").findOne({ product: "DIA", quoteType: quote.quoteType });
    quote.terms = terms;

    const templateFile = fs.readFileSync(`${appRoot}/template/ILL_MODIFY_PROPOSAL.hbs`, "utf-8");

    const template = handlebars.compile(templateFile);

    let serialNumber = 0;
    handlebars.registerHelper("incSerial", function () {
      return ++serialNumber;
    });
    handlebars.registerHelper("now", function (data) {
      const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
      const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
      // const date = new Date().toLocaleDateString("en-GB").split("/").join(" - ");
      const time = formattedTime;

      const currentDate = moment().format("DD-MMM-YYYY");
      const currentYear = moment().format("YYYY");
      if (data === "date") {
        return currentDate;
      } else if (data === "year") {
        return currentYear;
      } else if (data === "endDate") {
        const currentDate = new Date();
        currentDate.setDate(currentDate.getDate() + 15);
        const formattedDate = currentDate.toLocaleDateString("en-GB").split("/").join(" - ");

        return formattedDate;
      } else {
        return time;
      }
    });
    handlebars.registerHelper("if_eq", function (a, opts) {
      if (a === "modifyAddress" || a === "modifyBandwidthAddress") {
        return opts.fn(this);
      } else {
        return opts.inverse(this);
      }
    });
    handlebars.registerHelper("add", function (a, b) {
      return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b);
    });
    handlebars.registerHelper("getTowerOtc", function (additionalPrice) {
      const otc = additionalPrice.filter((data) => data.priceType === "tower").map((data) => data.otc);
      console.log("otc", otc);
      return otc[0] ? `₹${otc[0]}` : "-";
    });

    const companies = loginDB.collection("companies");

    const companyDetails = await companies.find({ officialcompanyName: quote.companyName }).toArray();
    const erpDatas = companyDetails?.[0]?.erpData
    console.log("companyDetails", companyDetails)
    console.log("erpDatas", erpDatas)
    console.log(isWireless);
    const cpUser = await loginDB.collection("users").findOne({ email: quote.customermail });
    const companyData = await loginDB
      .collection("companies")
      .findOne({ _id: cpUser.companyId });
    console.log("User:", cpUser);
    console.log("Company:", companyData);
    console.log("Company:", companyData.companyName);
    const htmlContent = template({ ...quote, towerOTC, cpCompany: companyData.companyName, withPrice, accountManagerName: companyDetails?.[0]?.accountManager_name || "-", companyDetails: companyDetails[0], companyName: quote.companyName.toUpperCase(), isFiber, isWireless, billingPattenLink: erpDatas.billingPattenLink, noticePeriod: erpDatas.noticePeriod });

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.emulateMediaType("screen");
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    const pdfPath = `${appRoot}/public/pd/${fileName}.pdf`;
    const pdfOptions = {
      path: pdfPath,
      format: "A4",
      preferCSSPageSize: true,
      margin: {
        top: "30px",
      },
    };

    await page.pdf(pdfOptions);

    await browser.close();

    const pdfBuffer = fs.readFileSync(`${pdfPath}`);

    const updatePlan = await Quote.findOneAndUpdate(
      { reqId },
      {
        pageTracker: "proposal",
      }
    );

    const { success, message } = await verifyOpportunity(reqId);
    if (success) {
      await updateOpportunityPrice(reqId);
    }
    else {
      console.log(`Opportunity cancelled for reqId ${reqId}: ${message}`);
    }

    res.contentType("application/pdf");
    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send(pdfBuffer);

    // send_po_mail(reqId, fileName, quote, false);
  } catch (error) {
    next(error);
  }
};
exports.get_gst_doc = async (req, res, next) => {
  try {
    const fileName = req.params.reqId;
    if (!fileName) throw new Error("Missing required parameters");

    const filter = fileName.split("-")[1];
    const reqId = parseInt(fileName.split("-")[2], 10);

    let quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    if (filter === "billtogst") {
      if (!quote.billToAddress || !quote.billToAddress.state) {
        throw new Error("Select State First");
      }
    }

    let templateFile = fs.readFileSync(`${appRoot}/template/No_Declaration_Form.hbs`, "utf-8");

    const template = handlebars.compile(templateFile);

    handlebars.registerHelper("now", function () {
      // const date = new Date().toLocaleDateString("en-GB").split("/").join(" - ");
      const currentDate = moment().format("DD-MMM-YYYY");
      return currentDate;
    });

    const htmlContent = template(await quote.toObject());

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.emulateMediaType("screen");
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    const pdfPath = `${appRoot}/public/gst/${fileName}.pdf`;
    const pdfOptions = {
      path: pdfPath,
      format: "A4",
      preferCSSPageSize: true,
      margin: {
        left: "30px",
        right: "30px",
      },
    };

    await page.pdf(pdfOptions);

    await browser.close();

    const pdfBuffer = fs.readFileSync(`${pdfPath}`);
    res.contentType("application/pdf");
    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};
exports.get_sign_order = async (req, res, next) => {
  console.log("get_sign_order")
  try {
    const fileName = req.params.reqId;
    if (!fileName) {
      throw "Missing Parameter";
    }
    const reqId = fileName.match(/\d+/g).join("");

    const quote = await getProcessedQuote(reqId, "so");
    const templateFile = fs.readFileSync(`${appRoot}/template/ILL_CAF.hbs`, "utf-8");
    const pdfPath = `${appRoot}/public/so/${fileName}.pdf`;

    const pdfBuffer = await getPdfBuffer(quote, templateFile, pdfPath);

    updateOpportunityDate(reqId);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.contentType("application/pdf");
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};
exports.get_modify_sign_order = async (req, res, next) => {
  try {
    const fileName = req.params.reqId;
    let withPrice = req.params.withPrice;
    withPrice = withPrice === "true";
    if (!fileName) {
      throw "Missing Parameter";
    }
    const reqId = fileName.match(/\d+/g).join("");

    let quote = await Quote.findOne({ reqId }).lean();
    const locationDetailsList = quote.locationDetails.filter((item) => item.isSelect === true);
    quote.locationDetails = locationDetailsList;
    const connectionTypes = new Set(quote.locationDetails.map((data) => data.connectionType));

    let isFiber = ["Fiber", "Other ISP"].some((type) => connectionTypes.has(type));
    let isWireless = connectionTypes.has("Wireless");

    const hasBoth = isFiber && isWireless;
    if (hasBoth) {
      isFiber = true;
      isWireless = true;
    }

    let towerOTC = 0;
    quote.locationDetails.map(async (data) => {
      if (data.additionalPrice && data.additionalPrice.length > 0) {
        data.additionalPrice.forEach((additionalPrice) => {
          towerOTC += additionalPrice.otc;
        });
      }
    });

    const currentDate = new Date();
    currentDate.setDate(currentDate.getDate() + 15);
    const dateString = moment(currentDate).format("DD-MMM-YYYY");

    quote.validTillDate = dateString;

    const terms = await db.collection("terms").findOne({ product: "DIA", quoteType: quote.quoteType });
    quote.terms = terms;

    const templateFile = fs.readFileSync(`${appRoot}/template/ILL_MODIFY_CAF.hbs`, "utf-8");

    const template = handlebars.compile(templateFile);

    let serialNumber = 0;
    handlebars.registerHelper("incSerial", function () {
      return ++serialNumber;
    });
    handlebars.registerHelper("now", function (data) {
      const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
      const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
      // const date = new Date().toLocaleDateString("en-GB").split("/").join(" - ");
      const time = formattedTime;

      const currentDate = moment().format("DD-MMM-YYYY");
      const currentYear = moment().format("YYYY");
      if (data === "date") {
        return currentDate;
      } else if (data === "year") {
        return currentYear;
      } else if (data === "endDate") {
        const currentDate = new Date();
        currentDate.setDate(currentDate.getDate() + 15);
        const formattedDate = currentDate.toLocaleDateString("en-GB").split("/").join(" - ");

        return formattedDate;
      } else {
        return time;
      }
    });
    handlebars.registerHelper("if_eq", function (a, opts) {
      if (a === "modifyAddress" || a === "modifyBandwidthAddress") {
        return opts.fn(this);
      } else {
        return opts.inverse(this);
      }
    });
    handlebars.registerHelper("getTowerOtc", function (additionalPrice) {
      const otc = additionalPrice.filter((data) => data.priceType === "tower").map((data) => data.otc);
      console.log("otc", otc);
      return otc[0] ? `₹${otc[0]}` : "-";
    });

    const companies = loginDB.collection("companies");

    const companyDetails = await companies.find({ officialcompanyName: quote.companyName }).toArray();
    const erpDatas = companyDetails?.[0]?.erpData
    console.log("companyDetails", companyDetails)
    console.log("erpDatas", erpDatas)
    const cpUser = await loginDB.collection("users").findOne({ email: quote.customermail });
    const companyData = await loginDB
      .collection("companies")
      .findOne({ _id: cpUser.companyId });
    console.log("User:", cpUser);
    console.log("Company:", companyData);
    console.log("Company:", companyData.companyName);
    const htmlContent = template({ ...quote, towerOTC, cpCompany: companyData.companyName, accountManagerName: companyDetails[0]?.accountManager_name, withPrice: quote.withPrice, companyDetails: companyDetails[0], companyName: quote.companyName.toUpperCase(), isFiber, isWireless, billingPattenLink: erpDatas.billingPattenLink, noticePeriod: erpDatas.noticePeriod });

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.emulateMediaType("screen");
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    const pdfPath = `${appRoot}/public/so/${fileName}.pdf`;
    const pdfOptions = {
      path: pdfPath,
      format: "A4",
      preferCSSPageSize: true,
      margin: {
        top: "30px",
        bottom: "30px",
      },
    };

    await page.pdf(pdfOptions);

    await browser.close();

    const pdfBuffer = fs.readFileSync(`${pdfPath}`);

    updateOpportunityDate(reqId);
    res.contentType("application/pdf");
    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};
exports.view_pd_doc = async (req, res, next) => {
  const fileName = req.params.reqId;
  try {
    if (!fileName) {
      throw "Missing Parameter";
    }
    const file = `${appRoot}/public/pd/${fileName}.pdf`;
    let data = fs.readFileSync(file);
    res.contentType("application/pdf");
    res.send(data);
  } catch (err) {
    next(err);
  }
};
exports.view_modify_pd_doc = async (req, res, next) => {
  const fileName = req.params.reqId;
  try {
    if (!fileName) {
      throw "Missing Parameter";
    }
    const file = `${appRoot}/public/pd/${fileName}.pdf`;
    let data = fs.readFileSync(file);
    res.contentType("application/pdf");
    res.send(data);
  } catch (err) {
    next(err);
  }
};
exports.view_gst_doc = async (req, res, next) => {
  const fileName = req.params.reqId;
  try {
    if (!fileName) {
      throw "Missing Parameter";
    }

    const file = `${appRoot}/public/gst/${fileName}.pdf`;
    let data = fs.readFileSync(file);
    res.contentType("application/pdf");
    res.send(data);
  } catch (err) {
    next(err);
  }
};
exports.view_sign_order = async (req, res, next) => {
  const fileName = req.params.reqId;
  try {
    if (!fileName) {
      throw "Missing Parameter";
    }

    const file = `${appRoot}/public/so/${fileName}.pdf`;
    let data = fs.readFileSync(file);
    res.contentType("application/pdf");
    res.send(data);
  } catch (err) {
    next(err);
  }
};
exports.view_modify_sign_order = async (req, res, next) => {
  const fileName = req.params.reqId;
  try {
    if (!fileName) {
      throw "Missing Parameter";
    }

    const file = `${appRoot}/public/so/${fileName}.pdf`;
    let data = fs.readFileSync(file);
    res.contentType("application/pdf");
    res.send(data);
  } catch (err) {
    next(err);
  }
};