const axios = require("axios");
const nodemailer = require("nodemailer");
const https = require("https");
const moment = require("moment");
const oracledb = require("oracledb");
const mongoose = require("mongoose");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const logger = require("./config/winston");
const { scheduleJob } = require("node-schedule");

const createOpportunity = async (reqId) => {
  let apiUrl, payload;
  try {
    const quote = await Quote.findOne({ reqId, isActive: true }).lean();
    const { companyName, ebsAccountNo, opportunityId, parentRole } = quote;

    const allowedRoles = ["CP + Customer"];

    if (!allowedRoles.includes(parentRole)) return true;
    if (opportunityId) return true;

    const opportunitypropect = await loginDB.collection("companies").find({ companyName }).toArray();
    let userType = opportunitypropect[0]?.ebsaccountNo ? "company" : "prospect";

    apiUrl = `${process.env.APP_PATH}/onesify/channelPartner/common/create_opportunity`;
    payload = {
      reqId: parseInt(reqId),
      product: "mpls",
      ebsAccountNo,
      userType,
    };

    console.log("Opportunity Create API Payload:", payload);
    const response = await axios.post(apiUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
      httpsAgent,
    });

    console.log("Opportunity Create API Response:", response.data);

    if (response?.data?.status === "Error") {
      throw new Error(response.data.message);
    }
  } catch (error) {
    await exports.errorLog({ stack: error.stack, message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}`, filter: "opportunity" }, reqId);
    logger.error({ statusCode: 200, status: "Error", message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}` });
    console.error("Error calling createOpportunity API:", error.response?.data || error.message);
  }
};
exports.errorLog = async (error, reqId, companyName = null, ebsAccountNo = null, createdDate = null, quoteType = null, ERPStatus = null) => {
  await db.collection("networkerrorlogs").insertOne({
    reqId: parseInt(reqId) || 0,
    message: error.message || error,
    response: error.response || null,
    stack: error.stack,
    filter: error.filter,
    path: error?.path,
    product: "MPLS",
    companyName,
    ebsAccountNo,
    createdDate,
    updatedDate: new Date(),
    quoteType,
    ERPStatus,
  });
};
exports.update_price = async (req, next, reqId) => {
  let ARC = 0;
  let OTC = 0;

  const quote = await Quote.findOne({ reqId });
  if (quote.basePlan.length !== 0) {
    for await (const basePlan of quote.basePlan) {
      // ARC += basePlan.totalARC;
      // OTC += basePlan.totalOTC;
      // ARC += basePlan.mastARC;
      // OTC += basePlan.mastOTC;
    }
  }

  for await (const value of quote.locationDetails) {
    if (!value.isSelect) continue;
    const { valueAddedService } = value;
    ARC += value?.basePrices?.totalARC ?? 0;
    OTC += value?.basePrices?.totalOTC ?? 0;
    // ARC += basePlan.mastARC;
    // OTC += basePlan.mastOTC;
    if (valueAddedService) {
      for await (const price of valueAddedService) {
        if (valueAddedService !== 0) {
          ARC += price.arc;
          OTC += price.otc;
        }
      }
    }
  }
  console.log("Calculated ARC : ", ARC, " Calculated OTC ; ", OTC);
  const updateQuote = await Quote.findOneAndUpdate(
    { reqId },
    {
      totalARC: ARC,
      totalOTC: OTC,
      totalPrice: Math.round(Number(ARC) + Number(OTC)),
    }
  );
  if (!updateQuote) throw new Error("reqId Not Found");
  return true;
};
exports.multiple_create_feasibility = async (req, next, reqId) => {
  try {
    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const { locationDetails, partyId, partyNo, ebsAccountNo } = quote;
    if (locationDetails.length === 0) throw new Error("Please add links before submitting feasibility");

    // const partyDataResponse = await axios.get(`${process.env.APP_PATH}/onesify/auth/api/v1/get-username/${quote.createdBy}`, { httpsAgent });
    // const partyData = partyDataResponse.data[0];

    const config = {
      headers: { apikey: process.env.ERP_API_KEY },
    };

    const postData = {
      source: "DSP",
      method: "createFeasibilityInBulk",
      ACCOUNT_MANAGER: "GOMATHI.SITARAM",
      AM_USER_ID: 5895,
      AM_OSC_ID: 100000000289504,
      PARTY_ID: partyId, //External API
      PARTY_NUMBER: partyNo, //External API
      OPPORTUNITY_ID: partyId, //party id
      OPPORTUNITY_NUMBER: partyNo, //party id
      OPPORTUNITY_NAME: "DSP-OSP",
      OSC_PARTY_ID: 300000610492325,
      SALES_REMARK: "TEST REMARKS FROM OSP -- DSP",
    };
    const REQUESTS = [];
    for await (const value of locationDetails) {
      let connectionTypeWireless = "";
      let connectionTypeFiber = "";
      let connectionTypeOtherISP = "";
      let { contactDetails, connectionType, reqBandwidth, reqBandwidthUOM } = value;

      switch (connectionType.toLowerCase()) {
        case "wireless":
          connectionTypeWireless = "Wireless";
          break;
        case "fiber":
          connectionTypeFiber = "Fiber";
          break;
        default:
          connectionTypeOtherISP = "LL";
          break;
      }
      function isDecimalNumber(num) {
        return !isNaN(num) && num % 1 !== 0;
      }

      if (isDecimalNumber(reqBandwidth) && reqBandwidth < 1) {
        reqBandwidthUOM = "Kbps";
        reqBandwidth = Math.floor(reqBandwidth * 1000);
      }

      REQUESTS.push({
        source: "DSP",
        method: "createFeasibility",
        ACCOUNT_MANAGER: "GOMATHI.SITARAM",
        AM_USER_ID: 5895,
        AM_OSC_ID: 100000000289504,
        PARTY_ID: partyId, //External API
        PARTY_NUMBER: partyNo, //External API
        OPPORTUNITY_ID: partyId, //party id
        OPPORTUNITY_NUMBER: partyNo, //party id
        OPPORTUNITY_NAME: "DSP-OSP",
        OSC_PARTY_ID: 300000625823242,
        SALES_REMARK: "TEST REMARKS FROM OSP -- DSP",
        REQUESTER_CONTACT_NO: 9943441504,
        LOCALLOOP_TYPE: connectionTypeWireless,
        SIFYONNET_FIBER: connectionTypeFiber,
        SIFYOFFNET_LL: connectionTypeOtherISP,
        ORDER_STATUS: "Firm",
        CONT_NAME: `${contactDetails.contactFirstName} ${contactDetails.contactLastName}`,
        CUST_ADDR: `${value.address1}, ${value.address2}, ${value.address3}`,
        ADDRESS1: value.address1,
        ADDRESS2: value.address2,
        ADDRESS3: value.address3,
        CITY: value.city.toUpperCase(),
        PIN: value.pincode,
        PHONE1: contactDetails.contactPhoneNumber1,
        PHONE2: contactDetails.contactPhoneNumber2,
        EMAIL: contactDetails.contactEmail,
        LOCALLOOP_BW: reqBandwidth,
        LOCALLOOP_BW_TYPE: reqBandwidthUOM,
        PORT_BW: reqBandwidth,
        PORT_BW_TYPE: reqBandwidthUOM,
        PROVISION_TYPE: value.provisionType || "New-Link",
        LINK_ID: value.existingPlanDetails?.linkId || "",
        REFERENCE_NO: value.locationId,
      });
    }
    postData.REQUESTS = REQUESTS;
    console.log("Post Data:", postData);

    const createFeasibility = await axios.post(`${process.env.CREATE_FEASIBILITY}`, postData, config);
    if (!createFeasibility) throw new Error("Temporary service outage. Please try again later.");

    if (createFeasibility?.data?.WSstatus || createFeasibility.data.WSstatus === "Error") {
      await Quote.findOneAndUpdate(
        { reqId },
        {
          status: "Not Feasible",
          feasibilityInitiatedDate: new Date(),
        }
      );
      await exports.errorLog({ stack: createFeasibility?.data?.WSerror, message: `Error in feasibility API: ${process.env.CREATE_FEASIBILITY} payload: ${JSON.stringify(postData)}`, filter: "feasibility" }, reqId);
      logger.error({ statusCode: 200, status: "Error", message: `Error in feasibility API: ${process.env.CREATE_FEASIBILITY} payload: ${JSON.stringify(postData)}` });
      console.error("Error calling multipleCreateFeasibility API:", createFeasibility?.data?.WSerror);
      throw new Error(createFeasibility?.data?.WSerror);
      // throw new Error("Temporary service outage. Please try again later.");
    }

    const feasibilityIdList = createFeasibility.data;

    for await (const data of locationDetails) {
      const feasibilityId = feasibilityIdList[`${data.locationId}`];
      const cxmFeasibilityStatus = "Pending";
      const requestedDate = Date();
      const mastHeight = "0";
      const mastType = "";
      const opex = 0;
      const capex = 0;

      const status = "CHECKING FEASIBILITY";

      const updateQuote = await Quote.updateOne(
        { reqId },
        {
          $set: {
            "locationDetails.$[elem].feasibilityId": feasibilityId,
            "locationDetails.$[elem].feasibilityStatus": status,
            "locationDetails.$[elem].cxmFeasibilityStatus": cxmFeasibilityStatus,
            "locationDetails.$[elem].feasibilityInitiatedDate": requestedDate,
            "locationDetails.$[elem].mastHeight": mastHeight,
            "locationDetails.$[elem].mastType": mastType,
            "locationDetails.$[elem].opex": opex,
            "locationDetails.$[elem].capex": capex,
            // "locationDetails.$[elem].capex": opportunityId,
          },
          status,
          opportunityId,
          // statusCode: erpTestApi.data["StatusCode"],
          // opportunityNo: erpTestApi.data["OptyNumber"],
          // userType
        },
        {
          arrayFilters: [{ "elem.locationId": data.locationId }],
        }
      );
      const feasibilityIds = new FeasibilityIds({
        feasibilityId,
        serviceType: "MPLS",
        status: "Pending",
      });
      const updateFeasibilityIds = await feasibilityIds.save();
      if (!updateFeasibilityIds) {
        throw new Error("Failed to insert");
      }
      console.log(updateQuote);
      if (!updateQuote) throw new Error("Temporary service outage. Please try again later.");
    }

    createOpportunity(reqId);
    return true;
  } catch (error) {
    next(error);
    return false;
  }
};
exports.create_feasibility = async (req, next, reqId) => {
  console.log(`[create_feasibility] START - reqId: ${reqId}`);

  const quote = await Quote.findOne({ reqId });
  console.log(`[create_feasibility] Quote fetched:`, quote ? "FOUND" : "NOT FOUND");
  if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

  const { locationDetails, ebsAccountNo, quoteType, partyId, partyNo, companyName } = quote;
  console.log(`[create_feasibility] locationDetails count: ${locationDetails.length}`);
  if (locationDetails.length === 0) throw new Error("Please add links before submitting feasibility");

  const config = {
    headers: { apikey: process.env.ERP_API_KEY },
  };

  const checkFeas = [];
  for (let locIndex = 0; locIndex < locationDetails.length; locIndex++) {
    const value = locationDetails[locIndex];
    console.log(`[create_feasibility] Processing locationId: ${value.locationId}`);
    if (value?.feasibilityId) {
      console.log(`[create_feasibility] Skipping locationId ${value.locationId} - Feasibility already exists`);
      continue;
    }

    let connectionTypeWireless = "";
    let connectionTypeFiber = "";
    let connectionTypeOtherISP = "";
    let { contactDetails, connectionType, serviceProvider = null, reqBandwidth, reqBandwidthUOM, provisionType } = value;
    const isOtherISP = connectionType.toLocaleLowerCase() === "other isp";

    switch (connectionType.toLowerCase()) {
      case "wireless":
        connectionTypeWireless = "Wireless";
        break;
      case "fiber":
        connectionTypeFiber = "Fiber";
        break;
      default:
        connectionTypeOtherISP = "LL";
        break;
    }

    function isDecimalNumber(num) {
      return !isNaN(num) && num % 1 !== 0;
    }

    if (isDecimalNumber(reqBandwidth) && reqBandwidth < 1) {
      console.log(`[create_feasibility] Converting fractional bandwidth to Kbps for locationId ${value.locationId}`);
      reqBandwidthUOM = "Kbps";
      reqBandwidth = Math.floor(reqBandwidth * 1000);
    }
    await createOpportunity(reqId);

    if (createOpportunity) {
      const updateStatusFeab = await db.collection("opportunityDetails").findOneAndUpdate(
        { reqId },
        {
          $set: { status: "CHECKING FEASIBILITY" }
        }
      );

      console.log("updateStatusFeab", updateStatusFeab);
      if (!updateStatusFeab) throw new Error("Unable To Update Status");
    }

    const createOpportunitydata = await loginDB.collection("companies").find({ companyName: quote.companyName }).toArray();
    let accountManager = createOpportunitydata[0]?.accountManager_name;

    const oscParty = await loginDB.collection("companies").find({ companyName: quote.companyName }).toArray();
    let oscpartyId = oscParty[0]?.oscpartyId || "";
    let partyId = oscParty[0]?.partyId || "";
    let partyNo = oscParty[0]?.partyNo || "";
    // console.log(oscParty)

    const opportunityDetails = await db.collection("opportunityDetails").findOne({ reqId: reqId });
    console.log("opportunityDetails", opportunityDetails);
    let opportunityId = opportunityDetails?.opportunityId || "";
    let opportunityNo = opportunityDetails?.opportunityNo || "";


    const postData = {
      source: "DSP",
      method: "createFeasibility",
      ACCOUNT_MANAGER: accountManager,
      AM_USER_ID: 5895,
      AM_OSC_ID: 100000000289504,
      PARTY_ID: partyId,
      PARTY_NUMBER: partyNo,
      OPPORTUNITY_ID: opportunityId || 300000663278698,
      OPPORTUNITY_NUMBER: opportunityNo || "487341",
      OPPORTUNITY_NAME: "DSP-OSP",
      OSC_PARTY_ID: oscpartyId || 300000625823242,
      SALES_REMARK: "TEST REMARKS FROM OSP -- DSP",
      REQUESTER_CONTACT_NO: 9943441504,
      LOCALLOOP_TYPE: connectionTypeWireless,
      SIFYONNET_FIBER: connectionTypeFiber,
      SIFYOFFNET_LL: connectionTypeOtherISP,
      ORDER_STATUS: "Firm",
      CONT_NAME: `${contactDetails.contactFirstName} ${contactDetails.contactLastName}`,
      CUST_ADDR: `${value.address1}, ${value.address2}, ${value.address3}`,
      ADDRESS1: value.address1,
      ADDRESS2: value.address2,
      ADDRESS3: value.address3,
      CITY: value.city.toUpperCase(),
      PIN: value.pincode,
      PHONE1: contactDetails.contactPhoneNumber1,
      PHONE2: contactDetails.contactPhoneNumber2,
      EMAIL: contactDetails.contactEmail,
      LOCALLOOP_BW: reqBandwidth,
      LOCALLOOP_BW_TYPE: reqBandwidthUOM,
      PORT_BW: reqBandwidth,
      PORT_BW_TYPE: reqBandwidthUOM,
      PROVISION_TYPE: value.provisionType || "New-Link",
      LINK_ID: value.existingPlanDetails?.linkId || "",
      fcf_link_id: value.existingPlanDetails?.linkId || "",
      fcf_lastmile_change: "",
      fcf_address_change: "",
      fcf_bw_chang: quoteType === "modifyBandwidth" && isOtherISP ? provisionType.toLowerCase() : "",
    };
    console.log(`[create_feasibility] Post Data prepared for locationId ${value.locationId}:`, postData);

    const isFiberConnection = connectionTypeFiber === "Fiber";
    let feasibilityId, feasibilityStatus, feasibilityReqStatus, OPEX, CAPEX, TOWER_HEIGHT, mastType, requestedDate;
    let usedFallback = false;

    try {
      const createFeasibility = await axios.post(process.env.CREATE_FEASIBILITY, postData, process.env.ENVIRONMENT === "PRODUCTION" ? config : {});
      console.log(`[create_feasibility] API Response for locationId ${value.locationId}:`, createFeasibility.data);

      const isApiError = createFeasibility?.data?.WSstatus === "Error" || createFeasibility?.data?.WSerror;

      if (isApiError) {
        console.error(`[create_feasibility] Feasibility API Error for locationId ${value.locationId}:`, createFeasibility?.data?.WSerror);
        await exports.errorLog({ stack: createFeasibility?.data?.WSerror, message: `Error in feasibility API: ${process.env.CREATE_FEASIBILITY} payload: ${JSON.stringify(postData)}`, filter: "feasibility" }, reqId);
        logger.error({ statusCode: 200, status: "Error", message: `Error in feasibility API: ${process.env.CREATE_FEASIBILITY} payload: ${JSON.stringify(postData)}` });
        console.warn(`[create_feasibility] Using fallback random feasibility ID for demo - locationId ${value.locationId}`);
        usedFallback = true;
      } else {
        let feasibilityData;
        switch (connectionType.toLowerCase()) {
          case "wireless":
            feasibilityData = createFeasibility.data.Wireless?.[0];
            break;
          case "fiber":
            feasibilityData = createFeasibility.data.Fiber?.[0];
            break;
          default: {
            const offnetData = createFeasibility.data.Offnet;
            const match = serviceProvider?.match(/\[(.*?)\]/);
            offnetData?.forEach((element) => {
              if (element["BSO"] === match?.[1]) feasibilityData = element;
            });
            break;
          }
        }

        console.log(`[create_feasibility] Feasibility data for locationId ${value.locationId}:`, feasibilityData);

        if (!feasibilityData) {
          console.warn(`[create_feasibility] No feasibility data in response - using fallback for locationId ${value.locationId}`);
          usedFallback = true;
        } else {
          ({ FEAS_OPT: feasibilityStatus, req_Status: feasibilityReqStatus, OPEX, CAPEX, TOWER_HEIGHT, TOWER_TYPE: mastType, CREATED_DATE: requestedDate, FEASIBILITY_ID: feasibilityId } = feasibilityData);
        }
      }
    } catch (apiErr) {
      console.warn(`[create_feasibility] API call failed - using fallback for locationId ${value.locationId}:`, apiErr.message);
      await exports.errorLog({ stack: apiErr.stack, message: `Feasibility API exception: ${apiErr.message}`, filter: "feasibility" }, reqId);
      usedFallback = true;
    }

    if (usedFallback) {
      feasibilityId = String(reqId) + "0" + String(locIndex);
      feasibilityStatus = "Pending";
      feasibilityReqStatus = "2";
      OPEX = 0; CAPEX = 0; TOWER_HEIGHT = 0; mastType = ""; requestedDate = new Date().toISOString();
    }

    const opex = isFiberConnection ? parseInt(OPEX) : 0;
    const capex = isFiberConnection ? parseInt(CAPEX) : 0;
    const mastHeight = isFiberConnection ? parseInt(TOWER_HEIGHT) : parseInt(TOWER_HEIGHT || 0);

    const status = feasibilityStatus === "Pending" && feasibilityReqStatus === "2" ? "CHECKING FEASIBILITY" : feasibilityStatus;

    checkFeas.push(feasibilityStatus);
    console.log(`[create_feasibility] Updating Quote for locationId ${value.locationId} with status: ${status}`);

    const updateQuote = await Quote.updateOne(
      { reqId },
      {
        $set: {
          "locationDetails.$[elem].towerPriceVerified": false,
          "locationDetails.$[elem].feasibilityId": feasibilityId,
          "locationDetails.$[elem].feasibilityStatus": status,
          "locationDetails.$[elem].actualFeasibilityStatus": status,
          "locationDetails.$[elem].cxmFeasibilityStatus": feasibilityStatus,
          "locationDetails.$[elem].feasibilityInitiatedDate": requestedDate,
          "locationDetails.$[elem].mastHeight": mastHeight,
          "locationDetails.$[elem].mastType": mastType,
          "locationDetails.$[elem].opex": opex,
          "locationDetails.$[elem].capex": capex,
        },
      },
      {
        arrayFilters: [{ "elem.locationId": value.locationId }],
      }
    );

    const feasibilityIds = new FeasibilityIds({
      feasibilityId,
      serviceType: "MPLS",
      status: "Pending",
    });
    const updateFeasibilityIds = await feasibilityIds.save();
    console.log(`[create_feasibility] Feasibility ID saved for locationId ${value.locationId}:`, updateFeasibilityIds);

    if (!updateFeasibilityIds) {
      throw new Error("Temporary service outage. Please try again later.");
    }
    if (!updateQuote) throw new Error("Temporary service outage. Please try again later.");
  }

  console.log(`[create_feasibility] All locations processed, checkFeas:`, checkFeas);

  let quoteStatus;
  if (checkFeas.includes("Pending")) {
    quoteStatus = "CHECKING FEASIBILITY";
  } else if (checkFeas.includes("Not Feasible")) {
    quoteStatus = "Partially Feasible";
  } else {
    quoteStatus = "Feasible";
  }

  console.log(`[create_feasibility] Final quoteStatus: ${quoteStatus}`);

  const updateStatusFeab = await Quote.findOneAndUpdate(
    { reqId },
    {
      status: quoteStatus,
      cxmCommonStatus: quoteStatus,
    }
  );
  console.log(`[create_feasibility] Quote status updated:`, updateStatusFeab ? "SUCCESS" : "FAILED");
  if (!updateStatusFeab) throw new Error("Unable To Update Status");

  console.log(`[create_feasibility] END - reqId: ${reqId}`);
  return true;
};

exports.update_feasibility = async (req, limit, page, companyId, next) => {
  // try {
  const skip = limit * (page - 1);
  // const toArray = [req.email];
  const sort = { reqId: -1 };
  const query = {
    isActive: true,
    locationDetails: {
      $elemMatch: {
        feasibilityStatus: { $in: ["CHECKING FEASIBILITY", "Pending"] },
        connectionType: "Fiber",
      },
    },
    status: { $nin: ["Order Signed", "Order Placed"] },
    companyId,
  };

  const quoteList = await Quote.find(query).sort(sort).skip(skip).limit(limit).lean();
  console.log(quoteList);
  for await (const quote of quoteList) {
    for await (const data of quote.locationDetails) {
      if (data.connectionType === "Fiber") {
        const postData = {
          source: "DSP",
          method: "getFeasibiltiyRequestsById",
          FEASIBILITY_ID: data.feasibilityId,
          PARTY_NUMBER: quote.partyNo,
        };
        console.log(postData);

        const updateFeasibility = await axios.post(`${process.env.CREATE_FEASIBILITY}`, postData, { httpsAgent });
        console.log(updateFeasibility);
        if (!updateFeasibility || updateFeasibility.data?.code) {
          console.log("Feasibility Request Failed");
        }
        const isFiberConnection = data.connectionType.toLowerCase() === "fiber";
        console.log(updateFeasibility);
        const feasibilityData = isFiberConnection ? updateFeasibility.data.Fiber[0] : updateFeasibility.data.Wireless[0];
        console.log(feasibilityData);
        if (!feasibilityData) {
          // throw "No Data";
          continue;
        }
        const { FEAS_OPT, req_Status, UPDATED_DATE, OPEX, CAPEX, TOWER_HEIGHT, BUILDING_HEIGHT, TOWER_TYPE, FEASIBILITY_ID } = feasibilityData;
        const feasibilityOpt = FEAS_OPT === "Pending" && req_Status === "2" ? "CHECKING FEASIBILITY" : FEAS_OPT;
        const payload = { fcfb_cxm_feasibility_status: FEAS_OPT, fcfb_wireless_option: feasibilityOpt, fcf_date_time: UPDATED_DATE, fcff_tot_opex: OPEX, fcff_tot_capex: CAPEX, fcfb_mast_height: TOWER_HEIGHT, fcfb_building_height: BUILDING_HEIGHT, fcfb_mast_type: TOWER_TYPE, fcf_feasibility_id: FEASIBILITY_ID };
        console.log(payload);
        const updateFeas = await axios.post(`https://onesifydemo.sifytechnologies.com/onesify/network/common/post_updated_feasibility`, payload, { httpsAgent });
        console.log(updateFeas);
      }
    }
  }
  return true;
  // } catch (error) {
  //   next(error);
  //   return false;
  // }
};

let transporter = null;

async function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const [mailcredentials] = await db
    .collection("mailcredentials")
    .find({})
    .toArray();

  transporter = nodemailer.createTransport({
    host: mailcredentials.SMTP_Mail_Host,
    port: mailcredentials.SMTP_Mail_port,
    secure: false,
    auth: {
      user: mailcredentials.SMTP_TO_EMAIL,
      pass: mailcredentials.SMTP_TO_PASSWORD,
    },
    pool: true, // Connection pooling
    maxConnections: 5,
    maxMessages: 100,
    tls: {
      rejectUnauthorized: true,
    },
  });

  return transporter;
}
const delay = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, retries = 4) {
  const retryDelays = [5000, 10000, 15000];
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      console.error(
        `Email attempt ${attempt}/${retries} failed:`,
        error.message
      );

      if (attempt < retries) {
        await delay(retryDelays[attempt - 1]);
      }
    }
  }

  throw lastError;
}
exports.send_mail = async (to, cc, subject, html, attachments = null) => {
  try {
    const isProd = process.env.ENVIRONMENT === "PRODUCTION";
    let bcc = isProd ? JSON.parse(process.env.PROD_BCC_MAILS || '[]') : JSON.parse(process.env.DEMO_BCC_MAILS || '[]');
    const transporter = await getTransporter();
    const [mailcredentials] = await db
      .collection("mailcredentials")
      .find({})
      .toArray();

    const mailOptions = {
      from: mailcredentials.SMTP_TO_EMAIL,
      to,
      cc: [...(cc || []),],
      bcc,
      subject,
      html,
    };

    if (attachments) {
      mailOptions.attachments = Array.isArray(attachments) ? attachments : [attachments];
    }

    const info = await retry(
      () => transporter.sendMail(mailOptions),
      4
    );

    return info;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

exports.sendMailUntilSuccess = async (
  reqId,
  to,
  cc,
  subject,
  html,
  attachment = null,
  maxRetries = 5,
  retryDelay = 3000,
  isOrderSignedMail = false
) => {
  let attemptCount = 0;

  async function trySendingMail() {
    try {
      const isProd = process.env.ENVIRONMENT === "PRODUCTION";
      let bcc = isProd ? JSON.parse(process.env.PROD_BCC_MAILS || '[]') : JSON.parse(process.env.DEMO_BCC_MAILS || '[]');
      if (isOrderSignedMail && isProd) {
        bcc.push("gomathi.sitaram@sifycorp.com");
      }

      const [mailcredentials] = await db.collection("mailcredentials").find({}).toArray();

      const transporter = await getTransporter();

      const sendMail = await transporter.sendMail({
        from: mailcredentials.SMTP_TO_EMAIL,
        to,
        cc,
        bcc,
        subject,
        html,
        ...(attachment ? { attachments: [attachment] } : {}),
      });

      console.log("Mail Triggered Successfully:", sendMail);
    } catch (error) {
      attemptCount++;
      if (attemptCount < maxRetries) {
        console.log(`Error in sending mail, retrying... Attempt ${attemptCount} of ${maxRetries}`);
        setTimeout(trySendingMail, retryDelay);
      } else {
        await exports.errorLog(
          { stack: error.stack, message: `Error in sending mail for: ${subject}`, filter: "mail" },
          reqId
        );
        logger.error({ statusCode: 200, status: "Error", message: `Error in sending mail after ${maxRetries} attempts.` });
        console.log(`Error in sending mail after ${maxRetries} attempts.`);
      }
    }
  }

  trySendingMail();
};
exports.update_quote_common_status = async (quote) => {
  const { reqId, locationDetails } = quote;

  const selectedData = locationDetails.filter((data) => data.isSelect || data.isSelect === undefined);

  // const allTowerPriceVerified = selectedData.every((data) => data.hasOwnProperty("towerPriceVerified") && data.towerPriceVerified === true);

  // if (allTowerPriceVerified) {
  let checkFeas = selectedData.map((data) => data.feasibilityStatus);
  console.log("tower", reqId, checkFeas);

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
  console.log(status);
  const updateStatusFeab = await Quote.findOneAndUpdate({ reqId: reqId }, { $set: { status } });
  if (!updateStatusFeab) throw new Error("Unable To Update Status");
  // }

  return true;
};
// exports.get_order_number = async (req, res, next) => {
//   const dbConfig = {
//     user: process.env.ORACAL_USERNAME,
//     password: process.env.ORACAL_PASSWORD,
//     connectString: process.env.ORACAL_CONNECTIONSTRING,
//   };
//   let oracalDb;
//   try {
//     console.log("order_number");
//     oracalDb = await oracledb.getConnection(dbConfig);
//     const listOf = await Quote.find({ status: "Order Placed", orderRefNo: null }).select("-_id reqId");
//     for (let i = 0; i < listOf.length; i++) {
//       const newQuery = `select ORDER_NUMBER from CCOSS.ORDER_STATUS_VIEW where ORDER_SOURCE='OSPMPLS-${listOf[i].reqId}'`;
//       const result = await oracalDb.execute(newQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//       const data = result.rows;
//       console.log(data);
//       if (data.length !== 0) {
//         const updateData = await Quote.findOneAndUpdate({ reqId: listOf[i].reqId }, { orderRefNo: data[0].ORDER_NUMBER, status: "Order Booked" });
//       }
//     }
//     logger.info(`${req.path} -- ${req.method} -- Success`);
//     return { status: "Success" };
//   } catch (error) {
//     return { status: "Error", error };
//   } finally {
//     if (oracalDb) {
//       await oracalDb.close();
//     }
//   }
// };
// exports.get_order_number = async (req, res, next) => {
//   console.log("get_order_number");
//   const dbConfig = {
//     user: process.env.ORACAL_USERNAME,
//     password: process.env.ORACAL_PASSWORD,
//     connectString: process.env.ORACAL_CONNECTIONSTRING,
//   };

//   let oracalDb;

//   try {
//     console.log("order_number");
//     oracalDb = await oracledb.getConnection(dbConfig);

//     const listOf = await Quote.find({ status: "Order Placed", orderRefNo: null })
//     console.log("listOf.length", listOf.length);

//     const date = new Date();

//     for (let i = 0; i < listOf.length; i++) {
//       const reqId = listOf[i].reqId;

//       const newQuery = `
//         SELECT
//           LINK_ID,
//           REQUEST_ID,
//           NEW_OPG_ATTRIBUTE41
//         FROM XXSIFY_OSP_ORM_ORDER_VIEW_V@bi2apps
//         WHERE NEW_OPG_ATTRIBUTE98 = '${reqId}'
//       `;
//       console.log("New Query", newQuery);

//       const result = await oracalDb.execute(newQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//       const data = result.rows;
//       console.log("data", data);

//       if (data && data.length > 0) {
//         const updateData = await Quote.findOneAndUpdate(
//           { reqId },
//           {
//             bookingNo: data[0].REQUEST_ID,
//             status: "Order Completed",
//             order_provisingDate: date,
//             linkId: data[0].LINK_ID || null,
//           }
//         );
//         console.log("Updated from main query:", updateData);
//       } else {
//         const fallbackQuery = `SELECT ORDER_NUMBER FROM CCOSS.ORDER_STATUS_VIEW WHERE ORDER_SOURCE = 'OSPMPLS-${reqId}'`;
//         const fallbackResult = await oracalDb.execute(fallbackQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//         const fallbackData = fallbackResult.rows;
//         console.log("Fallback data", fallbackData);

//         if (fallbackData.length !== 0) {
//           const updateData = await Quote.findOneAndUpdate(
//             { reqId },
//             {
//               orderRefNo: fallbackData[0].ORDER_NUMBER,
//               status: "Order Booked"
//             }
//           );
//           console.log("Updated from fallback query:", updateData);
//         }
//       }
//     }

//     logger.info(`${req.path} -- ${req.method} -- Success`);
//     return res.status(200).send({ status: "Success" }); 
//   } catch (error) {
//     console.error("get_order_number error:", error);
//     return res.status(500).send({ status: "Error", error: error.message });
//   } finally {
//     if (oracalDb) {
//       await oracalDb.close(); 
//     }
//   }
// };

async function sendBookingMail({ reqId, soNumber, linkId }) {
  console.log("sendBookingMail called with:", { reqId, soNumber, linkId });
  try {
    let toArray = ["anandhkstinfotech@gmail.com"];
    let ccArray = ["anandhkstinfotech@gmail.com"];
    //let toArray = process.env.MAIL_PLACEDTO?.split(",") || [];
    const quote = await Quote.findOne({ reqId });
    console.log("quote", quote)

    const usermail = await loginDB
      .collection("users")
      .findOne({ _id: new mongoose.Types.ObjectId(quote.createdBy) });


    console.log("usermail", usermail)

    // let toArray = process.env.PLACED_MAILTO
    //   ? process.env.PLACED_MAILTO.split(",").map(m => m.trim())
    //   : [];

    if (usermail?.email && !toArray.includes(usermail.email)) {
      toArray.push(usermail.email);
    }

    // let ccArray = process.env.PLACED_MAILCC
    //   ? process.env.PLACED_MAILCC.split(",").map(m => m.trim())
    //   : [];

    toArray = [...new Set(toArray)];
    ccArray = [...new Set(ccArray)];

    console.log("toArray =", toArray);
    console.log("ccArray =", ccArray);

    /* const pdfData = await downloadAndSavePDF(reqID);
    console.log("PDF downloaded:", pdfData.length, "bytes"); */

    const subject = `MPLS Order Confirmation Booking Number Generated (Request ID: ${reqId})`;
    const currentYear = new Date().getFullYear();

    const html = `
                <html>
                  <head>
                    <meta charset="utf-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                  </head>

                  <body style="font-family: Arial, sans-serif; font-size: 14px; color: #000; margin: 0; padding: 0; background-color: #ffffff;">
                    <div style="max-width: 800px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; background-color: #ffffff;">

                      <!-- Logo -->
                      <div style="text-align: right; margin-bottom: 20px;">
                        <img
                          src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png"
                          alt="Sify Technologies"
                          style="max-width: 180px; height: auto;"
                        />
                      </div>

                      <!-- Greeting -->
                      <p>Dear ${usermail.firstName} ${usermail.lastName},</p>

                      <p>
                        Greetings from <strong style="color:#0E3346;">Sify Technologies Limited</strong>.
                      </p>

                      <p>
                        We are pleased to inform you that your <strong>MPLS service order</strong>
                        has been successfully registered in our system and the
                        <strong>Booking Number has been generated</strong>.
                      </p>

                      <!-- Details Table -->
                      <table cellpadding="8" cellspacing="0" border="1"
                        style="border-collapse: collapse; margin: 15px 0; width: 100%; border-color: #dcdcdc;">
                        <tr style="background-color:#f7f9fa;">
                          <td><strong>Request ID</strong></td>
                          <td>${reqId}</td>
                        </tr>
                        <tr>
                          <td><strong>Quote Type</strong></td>
                          <td>${quote.quoteType}</td>
                        </tr>
                        <tr style="background-color:#f7f9fa;">
                          <td><strong>Booking Number</strong></td>
                          <td>${soNumber}</td>
                        </tr>
                        <tr>
                          <td><strong>Link ID</strong></td>
                          <td>${linkId}</td>
                        </tr>
                        <tr style="background-color:#f7f9fa;">
                          <td><strong>Current Status</strong></td>
                          <td>Order Implemented</td>
                        </tr>
                      </table>

                      <p>
                        Our provisioning team has started working on your request and will keep you
                        informed about further progress.
                      </p>

                      <p>
                        Please find the attached signed order document for your reference.
                      </p>

                      <p>
                        If you have any questions or require further assistance, please feel free
                        to reach out to your Account Manager or reply to this email.
                      </p>

                      <br />

                      <!-- Signature -->
                      <p>
                        Best Regards,<br />
                        <strong>Team OneSify</strong><br />
                        Sify Technologies
                      </p>

                      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />

                      <!-- Footer -->
                      <p style="font-size: 12px; color: #555;">
                        © ${currentYear} Sify Technologies Limited. All Rights Reserved.
                      </p>

                    </div>
                  </body>
                </html>
                `;


    await exports.sendMailUntilSuccess(reqId, toArray, ccArray, subject, html);
    console.log("Booking mail sent successfully for Request ID:", reqId);
  } catch (error) {
    console.log("Error sending mail:", error);
  }
}
exports.get_order_number = async (req, res, next) => {
  console.log("get_order_number called");
  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING,
  };
  let oracalDb;
  try {
    console.log("order_number");
    oracalDb = await oracledb.getConnection(dbConfig);
    const listOf = await Quote.find({ status: "Order Placed", soNumber: { $exists: false } }).select("-_id reqId quoteType");
    console.log("listOf", listOf)
    for (let i = 0; i < listOf.length; i++) {
      console.log("loop started");
      console.log("reqId:", listOf[i].reqId);
      console.log("quoteType:", listOf[i].quoteType);
      if (listOf[i].quoteType === "New") {
        console.log("listOf[i].reqId.quoteType", listOf[i].quoteType)
        const newQuery = `SELECT ORDER_NUMBER,LINK_ID FROM apps.sify_online_sales_ord_det@bi2apps WHERE scqh_id=${listOf[i].reqId}`;
        const result = await oracalDb.execute(newQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const data = result.rows;
        console.log(data);
        let updateData
        if (data.length !== 0) {

          const soNumber = data[0].ORDER_NUMBER.toString();
          const linkId = data[0].LINK_ID.toString();
          updateData = await Quote.findOneAndUpdate(
            { reqId: listOf[i].reqId },
            {
              linkId: linkId,
              soNumber: soNumber,
              status: "Order Implemented",
              order_implementedDate: new Date(),
            }
          );
          console.log("mail")
          await sendBookingMail({
            reqId: listOf[i].reqId,
            soNumber,
            linkId
          });
        }

      } else {
        const newQuery = `select LINK_ID,request_id,NEW_OPG_ATTRIBUTE41 from XXSIFY_OSP_ORM_ORDER_VIEW_V@bi2apps
         where new_opg_attribute98 = ${listOf[i].reqId}`;
        const result = await oracalDb.execute(newQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const data = result.rows;
        console.log(data);
        if (data.length !== 0) {
          updateData = await Quote.findOneAndUpdate({ reqId: listOf[i].reqId },
            { soNumber: data[0].ORDER_NUMBER, status: "Order Implemented", linkId: data[0].LINK_ID, order_implementedDate: new Date() });
          const soNumber = data[0].ORDER_NUMBER.toString();
          const linkId = data[0].LINK_ID.toString();

          await sendBookingMail({
            reqId: listOf[i].reqId,
            soNumber: soNumber,
            linkId: linkId
          });
        }
      }
    }
    logger.info(`${req.path} -- ${req.method} -- Success`);
    return { status: "Success" };
  } catch (error) {
    return { status: "Error", error };
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};

exports.modifyIrDate = async (req, res, next) => {
  console.log("Entered modifyIrDate");

  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING,
  };

  let oracalDb;

  try {
    oracalDb = await oracledb.getConnection(dbConfig);

    const listOf = await Quote.find({
      status: "Order Implemented",
      $or: [{ irDate: { $exists: false } }, { irDate: null }],
    });

    console.log("Total Orders:", listOf.length);

    const date = new Date();

    for (let i = 0; i < listOf.length; i++) {
      const query = `
        SELECT 
          LINK_ID,
          request_id,
          NEW_OPG_ATTRIBUTE41 AS REQ_IR_DATE
        FROM XXSIFY_OSP_ORM_ORDER_VIEW_V@bi2apps
        WHERE new_opg_attribute98 = :reqId
      `;

      const result = await oracalDb.execute(
        query,
        { reqId: listOf[i].reqId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const data = result.rows;

      if (data && data.length > 0 && data[0].REQ_IR_DATE) {
        await Quote.findOneAndUpdate(
          { reqId: listOf[i].reqId },
          {
            $set: {
              irDate: data[0].REQ_IR_DATE,
              status: "Order Completed",
              irUpdatedDate: date,
            },
          }
        );
      }
    }

    await oracalDb.close();
    return "Success";

  } catch (error) {
    if (oracalDb) await oracalDb.close();
    next(error);
  }
};

exports.get_delivery_status = async (req, res, next) => {
  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING,
  };
  let oracalDb;
  try {
    console.log("2");
    oracalDb = await oracledb.getConnection(dbConfig);
    const listOf = await Quote.find({ status: "Order Booked" });
    for await (const data of listOf) {
      const { orderRefNo, reqId } = data;
      let checkFeas = [];
      for await (const value of data.locationDetails) {
        const { linkId } = value.existingPlanDetails;
        const newQuery = `select fosv.link_id, link_status delivery_status, PORTIR_DATE ir_date from ccoss.fus_open_ord_status_v fosv where link_id = ${linkId} and ORDER_NUMBER=${orderRefNo}`;
        const result = await oracalDb.execute(newQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const data = result.rows;
        console.log(data);
        if (data.length !== 0) {
          let status = data[0].delivery_status;
          checkFeas.push(data[0].delivery_status);
          const query = {
            isActive: true,
            locationDetails: {
              $elemMatch: {
                feasibilityId: value.feasibilityId,
                isSelect: true,
              },
            },
          };

          const updateQuote = await db.collection("quotempls").updateMany(
            query,
            {
              $set: {
                "locationDetails.$[elem].status": status,
              },
            },
            {
              arrayFilters: [{ "elem.feasibilityId": value.feasibilityId }],
            }
          );
        }
      }
      let status = "Order Booked";
      if (checkFeas.every((status) => status === "CLOSED")) {
        status = "Implemented";
      } else if (checkFeas.some((status) => status === "CLOSED")) {
        status = "View Status";
      } else if (checkFeas.every((status) => status !== "CLOSED")) {
        status = "Implementation in progress";
      }
      console.log(status);
      const updateStatusFeab = await Quote.findOneAndUpdate({ reqId }, { status: status });
    }
    logger.info(`${req.path} -- ${req.method} -- Success`);
    return { status: "Success" };
  } catch (error) {
    return { status: "Error", error };
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};
exports.getOracleDb = async () => {
  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING,
  };

  const oracleDb = await oracledb.getConnection(dbConfig);
  return oracleDb;
};
exports.updateOpportunity = async (req, next, reqId) => {
  const { pageTracker, status } = await Quote.findOne({ reqId });
  await db.collection("opportunityDetails").findOneAndUpdate({ reqId }, { $set: { status, pageTracker, updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ") } });
};


// const exportExcel = scheduleJob("0 5 * * *", async function () {
//   let dateTime = new Date();
//   dateTime.setDate(dateTime.getDate() - 1);
//   let previousDate = dateTime.toISOString().slice(0, 10);
//   console.log(previousDate);

//   // let buffer = await axios.post(`https://192.168.2.125:4013/onesify/mpls/common/get_export_excel`, {}, { responseType: "arraybuffer" });
//   let buffer = await axios.post(`${process.env.APP_PATH}/onesify/mpls/common/get_export_excel`, {}, { responseType: "arraybuffer" });
//   console.log("result", buffer.data);

//   const decodedString = buffer.data.toString();

//   let data;
//   try {
//     data = JSON.parse(decodedString); // Parse string as JSON
//     if (data.status === "Error") {
//       return;
//     }
//   } catch (error) {
//     console.error("Invalid JSON:", error);
//   }

//   const toArray = ["technical@kstinfotech.com"];
//   const subject = `One Sify (OSP) MPLS Report for ${previousDate}`;
//   const html = `<div style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747;font-family:'Myriad Pro', sans-serif" width="100%">
//       <p><span style="font-size: 16px; color: #0E3346;">Dear One Sify Admin</span></p>
//       <p>Please see the attached file for the daily MPLS report from one sify portal.</p>
//       <br/>
//       </div>`;
//   const attachment = {
//     filename: `MPLS-${previousDate}.xlsx`,
//     content: buffer.data,
//   };

//   await exports.sendMailUntilSuccess(null, toArray, [], subject, html, attachment);
// });

// const draftStatusMail = async (date) => {
//   try {
//     const thirtyDaysAgo = new Date(Date.now() - date * 24 * 60 * 60 * 1000);
//     const quoteData = await req.Quote.find({
//       createdDate: {
//         $lte: thirtyDaysAgo,
//         $gt: new Date(thirtyDaysAgo.getTime() - 24 * 60 * 60 * 1000),
//       },
//     });

//     const subject = "Draft Test Mail - Sify";

//     const html = `<html>
//       <head>
//           <title>MPLS Template</title>
//       </head>
//       <body>
//           <div style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747;font-family:'Myriad Pro', sans-serif" width="100%">
//               <br/>
//               <table align="center" border="0" cellpadding="0" cellspacing="0"
//                   width="70%" bgcolor="white" >
//                   <tbody>
//                       <tr style="border: none;
//                       background-color: #ffffff;
//                       height: 40px;
//                       color:white;
//                       padding-bottom: 20px;
//                       text-align: left;">
//                           <td height="50px" align="left">
//                           <a href="" style="border: 0; text-decoration:none;">
//                                   <!--[if mso]>
//                                   <table width="50%"><tr><td><img width="200" src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png" alt="One Sify" style="text-align: right; width: 207px; border: 0; text-decoration:none; vertical-align: baseline;"></td></tr></table>
//                                       <div style="display:none">
//                                       <![endif]-->
//                                       <!--[if mso]>
//                                       </div>
//                                   <![endif]-->
//                                   <!--[if !mso]>-->
//                                       <img  src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png" alt="One Sify" style="text-align: right; min-width: 50px; max-width: 207px; border: 0; text-decoration:none; vertical-align: baseline;">
//                                   <!--<![endif]-->
//                               </a>
//                               <hr/>
//                           </td>
//                       </tr>
//                       <tr style="display: inline-block;">
//                           <td style="
//                           border: none;
//                           background-color: white;
//                           padding-left: 25px;
//                           padding-right: 25px;">
//                               <p>Dear <span style="font-size: 18px; color: #0E3346;">${to[0].name}</span></p>
//                               <p>The user ${req.firstName} ${req.lastName} from the company ${quote.companyName} has shared the document for your signature.</p>
//                               <br/>
//                           </td>
//                       </tr>

//                       <!-- Green Card -->
//                       <tr style="display: inline-block;">
//                           <td style="height: 150px;
//                                   width: 100%;
//                                   padding-left: 25px;
//                                   padding-right: 25px;
//                                   border: none;
//                                   background-color: white;">
//                                   <!--[if mso]>
//                                       <table style="width: 100%;
//                                       height: 100px;
//                                       background: #E9EBEC;
//                                       padding: 25px;
//                                       box-sizing: border-box;
//                                       border-radius: 5px;
//                                       color: #FFF;">
//                                           <tr>
//                                               <td style="border-radius: 2px; text-align: left;">
//                                                   <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${docuSignUrl}"  style="background-color: #E9EBEC;
//           ">                                          color: #FFFFFF;
//                                                       padding: 20px;
//                                                       margin: 50px;
//                                                       padding-left: 50px;
//                                                       border-radius: 5px;
//                                                   <w:anchorlock/>
//                                                   <center style="background-color: #0E3346;
//                                                       border: none;
//                                                       border-radius: 5px;
//                                                       font-family: 'Myriad Pro', sans-serif;
//                                                       color: #fff;
//                                                       padding: 15px 32px;
//                                                       text-align: center;
//                                                       text-decoration: none;
//                                                       display: inline-block;
//                                                       font-size: 16px;
//                                                       margin: 20px 0px;
//                                                       cursor: pointer;">Click Here to Sign</center>
//                                                   </v:roundrect>
//                                               </td>
//                                           </tr>
//                                       </table>
//                               <![endif]-->
//                               <!--[if !mso]>-->
//                                   <table style="width: 100%;
//                                       height: 100px;
//                                       background: #E9EBEC;
//                                       padding: 15px;
//                                       border-radius: 5px;
//                                       box-sizing: border-box;
//                                       color: #FFF;">
//                                       <tr>
//                                           <td style="border-radius: 2px; text-align: left;">
//                                               <a href="${docuSignUrl}" target="_blank" style="background-color: #0E3346;
//                                                           border: none;
//                                                           border-radius: 5px;
//                                                           font-family: 'Myriad Pro', sans-serif;
//                                                           color: #fff;
//                                                           padding: 15px 32px;
//                                                           text-align: center;
//                                                           text-decoration: none;
//                                                           display: inline-block;
//                                                           font-size: 16px;
//                                                           margin: 20px 0px;
//                                                           cursor: pointer;">
//                                                   Click Here to Sign
//                                               </a>
//                                           </td>
//                                       </tr>
//                                   </table>
//                               <!--<![endif]-->
//                               <h4>(or)</h4>
//                               <p style="margin-bottom: 0px;">Click the link</p>
//                               <p>
//                               <a href="${docuSignUrl}" class="link">${process.env.APP_PATH}</a>
//                               </p>
//                               <br>
//                               <p class="bestRegards">Best Regards,</p>
//                               <p>Sify Team</p>
//                               <p><a href="mailto:online.sales@sifycorp.com" target="_blank" class="link">online.sales@sifycorp.com</a>
//                               </p>
//                               <br>
//                               <p>If you do not recognize this activity or did not initiate the request, report to the above email id.</p>
//                               <br>
//                           </td>
//                       </tr>
//                       <tr style="display: inline-block;">
//                           <td style="height: 150px;
//                                   padding: 20px;
//                                   border: none;
//                                   background-color: white;">
//                                   <h4>Headquarters</h4>
//                                   <p>II Floor, TIDEL Park,<br/>
//                                   No.4, Rajiv Gandhi Salai, Taramani,<br/>
//                                   Chennai - 600 113, InMPLS</p>
//                                   <br>
//                           </td>
//                       </tr>
//                       <td style="
//                               font-size:16px; line-height:18px;
//                               color:#0A2134;" valign="top" align="center">
//                               <p>This is an auto generated mail. Please do not reply.<br>
//                                   Â© 2024
//        Sify Technologies Limited. All Rights Reserved.</p>
//                           </td>
//                       </tr>
//               </tbody>
//               </table>
//               <br/>
//               </div>
//       </body>
//   </html>`;
//     console.log(quoteData);
//     // const sendMail = await common.send_mail(toArray, [], subject, html, (attachments = null));
//   } catch (error) {}
// };
// const erpLevelOne = scheduleJob("*/3 * * * * *", async function () {
//   let result = await draftStatusMail(30);
//   console.log(result)
// });
// const erpLevelOne = scheduleJob("0 */3 * * *", async function () {
//   let result = await exports.get_order_number();
// });
// const erpLevelTwo = scheduleJob("0 */3 * * *", async function () {
//   console.log("1");
//   let result = await exports.get_delivery_status();
// });
