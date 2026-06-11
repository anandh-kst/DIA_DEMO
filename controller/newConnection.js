const logger = require("../config/winston");
const common = require("../common");
const handlebars = require("handlebars");
const fs = require("fs");
const moment = require("moment");
const oracledb = require("oracledb");
const ExcelJS = require("exceljs");
const { getPurchaseSummaryByLinkIdList } = require("./purchaseSummary");
const { default: axios } = require("axios");

const checkExistingBandwidth = async (linkId, reqBandwidth) => {
  let oracleDb;
  try {
    oracleDb = await common.getOracleDb();
    let message;
    let status = true;

    const sqlQuery = `SELECT
    sliv.bandwidth AS "reqBandwidth",
    sliv.uom AS "reqBandwidthUOM",
    sliv.link_id AS "linkId"
    FROM
      ${process.env.ORACAL_INSTANCE} sliv
    WHERE
    sliv.product_type = 'EXPRESSCONNECT' AND
    sliv.ordered_code = 'EXPRESSCONNECT-RC' AND
    sliv.link_id = '${linkId}'
    ORDER BY
    CONTRACT_END_DATE ASC`;
    console.log("sqlQuery", sqlQuery);
    const result = await oracleDb.execute(sqlQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const data = result.rows;
    if (data.length === 0) {
      status = false;
      message = "No data";
    } else if (data[0].reqBandwidth === String(reqBandwidth)) {
      status = false;
      message = `Select BandWidth greater or lesser than ${data[0].reqBandwidth}`;
    }
    return { status, message };
  } finally {
    if (oracleDb) {
      await oracleDb.close();
    }
  }
};
const checkLinkIdExist = async (linkId) => {
  let oracleDb;
  try {
    oracleDb = await common.getOracleDb();
    let message = "";
    let status = true;

    // const isExist = await Quote.find({
    //   isActive: true,
    //   status: { $ne: "CLOSED" },
    //   "locationDetails.existingPlanDetails.linkId": { $in: [`${linkId}`] },
    // });

    // if (isExist.length !== 0) {
    //   status = false;
    //   message = `Link Id - ${linkId} is already under implementation, Hence you cannot place additional order till that is implemented`;
    //   return { status, message };
    // }

    // const hasDataQuery = `SELECT * FROM ${process.env.ORACAL_INSTANCE} WHERE link_id = '${linkId}'`;
    // console.log(hasDataQuery);
    // const hasData = await oracleDb.execute(hasDataQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    // console.log("hasData", hasData.rows.length);
    // if (hasData.rows.length === 0) {
    //   const checkErrorQuery = `select
    // CASE
    // WHEN DISCONNECTION_DATE is not null THEN 'ACCOUNT NUMBER:'||CUSTOMER_NUMBER ||',DISCONNECTION DATE:'||DISCONNECTION_DATE||'(The given link got disconnected.Hence, you cannot process this order)'
    // WHEN UPPER(STATUS) like 'PENDING%' THEN 'ACCOUNT NUMBER:'||CUSTOMER_NUMBER||',MODEL:'||ORDERED_ITEM||',STATUS:'||STATUS||',ACTIVITY:'||ACTIVITY||'(The previous order for this link is under implementation.Until the implementation is completed,with IR Upload and billing for the previous order,you cannot process new order)'
    // WHEN LINE_END_DATE < SYSDATE  THEN 'ACCOUNT NUMBER:'||CUSTOMER_NUMBER||',MODEL:'||ORDERED_ITEM||',ACTIVITY:'||ACTIVITY||'CONTRACT END Date:'||LINE_END_DATE||'(Since the contract got expired, you cannot process any new order.Do the renewal first and then process this order)'
    // WHEN (LINE_END_DATE - SYSDATE)> 0 AND  (LINE_END_DATE - SYSDATE) <= 15  THEN 'ACCOUNT NUMBER:'||CUSTOMER_NUMBER||',MODEL:'||ORDERED_ITEM||',ACTIVITY:'||ACTIVITY||',CONTRACT END Date:'||LINE_END_DATE||'(No new orders can be logged when the contract is expiring in less than 15 days.Do the renewal first and then process this order)'
    // ELSE STATUS || 'The option to modify this link is not available'
    // END AS MESSAGE
    // from ${process.env.ORACAL_INSTANCE_STATUS}  where link_id='${linkId}'`;
    //   console.log("checkErrorQuery", checkErrorQuery);
    //   const checkError = await oracleDb.execute(checkErrorQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    //   status = false;
    //   message = checkError.rows[0]?.MESSAGE ? checkError.rows[0].MESSAGE : "Invalid LinkId";
    //   return { status, message };
    // }

    return { status, message };
  } finally {
    if (oracleDb) {
      await oracleDb.close();
    }
  }
};
const setInvalidData = (rowData, property, statusKey, messageKey, errorMessage) => {
  if (!rowData["errorMessage"].includes(errorMessage)) {
    rowData["errorMessage"] += errorMessage + ". ";
  }
  rowData[statusKey] = "Invalid";
  rowData[messageKey] = errorMessage;
};
const setValidData = (rowData, property, statusKey, messageKey) => {
  rowData[statusKey] = "Valid";
  rowData[messageKey] = "";
};
const send_feasibility_mail = async (reqId, toArray) => {
  console.log("send_feasibility_mail called with reqId:", reqId, "toArray:", toArray);
  try {
    const quote = await Quote.findOne({ reqId }).lean();
    const { locationDetails, customerNumber, customerName, companyName, quoteType, parentRole } = quote;
    console.log("quote", quote);
    // let subject,templateSource;
    let templateSource;
    let subject;
    if (parentRole === "CP + Customer") {
      subject = `Sify - ${companyName} - Feasibility Raised for DIA Services - Request ID: ${reqId}`;
    } else {
      subject = `One Sify - Request ID: ${reqId} - Feasibility Raised with One Sify for DIA Services.`;
    }

    if (parentRole === "CP + Customer") {
      templateSource = fs.readFileSync(`${appRoot}/template/FeasibilityRaisedCp.hbs`, "utf-8");
    } else {
      templateSource = fs.readFileSync(`${appRoot}/template/Feasibility_Raised.hbs`, "utf-8");

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
      reqId: reqId,
      quoteType: quoteType === "New" ? "New-Link" : capitalizeFirstLetter(quoteType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()),
      // quoteType: provisionType,
      customerName: customerName,
      customerNumber: customerNumber,
      ebsAccountNo: quote.ebsAccountNo,
      locationDetails: locationDetails,
      companyName: quote.companyName,
      numberOfLineItems: locationDetails.length,
      url: process.env.APP_PATH,
      isNew: quoteType === "New",
    };
    const html = template(templateData);

    common.sendMailUntilSuccess(reqId, toArray, [], subject, html, null);
  } catch (error) {
    logger.error({ statusCode: error.statusCode || 200, status: "Error", message: error });
    console.log(error);
  }
};
const get_gst = async (state, panNo) => {
  let stateCode = null;
  let shipToGST = "UNREGISTERED";
  try {
    const stateCodeDetails = await axios.post(`${process.env.APP_PATH}/onesify/auth/api/v1/get-city`, { state });
    console.log("stateCodeDetails", stateCodeDetails);
    stateCode = stateCodeDetails?.data?.stateCode;

    if (stateCode) {
      const gstPayload = {
        Org_Code: "60002",
        SecretKey: "hgnfds87r94hrfiosef8984o59",
        ServiceCode: "GSP",
        consent: "y",
        reason: "For KYC of User",
        PAN_Number: panNo,
        state_code: stateCode,
      };

      console.log("gstPayload", gstPayload);

      const gstData = await axios.post(`${process.env.APP_PATH}/kyc_live/eAPI/TAX_API/GST_Search_with_PAN`, gstPayload);
      console.log("gstData", gstData.data);

      const gstin = gstData?.data?.data?.[0]?.gstin;
      if (gstin) {
        shipToGST = gstin;
      } else {
        console.warn("gstin not found, defaulting to UNREGISTERED");
      }
    } else {
      console.warn("stateCode not found, skipping GST lookup.");
    }
    return shipToGST;
  } catch {
    return shipToGST;

  }
};
exports.get_service_provider = async (req, res, next) => {
  try {
    const data = await db
      .collection("ispdetails")
      .find({}, { projection: { serviceProvider: 1 } })
      .limit(1)
      .toArray();

    if (!data || data.length === 0) {
      throw new Error("No data found or failed to retrieve data");
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", data: data[0].serviceProvider });
  } catch (error) {
    next(error);
  }
};
exports.post_new_connection = async (req, res, next) => {
  try {
    let body = req.body;
    console.log(body, "req.body")
    let customerName = `${req.firstName} ${req.lastName}`;
    let { customermail, customerNumber, createdBy } = req;
    let { existingPlanDetails, reqBandwidth, sameContactForAll, contactDetails } = body;

    let { reqId, panNo, locationId, quoteType, iscxmFiberApproval, iscxmWirelessApproval, hasRateCard, rateCode, parentRole, companyId, partyId, partyNo, ebsAccountNo, companyName, ...locationDetails } = body;
    parentRole = parentRole || req.parentRole;
    let existingBandwidth;
    const notMantatoryFields = ["reqId", "serviceProvider", "longitude", "latitude", "contactPhoneNumber2", "locationId", "address3", "rateCode"];

    const missingFields = Object.keys(body).filter((field) => !notMantatoryFields.includes(field) && body[field] === "");

    if (missingFields.length > 0) {
      throw new Error(`${missingFields.join(", ")} is missing`);
    }
    const generateLocationId = async (reqId) => {
      const locationDetailsCount = await Quote.aggregate([{ $match: { reqId } }, { $unwind: "$locationDetails" }, { $group: { _id: null, count: { $max: "$locationDetails.locationId" } } }, { $project: { _id: 0, count: 1 } }]);
      return locationDetailsCount.length ? locationDetailsCount[0].count + 1 : 1;
    };

    const getProvisionType = (quoteType) => {
      switch (quoteType) {
        case "modifyBandwidth":
          existingBandwidth = existingPlanDetails.reqBandwidthUOM.toUpperCase() === "GBPS" ? existingPlanDetails.reqBandwidth * 1024 : existingPlanDetails.reqBandwidth;
          return parseInt(existingBandwidth) > reqBandwidth ? "Downgrade" : "Upgrade";
        case "modifyAddress":
          return "Shift";
        case "modifyBandwidthAddress":
          existingBandwidth = existingPlanDetails.reqBandwidthUOM.toUpperCase() === "GBPS" ? existingPlanDetails.reqBandwidth * 1024 : existingPlanDetails.reqBandwidth;
          return parseInt(existingBandwidth) > reqBandwidth ? "Shift-Downgrade" : "Shift-Upgrade";
        default:
          return "New-Link";
      }
    };

    const updateLocationDetails = async (reqId, locationId) => {
      locationDetails.locationId = locationId || (await generateLocationId(reqId));
      locationDetails.provisionType = getProvisionType(quoteType);

      if (
        quoteType === "modifyBandwidth" &&
        existingPlanDetails?.classofService === "Standard"
      ) {
        locationDetails.classofService = "Value";

        locationDetails.existingPlanDetails.classofService = "Value";
      }
      if (quoteType !== "New") {
        locationDetails.billingAddress = {
          ...existingPlanDetails.billingAddress,
          billToAddressType: "existing",
        };
      }
    };

    if (reqId === 0 && locationId === 0) {
      const { reqId } = await reqID.findOneAndUpdate({ id: "req_id" }, { $inc: { reqId: 1 } });
      await db.collection("reqiddetailslogs").insertOne({ reqId, ebsAccountNo, companyName, product: "DIA", createdAt: new Date() });

      await updateLocationDetails(reqId);

      const shipToGst = await get_gst(locationDetails.shippingAddress.state, panNo);
      locationDetails.shippingAddress.shipToGst = shipToGst;
      locationDetails.shippingAddress.hasShipToGst = shipToGst != "UNREGISTERED";

      const postData = {
        locationDetails,
        ...(sameContactForAll && { contactDetailsForAll: contactDetails }),
        quoteType,
        parentRole,
        reqId,
        ebsAccountNo,
        partyId,
        partyNo,
        createdBy,
        companyName,
        customerName,
        customerNumber,
        customermail,
        companyId,
        hasRateCard,
        rateCode,
        iscxmFiberApproval,
        iscxmWirelessApproval,
      };

      const quote = new Quote(postData);
      const result = await quote.save();
      if (!result) {
        throw new Error("Failed to insert");
      }
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({ status: "Success", reqId, locationId: locationDetails.locationId });
    } else if (reqId !== 0 && locationId !== 0) {
      const deleteOld = await Quote.findOneAndUpdate({ reqId, "locationDetails.locationId": locationId }, { $pull: { locationDetails: { locationId } } });

      if (!deleteOld) {
        throw new Error("LocationId not found in the document.");
      }

      await updateLocationDetails(reqId, locationId);

      if (!contactDetails) {
        const quote = await Quote.findOne({ reqId });
        locationDetails.contactDetails = quote.contactDetailsForAll;
      }

      const shipToGst = await get_gst(locationDetails.shippingAddress.state, panNo);
      locationDetails.shippingAddress.shipToGst = shipToGst;
      locationDetails.shippingAddress.hasShipToGst = shipToGst != "UNREGISTERED";

      const postData = {
        $addToSet: { locationDetails },
        ...(sameContactForAll && { contactDetailsForAll: contactDetails }),
        quoteType,
      };

      const quoteUpdate = await Quote.findOneAndUpdate({ reqId }, postData);
      if (!quoteUpdate) {
        throw new Error("Failed to insert");
      }

      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({ status: "Success", reqId, locationId: locationDetails.locationId });
    } else if (reqId !== 0 && locationId === 0) {
      await updateLocationDetails(reqId);

      if (!contactDetails) {
        const quote = await Quote.findOne({ reqId });
        locationDetails.contactDetails = quote.contactDetailsForAll;
      }

      const shipToGst = await get_gst(locationDetails.shippingAddress.state, panNo);
      locationDetails.shippingAddress.shipToGst = shipToGst;
      locationDetails.shippingAddress.hasShipToGst = shipToGst != "UNREGISTERED";

      const postData = {
        $addToSet: { locationDetails },
      };

      const quoteUpdate = await Quote.findOneAndUpdate({ reqId }, postData);
      if (!quoteUpdate) {
        throw new Error("Failed to insert");
      }

      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({ status: "Success", reqId, locationId: locationDetails.locationId });
    } else {
      throw new Error("Data Missing");
    }
  } catch (error) {
    next(error);
  }
};
//need to remove
exports.get_bandwidth_by_connectiontype = async (req, res, next) => {
  let { connectionType, currentBandwidth, rateCode } = req.body;
  try {
    connectionType = connectionType === "Other ISP" ? "Fiber" : connectionType;
    const data = await db.collection("conditionills").find({ connectionType }).project({ _id: 0, connectionType: 0 }).toArray();
    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({
      status: "Success",
      data,
    });
  } catch (error) {
    next(error);
  }
};
exports.get_connectiontype = async (req, res, next) => {
  try {
    const { rateCode, reqBandwidth, reqBandwidthUOM, existingConnectionType } = req.body;
    const { parentRole } = req;

    const restrictedRoles = ["CP + Customer", "CXM + Customer"];

    const filterByExistingConnectionType = (connectionTypes) => {
      if (
        !existingConnectionType ||
        (Array.isArray(existingConnectionType) && existingConnectionType.length === 0)
      ) {
        return connectionTypes;
      }

      const existing = Array.isArray(existingConnectionType)
        ? existingConnectionType
        : [existingConnectionType];

      if (existing.includes("Ethernet Drop - Sify PoP")) {
        return connectionTypes.includes("Fiber") ? ["Fiber"] : [];
      }

      if (existing.includes("Fiber") || existing.includes("Wireless")) {
        return connectionTypes.filter((type) =>
          ["Fiber", "Wireless"].includes(type)
        );
      }

      return connectionTypes;
    };

    if (rateCode) {
      const connectionTypes = await db
        .collection("ratecardprices")
        .find({
          plan: /bw/,
          Price_Sheet: rateCode,
          ...(reqBandwidth && { bandwidth: reqBandwidth }),
        })
        .toArray();

      const uniqueConnectionTypes = new Set();

      connectionTypes.forEach((doc) => {
        if (doc.plan === "bw_fiber") {
          uniqueConnectionTypes.add("Fiber");
          if (parentRole === "CP + Customer") {
            uniqueConnectionTypes.add("Other ISP");
          }
        } else if (doc.plan === "bw_rf") {
          uniqueConnectionTypes.add("Wireless");
        }
      });

      let connectionType = Array.from(uniqueConnectionTypes);
      connectionType = filterByExistingConnectionType(connectionType);

      logger.info(`${req.path} -- ${req.method} -- Success`);
      return res.send({ status: "Success", connectionType });
    }

    if (!reqBandwidth) {
      let connectionType = await db.collection("conditionills").distinct("connectionType");

      if (!restrictedRoles.includes(parentRole) || parentRole !== "CP + Customer") {
        connectionType = connectionType.filter((item) => item !== "Other ISP");
      }

      connectionType = filterByExistingConnectionType(connectionType);

      logger.info(`${req.path} -- ${req.method} -- Success`);
      return res.send({ status: "Success", connectionType });
    }

    const matchConditions = {
      bw: reqBandwidth,
      unit: reqBandwidthUOM,
    };

    const bwCondition = await db.collection("conditionills").find(matchConditions).toArray();

    let connectionType = [...new Set(bwCondition.map((doc) => doc.connectionType))];

    if (connectionType.length !== 0) {
      connectionType = filterByExistingConnectionType(connectionType);

      logger.info(`${req.path} -- ${req.method} -- Success`);
      return res.send({ status: "Success", connectionType });
    }

    let fallbackTypes = [];

    const availableBandwith = await db
      .collection("conditionills")
      .find({ bw: { $gte: reqBandwidth } })
      .limit(1)
      .toArray();

    if (availableBandwith.length > 0) {
      const bw = await db
        .collection("conditionills")
        .find({ bw: availableBandwith[0].bw });

      for await (const data of bw) {
        fallbackTypes.push(data.connectionType);
      }
    }

    if (!restrictedRoles.includes(parentRole) || parentRole !== "CP + Customer") {
      fallbackTypes = fallbackTypes.filter((item) => item !== "Other ISP");
    }

    let connectionTypeFinal = [...new Set(fallbackTypes)];
    connectionTypeFinal = filterByExistingConnectionType(connectionTypeFinal);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    return res.send({ status: "Success", connectionType: connectionTypeFinal });

  } catch (error) {
    next(error);
  }
};
exports.get_bandwidth_list = async (req, res, next) => {
  let { connectionType, currentBandwidth, rateCode } = req.body;
  try {
    if (rateCode) {
      const query = {
        plan: "bw",
        Price_Sheet: rateCode,
      };

      if (connectionType) {
        if (connectionType === "Fiber" || connectionType === "Other ISP") {
          query.plan = "bw_fiber";
        } else {
          query.plan = "bw_rf";
        }
      }

      const distinctBandwidth = await db.collection("ratecardprices").distinct("bandwidth", query, { maxTimeMS: 50000 });

      console.log(distinctBandwidth);
      const rateCardBandwidth = distinctBandwidth
        .filter((bandwidth) => parseInt(currentBandwidth) !== bandwidth)
        .sort((a, b) => a - b)
        .map((bandwidth) => ({
          bw: bandwidth,
          unit: "Mbps",
        }));
      console.log(rateCardBandwidth);
      res.send({
        status: "Success",
        data: rateCardBandwidth,
      });
    } else {
      if (connectionType === "Other ISP") {
        connectionType = "Fiber";
      }
      const allBandwidth = await db.collection("conditionills").find({ connectionType }).project({ _id: 0, connectionType: 0 }).toArray();

      const data = allBandwidth
        .filter((bandwidth) => parseInt(currentBandwidth) !== bandwidth.bw)
        .sort((a, b) => a.bw - b.bw)
        .map((bandwidth) => ({
          bw: bandwidth.bw,
          unit: bandwidth.unit,
        }));

      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({
        status: "Success",
        data,
      });
    }
  } catch (error) {
    next(error);
  }
};
exports.get_floor_list = async (req, res, next) => {
  try {
    const data = Array.from({ length: 26 }, (_, i) => `G${i === 0 ? "" : " + " + i}`);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({
      status: "Success",
      data,
    });
  } catch (error) {
    next(error);
  }
};
// exports.get_new_connection_list = async (req, res, next) => {
//   const { reqId, connectionID, isSelect } = req.body;
//   try {
//     if (!reqId) throw "reqId Missing";
//     let query = { reqId, isActive: true };

//     if (connectionID !== 0) {
//       query.connectionID = connectionID;
//     }
//     if (isSelect) {
//       query.isSelect = true;
//     }

//     const quotesCollection = db.collection("quoteills");

//     // const projection = {
//     //   _id: 0,
//     //   reqId: 1,
//     //   connectionID: 1,
//     //   quoteStatus: 1,
//     //   address1: 1,
//     //   address2: 1,
//     //   address3: 1,
//     //   city: 1,
//     //   state: 1,
//     //   pincode: 1,
//     //   latitude: 1,
//     //   longitude: 1,
//     //   contactFirstName: 1,
//     //   contactLastName: 1,
//     //   contactPhoneNumber1: 1,
//     //   contactPhoneNumber2: 1,
//     //   contactEmail: 1,
//     //   reqBandwidth: 1,
//     //   reqBandwidthUOM: 1,
//     //   connectionType: 1,
//     //   isSelect: 1,
//     //   status: 1,
//     //   shipToGst: 1,
//     //   existingPlanDetails: 1,
//     //   basePlan: { $arrayElemAt: ["$basePlan", 0] },
//     // };
//     const newConnectionList = await quotesCollection.find(query).toArray();
//     if (newConnectionList.length === 0) {
//       throw "No Data";
//     }

//     const checkFeas = new Map();
//     let feasabilityStatus = "Not Feasible";

//     for (const doc of newConnectionList) {
//       if (doc.basePlan && doc.basePlan.length === 1) {
//         doc.basePlan = doc.basePlan[0];
//       }

//       if (!checkFeas.has(doc.reqId)) {
//         checkFeas.set(doc.reqId, []);
//       }

//       checkFeas.get(doc.reqId).push(doc.status);
//     }

//     const feasStatus = checkFeas.get(reqId);

//     if (feasStatus.every((status) => status === "Feasible")) {
//       feasabilityStatus = "Feasible";
//     } else if (feasStatus.every((status) => status === "CHECKING FEASIBILITY")) {
//       feasabilityStatus = "CHECKING FEASIBILITY";
//     } else if (feasStatus.every((status) => status === "Order Signed")) {
//       feasabilityStatus = "Order Signed";
//     } else if (feasStatus.every((status) => status === "Order Placed")) {
//       feasabilityStatus = "Order Placed";
//     } else if (feasStatus.every((status) => status === "Awaiting Signature")) {
//       feasabilityStatus = "Awaiting Signature";
//     } else if (feasStatus.some((status) => status === "Awaiting Signature")) {
//       feasabilityStatus = "Awaiting Signature";
//     } else if (feasStatus.some((status) => status === "Order Signed")) {
//       feasabilityStatus = "Feasible";
//     } else if (feasStatus.some((status) => status === "Order Placed")) {
//       feasabilityStatus = "Feasible";
//     } else if (feasStatus.some((status) => status === "Feasible")) {
//       feasabilityStatus = "Partially Feasible";
//     }

//     res.send({
//       status: "Success",
//       data: newConnectionList,
//       feasabilityStatus,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

exports.get_new_connection_list = async (req, res, next) => {
  try {
    const { reqId, isSelect, parentRole } = req.body;
    console.log({ reqId, isSelect, parentRole })
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const quote = await Quote.findOne({ reqId, isActive: true });
    console.log("quote", quote)
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const { locationDetails, sameContactForAll, pageTracker, status, quoteType, cxmCommonStatus } = quote;

    let isCxm = parentRole === "CXM + Customer";
    console.log("isCxm", isCxm)
    if (!locationDetails || locationDetails.length === 0) throw new Error("No location details available.");

    const data = [];
    const checkFeas = [];
    let existingPlanDetails;

    for await (const value of locationDetails) {
      let { locationId, reqBandwidth, contractPeriod, contractUnit, towerPriceVerified, reqBandwidthUOM, opex, capex, connectionType, mastHeight, cxmConformation, provisionType, contactDetails, shippingAddress, feasibilityId, feasibilityStatus, actualFeasibilityStatus, cxmFeasibilityStatus } = value;
      if (quoteType === "New") {
        contractPeriod = locationDetails[0]?.contractPeriod == null ? 1 : locationDetails[0]?.contractPeriod;
      } else {
        contractPeriod = locationDetails[0]?.existingPlanDetails?.contractPeriod == null ? 1 : locationDetails[0]?.existingPlanDetails?.contractPeriod;
      }
      if (isCxm) {
        if ((isCxm && towerPriceVerified) || !cxmConformation) {
          console.log(cxmConformation);
          continue;
        }
      }

      existingPlanDetails = value.existingPlanDetails;
      checkFeas.push(value.feasibilityStatus, value.feasibilityId);

      const baseObject = {
        locationId,
        location: shippingAddress.city,
        connectionType,
        reqBandwidth: `${reqBandwidth} ${reqBandwidthUOM}`,
        ...(existingPlanDetails
          ? {
            currentBandwidth: `${existingPlanDetails.reqBandwidth} ${existingPlanDetails.reqBandwidthUOM}`,
            linkId: existingPlanDetails.linkId,
            currentLocation: existingPlanDetails.shippingAddress.city,
            provisionType: provisionType,
            hasShipToGst: value.hasShipToGst,
            // shipToGst: value.shipToGst,
            // basePrices: value.basePrices,
            // additionalPrice: value.additionalPrice || [],
          }
          : {}),
        contactPerson: contactDetails.contactFirstName + " " + contactDetails.contactLastName,
        contactEmail: contactDetails.contactEmail,
        phone: contactDetails.contactPhoneNumber1,
        contractPeriod,
        contractUnit,
        feasibilityStatus: feasibilityStatus || status,
        feasibilityId: feasibilityId,
        cxmFeasibilityStatus: cxmFeasibilityStatus,
        mastHeight,
        isSelect: value.isSelect || false,
        opex,
        capex,
        fusionTotalCharges: opex + capex,
        cxmConformation,
        towerPriceVerified,
        pageTracker: pageTracker,
        shipToGst: shippingAddress.shipToGst || null,
        basePrices: value.basePlan || [],
        additionalPrice: value.additionalPrice || [],
        valueAddedService: value.valueAddedService || [],
        billingAddress: value.billingAddress || {},
      };

      if (value.isSelect !== undefined) {
        if (isSelect && value.isSelect !== isSelect) {
          continue;
        }
      }

      data.push(baseObject);
      console.log("baseObject", baseObject)
    }
    console.log("cxmCommonStatus", cxmCommonStatus)

    const response = {
      status: "Success",
      data,
      feasibilityStatus: isCxm ? cxmCommonStatus : status,
    };
    console.log("response", response)

    res.send(response);
  } catch (error) {
    next(error);
  }
};
exports.delete_new_connection = async (req, res, next) => {
  try {
    const { reqId, locationId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const filter = { reqId };
    let update = { isActive: false };

    if (locationId != 0) {
      filter.locationDetails = { $elemMatch: { locationId: locationId } };
      update = { $pull: { locationDetails: { locationId: locationId } } };
    }

    const deleteLocation = await Quote.findOneAndUpdate(filter, update);
    if (!deleteLocation || deleteLocation.matchedCount === 0) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    res.send({
      status: "Success",
    });
  } catch (error) {
    next(error);
  }
};
exports.post_feasibility = async (req, res, next) => {
  try {
    const { reqId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const quote = await Quote.findOne({ reqId, isActive: true }).lean();
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found.`);
    const { companyName } = quote;
    const accounManager = await loginDB.collection("companies").find({ companyName: companyName }).toArray();
    console.log("accounManager", accounManager);
    let accountManagerEmail = accounManager[0]?.accountManager_email || "";
    console.log("accountManagerEmail", accountManagerEmail);

    const isProduction = process.env.ENVIRONMENT === "PRODUCTION";
    const isCPUser = req?.parentRole?.includes("CP");
    const company = accounManager?.[0];

    let toArray = [quote?.customermail, accountManagerEmail].filter(Boolean);
    console.log("CxmMails initial", company?.cxmEmail);
    if (isProduction && !isCPUser) {
      const cxmMails = Array.isArray(company?.cxmEmail)
        ? company.cxmEmail
        : [company?.cxmEmail].filter(Boolean);

      if (cxmMails.length) {
        toArray.push(
          ...cxmMails
            .map(({ email }) => email?.trim())
            .filter(Boolean)
        );
      }
    }

    toArray = [...new Set(toArray.map((email) => email.trim()))];

    console.log("Final toArray for sending email:", toArray);
    const create_feasibility = await common.create_feasibility(reqId, next);

    if (create_feasibility) {
      send_feasibility_mail(reqId, toArray);

      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({
        status: "Success",
        data: `We have received your Request ID - ${reqId} and will keep you updated using the contact information you submitted. A feasibility evaluation might take up to 7 working days to complete.`,
      });
    }
  } catch (error) {
    next(error);
  }
};
//no need
exports.post_modify_feasibility = async (req, res, next) => {
  try {
    const { reqId } = req.body;

    const connectionID = null;
    const create_feasibility = await common.create_feasibility(reqId, connectionID, next, "modify");
    if (create_feasibility) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({
        status: "Success",
        data: `We have received your Request ID - ${reqId} and will keep you updated using the contact information you submitted. A feasibility evaluation might take up to 7 working days to complete.`,
        // data: `We have received your update request<br> Weâ€™ll keep you posted on the contact info provided.<br> It might take ${quote.connectionType === "Fiber" ? "7" : "3-6"} working days to complete the feasibility check`,
      });
    }
  } catch (error) {
    next(error);
  }
};
exports.check_linkid_exist = async (req, res, next) => {
  try {
    const { linkId } = req.body;
    const isExist = await checkLinkIdExist(linkId);

    if (isExist.status) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({ status: "Success" });
    } else {
      throw isExist.message;
    }
  } catch (error) {
    next(error);
  }
};
exports.get_excel_template = async (req, res, next) => {
  try {
    const { quoteType, sameContactInfo, hasRateCard, rateCode } = req.body;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");

    const distinctBandwidth = await db.collection("ratecardprices").distinct("bandwidth", {
      plan: "bw",
      Price_Sheet: rateCode,
      // Price_Sheet: "HDFC BANK_ILL_Apr2023-Mar2024",
    });
    const distinctBandwidthWithUnit = distinctBandwidth.map((bandwidth) => `${bandwidth} Mbps`);

    const headerRows = ["Link Id", "Connection Type", "Proposed Bandwidth"];
    if (!false) {
      headerRows.push("Contact Person FirstName", "Contact Person LastName", "Email", "Mobile");
    }
    worksheet.addRow(headerRows);

    const dataValidation = {
      type: "list",
      formulae: [`"${distinctBandwidthWithUnit.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid Input",
      error: "Please select a value from the list.",
    };

    let length = 3000;
    for (let i = 2; i <= length; i++) {
      worksheet.getCell(`C${i}`).dataValidation = dataValidation;
    }

    const connectionTypes = await db
      .collection("ratecardprices")
      .find({
        plan: /bw/,
        Price_Sheet: rateCode,
        // Price_Sheet: "HDFC BANK_ILL_Apr2023-Mar2024",
      })
      .toArray();

    const uniqueConnectionTypes = new Set();

    connectionTypes.forEach((doc) => {
      if (doc.plan === "bw_fiber") {
        uniqueConnectionTypes.add("Fiber");
      } else if (doc.plan === "bw_rf") {
        uniqueConnectionTypes.add("Wireless");
      }
    });

    const connectionTypesArray = Array.from(uniqueConnectionTypes);

    const dataValidationConnectionType = {
      type: "list",
      formulae: [`"${connectionTypesArray.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid Input",
      error: "Please select a value from the list.",
    };

    for (let i = 2; i <= length; i++) {
      worksheet.getCell(`B${i}`).dataValidation = dataValidationConnectionType;
    }
    const buffer = await workbook.xlsx.writeBuffer();

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=DIA Template.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
exports.post_excel_template = async (req, res, next) => {
  try {
    const buffer = req.file.buffer;
    const { quoteType } = req.body;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    const headers = worksheet.getRow(1).values;

    const data = [];

    const keyMappings = {
      "Link Id": "linkId",
      "Connection Type": "connectionType",
      "Proposed Bandwidth": "proposedBandwidth",
      // "Proposed Bandwidth": "reqBandwidth",
      // "Proposed Bandwidth UOM": "reqBandwidthUOM",
      "Contact Person FirstName": "contactFirstName",
      "Contact Person LastName": "contactLastName",
      Email: "contactEmail",
      Mobile: "contactPhoneNumber1",
    };
    let count = {
      totalCount: 0,
      validCount: 0,
      invalidCount: 0,
    };
    const linkIdArray = [];
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i).values;
      const rowData = { errorMessage: [] };
      let isValid = true;
      let linkId;

      if (row.every((value) => value === null || value === undefined)) {
        continue;
      }
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j];
        const value = row[j];

        if (keyMappings[key]) {
          const property = keyMappings[key];

          rowData[property] = value === null || value === undefined ? null : value;

          const statusKey = `${property}Status`;
          const messageKey = `${property}Message`;

          if (value === null || value === undefined) {
            setInvalidData(rowData, property, statusKey, messageKey, `Value is Missing`);
            isValid = false;
          } else {
            switch (key) {
              case "Link Id":
                linkId = value;
                if (linkIdArray.includes(linkId)) {
                  isValid = false;
                  setInvalidData(rowData, property, statusKey, messageKey, "Repeated Link Id");
                  break;
                }
                linkIdArray.push(linkId);
                let linkIdExist = await checkLinkIdExist(value);
                // let linkIdExist = {
                //   status: true,
                //   message: "",
                // };
                if (linkIdExist.status) {
                  setValidData(rowData, property, statusKey, messageKey);
                } else {
                  isValid = false;
                  setInvalidData(rowData, property, statusKey, messageKey, linkIdExist.message);
                }
                break;
              case "Proposed Bandwidth":
                const [, bandwidth, unit] = value.match(/^(\d+)\s*(\w+)$/);
                const ExistingBandwidth = await checkExistingBandwidth(linkId, bandwidth);
                // const ExistingBandwidth = {
                //   status: true,
                //   message: "",
                // };
                if (ExistingBandwidth.status) {
                  setValidData(rowData, property, statusKey, messageKey);
                  rowData["reqBandwidth"] = bandwidth;
                  rowData["reqBandwidthUOM"] = unit;
                  // rowData["reqBandwidthStatus"] = "Valid";
                  // rowData["reqBandwidthMessage"] = "";
                  // rowData["reqBandwidthUOMStatus"] = "Valid";
                  // rowData["reqBandwidthUOMMessage"] = "";
                } else {
                  console.log("invalid bandwidth");
                  isValid = false;
                  setInvalidData(rowData, property, statusKey, messageKey, ExistingBandwidth.message);
                }
                break;
              case "Mobile":
                if (isNaN(value) || !/^\d{10}$/.test(value)) {
                  isValid = false;
                  setInvalidData(rowData, property, statusKey, messageKey, "Invalid Mobile");
                } else {
                  setValidData(rowData, property, statusKey, messageKey);
                }
                break;
              case "Contact Person FirstName":
                if (!/^[a-zA-Z ]{3,}$/.test(value)) {
                  isValid = false;
                  setInvalidData(rowData, property, statusKey, messageKey, "Invalid FirstName");
                } else {
                  setValidData(rowData, property, statusKey, messageKey);
                }
                break;
              case "Contact Person LastName":
                if (!/^[a-zA-Z ]{1,}$/.test(value)) {
                  isValid = false;
                  setInvalidData(rowData, property, statusKey, messageKey, "Invalid LastName");
                } else {
                  setValidData(rowData, property, statusKey, messageKey);
                }
                break;
              case "Email":
                if (!/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(value.text || value)) {
                  isValid = false;
                  setInvalidData(rowData, property, statusKey, messageKey, "Invalid Email");
                } else {
                  setValidData(rowData, property, statusKey, messageKey);
                }
                break;
              default:
                setValidData(rowData, property, statusKey, messageKey);
            }

            // if (key === "Link Id") {
            //   linkId = value;
            //   const req = {
            //     body: {
            //       linkId: value,
            //     },
            //   };
            //   const linkIdExistData = await this.check_linkid_exist(req, res, next, false);
            //   console.log(value, linkIdExistData);
            //   if (linkIdExistData.status === "Error") {
            //     rowData[statusKey] = "Invalid";
            //     rowData[messageKey] = linkIdExistData.error;
            //     rowData["isActive"] = false;
            //     isValid = false;
            //   } else {
            //     rowData[property] = String(value);
            //     rowData[statusKey] = "Valid";
            //     rowData[messageKey] = "";
            //     rowData["isActive"] = true;
            //   }
            // } else if (key === "Proposed Bandwidth") {
            //   const currentBandwidth = await get_existing_bw(linkId);
            //   console.log(currentBandwidth);
            //   if (currentBandwidth.status === "Success" && currentBandwidth.data[0]?.reqBandwidth === String(value)) {
            //     rowData[statusKey] = "Invalid";
            //     rowData[messageKey] = `Selct BandWidth grater or lesser than ${currentBandwidth.data[0].reqBandwidth}`;
            //     rowData["isActive"] = false;
            //     isValid = false;
            //   } else {
            //     rowData[property] = value;
            //     rowData[statusKey] = "Valid";
            //     rowData[messageKey] = "";
            //     rowData["isActive"] = true;
            //   }
            // } else {
            //   rowData[statusKey] = "Valid";
            //   rowData[messageKey] = "";
            //   rowData["isActive"] = true;
            // }
          }
          // if (key === "Phone" && (isNaN(value) || value.toString().length !== 10)) {
          //   rowData[statusKey] = "Invalid";
          //   rowData[messageKey] = "Invalid Mobile No";
          //   rowData["isActive"] = false;
          //   isValid = false;
          // }

          if (key === "Email" && typeof value === "object" && value.text) {
            rowData[property] = value.text;
          }
        }
      }

      if (isValid) {
        rowData.isActive = true;
        count.validCount++;
      } else {
        rowData.isActive = false;
        count.invalidCount++;
      }
      count.totalCount++;

      data.push(rowData);
    }

    const { reqId } = await reqID.findOneAndUpdate({ id: "req_id" }, { $inc: { reqId: 1 } });
    console.log("reqId", reqId);
    console.log(count);
    await Exceltemp.insertMany({ reqId, count, data, quoteType, product: "ILL" });

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.json({
      status: "Success",
      reqId,
      data,
    });
  } catch (error) {
    next(error);
  }
};
exports.get_excel_data = async (req, res, next) => {
  try {
    const { reqId, page, limit, filters } = req.body;
    let skip = (page - 1) * limit;

    const collection = db.collection("exceltemps");

    const tempData = await collection
      .aggregate([
        {
          $match: {
            reqId,
            // "data.isActive": filters.isActive,
          },
        },
        {
          $project: {
            _id: 0,
            reqId: 1,
            count: 1,
            paginatedData: {
              $cond: {
                if: filters.isActive,
                then: "$data",
                else: {
                  $slice: [
                    {
                      $filter: {
                        input: "$data",
                        as: "item",
                        cond: { $eq: ["$$item.isActive", false] },
                      },
                    },
                    skip,
                    limit,
                  ],
                },
              },
            },
          },
        },
      ])
      .toArray();
    console.log(tempData);
    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.json({
      status: "Success",
      data: tempData[0] || [],
    });
  } catch (error) {
    next(error);
  }
};
exports.get_all_data_as_excel = async (req, res, next) => {
  try {
    const { reqId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const tempData = await Exceltemp.findOne({ reqId });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    worksheet.columns = [
      { header: "Link Id", key: "linkId", width: 15 },
      { header: "Connection Type", key: "connectionType", width: 15 },
      { header: "Proposed Bandwidth", key: "proposedBandwidth", width: 15 },
      // { header: "Proposed Bandwidth UOM", key: "reqBandwidthUOM", width: 20 },
      { header: "Contact Person FirstName", key: "contactFirstName", width: 17 },
      { header: "Contact Person LastName", key: "contactLastName", width: 19 },
      { header: "Email", key: "contactEmail", width: 17 },
      { header: "Phone", key: "contactPhoneNumber1", width: 17 },
      { header: "Status", key: "isActive", width: 17 },
      { header: "Remarks", key: "remarks", width: 17 },
    ];
    const rowsWithCustomValues = tempData.data.map((row) => {
      // const remarksSet = new Set();

      // if (row.linkIdMessage) remarksSet.add(row.linkIdMessage);
      // if (row.connectionTypeMessage) remarksSet.add(row.connectionTypeMessage);
      // if (row.proposedBandwidthMessage) remarksSet.add(row.proposedBandwidthMessage);
      // if (row.reqBandwidthMessage) remarksSet.add(row.reqBandwidthMessage);
      // if (row.reqBandwidthUOMMessage) remarksSet.add(row.reqBandwidthUOMMessage);
      // if (row.contactFirstNameMessage) remarksSet.add(row.contactFirstNameMessage);
      // if (row.contactLastNameMessage) remarksSet.add(row.contactLastNameMessage);
      // if (row.contactEmailMessage) remarksSet.add(row.contactEmailMessage);
      // if (row.contactPhoneNumber1Message) remarksSet.add(row.contactPhoneNumber1Message);

      // const remarksArray = Array.from(remarksSet);
      // const remarks = remarksArray.join(", ");

      return {
        ...row,
        isActive: row.isActive ? "Valid" : "Invalid",
        remarks: row.errorMessage.length === 0 ? "" : row.errorMessage,
      };
    });

    worksheet.addRows(rowsWithCustomValues);
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=DIA Order List.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
exports.post_excel_data = async (req, res, next) => {
  try {
    let { reqId, parentRole, hasRateCard, rateCode, ebsAccountNo, partyNo, partyId, companyId, companyName } = req.body;
    let { createdBy, customerNumber, customermail } = req;
    let customerName = `${req.firstName} ${req.lastName}`;

    let extraData = { partyNo, partyId, parentRole, customerName, customermail, customerNumber, ebsAccountNo: ebsAccountNo || req.ebsAccountNo, createdBy, companyName: companyName || req.companyName, companyId: companyId || req.companyId, ...(hasRateCard && { hasRateCard, rateCode }) };
    const deleteQuote = await Quote.deleteMany({ reqId });

    const collection = db.collection("exceltemps");

    // const tempData = await collection
    //   .aggregate([
    //     {
    //       $match: {
    //         reqId,
    //         "data.isActive": true,
    //       },
    //     },
    //     {
    //       $project: {
    //         reqId: 1,
    //         paginatedData: {
    //           $filter: {
    //             input: "$data",
    //             as: "item",
    //             cond: { $eq: ["$$item.isActive", true] },
    //           },
    //         },
    //       },
    //     },
    //     {
    //       $unwind: "$paginatedData",
    //     },
    //     {
    //       $replaceRoot: { newRoot: "$paginatedData" },
    //     },
    //     {
    //       $project: {
    //         reqId: 1,
    //         linkId: { $ifNull: ["$linkId", ""] },
    //         connectionType: { $ifNull: ["$connectionType", ""] },
    //         reqBandwidth: { $ifNull: ["$reqBandwidth", ""] },
    //         reqBandwidthUOM: { $ifNull: ["$reqBandwidthUOM", ""] },
    //         contactFirstName: { $ifNull: ["$contactFirstName", ""] },
    //         contactLastName: { $ifNull: ["$contactLastName", ""] },
    //         contactEmail: { $ifNull: ["$contactEmail", ""] },
    //         contactPhoneNumber1: { $ifNull: ["$contactPhoneNumber1", ""] },
    //       },
    //     },
    //   ])
    //   .toArray();
    const tempData = await collection
      .aggregate([
        {
          $match: {
            reqId,
          },
        },
        {
          $unwind: "$data",
        },
        {
          $match: {
            "data.isActive": true,
          },
        },
        {
          $project: {
            _id: 0,
            reqId: 1,
            quoteType: 1,
            excelData: {
              linkId: "$data.linkId",
              connectionType: "$data.connectionType",
              reqBandwidth: "$data.reqBandwidth",
              reqBandwidthUOM: "$data.reqBandwidthUOM",
              contactFirstName: "$data.contactFirstName",
              contactLastName: "$data.contactLastName",
              contactEmail: "$data.contactEmail",
              contactPhoneNumber1: "$data.contactPhoneNumber1",
            },
          },
        },
        {
          $group: {
            _id: null,
            reqId: { $first: "$reqId" },
            quoteType: { $first: "$quoteType" },
            excelData: { $push: "$excelData" },
          },
        },
        {
          $project: {
            _id: 0,
            reqId: 1,
            quoteType: 1,
            excelData: 1,
          },
        },
      ])
      .toArray();

    if (tempData.length === 0) {
      throw new Error("Please choose the desire option to view proposal");
    }

    const { quoteType, excelData } = tempData[0];
    const linkIdList = excelData.map((item) => item.linkId);
    // const linkIdList = ["2023184916", "2023204475", "2023184231"];
    console.log(linkIdList);

    const data = await getPurchaseSummaryByLinkIdList(linkIdList, next);
    console.log(data);
    // const { data } = {
    //   status: "Success",
    //   data: {
    //     bandwidth: [
    //       {
    //         OPGFormContext: "Express Connect Internet",
    //         classofService: "Value",
    //         connectionType: "Wireless",
    //         contractPeriod: null,
    //         coveredProduct: "DIA",
    //         customerName: "SHOPPERS STOP LIMITED",
    //         ebsAccountNo: "2416",
    //         endDate: "2024-06-29T18:30:00.000Z",
    //         linkId: "2023186747",
    //         reqBandwidth: "4",
    //         reqBandwidthUOM: "MBPS",
    //         serviceItem: "EXPRESSCONNECT-RC",
    //         shipSiteCode: "BANGALORE-13288",
    //         shipsiteId: 6220683,
    //         startDate: "2023-06-30T18:30:00.000Z",
    //         totalArc: 28240,
    //         status: "ACTIVE",
    //       },
    //       {
    //         OPGFormContext: "Express Connect Internet",
    //         classofService: "Value",
    //         connectionType: "Wireless",
    //         contractPeriod: null,
    //         coveredProduct: "DIA",
    //         customerName: "SHOPPERS STOP LIMITED",
    //         ebsAccountNo: "2416",
    //         endDate: "2024-06-29T18:30:00.000Z",
    //         linkId: "2023204475",
    //         reqBandwidth: "2",
    //         reqBandwidthUOM: "MBPS",
    //         serviceItem: "EXPRESSCONNECT-RC",
    //         shipSiteCode: "DELHI-11941",
    //         shipsiteId: 6316851,
    //         startDate: "2023-06-30T18:30:00.000Z",
    //         totalArc: 14120,
    //         status: "ACTIVE",
    //       },
    //     ],
    //     shipping: [
    //       {
    //         shipTo: "6220683",
    //         shipToLocation: "BANGALORE-13288",
    //         address1: "U274 SHOPPERS STOP",
    //         address2: "Ground Floor",
    //         address3: "Royal Meenakshi Mall Banneraghatta Road Bangalore 560076",
    //         address4: "00",
    //         city: "Bangalore",
    //         state: "Karnataka",
    //         pincode: "560076",
    //       },
    //       {
    //         shipTo: "6316851",
    //         linkId: "2023204475",
    //         shipToLocation: "DELHI-11941",
    //         address1: "U165 SHOPPERS STOP  Plot No.3B1 situated at Rohini Twin",
    //         address2: "District Centre Sector 10 Delhi 110085",
    //         address3: "U165",
    //         address4: "04",
    //         city: "DELHI",
    //         state: "Delhi",
    //         pincode: "110085",
    //       },
    //     ],
    //     billing: [
    //       {
    //         billTo: "6221304",
    //         billToLocation: "BANGALORE-13288",
    //         address1: "U274 SHOPPERS STOP",
    //         address2: "Ground Floor",
    //         address3: "Royal Meenakshi Mall Banneraghatta Road Bangalore 560076",
    //         address4: "00",
    //         city: "Bangalore",
    //         state: "Karnataka",
    //         pincode: "560076",
    //       },
    //       {
    //         billTo: "6316850",
    //         linkId: "2023204475",
    //         billToLocation: "DELHI-11941",
    //         address1: "U165 SHOPPERS STOP  Plot No.3B1 situated at Rohini Twin",
    //         address2: "District Centre Sector 10 Delhi 110085",
    //         address3: "U165",
    //         address4: "04",
    //         city: "DELHI",
    //         state: "Delhi",
    //         pincode: "110085",
    //       },
    //     ],
    //   },
    // };
    const postData = [];
    let locationId = 0;
    excelData.forEach(async (item) => {
      locationId += 1;
      let tempObject = {};
      let existingPlanDetails = {};
      let provisionType;
      data.bandwidth.forEach((bandwidth) => {
        console.log(item.linkId === bandwidth.linkId);
        if (String(item.linkId) === bandwidth.linkId) {
          existingPlanDetails = { ...existingPlanDetails, ...bandwidth };
          switch (quoteType) {
            case "modifyBandwidth":
              provisionType = parseInt(existingPlanDetails.reqBandwidth) > item.reqBandwidth ? "Downgrade" : "Upgrade";
              break;
            case "modifyAddress":
              provisionType = "Shift";
              break;
            case "modifyBandwidthAddress":
              provisionType = parseInt(existingPlanDetails.reqBandwidth) > item.reqBandwidth ? "Shift-Downgrade" : "Shift-Upgrade";
              break;
            default:
              provisionType = "New-Link";
              break;
          }
          console.log("in", existingPlanDetails);
        }
      });
      data.shipping.forEach((shipping) => {
        if (String(item.linkId) === shipping.linkId) {
          existingPlanDetails = { ...existingPlanDetails, shippingAddress: shipping };
        }
      });
      data.billing.forEach((billing) => {
        if (String(item.linkId) === billing.linkId) {
          existingPlanDetails = { ...existingPlanDetails, billingAddress: billing };
        }
      });
      console.log(existingPlanDetails);
      tempObject = {
        locationId,
        provisionType,
        existingPlanDetails,
        shippingAddress: { ...existingPlanDetails.shippingAddress, shipTo: existingPlanDetails.shipTo, shipToLocation: existingPlanDetails.shipToLocation, shipSiteCode: existingPlanDetails.shipSiteCode },
        reqBandwidth: parseInt(item.reqBandwidth),
        reqBandwidthUOM: item.reqBandwidthUOM,
        connectionType: item.connectionType,
        contactDetails: {
          contactFirstName: item.contactFirstName,
          contactLastName: item.contactLastName,
          contactPhoneNumber1: item.contactPhoneNumber1,
          contactPhoneNumber2: customerNumber,
          contactEmail: item.contactEmail,
        },
        billToAddress: {
          ...existingPlanDetails.billingAddress,
          billToAddressType: "existing",
          billTo: existingPlanDetails.billTo,
          billToLocation: existingPlanDetails.billToLocation,
        },
        // ebsAccountNo,
        // partyNo,
        // createdBy,
        // companyName,
        // customerName,
        // customerNumber,
        // customermail,
        // companyId,
        // hasRateCard,
        // rateCode,
        //  address1: "U8521 SHOPPERS STOP",
        //  address2: "Next to Fairfield by Marriott",
        //  address3: "Rajarhat Action Area I Newtown Kolkata West Bengal 700156",
        //  city: "KOLKATA",
        //  state: "WEST BENGAL",
        //  pincode: "700156"
      };
      postData.push(tempObject);
    });
    console.log(postData);
    const results = await new Quote({
      reqId,
      locationDetails: postData,
      ...extraData,
      isBulkUpload: true,
      quoteType,
    }).save();

    const create_feasibility = await common.multiple_create_feasibility(reqId, next);
    if (create_feasibility) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({
        status: "Success",
        data: `We have received your Request ID - ${reqId} and will keep you updated using the contact information you submitted. A feasibility evaluation might take up to 7 working days to complete.`,
        // data: `We have received your update request<br> Weâ€™ll keep you posted on the contact info provided.<br> It might take ${quote.connectionType === "Fiber" ? "7" : "3-6"} working days to complete the feasibility check`,
      });
    }
  } catch (error) {
    next(error);
  }
};
exports.post_feasibile_to_new_reqId = async (req, res, next) => {
  try {
    let { reqId: oldReqId } = req.body;

    const collection = db.collection("quoteills");
    const oldQuote = await collection.findOne({ reqId: oldReqId }, { projection: { _id: 0 } });

    const feasibleLocationDetails = oldQuote.locationDetails.filter((item) => item.status === "Feasible" && !item.isSelect);

    if (feasibleLocationDetails.length === 0) throw "No Links";

    const { reqId } = await reqID.findOneAndUpdate({ id: "req_id" }, { $inc: { reqId: 1 } });

    const updatedQuote = {
      ...oldQuote,
      reqId: newReqId,
      locationDetails: feasibleLocationDetails,
      status: "Feasible",
    };

    const quote = new Quote(updatedQuote);
    const result = await quote.save();

    if (!result) throw "Failed to insert";

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", reqId });
  } catch (error) {
    next(error);
  }
};
exports.is_fiber_city = async (req, res, next) => {
  let oracleDb;
  try {
    oracleDb = await common.getOracleDb();
    let { city } = req.body;
    if (!city) throw new Error("Missing required parameters: city.");

    const query = `select fcfc_name as city, fcfc_label from ccoss.fus_conn_fiber_fea_cities where FCFC_ACTIVE_STATUS='Y' and lower(fcfc_name) like lower('%${city}%')`;

    const result = await oracleDb.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log("hasData", result.rows.length > 0);

    if (result.rows.length === 0) {
      throw new Error(`Not as sify fiber feasability city - ${city}`);
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (error) {
    next(error);
  }
};
