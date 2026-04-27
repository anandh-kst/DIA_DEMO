const logger = require("../config/winston");
const common = require("../common");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { default: axios } = require("axios");
const handlebars = require("handlebars");
const moment = require("moment");
const oracledb = require("oracledb");
const https = require("https");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const ExcelJS = require("exceljs");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploaded_po");
  },
  filename: async (req, file, cb) => {
    const reqId = req.body.reqId;
    const quoteUpdate = await Quote.findOneAndUpdate({ reqId }, { $set: { poUpload: true, poUploadFileName: file.originalname } });
    if (!quoteUpdate) {
      throw "Error While Upload";
    }
    const extname = path.extname(file.originalname);
    cb(null, reqId + extname);
  },
});

const upload = multer({ storage });

const sendOpportunityUpdate = async (reqId) => {
  let apiUrl, payload;
  try {
    const quote = await Quote.findOne({ reqId, isActive: true }).lean();

    const allowedRoles = ["CP + Customer"];

    if (!allowedRoles.includes(quote.parentRole)) return true;

    apiUrl = `${process.env.APP_PATH}/onesify/channelPartner/common/opportunityUpdate`;
    payload = {
      opportunityNo: quote.opportunityNo,
      poDate: moment(quote.poDate, "DD-MMM-YY").format("YYYY-MM-DD"),
      poNumber: quote.poRefNo,
      poValue: quote.totalPrice,
    };
    console.log("Opportunity Update API Payload:", payload);

    const response = await axios.post(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
      httpsAgent,
    });
    console.log("Opportunity Update API Response:", response.data);

    if (response?.data?.status === "Error") {
      throw new Error(response.data.message);
    }
  } catch (error) {
    await common.errorLog({ stack: error.stack, message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}`, filter: "opportunity" }, reqId);
    logger.error({ statusCode: 200, status: "Error", message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}` });
    console.error("Error calling opportunityUpdate API:", error.response?.data || error.message);
  }
};
const downloadAndSavePDF = async (reqId) => {
  const signedPdfUrl = `${process.env.APP_PATH}/onesify/docusign/api/v1/view/signed-file/ILL-SO-${reqId}`;
  const pdfPath = `${appRoot}/public/signedOrders/ILL-SO-${reqId}.pdf`;

  const response = await axios.get(signedPdfUrl, { responseType: "stream" });
  const outputStream = fs.createWriteStream(pdfPath);

  await response.data.pipe(outputStream);
  await new Promise((resolve) => outputStream.on("finish", resolve));

  const pdfData = fs.readFileSync(pdfPath);
  return pdfData;
};
const insertFileAttachment = async (oracalDb, reqId, pdfData) => {
  const { reqId: newReqId } = await reqID.findOneAndUpdate({ id: "file_id" }, { $inc: { reqId: 1 } });

  const bindParams = {
    FILE_ID: newReqId,
    CREATE_ON: new Date().toISOString().slice(0, 23).replace("T", " "),
    FILE_CONTENT: pdfData,
    BS_ID: reqId,
    FILE_NAME: `ILL-SO-${newReqId}`,
    FILE_EXTENSION: "pdf",
    FILE_CONTENT_TYPE: "application/pdf",
  };

  const query = `
    INSERT INTO ${process.env.BLOB_DB_NAME} (
      FILE_ID, CREATE_ON, FILE_CONTENT, BS_ID, FILE_NAME, FILE_EXTENSION, FILE_CONTENT_TYPE
    ) VALUES (
      :FILE_ID,
      TO_TIMESTAMP(:CREATE_ON, 'YYYY-MM-DD HH24:MI:SS.FF'),
      :FILE_CONTENT,
      :BS_ID,
      :FILE_NAME,
      :FILE_EXTENSION,
      :FILE_CONTENT_TYPE
    )
  `;

  const result = await oracalDb.execute(query, bindParams, { autoCommit: true });
  return result;
};
const send_placed_mail = async (reqID, quote, orderId, orderDate) => {
  try {
    const toArray = [quote.customermail];
    // const toArray = ["technical@kstinfotech.com"];
    const subject = `One Sify - Request ID: ${reqID} - Your Order for DIA Services is confirmed with One Sify.`;

    const templateSource = fs.readFileSync(`${appRoot}/template/Order_Placed_Mail.hbs`, "utf-8");

    handlebars.registerHelper("add", function (a, b) {
      return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b);
    });
    handlebars.registerHelper("now", function (data) {
      const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
      const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
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

    const template = handlebars.compile(templateSource);

    const templateData = {
      reqId: reqID,
      quoteType: quote.quoteType === "New" ? "New-Link" : quote.provisionType,
      status: "Order Placed",
      orderId,
      orderDate,
      customerName: quote.customerName,
      customerNumber: quote.customerNumber,
      url: process.env.APP_PATH,
    };

    const attachment = {
      filename: `ILL-SO-${reqID}.pdf`,
      content: fs.createReadStream(`${appRoot}/public/signedOrders/ILL-SO-${reqID}.pdf`),
    };

    const html = template(templateData);
    console.log(toArray);
    common.send_mail(toArray, [], subject, html, attachment).then(() => {
      console.log("Mail Triggered Successfully");
    });
    // const sendMail = await common.send_mail(toArray, (ccArray = []), subject, html, attachment, next);
  } catch (error) {
    logger.error({ statusCode: error.statusCode || 200, status: "Error", message: error });
    console.log(error);
  }
};
const send_order_signed_mail = async (reqID, quote) => {
  try {
    const subject = `DIA - Order Signed Successfully - Request ID: ${reqID}`;

    const templateSource = fs.readFileSync(`${appRoot}/template/Order_Signed_Mail.hbs`, "utf-8");

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
    const template = handlebars.compile(templateSource);

    function capitalizeFirstLetter(str) {
      return str.replace(/\b\w/g, (char) => char.toUpperCase());
    }

    const templateData = {
      ...quote,
      reqId: reqID,
      quoteType: quote.quoteType === "New" ? "New-Link" : capitalizeFirstLetter(quote.quoteType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()),
      companyName: quote.companyName,
      ebsAccountNo: quote.ebsAccountNo,
      locationDetails: quote.locationDetails,
    };

    const attachment = {
      filename: `ILL-SO-${reqID}.pdf`,
      content: fs.createReadStream(`${appRoot}/public/signedOrders/ILL-SO-${reqID}.pdf`),
    };

    const toArray = ["technical@kstinfotech.com"];

    const html = template(templateData);

    common.sendMailUntilSuccess(reqID, toArray, [], subject, html, attachment);
  } catch (error) {
    logger.error({ statusCode: error.statusCode || 200, status: "Error", message: error });
    console.log(error);
  }
};
const processOrderSigned = async (reqID) => {
  const updateData = {
    status: "Order Placed",
    pageTracker: "docuSign",
  };
  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING_BLOB,
  };

  // const oracalDb = await oracledb.getConnection(dbConfig);
  const oracalDb = "";
  try {
    let quote = await Quote.findOne({
      reqId: reqID,
    });
    const pdfData = await downloadAndSavePDF(reqID);
    console.log("PDF Downloaded");
    const singnedmail = await send_order_signed_mail(reqID, quote);
    console.log("Signed Mail Sent", singnedmail);

    const data = quote.quoteType.toUpperCase() === "NEW" ? await common.post_erp_order_new(reqID) : await common.post_erp_order(reqID);

    // const data = await common.post_erp_order(reqID);

    console.log(JSON.stringify(data));
    try {
      const result = await db.collection("erpJsonData").insertOne({ reqId: reqID, data: data, product: "ILL", date: new Date() });
      console.log("Data inserted into collection ERP JSON data:", result);
    } catch (error) {
      console.error("Error inserting ERP JSON data:", error);
    }

    const config = {
      headers: { apikey: process.env.ERP_API_KEY },
    };

    const postERP = await axios.post(`${process.env.POSTERP_URL}`, data, config);
    console.log(postERP?.data);

    // const postERP = {
    //   data: {
    //     STATUS: "S",
    //   },
    // };

    if (postERP.data.STATUS === "S") {
      // const insertData = await insertFileAttachment(oracalDb, reqID, pdfData);

      const orderId = `OSPILL-${reqID}`;
      const orderDate = moment().format("DD-MMM-YYYY");
      // const linkId = erpData.linkId;

      updateData.orderId = orderId;
      updateData.orderDate = orderDate;
      updateData.linkId = null;

      send_placed_mail(reqID, quote, orderId, orderDate);
    } else {
      await common.errorLog({ stack: postERP?.data, message: `Error in ERP Order API: ${process.env.POSTERP_URL} payload: ${JSON.stringify(data)}`, filter: "ERPOrder" }, reqID);
      logger.error({ statusCode: 200, status: "Error", message: `Error in ERP Order API: ${process.env.POSTERP_URL} payload: ${JSON.stringify(data)}` });
      console.error("Error calling ERPOrder API:", postERP?.data);
    }

    return updateData;
  } catch (error) {
    await common.errorLog({ stack: error.response?.data || error.stack || error.message, message: `Error in ERP Order API: ${process.env.POSTERP_URL}`, filter: "ERPOrder" }, reqID);
    logger.error({ statusCode: 200, status: "Error", message: `Error in ERP Order API: ${process.env.POSTERP_URL}` });
    console.error("Error calling ERPOrder API:", error.response?.data || error.message);
    updateData.status = "Order Signed";
    return updateData;
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};
/* exports.post_blob_file = async (req, res, next) => {
  const dbConfig = {
    user: "FLASHNET",
    password: "FLASHNET123",
    connectString: "corpproddb.sify.net:1522/CORPPROD",
  };

  const oracalDb = await oracledb.getConnection(dbConfig);
  try {
    const { reqId, blobReqId, signedPdfReqId } = req.body;

    const signedPdfUrl = `https://onesify.sifytechnologies.com/onesify/docusign/api/v1/view/signed-file/ILL-SO-${signedPdfReqId}`;
    const pdfPath = `${appRoot}/public/signedOrders/ILL-SO-${reqId}.pdf`;

    const response = await axios.get(signedPdfUrl, { responseType: "stream" });
    const outputStream = fs.createWriteStream(pdfPath);

    await response.data.pipe(outputStream);
    await new Promise((resolve) => outputStream.on("finish", resolve));

    const pdfData = fs.readFileSync(pdfPath);

    const bindParams = {
      FILE_ID: blobReqId,
      CREATE_ON: new Date().toISOString().slice(0, 23).replace("T", " "),
      FILE_CONTENT: pdfData,
      BS_ID: reqId,
      FILE_NAME: `ILL-SO-${blobReqId}`,
      FILE_EXTENSION: "pdf",
      FILE_CONTENT_TYPE: "application/pdf",
    };

    const query = `
    INSERT INTO SIFY_OSC_FILE_ATTACHMENT@BI2APPS (
      FILE_ID, CREATE_ON, FILE_CONTENT, BS_ID, FILE_NAME, FILE_EXTENSION, FILE_CONTENT_TYPE
    ) VALUES (
      :FILE_ID,
      TO_TIMESTAMP(:CREATE_ON, 'YYYY-MM-DD HH24:MI:SS.FF'),
      :FILE_CONTENT,
      :BS_ID,
      :FILE_NAME,
      :FILE_EXTENSION,
      :FILE_CONTENT_TYPE
    )
  `;

    const result = await oracalDb.execute(query, bindParams, { autoCommit: true });

    // const insertData = await insertFileAttachment(oracalDb, reqId, pdfData);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (error) {
    next(error);
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
} */

exports.get_quote = async (req, res, next) => {
  try {
    const { reqId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    let data = await Quote.findOne({ reqId }).lean();
    if (!data) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", data });
  } catch (error) {
    next(error);
  }
};
exports.change_quote_status = async (req, res, next) => {
  try {
    const { reqId, status } = req.body;
    let updateData = { status };

    if (!reqId) throw new Error("Missing required parameters: reqId.");

    let reqID = reqId.match(/\d+/g).join("");
    reqID = parseInt(reqID);

    const getStatus = await Quote.findOne({ reqId: reqID, isActive: true });

    if (getStatus.status === "Order Placed" || getStatus.status === "Order Signed") {
      res.send({ status: "Success" });
      return;
    }

    if (status === "Order Signed") {
      updateData = await processOrderSigned(reqID);
    }

    console.log(reqID, updateData);
    const quoteStatus = await Quote.findOneAndUpdate({ reqId: reqID, isActive: true }, updateData);
    if (!quoteStatus) {
      throw new Error("Document not found");
    }

    sendOpportunityUpdate(reqID);
    await common.updateOpportunity(parseInt(reqID));

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (err) {
    next(err);
  }
};
exports.post_updated_feasibility = async (req, res, next) => {
  try {
    const data = req.body;
    if (!data) throw new Error("No Data");

    const { fcf_feasibility_id: feasibilityId } = data;
    console.log(typeof feasibilityId);
    const feasibilityIds = await db.collection("feasibilityids").findOne({ feasibilityId });
    console.log(feasibilityIds);
    if (!feasibilityIds) throw new Error("Feasibility ID not found");

    const getPayload = async (connectionType, serviceProvider) => {
      let result = {};

      const defaultValues = {
        wirelessFeasibilityUpdatedDate: null,
        fiberFeasibilityUpdatedDate: null,
        cxmWirelessFeasibilityStatus: "-",
        cxmFiberFeasibilityStatus: "-",
        vendorId: "",
        otherIspOtc: 0,
        otherIspArc: 0,
        opex: 0,
        capex: 0,
        mastHeight: 0,
        buildingHeight: 0,
        fiberFeasibilityStatus: "",
        wirelessFeasibilityStatus: "",
        mastType: "",
        feasibilityId: "",
        feasibilityUpdatedDate: null,
        fusionFeasibilityStatus: "",
        cxmFeasibilityStatus: "-",
      };
      console.log("connectionType", connectionType, "serviceProvider", serviceProvider);
      if (connectionType === "Other ISP") {
        const { fcfl_otc_install = defaultValues.otherIspOtc, fcfl_rc_ll = defaultValues.otherIspArc, fcfl_total_otc = defaultValues.otherIspOtc, fcfl_total_arc = defaultValues.otherIspArc, fcfl_created_on = defaultValues.feasibilityUpdatedDate, fcfl_modified_on = defaultValues.feasibilityUpdatedDate, fcfl_status = "", fcfl_feasible_status = defaultValues.fusionFeasibilityStatus, fcfl_task_id = "", fcfl_vendor_id = defaultValues.vendorId, fcfl_lmt_remarks = "", fcfl_vsf_id = "", fcfb_cxm_feasibility_status = defaultValues.cxmFeasibilityStatus } = data;

        const match = serviceProvider.match(/\[(.*?)\]/);

        console.log(fcfl_vendor_id, "!==", match[1]);
        if (fcfl_vendor_id !== match[1]) {
          res.send({ status: "Success" });
          return;
        } else {
          result = {
            feasibilityUpdatedDate: fcfl_modified_on || fcfl_created_on,
            cxmFeasibilityStatus: fcfb_cxm_feasibility_status,
            vendorId: fcfl_vendor_id,
            fusionFeasibilityStatus: fcfl_feasible_status,
            otherIspOtc: parseInt(fcfl_total_otc),
            otherIspArc: parseInt(fcfl_total_arc),
          };
        }
      } else {
        const { fcff_cxm_feasibility_status = defaultValues.cxmFiberFeasibilityStatus, fcfb_cxm_feasibility_status = defaultValues.cxmWirelessFeasibilityStatus, fcfb_wireless_option = defaultValues.wirelessFeasibilityStatus, fcf_date_time = defaultValues.wirelessFeasibilityUpdatedDate, fcff_date_time = defaultValues.fiberFeasibilityUpdatedDate, fcff_tot_opex = defaultValues.opex, fcff_tot_capex = defaultValues.capex, fcfb_mast_height = defaultValues.mastHeight, fcfb_building_height = defaultValues.buildingHeight, fcfb_mast_type = defaultValues.mastType, fcf_feasibility_id = defaultValues.feasibilityId, fcff_fiber_selection = defaultValues.wirelessFeasibilityStatus } = data;

        connectionType = connectionType.toLowerCase();
        const isWireless = connectionType === "wireless";

        result = {
          feasibilityUpdatedDate: isWireless ? fcf_date_time : fcff_date_time,
          fusionFeasibilityStatus: isWireless ? fcfb_wireless_option : fcff_fiber_selection,
          cxmFeasibilityStatus: isWireless ? fcfb_cxm_feasibility_status : fcff_cxm_feasibility_status,
          feasibilityId: fcf_feasibility_id,
          opex: parseInt(fcff_tot_opex) || defaultValues.opex,
          capex: parseInt(fcff_tot_capex) || defaultValues.capex,
          mastHeight: parseInt(fcfb_mast_height) || defaultValues.mastHeight,
          buildingHeight: parseInt(fcfb_building_height) || defaultValues.buildingHeight,
          mastType: fcfb_mast_type,
        };
      }
      for (let key in defaultValues) {
        if (!(key in result)) {
          result[key] = defaultValues[key];
        }
      }
      console.log("post_updated_feasibility payload", result);
      return result;
    };
    const postTowerPrice = async (collectionName, quoteDocument, mastHeight, mastType, opex, capex) => {
      let cxmConformation = false;
      let additionalPrice = [];

      let { locationDetails, ebsAccountNo, partyId, hasRateCard, rateCode } = quoteDocument;
      const currentLocationDetails = locationDetails.find((item) => item.feasibilityId === feasibilityId);
      // console.log(currentLocationDetails);
      const companies = loginDB.collection("companies");

      const companyDetails = await companies.find({ $or: [{ ebsaccountNo: ebsAccountNo }, { partyId: partyId }] }).toArray();
      let { iscxmFiberApproval = false, iscxmWirelessApproval = false } = companyDetails[0];

      const connectionType = currentLocationDetails.connectionType.toLowerCase();
      const isWireless = connectionType === "wireless";
      const isFiber = connectionType === "fiber" || connectionType === "other isp";
      // console.log(connectionType, iscxmFiberApproval, iscxmWirelessApproval);
      // console.log("bf", cxmConformation);
      const dbCollection = db.collection(hasRateCard ? "ratecardprices" : "cpprices");
      if (mastHeight) {
        const isRateCardBased = hasRateCard && rateCode;

        const query = isRateCardBased ? { Model_Name: "Tower", Price_Sheet: rateCode } : { type: "tower", bandwidth: mastHeight };

        const towerData = dbCollection.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              minTowerHeight: { $min: "$bandwidth" },
              maxTowerHeight: { $max: "$bandwidth" },
            },
          },
        ]);

        const towerHeight = towerData.length > 0 ? towerData : { minTowerHeight: 9, maxTowerHeight: 0 };

        if (mastHeight >= towerHeight.minTowerHeight) {
          const tower = await dbCollection
            .find({
              ...query,
              bandwidth: mastHeight,
            })
            .toArray();
          cxmConformation = true;

          additionalPrice = [
            {
              priceType: "tower",
              arc: 0,
              otc: tower[0]?.Price ?? tower[0]?.otc ?? 0,
              actualARC: 0,
              actualOTC: tower[0]?.Price ?? tower[0]?.otc ?? 0,
              mastHeight,
              unit: tower[0]?.unit || "Meter",
              mastType,
            },
          ];

          // console.log("bf", cxmConformation);
          if (isWireless) {
            console.log("in", iscxmWirelessApproval);
            cxmConformation = iscxmWirelessApproval;
          } else if (isFiber) {
            cxmConformation = iscxmFiberApproval;
          } else {
            cxmConformation = false;
          }
          console.log("af", cxmConformation);
        }
      } else if (opex || capex) {
        if (isWireless) {
          console.log("in", iscxmWirelessApproval);
          cxmConformation = iscxmWirelessApproval;
        } else if (isFiber) {
          cxmConformation = iscxmFiberApproval;
        } else {
          cxmConformation = false;
        }
        console.log("af", cxmConformation);
      }

      await db.collection(collectionName).findOneAndUpdate(
        { reqId: quoteDocument.reqId },
        {
          $set: { "locationDetails.$[elem].additionalPrice": additionalPrice },
        },
        {
          arrayFilters: [{ "elem.feasibilityId": feasibilityId }],
        }
      );

      return cxmConformation;
    };

    if ((feasibilityIds.serviceType === "DIA" || feasibilityIds.serviceType === "MPLS") && feasibilityIds.status === "Pending") {
      const collectionName = feasibilityIds.serviceType === "DIA" ? "quoteills" : "quotempls";
      const query = { isActive: true, "locationDetails.feasibilityId": feasibilityId };
      const quoteDocument = await db.collection(collectionName).findOne(query);

      let hasRateCard = quoteDocument.hasRateCard;
      let currentLocationDetails = quoteDocument.locationDetails.find((item) => item.feasibilityId === feasibilityId);
      const { connectionType, serviceProvider } = currentLocationDetails;

      const { feasibilityUpdatedDate, cxmFeasibilityStatus, otherIspOtc, otherIspArc, opex, capex, mastHeight, buildingHeight, fusionFeasibilityStatus, mastType } = await getPayload(connectionType, serviceProvider);
      const cxmConformation = await postTowerPrice(collectionName, quoteDocument, mastHeight, mastType, opex, capex);
      if (fusionFeasibilityStatus === "Pending") throw new Error("Nothing To Update");

      const feasibilityStatus = hasRateCard ? (cxmConformation ? "CHECKING FEASIBILITY" : fusionFeasibilityStatus) : fusionFeasibilityStatus;

      console.log(hasRateCard ? (cxmConformation ? "CHECKING FEASIBILITY" : fusionFeasibilityStatus) : fusionFeasibilityStatus);
      const updateQuote = await db.collection(collectionName).findOneAndUpdate(
        query,
        {
          $set: {
            "locationDetails.$[elem].actualFeasibilityStatus": fusionFeasibilityStatus,
            "locationDetails.$[elem].feasibilityStatus": feasibilityStatus,
            "locationDetails.$[elem].cxmFeasibilityStatus": cxmFeasibilityStatus,
            "locationDetails.$[elem].feasibilityUpdatedDate": feasibilityUpdatedDate,
            "locationDetails.$[elem].mastHeight": mastHeight,
            "locationDetails.$[elem].mastType": mastType,
            "locationDetails.$[elem].buildingHeight": buildingHeight,
            "locationDetails.$[elem].opex": opex,
            "locationDetails.$[elem].capex": capex,
            "locationDetails.$[elem].otherIspOtc": otherIspOtc,
            "locationDetails.$[elem].otherIspArc": otherIspArc,
            "locationDetails.$[elem].cxmConformation": cxmConformation,
          },
        },
        {
          arrayFilters: [{ "elem.feasibilityId": feasibilityId }],
          returnDocument: "after", // This option ensures the updated document is returned
        }
      );
      const { lastErrorObject, value: quote, ok } = updateQuote;
      const { locationDetails, reqId, parentRole } = quote;

      if (lastErrorObject.n === 0) {
        throw new Error("Error updating locationDetails");
      }

      const checkFeas = locationDetails.map((data) => data.feasibilityStatus);
      console.log(reqId, checkFeas);
      let status = "CHECKING FEASIBILITY";
      if (checkFeas.every((status) => status === "Feasible")) {
        status = "Feasible";
      } else if (checkFeas.every((status) => status === "CHECKING FEASIBILITY")) {
        status = "CHECKING FEASIBILITY";
      } else if (checkFeas.every((status) => status === "Not Feasible")) {
        status = "Not Feasible";
      } else if (checkFeas.some((status) => status === "Feasible")) {
        status = "Partially Feasible";
      }

      const updateStatusFeab = await db.collection(collectionName).findOneAndUpdate({ reqId: quote.reqId }, { $set: { status: status, cxmCommonStatus: "CHECKING FEASIBILITY" } });
      console.log("updateStatusFeab In function", updateStatusFeab);
      const allFeasibilityStatus = quote.locationDetails.every((e) => e.feasibilityStatus !== "CHECKING FEASIBILITY");
      console.log(
        "Feasibility Status:",
        quote.locationDetails.map((i) => i.feasibilityStatus)
      );

      if (updateQuote && !cxmConformation && allFeasibilityStatus) {
        try {
          const toArray = [quote.customermail];

          let templateSource;

          const subject = `One Sify - Request ID: ${quote.reqId} - Feasibility Update for ${feasibilityIds.serviceType} Services`;
          if (parentRole === "CP + Customer") {
            templateSource = fs.readFileSync(`${appRoot}/template/FeasibilityUpdateCp.hbs`, "utf-8");
          } else {
            templateSource = fs.readFileSync(`${appRoot}/template/Feasibility_Updated.hbs`, "utf-8");
          }
          handlebars.registerHelper("add", function (a, b) {
            return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b);
          });
          handlebars.registerHelper("now", function (data) {
            const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
            const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
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

          const template = handlebars.compile(templateSource);

          function capitalizeFirstLetter(str) {
            return str.replace(/\b\w/g, (char) => char.toUpperCase());
          }
          const templateData = {
            reqId: quote.reqId,
            quoteType: quote.quoteType === "New" ? "New-Link" : capitalizeFirstLetter(quote.quoteType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()),
            // quoteType: quote.provisionType || quote.locationDetails[0].provisionType,
            customerName: quote.customerName,
            customerNumber: quote.customerNumber,
            locationDetails: quote.locationDetails,
            companyName: quote.companyName,
            ebsAccountNo: quote.ebsAccountNo,
            quoteType: quote.quoteType,
            numberOfLineItems: quote.locationDetails.length,
            url: process.env.APP_PATH,
            feasibleCount: quote.locationDetails.filter((data) => data.feasibilityStatus === "Feasible").length,
            notFeasibleCount: quote.locationDetails.filter((data) => data.feasibilityStatus === "Not Feasible").length,
            isNew: quote.quoteType === "New",
          };
          const html = template(templateData);

          common.sendMailUntilSuccess(quote.reqId, toArray, [], subject, html, null);
        } catch (error) {
          console.log("Error in send mail", error);
        }
      }

      await db.collection("opportunityDetails").findOneAndUpdate({ reqId }, { $set: { status, pageTracker: null, updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ") } });

      await db.collection("feasibilityids").findOneAndUpdate({ feasibilityId }, { $set: { status: "completed" } });

      res.send({ status: "Success" });
    } else if (feasibilityIds.serviceType === "P2P" && feasibilityIds.status === "Pending") {
      const getQuote = await db.collection("quotep2ps").findOne({
        $or: [
          {
            "feasibilityStatusNewConnectionA.feasibilityId": feasibilityId,
          },
          {
            "feasibilityStatusNewConnectionB.feasibilityId": feasibilityId,
          },
        ],
      });

      const { reqId, connectionType, newConnectionA, newConnectionB, reqBandwidth, reqBandwidthUOM, customermail, customerNumber, customerName, serviceProvider } = getQuote;
      const isConnectionA = getQuote.feasibilityStatusNewConnectionA?.feasibilityId === feasibilityId;
      const connectionDetails = isConnectionA ? getQuote.feasibilityStatusNewConnectionA : getQuote.feasibilityStatusNewConnectionB;

      const { feasibilityUpdatedDate, cxmFeasibilityStatus, otherIspOtc, otherIspArc, opex, capex, mastHeight, buildingHeight, fusionFeasibilityStatus, mastType } = await getPayload(getQuote.connectionType, serviceProvider);
      if (fusionFeasibilityStatus === "Pending") throw new Error("Nothing To Update");

      const updateData = {
        feasOpt: fusionFeasibilityStatus,
        feasUpdatededDate: feasibilityUpdatedDate,
        req_Status: fusionFeasibilityStatus,
        opex,
        capex,
        mastHeight,
        mastType,
        otherIspOtc,
        otherIspArc,
      };

      const updateField = isConnectionA
        ? {
            feasibilityStatusA: fusionFeasibilityStatus,
            feasibilityStatusNewConnectionA: {
              ...getQuote.feasibilityStatusNewConnectionA,
              ...updateData,
            },
          }
        : {
            feasibilityStatusB: fusionFeasibilityStatus,
            feasibilityStatusNewConnectionB: {
              ...getQuote.feasibilityStatusNewConnectionB,
              ...updateData,
            },
          };
      const updateQuote = await db.collection("quotep2ps").findOneAndUpdate({ reqId: getQuote.reqId }, { $set: updateField });

      const updatedQuote = await db.collection("quotep2ps").findOne({ reqId: getQuote.reqId });
      let status;

      if (updatedQuote?.feasibilityStatusA === "Feasible" && updatedQuote.feasibilityStatusB === "Feasible") {
        status = "Feasible";
      } else if (updatedQuote.feasibilityStatusA === "Not Feasible" || updatedQuote.feasibilityStatusB === "Not Feasible") {
        status = "Not Feasible";
      } else {
        status = "CHECKING FEASIBILITY";
      }

      if (updatedQuote) {
        try {
          const { feasibilityStatusA, feasibilityStatusB } = updateQuote;
          const toArray = [customermail];

          const subject = `One Sify - Request ID: ${reqId} - Feasibility Update for ${feasibilityIds.serviceType} Services`;

          const templateSource = fs.readFileSync(`${appRoot}/template/Feasibility_Updated.hbs`, "utf-8");

          handlebars.registerHelper("add", function (a, b) {
            return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b);
          });
          handlebars.registerHelper("now", function (data) {
            const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
            const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
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

          const template = handlebars.compile(templateSource);

          const templateData = {
            reqId,
            quoteType: "New-Link",
            // quoteType: quote.provisionType || quote.locationDetails[0].provisionType,
            customerName: customerName,
            customerNumber: customerNumber,
            locationDetails: [
              {
                city: newConnectionA.city,
                connectionType: connectionType,
                reqBandwidth: reqBandwidth,
                reqBandwidthUOM: reqBandwidthUOM,
                feasibilityStatus: feasibilityStatusA,
              },
              {
                city: newConnectionB.city,
                connectionType: connectionType,
                reqBandwidth: reqBandwidth,
                reqBandwidthUOM: reqBandwidthUOM,
                feasibilityStatus: feasibilityStatusB,
              },
            ],
            url: process.env.APP_PATH,
            isNew: true,
          };
          const html = template(templateData);

          common.sendMailUntilSuccess(reqId, toArray, [], subject, html, null);
        } catch (error) {
          console.log("Error in send mail", error);
        }
      }

      await db.collection("quotep2ps").findOneAndUpdate({ reqId: updatedQuote.reqId }, { $set: { status } });
      await db.collection("opportunityDetails").findOneAndUpdate({ reqId: updatedQuote.reqId }, { $set: { status, updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ") } });
      await db.collection("feasibilityids").findOneAndUpdate({ feasibilityId }, { $set: { status: "completed" } });

      res.send({ status: "Success" });
    } else if (feasibilityIds.serviceType === "GCC" && feasibilityIds.status === "Pending") {
      const gccCollection = db.collection("quotegccs");
      const quote = await gccCollection.findOne({ isActive: true, status: "CHECKING FEASIBILITY", feasibilityId: feasibilityId });
      const { reqId, connectionDetails, implementationAddress, customermail, customerNumber, customerName } = quote;
      const { connectionType } = quote.connectionDetails;

      const { feasibilityUpdatedDate, cxmFeasibilityStatus, otherIspOtc, otherIspArc, opex, capex, mastHeight, buildingHeight, fusionFeasibilityStatus, mastType } = await getPayload(connectionType);
      if (fusionFeasibilityStatus === "Pending") throw new Error("Nothing To Update");

      const updateStatusFeab = await gccCollection.findOneAndUpdate(
        { reqId },
        {
          $set: {
            status: fusionFeasibilityStatus,
            feasibilityStatus: cxmFeasibilityStatus,
            feasibilityUpdatedDate,
            opex,
            capex,
            mastHeight,
            mastType,
          },
        }
      );
      console.log("updateStatusFeab In function", updateStatusFeab);
      if (updateStatusFeab) {
        try {
          const toArray = [customermail];

          const subject = `One Sify - Request ID: ${reqId} - Feasibility Update for ${feasibilityIds.serviceType} Services`;

          const templateSource = fs.readFileSync(`${appRoot}/template/Feasibility_Updated.hbs`, "utf-8");

          handlebars.registerHelper("add", function (a, b) {
            return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b);
          });
          handlebars.registerHelper("now", function (data) {
            const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
            const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
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

          const template = handlebars.compile(templateSource);

          const templateData = {
            reqId,
            quoteType: "New-Link",
            // quoteType: quote.provisionType || quote.locationDetails[0].provisionType,
            customerName: customerName,
            customerNumber: customerNumber,
            locationDetails: [
              {
                city: implementationAddress.city,
                connectionType: connectionDetails.connectionType,
                reqBandwidth: connectionDetails.reqBandwidth,
                reqBandwidthUOM: connectionDetails.reqBandwidthUOM,
                feasibilityStatus: fusionFeasibilityStatus,
              },
            ],
            url: process.env.APP_PATH,
            isNew: true,
          };
          const html = template(templateData);

          common.sendMailUntilSuccess(reqId, toArray, [], subject, html, null);
        } catch (error) {
          console.log("Error in send mail", error);
        }
      }

      await db.collection("feasibilityids").findOneAndUpdate({ feasibilityId }, { $set: { status: "completed" } });
      await db.collection("opportunityDetails").findOneAndUpdate({ reqId }, { $set: { status: fusionFeasibilityStatus, updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ") } });
      res.send({ status: "Success" });
    } else {
      throw new Error("Nothing To Update");
    }
  } catch (error) {
    next(error);
  }
};
// exports.post_updated_feasibility = async (req, res, next) => {
//   try {
//     const data = req.body;
//     console.log("data");
//     if (!data) {
//       throw "No Data";
//     }
//     // {
//     //   fcf_feasibility_id,
//     //  fcf_date_time,
//     //   fcfb_wireless_option,
//     //   fcfb_mast_height,
//     //   fcfb_mast_type,
//     //   fcfb_building_height
//     //   fcff_total_km,
//     //   fcff_tot_opex,
//     //   fcff_tot_capex
//     //   }

//     const { fcfb_cxm_feasibility_status: cxmFeasibilityStatus, fcfb_wireless_option: feasibilityOpt, fcf_date_time: feasibilityUpdatedDate, fcff_tot_opex: OPEX, fcff_tot_capex: CAPEX, fcfb_mast_height: TOWER_HEIGHT, fcfb_building_height: BUILDING_HEIGHT, fcfb_mast_type: mastType, fcf_feasibility_id: feasibilityId, fcff_fiber_selection: fiberStatus, fcff_fiber_details: fiberDetails } = data;
//     console.log(data);
//     const opex = OPEX ? parseInt(OPEX) : 0;
//     const capex = CAPEX ? parseInt(CAPEX) : 0;
//     const mastHeight = parseInt(TOWER_HEIGHT) || 0;
//     const buildingHeight = parseInt(BUILDING_HEIGHT) || 0;
//     const fusionFeasibilityStatus = feasibilityOpt || fiberDetails;
//     console.log(typeof feasibilityId);
//     const feasibilityIds = await db.collection("feasibilityids").findOne({ feasibilityId });
//     console.log(feasibilityIds);

//     const postTowerPrice = async (collectionName, quoteDocument) => {
//       let cxmConformation = false;
//       let additionalPrice = [];

//       let { locationDetails, ebsAccountNo, partyId, hasRateCard, rateCode } = quoteDocument;
//       const currentLocationDetails = locationDetails.find((item) => item.feasibilityId === feasibilityId);
//       console.log(currentLocationDetails);
//       const companies = loginDB.collection("companies");

//       const companyDetails = await companies.find({ $or: [{ ebsaccountNo: ebsAccountNo }, { partyId: partyId }] }).toArray();
//       let { iscxmFiberApproval = false, iscxmWirelessApproval = false } = companyDetails[0];

//       const connectionType = currentLocationDetails.connectionType.toLowerCase();
//       const isWireless = connectionType === "wireless";
//       const isFiber = connectionType === "fiber" || connectionType === "other isp";
//       console.log(connectionType, iscxmFiberApproval, iscxmWirelessApproval);
//       console.log("bf", cxmConformation);
//       const dbCollection = db.collection(hasRateCard ? "ratecardprices" : "baseprice");
//       if (mastHeight) {
//         const towerData = dbCollection.aggregate([
//           {
//             $match: {
//               Model_Name: "Tower",
//               Price_Sheet: hasRateCard && rateCode ? rateCode : "BASE",
//             },
//           },
//           {
//             $group: {
//               _id: null,
//               minTowerHeight: { $min: "$bandwidth" },
//               maxTowerHeight: { $max: "$bandwidth" },
//             },
//           },
//         ]);

//         const towerHeight = towerData.length > 0 ? towerData : { minTowerHeight: 9, maxTowerHeight: 0 };
//         console.log(towerHeight);
//         if (mastHeight >= towerHeight.minTowerHeight) {
//           const tower = await dbCollection
//             .find({
//               Model_Name: "Tower",
//               bandwidth: mastHeight,
//               Price_Sheet: hasRateCard && rateCode ? rateCode : "BASE",
//             })
//             .toArray();
//           cxmConformation = true;
//           console.log(tower);
//           additionalPrice = [
//             {
//               priceType: "tower",
//               arc: 0,
//               otc: tower[0]?.Price || 0,
//               actualARC: 0,
//               actualOTC: tower[0]?.Price || 0,
//               mastHeight: mastHeight,
//               unit: tower[0]?.unit || "Meter",
//               mastType: mastType,
//             },
//           ];

//           // const currentLocationDetails = locationDetails.find((item) => item.feasibilityId === feasibilityId);
//           // console.log(currentLocationDetails);
//           // const companies = loginDB.collection("companies");

//           // const companyDetails = await companies.find({ ebsaccountNo: ebsAccountNo }).toArray();
//           // let { iscxmFiberApproval = false, iscxmWirelessApproval = false } = companyDetails[0];

//           // const connectionType = currentLocationDetails.connectionType.toLowerCase();
//           // const isWireless = connectionType === "wireless";
//           // const isFiber = connectionType === "fiber";
//           // console.log(connectionType, iscxmFiberApproval, iscxmWirelessApproval);
//           console.log("bf", cxmConformation);
//           if (isWireless) {
//             console.log("in", iscxmWirelessApproval);
//             cxmConformation = iscxmWirelessApproval;
//           } else if (isFiber) {
//             cxmConformation = iscxmFiberApproval;
//           } else {
//             cxmConformation = false;
//           }
//           console.log("af", cxmConformation);
//         }
//       } else if (opex || capex) {
//         if (isWireless) {
//           console.log("in", iscxmWirelessApproval);
//           cxmConformation = iscxmWirelessApproval;
//         } else if (isFiber) {
//           cxmConformation = iscxmFiberApproval;
//         } else {
//           cxmConformation = false;
//         }
//         console.log("af", cxmConformation);
//       }

//       await db.collection(collectionName).findOneAndUpdate(
//         { reqId: quoteDocument.reqId },
//         {
//           $set: { "locationDetails.$[elem].additionalPrice": additionalPrice },
//         },
//         {
//           arrayFilters: [{ "elem.feasibilityId": feasibilityId }],
//         }
//       );

//       return cxmConformation;
//     };

//     if (feasibilityIds.serviceType === "DIA" || (feasibilityIds.serviceType === "MPLS" && fusionFeasibilityStatus !== "Pending")) {
//       const collectionName = feasibilityIds.serviceType === "DIA" ? "quoteills" : "quotempls";
//       const query = {
//         isActive: true,
//         // locationDetails: {
//         //   $elemMatch: {
//         //     feasibilityId: feasibilityId,
//         //     feasibilityStatus: { $in: ["CHECKING FEASIBILITY", "Pending"] },
//         //   },
//         // },
//         "locationDetails.feasibilityId": feasibilityId,
//       };
//       console.log(query);

//       const quoteDocument = await db.collection(collectionName).findOne(query);
//       console.log("quoteDocument", quoteDocument);
//       let hasRateCard = quoteDocument.hasRateCard;
//       let actualStatus = quoteDocument.status;
//       console.log("hasRateCard", hasRateCard);

//       const cxmConformation = await postTowerPrice(collectionName, quoteDocument);
//       const feasibilityStatus = hasRateCard ? (cxmConformation ? "CHECKING FEASIBILITY" : fusionFeasibilityStatus) : fusionFeasibilityStatus;

//       console.log(hasRateCard ? "CHECKING FEASIBILITY" : fusionFeasibilityStatus);
//       const updateQuote = await db.collection(collectionName).findOneAndUpdate(
//         query,
//         {
//           $set: {
//             "locationDetails.$[elem].actualFeasibilityStatus": fusionFeasibilityStatus,
//             "locationDetails.$[elem].feasibilityStatus": feasibilityStatus,
//             "locationDetails.$[elem].cxmFeasibilityStatus": cxmFeasibilityStatus,
//             "locationDetails.$[elem].feasibilityUpdatedDate": feasibilityUpdatedDate,
//             "locationDetails.$[elem].mastHeight": mastHeight,
//             "locationDetails.$[elem].mastType": mastType,
//             "locationDetails.$[elem].buildingHeight": buildingHeight,
//             "locationDetails.$[elem].opex": opex,
//             "locationDetails.$[elem].capex": capex,
//             "locationDetails.$[elem].cxmConformation": cxmConformation,
//           },
//         },
//         {
//           arrayFilters: [{ "elem.feasibilityId": feasibilityId }],
//           returnDocument: "after", // This option ensures the updated document is returned
//         }
//       );
//       const { lastErrorObject, value: quote, ok } = updateQuote;
//       const { locationDetails, reqId } = quote;

//       if (lastErrorObject.n === 0) {
//         throw "Error updating locationDetails";
//       }

//       const checkFeas = locationDetails.map((data) => data.feasibilityStatus);
//       console.log(reqId, checkFeas);
//       let status = "CHECKING FEASIBILITY";
//       if (checkFeas.every((status) => status === "Feasible")) {
//         status = "Feasible";
//       } else if (checkFeas.every((status) => status === "CHECKING FEASIBILITY")) {
//         status = "CHECKING FEASIBILITY";
//       } else if (checkFeas.every((status) => status === "Not Feasible")) {
//         status = "Not Feasible";
//       } else if (checkFeas.some((status) => status === "Feasible")) {
//         status = "Partially Feasible";
//       }
//       // console.log("status", status);
//       // const notAllowed = ["Feasible", "CHECKING FEASIBILITY", "Partially Feasible"];
//       // if (hasRateCard) {
//       //   if (cxmConformation) {
//       //     if (notAllowed.includes(status)) {
//       //       status = "CHECKING FEASIBILITY";
//       //     }
//       //   }
//       // }
//       // console.log(status, { cxmCommonStatus: "CHECKING FEASIBILITY" });

//       // console.log(`${actualStatus} === "Partially Feasible" && !${cxmConformation}`, actualStatus === "Partially Feasible" && !cxmConformation);

//       // if (cxmConformation) {
//       //   if (actualStatus !== "Partially Feasible") {
//       //     const updateStatusFeab = await db.collection(collectionName).findOneAndUpdate({ reqId: quote.reqId }, { $set: { status: status, cxmCommonStatus: "CHECKING FEASIBILITY" } });
//       //     console.log("updateStatusFeab In function", updateStatusFeab);
//       //   }
//       // } else {
//       const updateStatusFeab = await db.collection(collectionName).findOneAndUpdate({ reqId: quote.reqId }, { $set: { status: status, cxmCommonStatus: "CHECKING FEASIBILITY" } });
//       console.log("updateStatusFeab In function", updateStatusFeab);
//       // }

//       if (updateQuote) {
//         try {
//           const toArray = [quote.customermail];
//           const subject = `One Sify - Request ID: ${quote.reqId} - Feasibility Update for ${feasibilityIds.serviceType} Services`;

//           const templateSource = fs.readFileSync(`${appRoot}/template/Feasibility_Updated.hbs`, "utf-8");

//           handlebars.registerHelper("add", function (a, b) {
//             return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b);
//           });
//           handlebars.registerHelper("now", function (data) {
//             const currentTime = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric" });
//             const formattedTime = currentTime.replace(/:\d+ /, " $&IST ");
//             const time = formattedTime;
//             const currentDate = moment().format("DD-MMM-YYYY");
//             const currentYear = moment().format("YYYY");
//             if (data === "date") {
//               return currentDate;
//             } else if (data === "year") {
//               return currentYear;
//             } else if (data === "endDate") {
//               const currentDate = new Date();
//               currentDate.setDate(currentDate.getDate() + 15);
//               const formattedDate = currentDate.toLocaleDateString("en-GB").split("/").join(" - ");

//               return formattedDate;
//             } else {
//               return time;
//             }
//           });

//           const template = handlebars.compile(templateSource);

//           function capitalizeFirstLetter(str) {
//             return str.replace(/\b\w/g, (char) => char.toUpperCase());
//           }
//           const templateData = {
//             reqId: quote.reqId,
//             // quoteType: capitalizeFirstLetter(quote.quoteType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()),
//             quoteType: quote.provisionType || quote.locationDetails[0].provisionType,
//             customerName: quote.customerName,
//             customerNumber: quote.customerNumber,
//             locationDetails: quote.locationDetails,
//             url: process.env.APP_PATH,
//             isNew: quote.quoteType === "New",
//           };
//           const html = template(templateData);
//           common.send_mail(toArray, (ccArray = []), subject, html, (attachments = null)).then(() => {
//             console.log("Mail Triggered Successfully");
//           });
//         } catch {
//           console.log("Error in send mail");
//         }
//       }

//       await db.collection("opportunityDetails").findOneAndUpdate({ reqId }, { $set: { status, pageTracker: null, updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ") } });
//       // await db.collection("opportunityDetails").findOneAndUpdate({ reqId }, { $set: { status, updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ") } });
//       await db.collection("feasibilityids").findOneAndUpdate({ feasibilityId }, { $set: { status: "completed" } });

//       res.send({ status: "Success" });
//     } else if (feasibilityIds.serviceType === "P2P" && feasibilityIds.status === "Pending") {
//       const getQuote = await db.collection("quotep2ps").findOne({
//         $or: [
//           {
//             "feasibilityStatusNewConnectionA.feasibilityId": feasibilityId,
//           },
//           {
//             "feasibilityStatusNewConnectionB.feasibilityId": feasibilityId,
//           },
//         ],
//       });
//       if (getQuote.feasibilityStatusNewConnectionA.feasibilityId === feasibilityId) {
//         const updateQuote = await db.collection("quotep2ps").findOneAndUpdate(
//           {
//             reqId: getQuote.reqId,
//           },
//           {
//             $set: {
//               status: fusionFeasibilityStatus,
//               feasibilityStatusNewConnectionA: {
//                 ...getQuote.feasibilityStatusNewConnectionA,
//                 feasOpt: fusionFeasibilityStatus,
//                 feasUpdatededDate: updatedData,
//                 req_Status: fusionFeasibilityStatus,
//                 opex,
//                 capex,
//               },
//             },
//           }
//         );
//         if (!updateQuote) {
//           const updateFeasibilityIds = await db.collection("feasibilityids").findOneAndUpdate({ feasibilityId }, { status: "completed" });
//         }
//         res.send({ status: "Success" });
//       } else {
//         const updateQuote = await db.collection("quotep2ps").findOneAndUpdate(
//           {
//             reqId: getQuote.reqId,
//           },
//           {
//             $set: {
//               status: fusionFeasibilityStatus,
//               feasibilityStatusNewConnectionB: {
//                 ...getQuote.feasibilityStatusNewConnectionB,
//                 feasOpt: fusionFeasibilityStatus,
//                 feasUpdatededDate: updatedData,
//                 req_Status: fusionFeasibilityStatus,
//                 opex,
//                 capex,
//               },
//             },
//           }
//         );
//       }
//       if (!updateQuote) {
//         const updateFeasibilityIds = await db.collection("feasibilityids").findOneAndUpdate({ feasibilityId }, { status: "completed" });
//       }
//       res.send({ status: "Success" });
//     } else {
//       throw new Error("Nothing To Update");
//     }
//   } catch (error) {
//     next(error);
//   }
// };
exports.get_erp_order_json = async (req, res, next) => {
  try {
    const { reqId } = req.body;
    if (!reqId) {
      throw new Error("Missing Credential");
    }

    let quote = await Quote.findOne({
      reqId,
    });

    const data = quote.quoteType.toUpperCase() === "NEW" ? await common.post_erp_order_new(reqId) : await common.post_erp_order(reqId);

    res.send({ status: "Success", data });
  } catch (error) {
    next(error);
  }
};
exports.post_po_doc = async (req, res, next) => {
  try {
    upload.single("file")(req, res, (err) => {
      if (err) {
        throw new Error("File upload failed");
      }
      res.send({ status: "Success" });
    });
  } catch (error) {
    next(error);
  }
};
exports.view_upload_po = async (req, res, next) => {
  const reqId = req.params.reqId;
  try {
    const file = `${appRoot}/public/uploaded_po/${reqId}.pdf`;
    let data = fs.readFileSync(file);
    res.contentType("application/pdf");
    res.send(data);
  } catch (err) {
    next(err);
  }
};
exports.share_and_sign = async (req, res, next) => {
  let oracleDb;
  try {
    oracleDb = await common.getOracleDb();
    const reqId = req.params.reqId;
    const name = req.params.name;
    const mail = req.params.mail;

    const quote = await Quote.findOne({ reqId }).lean();
    const { quoteType, locationDetails } = quote;

    // As per Gomathi's instructions during the call on 30/12/2024, the code has been commented.
    //// Enable this code as per the mail subject: "Clarification on ORM Validation Flow for DIA." 14/03/2025
    if (quoteType === "modifyBandwidth") {
      const selectedLocationDetails = locationDetails.filter((item) => item.isSelect === true);

      const linkIds = selectedLocationDetails.map((item) => item.existingPlanDetails?.linkId).filter((linkId) => linkId !== undefined);
      // let linkIds = ["2018001214", "232344"];
      const linkIdList = linkIds.map((id) => `'${id}'`).join(",");

      if (linkIds.length > 0) {
        const hasDataQuery = `SELECT COUNT(*) AS count FROM ${process.env.ORACAL_INSTANCE} sliv WHERE sliv.contract_line_status = 'ACTIVE' AND sliv.contract_end_date >= ADD_MONTHS(SYSDATE,1) AND sliv.link_id IN (${linkIdList}) AND sliv.ordered_code !='LASTMILE-RC'`;
        const hasData = await oracleDb.execute(hasDataQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(hasData);

        // const currentDate = moment();

        // const validLinks = hasData.rows
        //   .filter((row) => {
        //     const contractEndDate = moment(row.CONTRACT_END_DATE, "DD-MMM-YYYY");
        //     const adjustedDate = contractEndDate.subtract(1, "month");

        //     return row.CONTRACT_STATUS === "ACTIVE" && adjustedDate.isAfter(currentDate);
        //   })
        //   .map((row) => row.LINK_ID);

        // const invalidLinkIds = linkIds.filter((id) => !validLinks.includes(id));

        console.log(linkIds.length, hasData.rows[0].COUNT);
        if (linkIds.length !== hasData.rows[0].COUNT) {
          // const date = new Date(req.params.createdDate);
          // const formattedDate = `${String(date.getDate()).padStart(2, "0")}-${date.toLocaleString("en-us", { month: "short" })}-${String(date.getFullYear()).slice(-2)} ${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}.${String(date.getSeconds()).padStart(2, "0")}`;
          const currentYear = moment().format("YYYY");
          const htmlContent = `
              <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css">
        <link href='https://fonts.googleapis.com/css?family=Roboto' rel='stylesheet'>
        <!-- <link href="http://fonts.cdnfonts.com/css/myriad-pro" rel="stylesheet"> -->
        <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.4.1/jquery.min.js"></script>
        <script src="https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/js/bootstrap.min.js"></script>
        <title>One Sify Docusign</title>
        <style>
          body {
            font-family: 'Roboto';
          }
          img {
            /* margin-left:50px; */
            margin-top: 20px;
            margin-bottom: 20px;
          }
          h1 {
            color: #0A2134;
            text-align: center;
            font-size: 22px;
            margin-bottom: 35px;
          }
          hr {
            margin-left: 0px;
            margin-top: 15px;
            border-color: #8c9297;
            margin-bottom: 10px;
            margin-right: 25px;
            width: 100%;
          }
          .mail-footer img {
            margin-left: 0px;
            margin-bottom: 0px;
            margin-top: -5px;
            margin-right: 1px;
          }
          .mail-footer p {
            font-size: 12px;
            color: #6A737C;
            margin-right: 50px;
          }
          .mail-footer h6 {
            color: #0A2134;
            font-size: 12px;
            font-weight: 500;
            margin: 10px 0px;
          }
          table {
            width: 100%;
            margin-top: 20px;
          }
          .sify-logo {
            text-align: center;
          }
          a {
            font-size: 12px;
          }
          .loa {
            color: #707070;
            font-size: 14px;
            font-weight: 400;
          }
          .topSpacing {
            margin-top: 15px;
          }
          .row {
            margin-top: 10px;
          }
          .btn {
            min-width: 100px;
            margin-left: 30px;
            margin-bottom: 50px;
          }
          .btnn {
            background-color: #0E3346;
            color: #FFFFFF;
          }
          .page-footer {
            margin-top: 50px;
          }
          th {
            padding: 5px;
            font-weight: 100;
            width: 25%;
          }
          .contact-info {
            text-align: center;
            margin-top: 25px;
            font-size: 12px;
          }
          p {
            color: #474747;
            line-height: 1.4;
            margin-left: 0px;
            font-size: 15px;
            margin-right: 50px;
          }
          .request {
            margin-bottom: 3px;
          }
    	  .container{
    	  margin-top:30px;
    	   margin-bottom:30px;
    	  width:50%;
    	  padding:40px;
    	  background:#f0f0f0;
    	  }
    	  .card {
    	  background:white;
            border-color: #fff;
          }
    	  .headtext{
    	  font-size:25px;
    	  font-weight:bold;
    	  text-align:center;
          margin-top:20px;
    	  }
    	  .btext{
    	  font-size:24px;
    	   font-weight:bold;
    	   margin-bottom:20px;
    	  }
    	  .btext1{
    	  font-size:16px;
    	   font-weight:normal;
    	   margin-bottom:5px;
         padding:10px;
    	  }
    	  button{
    	  background: #0b617a;
        height: 50px;
        color: white;
        width: 250px;
        text-align: center;
        margin-top: 30px;
        margin-bottom: 20px;
        border: none;
        border-radius: 5px;
        font-weight: normal;
    	}
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
          <div class="text-center"><img style='width:200px' src="https://onesifyqc.sifytechnologies.com/assets/images/onesify-logo2.svg" /></div>
    		 <div class="text-center btext">Unable to Proceed</div>
         <div class="text-center btext1">Link Id(s) are not available or have an inactive/expired contract, hence you cannot place the order.</div>
    		  <div class="text-center btext"><img style='width:150px; height: 150px;' src="https://media.istockphoto.com/id/1009333356/vector/warning-sign-icon-vector-simple.jpg?s=612x612&w=0&k=20&c=fWnxkX-H-ZwJsXoYhENQmHe9PlYvrd1fj6u1Op7sE6o="></img></div>
          </div>
    	   <table style="width: 100%;">
                <tr style="border: none;  height: 40px; color:#6A737C; padding-bottom: 20px;">
                    <td height="40px" style="width: 100%; text-align:center;">
                    <p><img
                        src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiIgdmlld0JveD0iMCAwIDEyIDEyIj4KICA8cGF0aCBpZD0iSWNvbl9tYXRlcmlhbC1jb3B5cmlnaHQiIGRhdGEtbmFtZT0iSWNvbiBtYXRlcmlhbC1jb3B5cmlnaHQiIGQ9Ik03Ljg0OCw4LjMxNmExLjUzNCwxLjUzNCwwLDAsMSwuMTgtLjUyMiwxLjA1LDEuMDUsMCwwLDEsLjM1NC0uMzcyLDEuMDY1LDEuMDY1LDAsMCwxLC41NDYtLjEzOCwxLjA4OCwxLjA4OCwwLDAsMSwuMzc4LjA3OC45NjcuOTY3LDAsMCwxLC4zMTIuMjE2LDEuMTU1LDEuMTU1LDAsMCwxLC4yLjMxOCwxLjA1MSwxLjA1MSwwLDAsMSwuMDg0LjM4NEgxMC45OGEyLjE0OCwyLjE0OCwwLDAsMC0uMTY4LS43NzQsMS44LDEuOCwwLDAsMC0uNDItLjYwNiwxLjk2LDEuOTYsMCwwLDAtLjY0OC0uNCwyLjMxOCwyLjMxOCwwLDAsMC0uODM0LS4xMzgsMi4zNDUsMi4zNDUsMCwwLDAtMS4wMi4yLDIuMDYzLDIuMDYzLDAsMCwwLS43Mi41NTIsMi4yNTUsMi4yNTUsMCwwLDAtLjQyNi44MTYsMy41MTQsMy41MTQsMCwwLDAtLjE0NC45ODR2LjE2MmEzLjUxMywzLjUxMywwLDAsMCwuMTM4Ljk4NCwyLjE4MSwyLjE4MSwwLDAsMCwuNDI2LjgxLDIuMDQ4LDIuMDQ4LDAsMCwwLC43Mi41NDYsMi40MzUsMi40MzUsMCwwLDAsMS4wMi4yQTIuMjg5LDIuMjg5LDAsMCwwLDkuNywxMS40OWEyLjA0NywyLjA0NywwLDAsMCwuNjQ4LS4zNzgsMS44MzEsMS44MzEsMCwwLDAsLjQ0NC0uNTY0LDEuNjE1LDEuNjE1LDAsMCwwLC4xOC0uNjlIOS44OTRhLjg1NC44NTQsMCwwLDEtLjA5LjM0OC44ODMuODgzLDAsMCwxLS4yMTYuMjc2Ljk0NS45NDUsMCwwLDEtLjMxMi4xOCwxLjE5MSwxLjE5MSwwLDAsMS0uMzYuMDYsMS4wMTksMS4wMTksMCwwLDEtLjUzNC0uMTM4LDEuMDUsMS4wNSwwLDAsMS0uMzU0LS4zNzIsMS41NjgsMS41NjgsMCwwLDEtLjE4LS41MjgsNC4wNDQsNC4wNDQsMCwwLDEtLjA0OC0uNlY4LjkyMmE0LDQsMCwwLDEsLjA0OC0uNjA2Wk05LDNhNiw2LDAsMSwwLDYsNkE2LDYsMCwwLDAsOSwzWk05LDEzLjhBNC44LDQuOCwwLDEsMSwxMy44LDksNC44MDYsNC44MDYsMCwwLDEsOSwxMy44WiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTMgLTMpIiBmaWxsPSIjNmE3MzdjIi8+Cjwvc3ZnPgo=">
                         ${currentYear} Sify Technologies Ltd, All Rights Reserved.</p>
                    </td>
                </tr>
            </table>
          </div>
      </body>
    </html>
            `;
          res.send(htmlContent);
          return true;
          // throw `Link Id(s) - ${invalidLinkIds.join(", ")} are not available or have an inactive/expired contract, hence you cannot place the order.`;
        }
      }
    }

    const docuSignApiURL = `${process.env.APP_PATH}/onesify/docusign/api/v1/get-jwt-token/ILL-SO-${reqId}`;
    const docuSignPayload = {
      name: name,
      email: mail,
      filePath: `${process.env.APP_PATH}/onesify/network/docu_sign/${quoteType === "New" ? "get_sign_order" : "get_modify_sign_order/true"}/ILL-SO-${reqId}`,
      service: "ILL",
    };

    const docuSignApi = await axios.post(docuSignApiURL, docuSignPayload, { httpsAgent });
    const docuSignUrl = docuSignApi.data.data;

    if (docuSignApi.data.data) {
      res.redirect(docuSignUrl);
    } else {
      await common.errorLog({ stack: docuSignApi?.data, message: `Error in DocuSign API: ${docuSignApiURL} payload: ${JSON.stringify(docuSignPayload)}`, filter: "docuSign" }, reqId);
      logger.error({ statusCode: 200, status: "Error", message: `Error in DocuSign API: ${docuSignApiURL} payload: ${JSON.stringify(docuSignPayload)}` });
      console.error("Error calling DocuSign API:", docuSignApi?.data);
      throw new Error("Error in generating DocuSign URL");
    }
  } catch (error) {
    next(error);
  } finally {
    if (oracleDb) {
      await oracleDb.close();
    }
  }
};
exports.orm_view_validation = async (req, res, next) => {
  let oracleDb;
  try {
    // As per Gomathi's instructions during the call on 30/12/2024, the code has been commented.
    // Enable this code as per the mail subject: "Clarification on ORM Validation Flow for DIA." 14/03/2025
    oracleDb = await common.getOracleDb();
    const { reqId, linkIds = [] } = req.body;

    let linkIdArray = linkIds;
    if (linkIds.length === 0) {
      const quote = await Quote.findOne({ reqId }).lean();

      if (!quote) {
        throw new Error("Quote not found for the given reqId");
      }

      const { locationDetails, quoteType } = quote;

      if (quoteType !== "modifyBandwidth") {
        return res.send({ status: "Success" });
      }

      const selectedLocationDetails = locationDetails.filter((item) => item.isSelect === true);
      if (!selectedLocationDetails.length) {
        throw new Error("Please select at least one location.");
      }

      linkIdArray = selectedLocationDetails.map((item) => item.existingPlanDetails?.linkId).filter((linkId) => linkId !== undefined);
    }

    if (!linkIdArray.length) {
      throw new Error("Link id not found.");
    }

    const linkIdList = linkIdArray.map((id) => `'${id}'`).join(",");

    const hasDataQuery = `SELECT COUNT(*) AS count FROM ${process.env.ORACAL_INSTANCE} sliv WHERE sliv.contract_line_status = 'ACTIVE' AND sliv.contract_end_date >= ADD_MONTHS(SYSDATE,1) AND sliv.link_id IN (${linkIdList}) AND sliv.product_type = 'EXPRESSCONNECT' AND sliv.ordered_code !='LASTMILE-RC'`;
    const hasData = await oracleDb.execute(hasDataQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(hasData);
    if (!hasData?.rows?.length) {
      throw new Error("Error fetching data or invalid response from the database.");
    }

    const activeCount = hasData.rows[0].COUNT;

    if (linkIdArray.length !== activeCount) {
      throw new Error(`Link Id(s) - are not available or have an inactive/expired contract, hence you cannot place the order.`);
    }

    res.send({ status: "Success" });
  } catch (error) {
    next(error);
  } finally {
    if (oracleDb) {
      await oracleDb.close();
    }
  }
};
exports.get_export_excel = async (req, res, next) => {
  try {
    let { fromDate, toDate } = req.body;
    // fromDate = "2023-08-16T07:40:23.000+00:00";
    // toDate = "";
    let dateTime = new Date();
    dateTime.setDate(dateTime.getDate() - 1);
    let previousDate = dateTime.toISOString().slice(0, 10);
    console.log(previousDate);
    fromDate = fromDate || previousDate + " 00:00:00";
    toDate = toDate || previousDate + " 23:59:59";

    const quotesCollection = db.collection("quoteills");

    const sort = { reqId: -1 };

    const startDate = new Date(fromDate);
    startDate.setUTCHours(0, 0, 0, 0); // Set time to midnight (start of the day)

    const endDate = new Date(toDate);
    endDate.setUTCHours(23, 59, 59, 999); // Set time to 23:59:59.999 (end of the day)

    const dateRangeFilter = {};
    if (fromDate && toDate) {
      dateRangeFilter.createdDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const query = {
      isActive: true,
      ...dateRangeFilter,
    };

    console.log(query);

    const allFeasibility = await quotesCollection.find(query).sort(sort).toArray();

    if (allFeasibility.length === 0) {
      throw new Error("No data found");
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    const schema = [
      { header: "Request ID", key: "reqId" },
      { header: "Order Type", key: "quoteType" },
      { header: "Model Name", key: "modelName" },
      { header: "Status", key: "status" },
      { header: "Feasibility ID", key: "feasibilityId" },
      { header: "Fusion Feasibility Status", key: "cxmFeasibilityStatus" },
      { header: "Requested Date", key: "createdDate" },
      { header: "SO Number", key: "orderId" },
      { header: "IR Date", key: "irDate" },
      { header: "PO Date", key: "poDate" },
      { header: "PO Ref No", key: "poRefNo" },
      { header: "Total ARC", key: "totalARC" },
      { header: "Total OTC", key: "totalOTC" },
      { header: "Total Price", key: "totalPrice" },
      { header: "Mode", key: "connectionType" },
      { header: "Bandwidth", key: "reqBandwidth" },
      { header: "UoM", key: "reqBandwidthUOM" },
      { header: "Shipping Address", key: "shippingAddress" },
      { header: "Contact First Name", key: "contactFirstName" },
      { header: "Contact Last Name", key: "contactLastName" },
      { header: "Contact Email", key: "contactEmail" },
      // Add more fields as needed
    ];
    const list = [];
    let rowIndex = 1;
    const reqIdRowCount = {};
    const dataStartRow = 3;

    allFeasibility.forEach((value) => {
      if (value.locationDetails && value.locationDetails.length > 0) {
        value.locationDetails.forEach((data) => {
          const rowData = {
            reqId: value.reqId,
            quoteType: value.quoteType,
            modelName: value.modelName,
            status: value.status,
            createdDate: moment(value.createdDate).format("DD-MMM-YYYY"),
            orderId: value.orderId || "",
            irDate: value.irDate || "",
            poDate: value.poDate || "",
            poRefNo: value.poRefNo || "",
            totalARC: value.totalARC || "",
            totalOTC: value.totalotc || "",
            totalPrice: value.totalPrice || "",
            cxmFeasibilityStatus: data.cxmFeasibilityStatus || "",
            feasibilityId: data.feasibilityId || "",
            shippingAddress: `${data.shippingAddress.address1 || ""}, ${data.shippingAddress.address2 || ""}, ${data.shippingAddress.address3 || ""}, ${data.shippingAddress.city || ""}, ${data.shippingAddress.state || ""}, ${data.shippingAddress.pincode || ""}`,
            connectionType: data.connectionType || "",
            reqBandwidth: data.reqBandwidth || "",
            reqBandwidthUOM: data.reqBandwidthUOM || "",
            contactFirstName: data.contactDetails?.contactFirstName || "",
            contactLastName: data.contactDetails?.contactLastName || "",
            contactEmail: data.contactDetails?.contactEmail || "",
          };

          list.push(rowData);
          reqIdRowCount[value.reqId] = (reqIdRowCount[value.reqId] || 0) + 1;
          rowIndex += 1;
        });
      } else {
        const rowData = {
          reqId: value.reqId,
          quoteType: value.quoteType,
          modelName: value.modelName,
          status: value.status,
          createdDate: moment(value.createdDate).format("DD-MMM-YYYY"),
          orderId: value.orderId || "",
          irDate: value.irDate || "",
          poDate: value.poDate || "",
          poRefNo: value.poRefNo || "",
          totalARC: "",
          totalOTC: "",
          totalPrice: "",
          cxmFeasibilityStatus: "",
          feasibilityId: "",
          shippingAddress: "",
          connectionType: "",
          reqBandwidth: "",
          reqBandwidthUOM: "",
          contactFirstName: "",
          contactLastName: "",
          contactEmail: "",
        };

        list.push(rowData);
        reqIdRowCount[value.reqId] = (reqIdRowCount[value.reqId] || 0) + 1;
        rowIndex += 1;
      }
    });

    worksheet.columns = schema.map((s) => ({ header: s.header, key: s.key }));
    worksheet.spliceRows(dataStartRow, 0, ...list);

    worksheet.addRows(list);

    let currentReqId = null;
    let startRow = dataStartRow;
    let mergeRowCount = 0;

    for (let i = 0; i < list.length; i++) {
      const rowData = list[i];

      if (rowData.reqId !== currentReqId) {
        if (currentReqId !== null && mergeRowCount > 1) {
          for (let col = 1; col <= 14; col++) {
            worksheet.mergeCells(startRow, col, startRow + mergeRowCount - 1, col);
            worksheet.getCell(startRow, col).alignment = { horizontal: "center", vertical: "middle" };
          }
        }

        currentReqId = rowData.reqId;
        startRow = i + dataStartRow;
        mergeRowCount = 1;
      } else {
        mergeRowCount++;
      }

      if (i === list.length - 1 && mergeRowCount > 1) {
        for (let col = 1; col <= 14; col++) {
          worksheet.mergeCells(startRow, col, startRow + mergeRowCount - 1, col);
          worksheet.getCell(startRow, col).alignment = { horizontal: "center", vertical: "middle" };
        }
      }
    }

    const currentDate = moment().format("DD-MMM-YYYY");

    worksheet.spliceRows(1, 0, [`Onesify Portal                                 Date: ${currentDate}`]);
    const headingRow1 = worksheet.getRow(1);
    headingRow1.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A1:U1");

    worksheet.spliceRows(2, 0, ["DIA"]);
    const headingRow2 = worksheet.getRow(2);
    headingRow2.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A2:U2");

    const headingRow3 = worksheet.getRow(3);
    headingRow3.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0e3346" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 2) {
        row.eachCell((cell) => {
          cell.alignment = { horizontal: "left" };
        });
      }
    });
    // worksheet.spliceRows(4, 1);
    const buffer = await workbook.xlsx.writeBuffer();
    // res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    // res.setHeader("Content-Disposition", "attachment; filename=DIA Order List.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
exports.updatae_page_tracker = async (req, res, next) => {
  try {
    let { reqId, pageTracker } = req.body;
    if (!reqId || !pageTracker) throw new Error("Missing required parameters: reqId, pageTracker.");

    const updatePageTracker = await Quote.findOneAndUpdate({ reqId }, { pageTracker });
    if (!updatePageTracker) throw new Error("Failed To Update");

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (error) {
    next(error);
  }
};
exports.ORDER_NUMBER = async (req, res, next) => {
  const { reqId } = req.body;
  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING1,
  };
  const oracalDb = await oracledb.getConnection(dbConfig);

  try {
    const newQuery = `select ORDER_NUMBER from CCOSS.ORDER_STATUS_VIEW where ORDER_SOURCE='OSPILL-${reqId}'`;
    console.log("New Query ::::::: ", newQuery);
    const result = await oracalDb.execute(newQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log("result ::::::: ", result);
    const data = result.rows;
    return { status: "Success", data };
  } catch (error) {
    return error;
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};

exports.remove_poDoc = async (req, res, next) => {
  const { reqId } = req.params;

  try {
    const filePath = `${appRoot}/public/uploaded_po/${reqId}.pdf`;

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);

      await Quote.findOneAndUpdate(
        { reqId: reqId },
        {
          $set: {
            poUpload: false,
            poUploadFileName: null
          }
        }
      );

      res.status(200).json({ status: "success", message: "PO Document deleted successfully" });
    } else {
      res.status(200).json({ status: "error", message: "PO Document not found" });
    }
  } catch (err) {
    console.error('Error deleting PO document:', err);
    next(err);
  }
};

exports.updateRateCode =  async (req, res) => {
  try {
    const { ebsaccountNo, rateCode } = req.body;

  if (!Array.isArray(ebsaccountNo) || ebsaccountNo.length === 0) {
      return res.json({ message: "Provide ebsaccountNo as array" });
    }

   const result = await db.collection("companies").updateMany(
      { ebsaccountNo: { $in: ebsaccountNo } },
      { $set: { rateCode } }
    );

    if (result.modifiedCount > 0) {
      res.json({ message: "Rate code updated successfully", result });
    } else {
      res.json({ message: "No document updated (check ebsaccountNo)", result });
    }
  } catch (error) {
    res.status(500).json({ message: "Error updating rate code", error });
  }
};