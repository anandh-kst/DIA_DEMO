const axios = require("axios");
const logger = require("../config/winston");
const https = require("https");
const crypto = require("crypto");
const moment = require("moment");
const fs = require("fs");
const oracledb = require("oracledb");
const mongoose = require("mongoose");
const { updateOpportunity } = require("../common");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const handlebars = require("handlebars");
const common = require("../common");

const send_po_mail = async (reqId, quote) => {
  try {
    const toArray = [quote.customermail];

    const subject = `One Sify - Request ID: ${reqId} - Proposal Document for DIA Services`;

    const templateSource = fs.readFileSync(`${appRoot}/template/Proposal_To_Mail.hbs`, "utf-8");

    const mailTemplate = handlebars.compile(templateSource);

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

    function capitalizeFirstLetter(str) {
      return str.replace(/\b\w/g, (char) => char.toUpperCase());
    }

    const isNew = quote.quoteType === "New";

    const templateData = {
      reqId,
      fileName: `ILL-PD-${reqId}`,
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
      filename: `ILL-PD-${reqId}.pdf`,
      content: fs.createReadStream(`${appRoot}/public/pd/ILL-PD-${reqId}.pdf`),
    };
    const html = mailTemplate(templateData);
    common.sendMailUntilSuccess(reqId, toArray, [], subject, html, attachment);
  } catch (error) {
    logger.error({ statusCode: error.statusCode || 200, status: "Error", message: error });
    console.log(error);
  }
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

exports.get_address_info = async (req, res, next) => {
  try {
    const { reqId, locationId } = req.body;

    if (!reqId || !locationId) {
      throw new Error("Missing required parameters: reqId or locationId.");
    }

    // Fetch only required fields for better performance
    const quote = await Quote.findOne(
      { reqId },
      {
        ebsAccountNo: 1,
        companyName: 1,
        locationDetails: 1,
      }
    ).lean();

    if (!quote) {
      throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);
    }

    const { ebsAccountNo, companyName } = quote;

    // Find matching location
    const matchingLocation = quote.locationDetails?.find(
      (value) => value.locationId === locationId
    );

    const shipTo = matchingLocation?.shippingAddress;

    if (!shipTo?.state) {
      throw new Error("locationId is missing in reqId");
    }

    // Fetch only required field from companies collection
    const company = await loginDB.collection("companies").findOne(
      { companyName },
      {
        projection: {
          ebsaccountNo: 1,
        },
      }
    );

    const hasebsAccountNo = !!company?.ebsaccountNo;

    let stateList = [];

    if (hasebsAccountNo) {
      const headers = {
        username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
        password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
        // apikey: process.env.ERP_API_KEY,
      };

      const apiUrl =
        `${process.env.GET_STATE}` +
        `n_customer_no=${ebsAccountNo}` +
        `&v_site_use_code=BILL_TO` +
        `&n_org_id=425`;

      try {
        const response = await axios.get(apiUrl, {
          headers,
          httpsAgent,
          timeout: 10000,
        });

        if (response?.data?.STATUS !== "S") {
          await common.errorLog(
            {
              stack: response?.data,
              message: `Error in ERP Address API: ${apiUrl} payload: ${JSON.stringify(headers)}`,
              filter: "ERPAddress",
            },
            reqId
          );

          logger.error({
            statusCode: 200,
            status: "Error",
            message: `Error in ERP Address API: ${apiUrl}`,
            response: response?.data,
          });

          console.error("Error calling getShipToStates API:", response?.data);

          stateList = [];
        } else {
          stateList = response.data.n_address.map(
            ({ SERVICES, PRIMARY_FLAG, ...state }) => state
          );

          stateList = [
            ...new Map(
              stateList.map((item) => [item.STATE, item])
            ).values(),
          ];
        }
      } catch (error) {
        logger.error({
          status: "Error",
          message: "ERP API request failed",
          error: error.message,
        });

        stateList = [];
      }
    }

    return res.send({
      status: "Success",
      shipTo,
      stateList,
    });
  } catch (err) {
    console.log(err);

    logger.error({
      status: "Error",
      message: err.message,
      stack: err.stack,
    });

    next(err);
  }
};

exports.get_address_list = async (req, res, next) => {
  try {
    const { reqId, locationId, stateName } = req.body;

    if (!reqId || !stateName) {
      throw new Error("Missing required parameters: reqId or stateName.");
    }

    const headers = {
      username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
      password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
      // apikey: process.env.ERP_API_KEY,
    };

    // Fetch only required fields
    const quote = await Quote.findOne(
      { reqId },
      {
        ebsAccountNo: 1,
        locationDetails: 1,
      }
    ).lean();

    if (!quote) {
      throw new Error(`Quote with reqId: ${reqId} not found.`);
    }

    const { ebsAccountNo, locationDetails } = quote;

    // Keep same business logic flow
    const locationDetail = locationDetails?.find(
      (item) => item.locationId === locationId
    );

    const valueAddedService = locationDetail?.valueAddedService || [];

    // Preserved existing logic
    const hasManaged = valueAddedService.some(
      (data) =>
        data.serviceType === "bundled" ||
        data.serviceType === "managed"
    );

    const apiUrl =
      `${process.env.GET_ADDRESS}` +
      `n_customer_no=${ebsAccountNo}` +
      `&v_site_use_code=BILL_TO` +
      `&n_org_id=82` +
      `&v_state=${stateName}`;

    // Fixed axios config
    const billToResponse = await axios.get(apiUrl, {
      headers,
      httpsAgent,
      timeout: 10000,
    });

    if (billToResponse?.data?.STATUS !== "S") {
      await common.errorLog(
        {
          stack: billToResponse?.data,
          message: `Error in ERP Address API: ${apiUrl} payload: ${JSON.stringify(headers)}`,
          filter: "ERPAddress",
        },
        reqId
      );

      logger.error({
        statusCode: 200,
        status: "Error",
        message: `Error in ERP Address API: ${apiUrl}`,
        response: billToResponse?.data,
      });

      console.error(
        "Error calling getAddressList API:",
        billToResponse?.data
      );

      throw new Error("Temporary service outage. Please try again later.");
    }

    // Faster + non-mutating cleanup
    const billTo = billToResponse.data.n_address.map(
      ({ SERVICES, PRIMARY_FLAG, ...rest }) => rest
    );

    logger.info(`${req.path} -- ${req.method} -- Success`);

    return res.send({
      status: "Success",
      billTo,
    });
  } catch (err) {
    logger.error({
      status: "Error",
      message: err.message,
      stack: err.stack,
    });

    next(err);
  }
};

exports.post_new_address = async (req, res, next) => {
  let oracleDb;
  try {
    oracleDb = await common.getOracleDb();
    let { reqId, locationId, sameBillToForAll, shipToGst, hasShipToGst, billingAddress } = req.body;

    if (!reqId) throw new Error("Missing required parameters");
    if (!billingAddress || Object.keys(billingAddress).length === 0) throw new Error("Billing Address is required");

    let shipToERP = null;
    let billToERP = null;
    let matchingShipTo = { stl: [], sds: [] };
    let matchingBillTo = { stl: [], sds: [] };


    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error("Quote context not found");
    let { ebsAccountNo, quoteType, locationDetails } = quote;

    if (!["Draft", "Awaiting Signature", "DRAFT", "Feasible"].includes(quote?.status)) {
      res.send({ status: "Success", message: "Order already Signed/Order" });
      return;
    }


    const locationIndex = locationDetails.findIndex((item) => item.locationId === locationId);
    if (locationIndex === -1) throw new Error("Location details not found");

    let locationItem = locationDetails[locationIndex];
    let { valueAddedService, shippingAddress, postShipToERP = false } = locationItem;

    let hasManaged = valueAddedService?.some((data) => data.serviceType === "bundled" || data.serviceType === "managed");
    shippingAddress.gstNo = shipToGst;

    const opportunitypropect = await loginDB.collection("companies").find({ companyName: quote.companyName }).toArray();
    const hasebsAccountNo = !!(opportunitypropect[0]?.ebsaccountNo || ebsAccountNo);
    const actualAccountNo = opportunitypropect[0]?.ebsaccountNo || ebsAccountNo;

    if (!hasebsAccountNo) {
      await Quote.updateOne(
        { reqId },
        {
          $set: {
            pageTracker: "billAndShip",
            [`locationDetails.${locationIndex}.shippingAddress.shipToGst`]: shipToGst,
            [`locationDetails.${locationIndex}.shippingAddress.hasShipToGst`]: hasShipToGst,
            [`locationDetails.${locationIndex}.billingAddress`]: { ...billingAddress }
          },
        }
      );
      if (!quote?.parentRole?.includes("CXM")) {
        await updateOpportunity(reqId);
      }
      return res.send({ status: "Success" });
    }

    const isShippingPageCall = !billingAddress.address1 && !billingAddress.city;

    const executeAddressInsertionEngine = async (inputAddress, type) => {
      const outputNode = { stl: null, sds: null };

      const normalizedAddr = {
        CUSTOMER_CODE: actualAccountNo,
        ADDRESS1: inputAddress.address1 || inputAddress.ADDRESS1,
        ADDRESS2: inputAddress.address2 || inputAddress.ADDRESS2 || "",
        ADDRESS3: inputAddress.address3 || inputAddress.ADDRESS3 || "",
        CITY: inputAddress.city || inputAddress.CITY,
        STATE: inputAddress.state || inputAddress.STATE,
        POSTAL_CODE: inputAddress.pincode || inputAddress.pinCode || inputAddress.POSTAL_CODE,
        GST_NO: inputAddress.gstNo || inputAddress.GST_NO || "UNREGISTERED",
        SITE_USE_CODE: type,
        SITE_CODE: inputAddress.siteCode || inputAddress.SITE_CODE || ""
      };

      const runProcessForOrg = async (orgId) => {
        let baseBinds = {
          customerCode: normalizedAddr.CUSTOMER_CODE,
          orgId: orgId,
          siteUseCode: normalizedAddr.SITE_USE_CODE,
          address1: normalizedAddr.ADDRESS1,
          address2: normalizedAddr.ADDRESS2,
          city: normalizedAddr.CITY,
          state: normalizedAddr.STATE,
          postalCode: normalizedAddr.POSTAL_CODE,
          gstNo: normalizedAddr.GST_NO
        };

        let sql = `
          SELECT * FROM SIFY_CPQ_CUST_ADDRESS_V@BI2APPS
          WHERE ACCOUNT_NUMBER = :customerCode
            AND ORG_ID = :orgId
            AND SITE_USE_CODE = :siteUseCode
            AND ADDRESS1 = :address1
            AND ADDRESS2 = :address2
            AND CITY = :city
            AND STATE = :state
            AND POSTAL_CODE = :postalCode
            AND GST_NO = :gstNo
        `;

        if (normalizedAddr.ADDRESS3 && normalizedAddr.ADDRESS3.trim() !== "") {
          sql += ` AND ADDRESS3 = :address3`;
          baseBinds.address3 = normalizedAddr.ADDRESS3;
        }

        const result = await oracleDb.execute(sql, baseBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

        if (result.rows && result.rows.length > 0) {
          const matchedRow = result.rows.find(
            row => row.SITE_CODE?.toUpperCase() === normalizedAddr.SITE_CODE?.toUpperCase()
          );
          if (matchedRow) return { STATUS: "S", MESSAGE: "Using existing address", siteCode: matchedRow.SITE_CODE, ...matchedRow };
          return { STATUS: "S", MESSAGE: "Using existing address", siteCode: result.rows[0].SITE_CODE, ...result.rows[0] };
        }

        const postAddressToERP = async (siteCodeValue) => {
          const payload = {
            ACCOUNT_NUMBER: normalizedAddr.CUSTOMER_CODE,
            SITE_CODE: siteCodeValue,
            ADDRESS1: normalizedAddr.ADDRESS1,
            ADDRESS2: normalizedAddr.ADDRESS2,
            ADDRESS3: normalizedAddr.ADDRESS3,
            ADDRESS4: "",
            CITY: normalizedAddr.CITY,
            STATE: normalizedAddr.STATE,
            POSTAL_CODE: normalizedAddr.POSTAL_CODE,
            SITE_USE_CODE: normalizedAddr.SITE_USE_CODE,
            ORG_ID: orgId,
            GST_NO: normalizedAddr.GST_NO,
            COUNTRY_CODE: "IN"
          };

          const apiResponse = await axios({
            method: "post",
            url: process.env.CREATE_ADDRESS,
            headers: {
              apikey: process.env.ERP_API_KEY,
              username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
              password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
              "Content-Type": "application/json"
            },
            httpsAgent,
            data: payload
          });

          await common.errorLog({ response: apiResponse?.data, message: `Post ERP Address API: Org ${orgId}`, filter: "createERPAddress" }, reqId);
          return { resData: apiResponse.data, payloadData: payload };
        };

        if (normalizedAddr.SITE_CODE) {
          try {
            const try1 = await postAddressToERP(normalizedAddr.SITE_CODE);
            if (try1.resData.STATUS !== "E") return { STATUS: "S", MESSAGE: "Address created successfully", siteCode: normalizedAddr.SITE_CODE, ...try1.payloadData, ...try1.resData };
          } catch (err) { console.error(`ERP Try 1 failed on Org ${orgId}:`, err.message); }
        }

        try {
          const newSiteCode = `${normalizedAddr.CITY.toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
          const try2 = await postAddressToERP(newSiteCode);
          if (try2.resData.STATUS !== "E") return { STATUS: "S", MESSAGE: "Address created successfully", siteCode: newSiteCode, ...try2.payloadData, ...try2.resData };
        } catch (err) { console.error(`ERP Try 2 failed on Org ${orgId}:`, err.message); }

        return { STATUS: "E", MESSAGE: `Failed to insert address into OrgId ${orgId}` };
      };

      const tasks = [runProcessForOrg("82").then(res => outputNode.stl = res)];
      if (hasManaged) tasks.push(runProcessForOrg("425").then(res => outputNode.sds = res));

      await Promise.all(tasks);
      return outputNode;
    };


    let shipEngineResult = { stl: null, sds: null };
    let billEngineResult = null;

    if (isShippingPageCall) {
      shipEngineResult = await executeAddressInsertionEngine(shippingAddress, "SHIP_TO");
    } else {
      // FIX HERE: "existing" address types are now evaluated. As long as the billing address is marked complete, process it!
      const runBillingCondition = ["new", "sameas", "existing"].includes(billingAddress.billToAddressType) || billingAddress.isComplete;

      const [shipRes, billRes] = await Promise.all([
        executeAddressInsertionEngine(shippingAddress, "SHIP_TO"),
        runBillingCondition ? executeAddressInsertionEngine(billingAddress, "BILL_TO") : Promise.resolve(null)
      ]);
      shipEngineResult = shipRes;
      billEngineResult = billRes;
    }


    if (shipEngineResult.stl && shipEngineResult.stl.STATUS !== "E") {
      shipToERP = { stl: shipEngineResult.stl };
      postShipToERP = true;
    } else if (shipEngineResult.stl?.STATUS === "E") {
      matchingShipTo.stl = [shipEngineResult.stl];
    }

    if (shipEngineResult.sds && shipEngineResult.sds.STATUS !== "E" && shipToERP) {
      shipToERP.sds = shipEngineResult.sds;
    } else if (shipEngineResult.sds?.STATUS === "E") {
      matchingShipTo.sds = [shipEngineResult.sds];
    }

    if (billEngineResult) {
      billToERP = {};
      if (billEngineResult.stl && billEngineResult.stl.STATUS !== "E") billToERP.stl = billEngineResult.stl;
      if (billEngineResult.sds && billEngineResult.sds.STATUS !== "E") billToERP.sds = billEngineResult.sds;
      if (billEngineResult.stl?.STATUS === "E") matchingBillTo.stl = [billEngineResult.stl];
      if (billEngineResult.sds?.STATUS === "E") matchingBillTo.sds = [billEngineResult.sds];
    }

    if (quoteType !== "New") {
      await Quote.updateMany({ reqId }, { status: "Awaiting Signature" });
    }

    const existingBillingAddress = locationItem.billingAddress || {};
    const buildToPostData = {
      ...existingBillingAddress,
      ...billingAddress,
      billToERP: billToERP || existingBillingAddress.billToERP || null
    };

    if (billEngineResult && billEngineResult.stl && billEngineResult.stl.STATUS !== "E") {
      const bStl = billEngineResult.stl;
      buildToPostData.address1 = bStl.ADDRESS1 || buildToPostData.address1;
      buildToPostData.address2 = bStl.ADDRESS2 || buildToPostData.address2;
      buildToPostData.address3 = bStl.ADDRESS3 || buildToPostData.address3;
      buildToPostData.city = bStl.CITY || buildToPostData.city;
      buildToPostData.state = bStl.STATE || buildToPostData.state;
      buildToPostData.pinCode = bStl.POSTAL_CODE || buildToPostData.pinCode;
    }

    const updatePayload = {
      pageTracker: "billAndShip",
      [`locationDetails.${locationIndex}.shippingAddress.shipToGst`]: shipToGst,
      [`locationDetails.${locationIndex}.shippingAddress.hasShipToGst`]: hasShipToGst,
      [`locationDetails.${locationIndex}.billingAddress`]: buildToPostData
    };

    if (shipToERP) {
      updatePayload[`locationDetails.${locationIndex}.shippingAddress.shipToERP`] = shipToERP;
      updatePayload[`locationDetails.${locationIndex}.shippingAddress.postShipToERP`] = postShipToERP;
    }

    const result = await Quote.updateOne({ reqId }, { $set: updatePayload });
    if (!quote?.parentRole?.includes("CXM")) {
      await updateOpportunity(reqId);
    }

    if (!result || result.matchedCount === 0) {
      throw new Error("Temporary service outage. Please try again later.");
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    return res.send({ status: "Success", ...((matchingShipTo.stl.length || matchingBillTo.stl.length) ? { matchingBillTo, matchingShipTo } : {}) });

  } catch (err) {
    console.error("Unhandled Process Rejection: ", err.message);
    return next(err);
  }
};

exports.post_po_no = async (req, res, next) => {
  let { reqId, isPoNo, poRefNo, poDate } = req.body;
  try {
    if (!reqId) throw new Error("Missing required parameters: reqId.");
    let poDateISO;
    const quote = await Quote.findOne({ reqId }, { companyId: 1, parentRole: 1 });
    if (!quote?.parentRole?.includes("CXM")) {
      const { success, message } = await verifyOpportunity(reqId);
      if (!success) {
        return res.status(200).send({ status: "Error", message: message });
      }
    }
    if (!["Draft", "Awaiting Signature", "DRAFT", "Feasible"].includes(quote?.status)) {
      res.send({ status: "Success", message: "Order already Signed/Order" });
      return;
    }
    if (!isPoNo) {
      const path = `${appRoot}/public/uploaded_po/${reqId}.pdf`;

      fs.unlink(path, (err) => {
        if (err) {
          console.error("Error deleting file:", err);
        } else {
          console.log("File deleted successfully");
        }
      });
      poRefNo = `ILL-${reqId}`;
      poDate = moment().format("DD-MMM-YY");
      poDateISO = new Date().toISOString();
    } else {
      poDateISO = poDate;
      poDate = moment(poDate).format("DD-MMM-YY");
    }
    const result = await Quote.updateMany(
      { reqId },
      {
        pageTracker: "poNo",
        isPoNo,
        poRefNo,
        poDate,
        poDateISO,
        status: "Awaiting Signature",
      }
    );
    if (!result) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);
    if (!quote?.parentRole?.includes("CXM")) {
      await updateOpportunity(reqId);
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (err) {
    next(err);
  }
};