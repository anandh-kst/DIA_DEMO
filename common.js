const axios = require("axios");
const moment = require("moment");
const nodemailer = require("nodemailer");
const https = require("https");
const { default: mongoose } = require("mongoose");
const oracledb = require("oracledb");
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
      product: "ills",
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
    console.error("Error calling createOpportunity API:", error.response?.data || error.message);
    logger.error({ statusCode: 200, status: "Error", message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}` });
    await exports.errorLog({ stack: error.stack, message: `Error in opportunity API: ${apiUrl} payload: ${JSON.stringify(payload)}`, filter: "opportunity" }, reqId);
  }
};
exports.errorLog = async (error, reqId) => {
  await db.collection("networkerrorlogs").insertOne({
    reqId: reqId || 0,
    message: error.message || error,
    response: error.response || null,
    stack: error.stack,
    filter: error.filter,
    path: error?.path,
    product: "DIA",
  });
};
exports.multiple_create_feasibility = async (reqId, next) => {
  try {
    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const { partyId, partyNo, locationDetails, ebsAccountNo, companyName } = quote;
    if (locationDetails.length === 0) throw new Error("Please add links before submitting feasibility");

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
    for await (const data of locationDetails) {
      let { existingPlanDetails, locationId, reqBandwidth, provisionType, reqBandwidthUOM, connectionType, contactDetails, shippingAddress } = data;
      const isFiber = connectionType.toLocaleLowerCase() === "fiber";
      const isOtherISP = connectionType.toLocaleLowerCase() === "other isp";

      function isDecimalNumber(num) {
        return !isNaN(num) && num % 1 !== 0;
      }

      if (isDecimalNumber(reqBandwidth) && reqBandwidth < 1) {
        reqBandwidthUOM = "Kbps";
        reqBandwidth = Math.floor(reqBandwidth * 1000);
      }

      REQUESTS.push({
        LOCALLOOP_TYPE: isFiber ? "" : "Wireless",
        SIFYOFFNET_LL: isOtherISP ? "LL" : "",
        SIFYONNET_FIBER: isFiber ? "Fiber" : "",
        ORDER_STATUS: "Firm",
        CONT_NAME: `${contactDetails.contactFirstName} ${contactDetails.contactLastName}`,
        ADDRESS1: shippingAddress.address1,
        ADDRESS2: shippingAddress.address2,
        ADDRESS3: shippingAddress.address3 || "",
        CITY: shippingAddress.city.toUpperCase(),
        PIN: shippingAddress.pincode,
        PHONE1: contactDetails.contactPhoneNumber1,
        PHONE2: contactDetails.contactPhoneNumber2,
        EMAIL: contactDetails.contactEmail,
        LOCALLOOP_BW: reqBandwidth,
        LOCALLOOP_BW_TYPE: reqBandwidthUOM,
        PORT_BW: reqBandwidth,
        PORT_BW_TYPE: reqBandwidthUOM,
        PROVISION_TYPE: provisionType,
        LINK_ID: existingPlanDetails?.linkId || "",
        REFERENCE_NO: locationId,
        // INTERFACE_OUTPUT: "Fiber-Optical",
        // FEASIBLITY_STUDY: "Yes",
        // SPOKEN_NAME: "Sakthi",
        // SPOKEN_CONTNO: "9877788882",
        // SPOKEN_DATE: "27-02-2018",
        // POP_NAME: "KANCHIPURAM",
        // SIFYEND_ADDRESSA: "Railtel NOC  Southern Railway",
        // SIFYEND_ADDRESSB: "Kanchipuram Railway Station",
        // SIFYEND_ADDRESSC: "Kancheepuram",
        // SIFYEND_CITY: "Kanchipuram",
        // SIFYEND_PIN: "631501",
        // SIFYEND_PHONE1: "899988800",
        // SIFYEND_PHONE2: "899988811",
        // SIFYEND_EMAIL: "testPOP@sifycorp.com",
        // OFF_TERES: "BTNL1,TCL01",
        // FCF_OFF_BUILD_FLOORS: "3",
        // FCF_OFF_LOCATED: "LOCATION",
        // FCF_LATITUDE: "1000",
        // FCF_LONGITUDE: "1000",
      });
    }
    postData.REQUESTS = REQUESTS;
    console.log("Post Data:", postData);

    const createFeasibility = await axios.post(`${process.env.CREATE_FEASIBILITY}`, postData, config);
    if (!createFeasibility) throw new Error("Temporary service outage. Please try again later.");

    if (createFeasibility?.data?.WSstatus && createFeasibility.data.WSstatus === "Error") {
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
          },
          status,
        },
        {
          arrayFilters: [{ "elem.locationId": data.locationId }],
        }
      );

      const feasibilityIds = new FeasibilityIds({
        feasibilityId,
        serviceType: "DIA",
        status: "Pending",
      });
      const updateFeasibilityIds = await feasibilityIds.save();
      if (!updateFeasibilityIds) {
        throw new Error("Failed to insert");
      }
      if (!updateQuote) throw new Error("Feasibility Request Failed");
    }
    createOpportunity(reqId);
    return true;
  } catch (error) {
    next(error);
    return false;
  }
};
exports.create_feasibility = async (reqId, next) => {
  try {
    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const { partyId, partyNo, locationDetails, ebsAccountNo, quoteType, companyId, companyName, createdBy, parentRole, isBulkUpload, pageTracker } = quote;
    if (!locationDetails.length) throw new Error("Please add links before submitting feasibility");

    const config = {
      headers: { apikey: process.env.ERP_API_KEY },
    };

    if (parentRole === "CP + Customer") {
      console.log("Creating opportunity for CP + Customer");
      const opportunityDetails1 = await db.collection("opportunityDetails").findOne({ reqId: reqId })
      console.log("opportunityDetails1", opportunityDetails1);
      if (!opportunityDetails1) {
        await createOpportunity(reqId);
      }

      console.log("crpOpapi,", createOpportunity);
      const opportunityDetails2 = await db.collection("opportunityDetails").findOne({ reqId });
      if (opportunityDetails2) {
        const updateStatusFeab = await db.collection("opportunityDetails").findOneAndUpdate(
          { reqId },
          { $set: { status: "CHECKING FEASIBILITY" } }
        );
        console.log("updateStatusFeab", updateStatusFeab);
        if (!updateStatusFeab.value) throw new Error("Unable To Update Status");
      } else {
        console.error(`[create_feasibility] Opportunity not created for reqId ${reqId}.`);
        throw new Error("Opportunity creation failed");
      }
    }

    const checkFeas = [];
    for await (const data of locationDetails) {
      let { reqBandwidth, reqBandwidthUOM, connectionType, serviceProvider = null, contactDetails, shippingAddress, provisionType } = data;
      console.log("data", { reqBandwidth, reqBandwidthUOM, connectionType, serviceProvider, contactDetails, shippingAddress, provisionType });
      console.log(connectionType);
      if (data?.feasibilityId) continue; // Skip if feasibilityId already exists
      const type = connectionType?.toLowerCase()?.trim();

      const isFiber = type === "fiber" || type === "ethernet drop";
      const isOtherISP = type === "other isp";

      function isDecimalNumber(num) {
        return !isNaN(num) && num % 1 !== 0;
      }

      if (isDecimalNumber(reqBandwidth) && reqBandwidth < 1) {
        reqBandwidthUOM = "Kbps";
        reqBandwidth = Math.floor(reqBandwidth * 1000);
      }

      const createOpportunitydata = await loginDB.collection("companies").find({ companyName: quote.companyName }).toArray();
      let accountManager = createOpportunitydata[0]?.accountManager_name || "";

      const oscParty = await loginDB.collection("companies").find({ companyName: quote.companyName }).toArray();
      let oscpartyId = oscParty[0]?.oscpartyId || "";
      let partyId = oscParty[0]?.partyId || "";
      let partyNo = oscParty[0]?.partyNo || "";
      // console.log(oscParty)

      const opportunityDetails = await db.collection("opportunityDetails").findOne({ reqId: reqId });
      console.log("opportunityDetails", opportunityDetails);
      let opportunityId = opportunityDetails?.opportunityId || "";
      let opportunityNo = opportunityDetails?.opportunityNo || "";

      if (
        !shippingAddress.address1 ||
        !shippingAddress.address2 ||
        !shippingAddress.city ||
        !shippingAddress.pincode
      ) {
        const error = new Error(
          "ADDRESS1, ADDRESS2, CITY, and PIN are mandatory to create feasibility."
        );

        error.statusCode = 200;
        error.status = "Error";

        throw error;
      }
      const postData = {
        source: "DSP",
        method: "createFeasibility",
        ACCOUNT_MANAGER: accountManager,
        AM_USER_ID: 5895,
        AM_OSC_ID: 100000000289504,
        // PARTY_ID: 2508660,
        // PARTY_NUMBER: 958467,
        // OPPORTUNITY_ID: 2508660,
        // OPPORTUNITY_NUMBER: 2508660,
        PARTY_ID: partyId, //External API
        PARTY_NUMBER: partyNo, //External API
        OPPORTUNITY_ID: opportunityId || 300000663278698, //party id
        OPPORTUNITY_NUMBER: opportunityNo || "487341", //party id
        OPPORTUNITY_NAME: "DSP-OSP",
        OSC_PARTY_ID: oscpartyId,
        SALES_REMARK: "TEST REMARKS FROM OSP -- DSP",
        REQUESTER_CONTACT_NO: 9943441504,
        LOCALLOOP_TYPE: isFiber ? "" : "Wireless",
        SIFYONNET_FIBER: isFiber ? "Fiber" : "",
        SIFYOFFNET_LL: isOtherISP ? "LL" : "",
        ORDER_STATUS: "Firm",
        CUST_ADDR: `${shippingAddress.address1}, ${shippingAddress.address2}, ${shippingAddress.address3}`,
        CONT_NAME: `${contactDetails.contactFirstName} ${contactDetails.contactLastName}`,
        ADDRESS1: shippingAddress.address1,
        ADDRESS2: shippingAddress.address2,
        ADDRESS3: shippingAddress.address3 || "",
        CITY: shippingAddress.city.toUpperCase(),
        PIN: shippingAddress.pincode,
        PHONE1: contactDetails.contactPhoneNumber1,
        PHONE2: contactDetails.contactPhoneNumber2,
        EMAIL: contactDetails.contactEmail,
        LOCALLOOP_BW: reqBandwidth,
        LOCALLOOP_BW_TYPE: reqBandwidthUOM,
        PORT_BW: reqBandwidth,
        PORT_BW_TYPE: reqBandwidthUOM, //end new connection form
        PROVISION_TYPE: data.provisionType,
        LINK_ID: data.existingPlanDetails?.linkId || "",
        fcf_link_id: data.existingPlanDetails?.linkId || "",
        fcf_lastmile_change: "",
        fcf_address_change: "",
        fcf_bw_chang: quoteType === "modifyBandwidth" && isOtherISP ? provisionType.toLowerCase() : "",
        // FCF_OFF_BUILD_FLOORS: data.officeFloor || "",
        // FCF_OFF_LOCATED: data.totalFloor || "",
        // FCF_LATITUDE: data.latitude || "",
        // FCF_LONGITUDE: data.longitude || "",
      };
      console.log("Post Data:", postData);

      const createFeasibility = await axios.post(`${process.env.CREATE_FEASIBILITY}`, postData/* , config */ /* Production */);
      console.log("Create Feasibility Response:", createFeasibility.data);

      if (!createFeasibility) {
        throw new Error("Temporary service outage. Please try again later.");
      }

      if (createFeasibility?.data?.WSstatus || createFeasibility.data.WSstatus === "Error") {
        checkFeas.push("Not Feasible");
        // await Quote.findOneAndUpdate(
        //   { reqId },
        //   {
        //     status: "Not Feasible",
        //     feasibilityInitiatedDate: new Date(),
        //   }
        // );
        await exports.errorLog({ stack: createFeasibility?.data?.WSerror, message: `Error in feasibility API: ${process.env.CREATE_FEASIBILITY} payload: ${JSON.stringify(postData)}`, filter: "feasibility" }, reqId);
        logger.error({ statusCode: 200, status: "Error", message: `Error in feasibility API: ${process.env.CREATE_FEASIBILITY} payload: ${JSON.stringify(postData)}` });
        console.error("Error calling createFeasibility API:", createFeasibility?.data?.WSerror);
        throw new Error(createFeasibility?.data?.WSerror);
        // throw new Error("Temporary service outage. Please try again later.");
      }

      let feasibilityData;


      switch (type) {
        case "wireless":
          feasibilityData = createFeasibility.data.Wireless?.[0];
          break;
        case "fiber":
        case "ethernet drop":
          feasibilityData = createFeasibility.data.Fiber?.[0];
          break;
        default:
          {
            const offnetData = createFeasibility.data.Offnet;

            const str = serviceProvider;
            const match = str.match(/\[(.*?)\]/);

            offnetData.forEach((element) => {
              if (element["BSO"] === match[1]) {
                feasibilityData = element;
              }
            });
          }
          break;
      }

      if (!feasibilityData) throw new Error("Temporary service outage. Please try again later.");

      const { FEAS_OPT: feasibilityStatus, req_Status: feasibilityReqStatus, OPEX, CAPEX, TOWER_HEIGHT, TOWER_TYPE: mastType, CREATED_DATE: requestedDate, FEASIBILITY_ID: feasibilityId } = feasibilityData;

      const opex = isFiber ? parseInt(OPEX) : 0;
      const capex = isFiber ? parseInt(CAPEX) : 0;
      const mastHeight = isFiber ? parseInt(TOWER_HEIGHT) : parseInt(TOWER_HEIGHT || 0);

      const status = feasibilityStatus === "Pending" && feasibilityReqStatus === "2" ? "CHECKING FEASIBILITY" : feasibilityStatus;

      checkFeas.push(feasibilityStatus);
      // let opportunityId = null;
      const updateQuote = await Quote.findOneAndUpdate(
        { reqId },
        {
          $set: {
            "locationDetails.$[elem].towerPriceVerified": false,
            "locationDetails.$[elem].feasibilityId": feasibilityId,
            "locationDetails.$[elem].feasibilityStatus": status,
            "locationDetails.$[elem].cxmFeasibilityStatus": feasibilityStatus,
            "locationDetails.$[elem].feasibilityInitiatedDate": requestedDate,
            "locationDetails.$[elem].mastHeight": mastHeight,
            "locationDetails.$[elem].mastType": mastType,
            "locationDetails.$[elem].opex": opex,
            "locationDetails.$[elem].capex": capex,
            "locationDetails.$[elem].opportunityId": opportunityId,
          },
        },
        {
          arrayFilters: [{ "elem.locationId": data.locationId }],
        }
      );

      const feasibilityIds = new FeasibilityIds({
        feasibilityId,
        serviceType: "DIA",
        status: "Pending",
      });
      const updateFeasibilityIds = await feasibilityIds.save();
      console.log(updateFeasibilityIds);
      if (!updateFeasibilityIds) throw new Error("Failed to insert");

      if (!updateQuote) throw new Error("Temporary service outage. Please try again later.");
    }
    let quoteStatus;
    console.log("checkFeas", checkFeas);
    if (checkFeas.includes("Pending")) {
      quoteStatus = "CHECKING FEASIBILITY";
    } else if (checkFeas.includes("Not Feasible")) {
      quoteStatus = "Partially Feasible";
    } else {
      quoteStatus = "Feasible";
    }
    console.log(reqId, { status: quoteStatus, cxmCommonStatus: quoteStatus });
    const updateStatusFeab = await Quote.findOneAndUpdate(
      { reqId },
      {
        status: quoteStatus,
        cxmCommonStatus: quoteStatus,
      }
    );
    if (!updateStatusFeab) throw new Error("Unable To Update Status");

    return true;
  } catch (error) {
    next(error);
    return false;
  }
};
exports.update_feasibility = async (limit, page, companyId) => {
  // try {
  const skip = limit * (page - 1);
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
        console.log(quote.reqId);
        if (!updateFeasibility || updateFeasibility.data?.code) {
          console.log("Feasibility Request Failed");
        }
        const isFiberConnection = data.connectionType.toLowerCase() === "fiber";
        const feasibilityData = isFiberConnection ? updateFeasibility.data.Fiber[0] : updateFeasibility.data.Wireless[0];
        console.log(feasibilityData);
        if (!feasibilityData) {
          continue;
        }
        const { FEAS_OPT, req_Status, UPDATED_DATE, OPEX, CAPEX, TOWER_HEIGHT, BUILDING_HEIGHT, TOWER_TYPE, FEASIBILITY_ID } = feasibilityData;
        const feasibilityOpt = FEAS_OPT === "Pending" && req_Status === "2" ? "CHECKING FEASIBILITY" : FEAS_OPT;
        const payload = {
          fcfb_cxm_feasibility_status: FEAS_OPT,
          fcfb_wireless_option: feasibilityOpt,
          fcf_date_time: UPDATED_DATE,
          fcff_tot_opex: OPEX,
          fcff_tot_capex: CAPEX,
          fcfb_mast_height: TOWER_HEIGHT,
          fcfb_building_height: BUILDING_HEIGHT,
          fcfb_mast_type: TOWER_TYPE,
          fcf_feasibility_id: FEASIBILITY_ID,
        };
        console.log(payload);
        if (req_Status === "1") {
          const updateFeas = await axios.post(`https://onesifydemo.sifytechnologies.com/onesify/network/common/post_updated_feasibility`, payload, { httpsAgent });
          console.log(updateFeas);
        }
        // const { FEAS_OPT: feasibilityStatus, req_Status: feasibilityReqStatus, OPEX, CAPEX, TOWER_HEIGHT, TOWER_TYPE: mastType, UPDATED_DATE: feasibilityUpdatedDate } = feasibilityData;

        //   const opex = isFiberConnection ? parseInt(OPEX) : 0;
        //   const capex = isFiberConnection ? parseInt(CAPEX) : 0;
        //   const mastHeight = isFiberConnection ? parseInt(TOWER_HEIGHT) : parseInt(TOWER_HEIGHT) || 0;
        //   // console.log(feasibilityReqStatus)
        //   checkFeas.push(parseInt(feasibilityReqStatus) === 1 ? "Feasible" : feasibilityStatus);

        //   if (feasibilityStatus !== "Pending") {
        //     updateOperations.push({
        //       updateOne: {
        //         filter: {
        //           reqId: quote.reqId,
        //           "locationDetails.locationId": data.locationId,
        //         },
        //         update: {
        //           $set: {
        //             "locationDetails.$.feasibilityStatus": parseInt(feasibilityReqStatus) === 1 ? "Feasible" : "Not Feasible",
        //             "locationDetails.$.cxmFeasibilityStatus": feasibilityStatus,
        //             "locationDetails.$.feasibilityUpdatedDate": feasibilityUpdatedDate,
        //             "locationDetails.$.mastHeight": mastHeight,
        //             "locationDetails.$.mastType": mastType,
        //             "locationDetails.$.opex": opex,
        //             "locationDetails.$.capex": capex,
        //           },
        //         },
        //       },
        //     });
        //   }
        // }

        // let status = "CHECKING FEASIBILITY";
        // console.log(quote.reqId, checkFeas);
        // if (checkFeas.length !== 0) {
        //   if (checkFeas.every((status) => status === "Feasible")) {
        //     status = "Feasible";
        //   } else if (checkFeas.some((status) => status === "Feasible")) {
        //     status = "Partially Feasible";
        //   } else if (checkFeas.every((status) => status === "Pending")) {
        //     status = "CHECKING FEASIBILITY";
        //   } else if (checkFeas.every((status) => status === "Not Feasible")) {
        //     status = "Not Feasible";
        //   }
        //   console.log(status);
        //   const updateStatusFeab = await Quote.findOneAndUpdate({ reqId: quote.reqId }, { status: status });
        // }

        // if (updateOperations.length > 0) {
        //   const bulkWriteResult = await Quote.bulkWrite(updateOperations);

        //   if (bulkWriteResult.hasWriteErrors.length > 0) {
        //     throw "Error updating locationDetails";
        //   }
        // }
      }
    }
    // } catch (error) {
    //   next(error);
    //   return false;
    // }
  }
  return true;
};
exports.update_price = async (reqId, next) => {
  try {
    let ARC = 0;
    let OTC = 0;
    const quote = await Quote.findOne({ reqId });

    const updatePromises = quote.locationDetails.map(async (data) => {
      if (!data.isSelect) return;
      let totalARC = 0;
      let totalOTC = 0;

      if (data.basePlan && data.basePlan.length > 0) {
        data.basePlan.forEach((basePlan) => {
          ARC += basePlan.totalARC;
          OTC += basePlan.totalOTC;
          totalARC += basePlan.totalARC;
          totalOTC += basePlan.totalOTC;
        });
      }
      if (data.valueAddedService && data.valueAddedService.length > 0) {
        data.valueAddedService.forEach((valueAddedService) => {
          ARC += valueAddedService.arc;
          OTC += valueAddedService.otc;
          totalARC += valueAddedService.arc;
          totalOTC += valueAddedService.otc;
        });
      }

      return Quote.findOneAndUpdate(
        { reqId },
        {
          $set: {
            "locationDetails.$[elem].totalARC": totalARC,
            "locationDetails.$[elem].totalOTC": totalOTC,
          },
        },
        {
          arrayFilters: [{ "elem.locationId": data.locationId }],
        }
      );
    });

    await Promise.all(updatePromises);

    console.log(ARC, OTC);
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
  } catch (error) {
    next(error);
    return false;
  }
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

  if (!mailcredentials) {
    throw new Error("Mail credentials not found");
  }

  transporter = nodemailer.createTransport({
    host: mailcredentials.SMTP_Mail_Host,
    port: mailcredentials.SMTP_Mail_port,
    secure: false,
    auth: {
      user: mailcredentials.SMTP_TO_EMAIL,
      pass: mailcredentials.SMTP_TO_PASSWORD,
    },
    pool: true, // Connection pooling
    maxConnections: 10,
    maxMessages: 200,
    tls: {
      rejectUnauthorized: true,
    },
  });

  return transporter;
}
const delay = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, retries = 3) {
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
exports.send_mail = async (to, cc, subject, html, attachment) => {
  try {
    const bcc = ["anandhkstinfotech@gmail.com"];
    const [mailcredentials] = await db.collection("mailcredentials").find({}).toArray();
    if (!mailcredentials) {
      throw new Error("Mail credentials not found");
    }
    const transporter = await getTransporter();

    const mailOptions = {
      from: mailcredentials.SMTP_TO_EMAIL,
      to,
      cc,
      bcc,
      subject,
      html,
      ...(attachment ? { attachments: [attachment] } : {}),
    };

    const info = await retry(
      () => transporter.sendMail(mailOptions),
      3
    );
    return info;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

exports.sendMailUntilSuccess = async (reqId, to, cc, subject, html, attachment = null, maxRetries = 5, retryDelay = 3000, isOrderSignedMail = false) => {
  let attemptCount = 0;

  async function trySendingMail() {
    try {
      const isProd = process.env.ENVIRONMENT === "PRODUCTION";

      let bcc = isProd
        ? [
          "kiran.sudharsan@sifycorp.com",
          "murali.janakiraman@sifycorp.com",
          "yuvaraj.subramanian@sifycorp.com",
          "ragupathi.ravichandran@sifycorp.com",
          "gobala.manoharan@sifycorp.com",
          "sudhakar.mani@sifycorp.com"
        ]
        : ["kiran.sudharsan@sifycorp.com", "anandhkstinfotech@gmail.com"];

      if (isOrderSignedMail && isProd) {
        bcc.push("gomathi.sitaram@sifycorp.com");
      }

      const [mailcredentials] = await db.collection("mailcredentials").find({}).toArray();

      if (!mailcredentials) {
        throw new Error("Mail credentials not found");
      }

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
        await exports.errorLog({ stack: error.stack, message: `Error in sending mail for: ${subject}`, filter: "mail" }, reqId);
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
  console.log(status);
  const updateStatusFeab = await Quote.findOneAndUpdate({ reqId }, { $set: { status } });
  if (!updateStatusFeab) throw new Error("Unable To Update Status");
  // }
  return true;
};
exports.post_erp_order_new = async (reqId, next) => {
  // try {
  let headersField;
  let itemsField = [];
  const quote = await Quote.findOne({ reqId });
  let { locationDetails, rateCode, ebsAccountNo, quoteType, poRefNo, poDate, opportunityId } = quote;
  poDate = poDate.toUpperCase();

  const selectedLocationDetails = locationDetails.filter((item) => item.isSelect === true);
  let isNew = quoteType === "New";
  const contractPeriod = selectedLocationDetails[0]?.contractPeriod ?? 1;

  let linkId;

  const removeQuotes = async (str) => {
    return str ? str.replace(/['"]/g, "") : str;
  };

  let totalProductCount = 0;

  selectedLocationDetails.forEach((location) => {
    let result = [
      ...location.basePlan.flatMap((plan) => [
        {
          erpPlanName: "BANDWIDTH CHARGES",
          arc: plan.arc,
          otc: plan.otc,
          loopCount: ["link", "rc", "ot"],
          link: {
            INVENTORY_ITEM_ID: 931358,
            ITEM: "EXPRESSCONNECT",
            ITEM_DESCRIPTION: "Express Connect Internet",
          },
          rc: {
            INVENTORY_ITEM_ID: 813279,
            ITEM: "EXPRESSCONNECT-RC",
            ITEM_DESCRIPTION: "Recurring Charges for ExpressConnect Internet",
          },
          ot: {
            INVENTORY_ITEM_ID: 813292,
            ITEM: "EXPRESSCONNECT-OT",
            ITEM_DESCRIPTION: "Onetime Charges for ExpressConnect Internet",
          },
        },
        {
          erpPlanName: "LASTMILE",
          arc: "0.0",
          otc: "0.0",
          loopCount: ["rc", "ot"],
          link: { INVENTORY_ITEM_ID: 0, ITEM: "", ITEM_DESCRIPTION: "" },
          rc: {
            INVENTORY_ITEM_ID: 813272,
            ITEM: "LASTMILE-RC",
            ITEM_DESCRIPTION: "Lastmile Recurring Charges",
          },
          ot: {
            INVENTORY_ITEM_ID: 813271,
            ITEM: "LASTMILE-OT",
            ITEM_DESCRIPTION: "Lastmile Onetime Charges",
          },
        },
      ]),
      ...location.additionalPrice.flatMap((plan) => [
        {
          erpPlanName: "Sify RF",
          arc: plan.arc,
          otc: plan.otc,
          loopCount: ["rc", "ot"],
          link: { INVENTORY_ITEM_ID: 0, ITEM: "", ITEM_DESCRIPTION: "" },
          rc: {
            INVENTORY_ITEM_ID: 813275,
            ITEM: "TOWER-RC",
            ITEM_DESCRIPTION: "NCS Tower Recurring Charges",
          },
          ot: {
            INVENTORY_ITEM_ID: 813274,
            ITEM: "TOWER-OT",
            ITEM_DESCRIPTION: "Tower Onetime Charges",
          },
        },
      ]),
    ];

    if (location.valueAddedService?.length > 0) {
      let totalArc = 0;
      let totalOtc = 0;
      let hasBundledOrManaged = false;
      location.valueAddedService.forEach((plan) => {
        if (plan.serviceType === "bundled" || plan.serviceType === "managed") {
          hasBundledOrManaged = true;
          if (plan.arc) totalArc += plan.arc;
          if (plan.otc) totalOtc += plan.otc;
        }
      });

      if (hasBundledOrManaged) {
        result = result.concat({
          erpPlanName: "MCPE",
          arc: totalArc,
          otc: totalOtc,
          countPlus: true,
          loopCount: ["link", "rc", "ot"],
          link: { INVENTORY_ITEM_ID: 1144813, ITEM: "MCPE", ITEM_DESCRIPTION: "Managed CPE" },
          rc: { INVENTORY_ITEM_ID: 813273, ITEM: "MCPE-RC", ITEM_DESCRIPTION: "Recurring Charges for Managed CPE" },
          ot: { INVENTORY_ITEM_ID: 813290, ITEM: "MCPE-OT", ITEM_DESCRIPTION: "Onetime charges for Managed CPE" },
        });
      }

      result = result.concat(
        location.valueAddedService.flatMap((plan) => {
          if (plan.serviceType !== "bundled" || plan.serviceType !== "managed") {
            if (plan.serviceType === "ip") {
              return {
                erpPlanName: plan.name,
                arc: plan.arc,
                otc: plan.otc,
                countPlus: true,
                loopCount: ["link", "ot"],
                rc: { INVENTORY_ITEM_ID: 0, ITEM: "", ITEM_DESCRIPTION: "" },
                link: { INVENTORY_ITEM_ID: 1223188, ITEM: "ADDON-IP", ITEM_DESCRIPTION: "Reserved IP address allocated along with an Internet Link" },
                ot: { INVENTORY_ITEM_ID: 1224188, ITEM: "ADDON-IP-OT", ITEM_DESCRIPTION: "Onetime charges for Reserved IP address allocated along with an Internet Link" },
                ...plan,
              };
            }
            if (plan.serviceType === "ddos") {
              return {
                erpPlanName: plan.name,
                arc: plan.arc,
                otc: plan.otc,
                countPlus: true,
                loopCount: ["link", "rc", "ot"],
                link: { INVENTORY_ITEM_ID: 529949, ITEM: "MGD-NW-DDOS", ITEM_DESCRIPTION: "DDoS attack detection and mitigation" },
                rc: { INVENTORY_ITEM_ID: 529950, ITEM: "MGD-NW-DDOS-RC", ITEM_DESCRIPTION: "Recurring Charges for MGD-NW-DDOS" },
                ot: { INVENTORY_ITEM_ID: 529951, ITEM: "MGD-NW-DDOS-OT", ITEM_DESCRIPTION: "Onetime Charges for MGD-NW-DDOS" },
                ...plan,
              };
            }
            return [];
          }
        })
      );
    }
    console.log("result", result);
    location.productCount = result;

    location.productCountTotal = result.length;

    totalProductCount += result.length;
  });

  // console.log(selectedLocationDetails);
  console.log("Total Product Count for All Locations:", totalProductCount);

  let scodIdIncCount = totalProductCount * 3;
  console.log("scodIdIncCount", scodIdIncCount);
  selectedLocationDetails.forEach((data) => {
    data.productCount.forEach((product) => {
      if (product.erpPlanName === "LASTMILE" || product.erpPlanName === "Sify RF" || product.erpPlanName === "Additional IPs") {
        scodIdIncCount--;
      }
    });
  });

  console.log("scodIdIncCount", scodIdIncCount);
  const scodId = await reqID.findOneAndUpdate({ id: "scod_id" }, { $inc: { reqId: scodIdIncCount } });

  // const getDate = await axios.get(
  //   process.env.DATE_URL,
  //   {
  //     headers: {
  //       apikey: process.env.ERP_API_KEY,
  //     },
  //   },
  //   { httpsAgent }
  // );

  // let dateData = getDate.data.data.filter((item) => item.account_number === ebsAccountNo && item.price_sheet === rateCode);
  // console.log(reqId, "dateData", dateData);
  // let startDate = dateData[0]?.start_date || "01-04-2024";
  // let endDate = dateData[0]?.end_date || "31-03-2025";
  let startDate = "01-04-2025";
  let endDate = "31-03-2026";

  let SCOD_ID = scodId.reqId;
  let orderDate = moment().format("DD-MMM-YYYY");

  const companyDetails = await loginDB.collection("companies").findOne({ ebsaccountNo: ebsAccountNo });
  let accountManager = companyDetails?.accountManager_name || "GOMATHI.SITARAM";
  let erpDatas = companyDetails?.erpData || ""
  console.log("companyDetails", companyDetails)
  console.log("erpDatas", erpDatas)

  headersField = {
    ID: reqId,
    OPPORTUNITY_ID: opportunityId || 300000622710974,
    QUOTE_ID: "OSPILL-" + reqId,
    ORDER_TYPE: "Change",
    SCQH_REC_TYPE: "OM",
    ORDER_DATE: orderDate,
    BS_ID: "",
    CREATED_BY: accountManager,
    CREATED_DATE: orderDate,
    STATUS: "Y",
    ACCOUNT_NUMBER: ebsAccountNo,
    ACCOUNT_MANAGER: accountManager,
    CURRENCY: "INR",
    PO_NO: poRefNo,
    PO_DATE: poDate,
    NOTICE_PERIOD: erpDatas?.noticePeriod || "60 Days",
    CONTRACT_TYPE: "Fixed",
    CONTRACT_PERIOD: contractPeriod == 1 ? `${contractPeriod} Year` : `${contractPeriod} Years`,
    TRANSPOSE_FLAG: "Y",
    REMARKS: "",
    LEADBU: "DSP",
    IS_TELECOM: "true",
    IS_DC: "false",
    SITECODE: locationDetails[0].shippingAddress?.shipToERP?.stl?.siteCode || null, //ship to
    IS_CMS: "false",
    START_DATE: startDate,
    END_DATE: endDate,
  };

  let refID = [];
  let left = 0;
  for (let k = 0; k < selectedLocationDetails.length; k++) {
    const location = selectedLocationDetails[k];
    let { productCount, provisionType, connectionType, reqBandwidth, feasibilityId, reqBandwidthUOM, contractPeriod = 1, mastHeight, mastType, basePlan, billingAddress, shippingAddress } = location;

    billingAddress.billToLocation = billingAddress.billToERP?.stl?.siteCode || billingAddress?.siteCode;
    billingAddress.billTo = billingAddress.billToERP?.stl?.SITE_USE_ID || (billingAddress?.billToId ? billingAddress?.billToId : billingAddress?.billTo);

    shippingAddress.shipSiteCode = shippingAddress.shipToERP?.stl?.siteCode;
    shippingAddress.shipTo = shippingAddress.shipToERP?.stl?.SITE_USE_ID;

    left++;
    let right = 1;
    for (const [i, data] of productCount.entries()) {
      // for (let j = data.erpPlanName == "LASTMILE" ? 1 : data.erpPlanName == "Sify RF" ? 1 : data.erpPlanName == "Additional IPs" ? 1 : 0; j < 3; j++) {
      // console.log(data);
      console.log(data.countPlus);
      if (data.countPlus) {
        left++;
        right = 1;
      }
      for (let j = 0; j < data.loopCount.length; j++) {
        const element = data.loopCount[j];

        let link, OPG_CONTEXT, OPG_FORM_CONTEXT, SERVICE_REF_LINE_ID, INVENTORY_ITEM_ID, ITEM, ITEM_DESCRIPTION, LIST_PRICE, DISCOUNT, NET_PRICE, NET_AMOUNT, OPG_ATTRIBUTE36, OPG_ATTRIBUTE38, OPG_ATTRIBUTE39;

        switch (element) {
          case "link":
            link = "LINK";
            SERVICE_REF_LINE_ID = null;
            INVENTORY_ITEM_ID = data.link.INVENTORY_ITEM_ID;
            ITEM = data.link.ITEM;
            ITEM_DESCRIPTION = data.link.ITEM_DESCRIPTION;
            LIST_PRICE = "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = "0.0";
            NET_AMOUNT = "0.00";
            OPG_ATTRIBUTE36 = erpDatas?.billingPattenRC || "Quarterly in Advance";
            OPG_CONTEXT = "Express Connect Internet";
            OPG_FORM_CONTEXT = "Express Connect Internet";
            break;
          case "rc":
            link = "RC";
            SERVICE_REF_LINE_ID = data.erpPlanName == "LASTMILE" || data.erpPlanName == "Sify RF" ? refID[refID.length - 1] : SCOD_ID - 1;
            refID.push(SCOD_ID - 1);
            INVENTORY_ITEM_ID = data.rc.INVENTORY_ITEM_ID;
            ITEM = data.rc.ITEM;
            ITEM_DESCRIPTION = data.rc.ITEM_DESCRIPTION;
            LIST_PRICE = data.arc ? `${data?.arc}` : "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = data.arc ? `${data?.arc}` : "0.0";
            NET_AMOUNT = data.arc ? `${data?.arc}` : "0.0";
            OPG_ATTRIBUTE36 = erpDatas?.billingPattenRC || "Quarterly in Advance";
            OPG_CONTEXT = "Not Applicable";
            OPG_FORM_CONTEXT = "Not Applicable";
            break;
          case "ot":
            link = "OT";
            SERVICE_REF_LINE_ID = null;
            INVENTORY_ITEM_ID = data.ot.INVENTORY_ITEM_ID;
            ITEM = data.ot.ITEM;
            ITEM_DESCRIPTION = data.ot.ITEM_DESCRIPTION;
            LIST_PRICE = data.otc ? `${data?.otc}` : "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = data.otc ? `${data?.otc}` : "0.0";
            NET_AMOUNT = data.otc ? `${data?.otc}` : "0.0";
            OPG_ATTRIBUTE36 = erpDatas?.billingPattenOT || "100% in Advance";
            OPG_CONTEXT = "Onetime";
            OPG_FORM_CONTEXT = "Onetime";
            break;
        }

        let commonAttributes = {
          OPG_ATTRIBUTE1: "Primary",
          OPG_ATTRIBUTE2: `${reqBandwidth}`, // Unit of Measurement
          OPG_ATTRIBUTE3: `${reqBandwidthUOM}`, // Unit of Measurement Sify
          OPG_ATTRIBUTE4: `${connectionType}`, // RF , Fiber
          // OPG_ATTRIBUTE5: `L3`,
          OPG_ATTRIBUTE17: basePlan[0].planType === "Standard" ? reqBandwidth : null, //!
          OPG_ATTRIBUTE18: basePlan[0].planType === "Value" ? reqBandwidth : null,
          OPG_ATTRIBUTE19: basePlan[0].planType === "Premium" ? reqBandwidth : null,
          OPG_ATTRIBUTE7: null, //-- Contract period // 1 Year, 2 Years, 3 Years !
          OPG_ATTRIBUTE8: contractPeriod >= 1 ? "OPEN" : "FIXED", // order type fixed(1 year below) or open(1 year above)
          OPG_ATTRIBUTE47: contractPeriod,
          OPG_ATTRIBUTE20: `${contractPeriod} Year`, //-- contract period !
          OPG_ATTRIBUTE38: poRefNo, // PO Number
          OPG_ATTRIBUTE39: poDate, //-- PO Date
          OPG_ATTRIBUTE40: provisionType,
          OPG_ATTRIBUTE43: `Sify`, //sify, Not Applicable
          // OPG_ATTRIBUTE32: parseInt(linkId),
          // OPG_ATTRIBUTE15: 'Upgrade from 4 to 10 Mbps',
          OPG_ATTRIBUTE26: `${reqBandwidth} ${reqBandwidthUOM}`,
          OPG_ATTRIBUTE22: `${mastType}`, // Tower, Pole, Mast, Tripod !
          // OPG_ATTRIBUTE22: null, // Tower, Pole, Mast, Tripod !
          OPG_ATTRIBUTE23: "Sify", // Tower Owner
          OPG_ATTRIBUTE24: `${mastHeight}`, // Tower Height
          OPG_ATTRIBUTE25: "-", //fiber distance
          OPG_ATTRIBUTE28: "Sify",
          OPG_ATTRIBUTE48: basePlan[0].planType,
          OPG_ATTRIBUTE36: erpDatas?.billingPattenLink || "Quarterly in Arrears",
          OPG_ATTRIBUTE35: erpDatas?.noticePeriod || "60 Days", //-- Notice Period // 60 days
          OPG_ATTRIBUTE61: "100%", //-- 100% / 99%
        };
        let opgAttribute;
        // if (link == "RC" && data.erpPlanName !== "LASTMILE") {
        //   opgAttribute = {
        //     OPG_ATTRIBUTE38: poRefNo, // PO Number
        //     OPG_ATTRIBUTE39: poDate, //-- PO Date
        //   };
        // }
        if (link == "LINK") {
          opgAttribute = commonAttributes;
        }
        // if (link == "RC" && data.erpPlanName === "LASTMILE") {
        //   opgAttribute = {
        //     OPG_ATTRIBUTE38: poRefNo, // PO Number
        //     OPG_ATTRIBUTE39: poDate, //-- PO Date
        //     OPG_ATTRIBUTE36: "Quarterly in Arrears",
        //     OPG_ATTRIBUTE35: "60 Days", //-- Notice Period // 60 days
        //     OPG_ATTRIBUTE20: `${contractPeriod} Year`, //-- contract period
        //   };
        // }

        itemsField.push({
          ITEM_TYPE: link,
          SERVICE_REF_LINE_ID,
          INVENTORY_ITEM_ID,
          ITEM,
          ITEM_DESCRIPTION,
          QUANTITY: 1,
          LIST_PRICE,
          DISCOUNT,
          NET_PRICE,
          NET_AMOUNT,
          SCOD_ID: SCOD_ID++,
          SCQH_ID: reqId,
          SCLA_LINE_ID: parseFloat(left.toString() + "." + right.toString()),
          // SCLA_LINE_ID: parseFloat((i + 2 * k + 1).toString() + "." + (j + 1).toString()),
          SCLA_LINE_NO: left,
          SCLA_LINE_DEC: right,
          BATCH_ID: reqId,
          ORDER_TYPE: "STLIN_TS_DOM",
          CONTRACT_PERIOD: contractPeriod == 1 ? `${contractPeriod} Year` : `${contractPeriod} Years`,
          SHIP_SITE_CODE: shippingAddress.shipSiteCode,
          BILL_SITECODE: billingAddress.billToLocation,
          BILL_ADDRESS1: await removeQuotes(billingAddress.address1),
          BILL_ADDRESS2: await removeQuotes(billingAddress.address2),
          BILL_ADDRESS3: await removeQuotes(billingAddress.address3),
          BILL_CITY: billingAddress.city,
          BILL_STATE: billingAddress.state,
          BILL_REGION: "East",
          BILL_PIN: billingAddress.pincode || billingAddress.pinCode, //till this completed
          BILL_TO_ID: billingAddress.billTo,
          SHIP_TO_ID: shippingAddress.shipTo,
          SHIP_ADDRESS1: await removeQuotes(shippingAddress.address1),
          SHIP_ADDRESS2: await removeQuotes(shippingAddress.address2),
          SHIP_ADDRESS3: await removeQuotes(shippingAddress.address3),
          SHIP_CITY: shippingAddress.city,
          SHIP_STATE: shippingAddress.state,
          SHIP_REGION: "East",
          SHIP_PIN: shippingAddress.pincode,
          BU: "NULL",
          BUSINESS_LINE: "CMS",
          OPG_FORM_CONTEXT,
          OPG_CONTEXT,
          ACTIVITY: provisionType,
          ...(!isNew ? { LINK_ID: parseInt(linkId) } : {}),
          BILL_GST_NO: billingAddress.gstNo ? billingAddress.gstNo : "UNREGISTERED",
          SHIP_GST_NO: shippingAddress.shipToGst ? shippingAddress.shipToGst : "UNREGISTERED",
          ORG_ID: 82,
          FES_ID: feasibilityId,
          OPG_ATTRIBUTE8: contractPeriod >= 1 ? "OPEN" : "FIXED", // order type fixed(1 year below) or open(1 year above)
          OPG_ATTRIBUTE35: erpDatas?.noticePeriod || "60 Days", //-- Notice Period // 60 days
          OPG_ATTRIBUTE36: OPG_ATTRIBUTE36,
          OPG_ATTRIBUTE38: poRefNo, // PO Number
          OPG_ATTRIBUTE39: poDate, //-- PO Date
          ...opgAttribute,
          // OPG_ATTRIBUTE1: "Primary",
          // OPG_ATTRIBUTE2: reqBandwidth, // Unit of Measurement
          // OPG_ATTRIBUTE3: reqBandwidthUOM, // Unit of Measurement Sify
          // OPG_ATTRIBUTE4: `${connectionType}`, // RF , Fiber
          // OPG_ATTRIBUTE5: `L3`,
          // OPG_ATTRIBUTE19: reqBandwidth,
          // OPG_ATTRIBUTE7: `Fixed`, //-- Contract period // 1 Year, 2 Years, 3 Years
          // OPG_ATTRIBUTE8: contractPeriod == 1 ? `FIXED` : `OPEN`, // order type fixed(1 year below) or open(1 year above)
          // OPG_ATTRIBUTE38: poRefNo, // PO Number
          // OPG_ATTRIBUTE39: poDate, //-- PO Date
          // OPG_ATTRIBUTE47: contractPeriod,
          // OPG_ATTRIBUTE20: null, //-- contract period
          // OPG_ATTRIBUTE40: provisionType,
          // OPG_ATTRIBUTE41: "Mesh", // hub & Spoke , Mesh
          // OPG_ATTRIBUTE43: `Yes`,
          // OPG_ATTRIBUTE32: parseInt(linkId),
          // OPG_ATTRIBUTE15: 'Upgrade from 4 to 1k Mbps',
          // OPG_ATTRIBUTE26: `${reqBandwidth} ${reqBandwidthUOM}`,
          // OPG_ATTRIBUTE22: mastType, // Tower, Pole, Mast, Tripod
          // OPG_ATTRIBUTE23: "Sify", // Tower Owner
          // OPG_ATTRIBUTE24: `${mastHeight}`, // Tower Height
          // OPG_ATTRIBUTE25: "-", //
          // OPG_ATTRIBUTE28: "Sify",
          // OPG_ATTRIBUTE48: basePlan[0].planType, // Diamond, Gold, Silver
          // OPG_ATTRIBUTE36: "Monthly in advance", //-- Monthly in advance // refer Reference Key table (Green Color hightlighted)
          // OPG_ATTRIBUTE35: "60 Days", //-- Notice Period // 60 days
          // OPG_ATTRIBUTE61: "100%", //-- 100% / 99%
        });
        right++;
      }
    }
  }

  return { HEADER: headersField, ITEMS: itemsField };
  // } catch (error) {
  //   next(error);
  // }
};
exports.post_erp_order = async (reqId, next) => {
  // try {
  let headersField;
  let itemsField = [];
  const quote = await Quote.findOne({ reqId });
  let { locationDetails, rateCode, ebsAccountNo, quoteType, poRefNo, poDate, opportunityId } = quote;
  poDate = poDate.toUpperCase();

  const selectedLocationDetails = locationDetails.filter((item) => item.isSelect === true);
  let isNew = quoteType === "New";
  const contractPeriod = isNew ? selectedLocationDetails[0]?.contractPeriod ?? 1 : selectedLocationDetails[0]?.existingPlanDetails?.contractPeriod ?? 1;

  let linkId;

  const removeQuotes = async (str) => {
    return str ? str.replace(/['"]/g, "") : str;
  };

  let totalProductCount = 0;

  selectedLocationDetails.forEach((location) => {
    let result = [
      ...location.basePlan.flatMap((plan) => [
        {
          erpPlanName: "BANDWIDTH CHARGES",
          arc: plan.arc,
          otc: plan.otc,
          loopCount: ["link", "rc", "ot"],
          link: {
            INVENTORY_ITEM_ID: 931358,
            ITEM: "EXPRESSCONNECT",
            ITEM_DESCRIPTION: "Express Connect Internet",
          },
          rc: {
            INVENTORY_ITEM_ID: 813279,
            ITEM: "EXPRESSCONNECT-RC",
            ITEM_DESCRIPTION: "Recurring Charges for ExpressConnect Internet",
          },
          ot: {
            INVENTORY_ITEM_ID: 813292,
            ITEM: "EXPRESSCONNECT-OT",
            ITEM_DESCRIPTION: "Onetime Charges for ExpressConnect Internet",
          },
        },
        {
          erpPlanName: "LASTMILE",
          arc: "0.0",
          otc: "0.0",
          loopCount: ["rc", "ot"],
          link: { INVENTORY_ITEM_ID: 0, ITEM: "", ITEM_DESCRIPTION: "" },
          rc: {
            INVENTORY_ITEM_ID: 813272,
            ITEM: "LASTMILE-RC",
            ITEM_DESCRIPTION: "Lastmile Recurring Charges",
          },
          ot: {
            INVENTORY_ITEM_ID: 813271,
            ITEM: "LASTMILE-OT",
            ITEM_DESCRIPTION: "Lastmile Onetime Charges",
          },
        },
      ]),
      ...location.additionalPrice.flatMap((plan) => [
        {
          erpPlanName: "Sify RF",
          arc: plan.arc,
          otc: plan.otc,
          loopCount: ["rc", "ot"],
          link: { INVENTORY_ITEM_ID: 0, ITEM: "", ITEM_DESCRIPTION: "" },
          rc: {
            INVENTORY_ITEM_ID: 813275,
            ITEM: "TOWER-RC",
            ITEM_DESCRIPTION: "NCS Tower Recurring Charges",
          },
          ot: {
            INVENTORY_ITEM_ID: 813274,
            ITEM: "TOWER-OT",
            ITEM_DESCRIPTION: "Tower Onetime Charges",
          },
        },
      ]),
    ];

    if (location.valueAddedService?.length > 0) {
      let totalArc = 0;
      let totalOtc = 0;
      let hasBundledOrManaged = false;

      location.valueAddedService.forEach((plan) => {
        if (plan.serviceType === "bundled" || plan.serviceType === "managed") {
          hasBundledOrManaged = true;
          if (plan.arc) totalArc += plan.arc;
          if (plan.otc) totalOtc += plan.otc;
        }
      });
      if (hasBundledOrManaged) {
        result = result.concat({
          erpPlanName: "MCPE",
          arc: totalArc,
          otc: totalOtc,
          countPlus: true,
          loopCount: ["link", "rc", "ot"],
          link: { INVENTORY_ITEM_ID: 1144813, ITEM: "MCPE", ITEM_DESCRIPTION: "Managed CPE" },
          rc: { INVENTORY_ITEM_ID: 813273, ITEM: "MCPE-RC", ITEM_DESCRIPTION: "Recurring Charges for Managed CPE" },
          ot: { INVENTORY_ITEM_ID: 813290, ITEM: "MCPE-OT", ITEM_DESCRIPTION: "Onetime charges for Managed CPE" },
        });
      }

      result = result.concat(
        location.valueAddedService.flatMap((plan) => {
          if (plan.serviceType !== "bundled" || plan.serviceType !== "managed") {
            if (plan.serviceType === "ip") {
              return {
                erpPlanName: plan.name,
                arc: plan.arc,
                otc: plan.otc,
                countPlus: true,
                loopCount: ["link", "ot"],
                rc: { INVENTORY_ITEM_ID: 0, ITEM: "", ITEM_DESCRIPTION: "" },
                link: { INVENTORY_ITEM_ID: 1223188, ITEM: "ADDON-IP", ITEM_DESCRIPTION: "Reserved IP address allocated along with an Internet Link" },
                ot: { INVENTORY_ITEM_ID: 1224188, ITEM: "ADDON-IP-OT", ITEM_DESCRIPTION: "Onetime charges for Reserved IP address allocated along with an Internet Link" },
                ...plan,
              };
            }
            if (plan.serviceType === "ddos") {
              return {
                erpPlanName: plan.name,
                arc: plan.arc,
                otc: plan.otc,
                countPlus: true,
                loopCount: ["link", "rc", "ot"],
                link: { INVENTORY_ITEM_ID: 529949, ITEM: "MGD-NW-DDOS", ITEM_DESCRIPTION: "DDoS attack detection and mitigation" },
                rc: { INVENTORY_ITEM_ID: 529950, ITEM: "MGD-NW-DDOS-RC", ITEM_DESCRIPTION: "Recurring Charges for MGD-NW-DDOS" },
                ot: { INVENTORY_ITEM_ID: 529951, ITEM: "MGD-NW-DDOS-OT", ITEM_DESCRIPTION: "Onetime Charges for MGD-NW-DDOS" },
                ...plan,
              };
            }
            return [];
          }
        })
      );
    }

    location.productCount = result;

    location.productCountTotal = result.length;

    totalProductCount += result.length;
  });

  console.log(selectedLocationDetails);
  console.log("Total Product Count for All Locations:", totalProductCount);

  let scodIdIncCount = totalProductCount * 3;
  console.log("scodIdIncCount", scodIdIncCount);
  selectedLocationDetails.forEach((data) => {
    data.productCount.forEach((product) => {
      if (product.erpPlanName === "LASTMILE" || product.erpPlanName === "Sify RF" || product.erpPlanName === "Additional IPs") {
        scodIdIncCount--;
      }
    });
  });

  console.log("scodIdIncCount", scodIdIncCount);
  const scodId = await reqID.findOneAndUpdate({ id: "scod_id" }, { $inc: { reqId: scodIdIncCount } });

  // const getDate = await axios.get(
  //   process.env.DATE_URL,
  //   {
  //     headers: {
  //       apikey: process.env.ERP_API_KEY,
  //     },
  //   },
  //   { httpsAgent }
  // );

  // let dateData = getDate.data.data.filter((item) => item.account_number === ebsAccountNo && item.price_sheet === rateCode);
  // console.log(reqId, "dateData", dateData);
  // let startDate = dateData[0]?.start_date || "01-04-2024";
  // let endDate = dateData[0]?.end_date || "31-03-2025";
  let startDate = "01-04-2025";
  let endDate = "31-03-2026";

  let SCOD_ID = scodId.reqId;
  let orderDate = moment().format("DD-MMM-YYYY");

  const companyDetails = await loginDB.collection("companies").findOne({ ebsaccountNo: ebsAccountNo });
  let accountManager = companyDetails?.accountManager_name || "GOMATHI.SITARAM";
  let erpDatas = companyDetails?.erpData || ""
  console.log("companyDetails", companyDetails)
  console.log("erpDatas", erpDatas)

  headersField = {
    ID: reqId,
    OPPORTUNITY_ID: opportunityId || 300000622710974,
    QUOTE_ID: "OSPILL-" + reqId,
    ORDER_TYPE: "ORM",
    SCQH_REC_TYPE: "ORM",
    ORDER_DATE: orderDate,
    BS_ID: "",
    CREATED_BY: accountManager,
    CREATED_DATE: orderDate,
    STATUS: "Y",
    ACCOUNT_NUMBER: ebsAccountNo,
    ACCOUNT_MANAGER: accountManager,
    CURRENCY: "INR",
    PO_NO: poRefNo,
    PO_DATE: poDate,
    NOTICE_PERIOD: erpDatas?.noticePeriod || "60 Days",
    CONTRACT_TYPE: "Fixed",
    CONTRACT_PERIOD: contractPeriod == 1 ? `${contractPeriod} Year` : `${contractPeriod} Years`,
    TRANSPOSE_FLAG: "Y",
    REMARKS: "",
    LEADBU: "DSP",
    IS_TELECOM: "true",
    IS_DC: "false",
    SITECODE: locationDetails[0].shippingAddress?.shipToERP?.stl?.siteCode || null, //ship to
    IS_CMS: "false",
    START_DATE: startDate,
    END_DATE: endDate,
  };

  let refID = [];
  let left = 0;
  for (let k = 0; k < selectedLocationDetails.length; k++) {
    const location = selectedLocationDetails[k];
    const { existingPlanDetails } = location;
    let { productCount, provisionType, connectionType, reqBandwidth, feasibilityId, reqBandwidthUOM, contractPeriod = 1, mastHeight, mastType, basePlan, billingAddress, shippingAddress } = location;

    let erpProvisionType;
    switch (provisionType) {
      case "Upgrade":
        if (existingPlanDetails.connectionType === connectionType) {
          erpProvisionType = "Upgrade-Gross";
        } else erpProvisionType = "Shift-LastMile";
        break;
      case "Downgrade":
        if (existingPlanDetails.connectionType === connectionType) {
          erpProvisionType = "Downgrade";
        } else erpProvisionType = "Shift-LastMile";
        break;
      default:
        erpProvisionType = provisionType;
        break;
    }
    if (["modifyAddress", "modifyBandwidthAddress", "modifyBandwidth"].includes(quoteType)) {
      shippingAddress.shipSiteCode = shippingAddress.shipToERP?.stl?.siteCode || existingPlanDetails.shippingAddress?.shipToLocation;
      shippingAddress.shipTo = shippingAddress.shipToERP?.stl?.SITE_USE_ID || existingPlanDetails.shippingAddress?.shipTo;

      linkId = existingPlanDetails.linkId;
    }
    left++;
    let right = 1;
    for (const [i, data] of productCount.entries()) {
      // for (let j = data.erpPlanName == "LASTMILE" ? 1 : data.erpPlanName == "Sify RF" ? 1 : data.erpPlanName == "Additional IPs" ? 1 : 0; j < 3; j++) {
      // console.log(data);
      console.log(data.countPlus);
      if (data.countPlus) {
        left++;
        right = 1;
      }
      for (let j = 0; j < data.loopCount.length; j++) {
        const element = data.loopCount[j];

        let link, OPG_CONTEXT, OPG_FORM_CONTEXT, SERVICE_REF_LINE_ID, INVENTORY_ITEM_ID, ITEM, ITEM_DESCRIPTION, LIST_PRICE, DISCOUNT, NET_PRICE, NET_AMOUNT, OPG_ATTRIBUTE36, OPG_ATTRIBUTE38, OPG_ATTRIBUTE39;

        switch (element) {
          case "link":
            link = "LINK";
            SERVICE_REF_LINE_ID = null;
            INVENTORY_ITEM_ID = data.link.INVENTORY_ITEM_ID;
            ITEM = data.link.ITEM;
            ITEM_DESCRIPTION = data.link.ITEM_DESCRIPTION;
            LIST_PRICE = "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = "0.0";
            NET_AMOUNT = "0.00";
            OPG_ATTRIBUTE36 = erpDatas?.billingPattenLink || "Quarterly in Advance";
            OPG_CONTEXT = "Express Connect Internet";
            OPG_FORM_CONTEXT = "Express Connect Internet";
            break;
          case "rc":
            link = "RC";
            SERVICE_REF_LINE_ID = data.erpPlanName == "LASTMILE" || data.erpPlanName == "Sify RF" ? refID[refID.length - 1] : SCOD_ID - 1;
            refID.push(SCOD_ID - 1);
            INVENTORY_ITEM_ID = data.rc.INVENTORY_ITEM_ID;
            ITEM = data.rc.ITEM;
            ITEM_DESCRIPTION = data.rc.ITEM_DESCRIPTION;
            LIST_PRICE = data.arc ? `${data?.arc}` : "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = data.arc ? `${data?.arc}` : "0.0";
            NET_AMOUNT = data.arc ? `${data?.arc}` : "0.0";
            OPG_ATTRIBUTE36 = erpDatas?.billingPattenRC || "Quarterly in Advance";
            OPG_CONTEXT = "Express Connect Internet";
            OPG_FORM_CONTEXT = "Express Connect Internet";
            break;
          case "ot":
            link = "OT";
            SERVICE_REF_LINE_ID = null;
            INVENTORY_ITEM_ID = data.ot.INVENTORY_ITEM_ID;
            ITEM = data.ot.ITEM;
            ITEM_DESCRIPTION = data.ot.ITEM_DESCRIPTION;
            LIST_PRICE = data.otc ? `${data?.otc}` : "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = data.otc ? `${data?.otc}` : "0.0";
            NET_AMOUNT = data.otc ? `${data?.otc}` : "0.0";
            OPG_ATTRIBUTE36 = erpDatas?.billingPattenOT || "100% in Advance";
            OPG_CONTEXT = "Onetime";
            OPG_FORM_CONTEXT = "Onetime";
            break;
        }

        let commonAttributes = {
          OPG_ATTRIBUTE1: "Primary",
          OPG_ATTRIBUTE2: `${reqBandwidth}`, // Unit of Measurement
          OPG_ATTRIBUTE3: `${reqBandwidthUOM}`, // Unit of Measurement Sify
          OPG_ATTRIBUTE4: `${connectionType}`, // RF , Fiber
          // OPG_ATTRIBUTE5: `L3`,
          OPG_ATTRIBUTE17: basePlan[0].planType === "Standard" ? reqBandwidth : null, //!
          OPG_ATTRIBUTE18: basePlan[0].planType === "Value" ? reqBandwidth : null,
          OPG_ATTRIBUTE19: basePlan[0].planType === "Premium" ? reqBandwidth : null,
          OPG_ATTRIBUTE7: null, //-- Contract period // 1 Year, 2 Years, 3 Years !
          OPG_ATTRIBUTE8: contractPeriod >= 1 ? "OPEN" : "FIXED", // order type fixed(1 year below) or open(1 year above)
          OPG_ATTRIBUTE47: contractPeriod,
          OPG_ATTRIBUTE20: `${contractPeriod} Year`, //-- contract period !
          OPG_ATTRIBUTE38: poRefNo, // PO Number
          OPG_ATTRIBUTE39: poDate, //-- PO Date
          OPG_ATTRIBUTE40: erpProvisionType,
          OPG_ATTRIBUTE43: `Sify`, //sify, Not Applicable
          // OPG_ATTRIBUTE32: parseInt(linkId),
          // OPG_ATTRIBUTE15: 'Upgrade from 4 to 10 Mbps',
          OPG_ATTRIBUTE26: `${reqBandwidth} ${reqBandwidthUOM}`,
          OPG_ATTRIBUTE22: `${mastType}`, // Tower, Pole, Mast, Tripod !
          // OPG_ATTRIBUTE22: null, // Tower, Pole, Mast, Tripod !
          OPG_ATTRIBUTE23: "Sify", // Tower Owner
          OPG_ATTRIBUTE24: `${mastHeight}`, // Tower Height
          // OPG_ATTRIBUTE25: "-", //fiber distance
          OPG_ATTRIBUTE28: "Sify",
          OPG_ATTRIBUTE48: basePlan[0].planType,
          // OPG_ATTRIBUTE36: "Quarterly in Advance",
          OPG_ATTRIBUTE35: erpDatas?.noticePeriod || "60 Days", //-- Notice Period // 60 days
          OPG_ATTRIBUTE61: "100%", //-- 100% / 99%
        };
        let opgAttribute;
        if (link == "RC" && data.erpPlanName !== "LASTMILE") {
          opgAttribute = commonAttributes;
        }
        // if (link == "LINK") {
        //   opgAttribute = {
        //     OPG_ATTRIBUTE38: poRefNo, // PO Number
        //     OPG_ATTRIBUTE39: poDate, //-- PO Date
        //   };
        // }
        // if (link == "RC" && data.erpPlanName === "LASTMILE") {
        //   opgAttribute = {
        //     OPG_ATTRIBUTE8: contractPeriod == 1 ? `FIXED` : `OPEN`, // order type fixed(1 year below) or open(1 year above)
        //     OPG_ATTRIBUTE35: "60 Days", //-- Notice Period // 60 days
        //     OPG_ATTRIBUTE36: "Quarterly in Arrears",
        //     OPG_ATTRIBUTE38: poRefNo, // PO Number
        //     OPG_ATTRIBUTE39: poDate, //-- PO Date
        //   };
        // }

        itemsField.push({
          ITEM_TYPE: link,
          SERVICE_REF_LINE_ID,
          INVENTORY_ITEM_ID,
          ITEM,
          ITEM_DESCRIPTION,
          QUANTITY: 1,
          LIST_PRICE,
          DISCOUNT,
          NET_PRICE,
          NET_AMOUNT,
          SCOD_ID: SCOD_ID++,
          SCQH_ID: reqId,
          SCLA_LINE_ID: parseFloat(left.toString() + "." + right.toString()),
          SCLA_LINE_NO: left,
          SCLA_LINE_DEC: right,
          // SCLA_LINE_ID: parseFloat((i + 2 * k + 1).toString() + "." + (j + 1).toString()),
          // SCLA_LINE_NO: i + 2 * k + 1,
          // SCLA_LINE_DEC: j + 1,
          BATCH_ID: reqId,
          ORDER_TYPE: "STLIN_TS_DOM",
          CONTRACT_PERIOD: contractPeriod == 1 ? `${contractPeriod} Year` : `${contractPeriod} Years`,
          SHIP_SITE_CODE: shippingAddress.shipSiteCode,
          BILL_SITECODE: billingAddress.billToLocation,
          BILL_ADDRESS1: await removeQuotes(billingAddress.address1),
          BILL_ADDRESS2: await removeQuotes(billingAddress.address2),
          BILL_ADDRESS3: await removeQuotes(billingAddress.address3),
          BILL_CITY: billingAddress.city,
          BILL_STATE: billingAddress.state,
          BILL_REGION: "East",
          BILL_PIN: billingAddress.pincode || billingAddress.pinCode, //till this completed
          BILL_TO_ID: billingAddress.billTo,
          SHIP_TO_ID: shippingAddress.shipTo,
          SHIP_ADDRESS1: await removeQuotes(shippingAddress.address1),
          SHIP_ADDRESS2: await removeQuotes(shippingAddress.address2),
          SHIP_ADDRESS3: await removeQuotes(shippingAddress.address3),
          SHIP_CITY: shippingAddress.city,
          SHIP_STATE: shippingAddress.state,
          SHIP_REGION: "East",
          SHIP_PIN: shippingAddress.pincode,
          BU: "NULL",
          BUSINESS_LINE: "CMS",
          OPG_FORM_CONTEXT,
          OPG_CONTEXT,
          ACTIVITY: erpProvisionType,
          ...(!isNew ? { LINK_ID: parseInt(linkId) } : {}),
          BILL_GST_NO: billingAddress.gstNo ? billingAddress.gstNo : "UNREGISTERED",
          SHIP_GST_NO: shippingAddress.shipToGst ? shippingAddress.shipToGst : "UNREGISTERED",
          ORG_ID: 82,
          FES_ID: feasibilityId,
          OPG_ATTRIBUTE8: contractPeriod >= 1 ? "OPEN" : "FIXED", // order type fixed(1 year below) or open(1 year above)
          OPG_ATTRIBUTE35: erpDatas?.noticePeriod || "60 Days", //-- Notice Period // 60 days
          OPG_ATTRIBUTE36: OPG_ATTRIBUTE36,
          OPG_ATTRIBUTE38: poRefNo, // PO Number
          OPG_ATTRIBUTE39: poDate, //-- PO Date
          ...opgAttribute,
          // OPG_ATTRIBUTE1: "Primary",
          // OPG_ATTRIBUTE2: reqBandwidth, // Unit of Measurement
          // OPG_ATTRIBUTE3: reqBandwidthUOM, // Unit of Measurement Sify
          // OPG_ATTRIBUTE4: `${connectionType}`, // RF , Fiber
          // OPG_ATTRIBUTE5: `L3`,
          // OPG_ATTRIBUTE19: reqBandwidth,
          // OPG_ATTRIBUTE7: `Fixed`, //-- Contract period // 1 Year, 2 Years, 3 Years
          // OPG_ATTRIBUTE8: contractPeriod == 1 ? `FIXED` : `OPEN`, // order type fixed(1 year below) or open(1 year above)
          // OPG_ATTRIBUTE38: poRefNo, // PO Number
          // OPG_ATTRIBUTE39: poDate, //-- PO Date
          // OPG_ATTRIBUTE47: contractPeriod,
          // OPG_ATTRIBUTE20: null, //-- contract period
          // OPG_ATTRIBUTE40: provisionType,
          // OPG_ATTRIBUTE41: "Mesh", // hub & Spoke , Mesh
          // OPG_ATTRIBUTE43: `Yes`,
          // OPG_ATTRIBUTE32: parseInt(linkId),
          // OPG_ATTRIBUTE15: 'Upgrade from 4 to 1k Mbps',
          // OPG_ATTRIBUTE26: `${reqBandwidth} ${reqBandwidthUOM}`,
          // OPG_ATTRIBUTE22: mastType, // Tower, Pole, Mast, Tripod
          // OPG_ATTRIBUTE23: "Sify", // Tower Owner
          // OPG_ATTRIBUTE24: `${mastHeight}`, // Tower Height
          // OPG_ATTRIBUTE25: "-", //
          // OPG_ATTRIBUTE28: "Sify",
          // OPG_ATTRIBUTE48: basePlan[0].planType, // Diamond, Gold, Silver
          // OPG_ATTRIBUTE36: "Monthly in advance", //-- Monthly in advance // refer Reference Key table (Green Color hightlighted)
          // OPG_ATTRIBUTE35: "60 Days", //-- Notice Period // 60 days
          // OPG_ATTRIBUTE61: "100%", //-- 100% / 99%
        });
        right++;
      }
    }
  }

  return { HEADER: headersField, ITEMS: itemsField };
  // } catch (error) {
  //   next(error);
  // }
};
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

    const accounManager = await loginDB.collection("companies").find({ companyName: quote.companyName }).toArray();
    console.log("accounManager", accounManager);
    let accountManager_name = accounManager[0]?.accountManager_name || "";
    console.log("accountManager_name", accountManager_name);
    let accountManagerEmail = accounManager[0]?.accountManager_email || "";
    console.log("accountManagerEmail", accountManagerEmail);


    console.log("usermail", usermail)
    // let toArray = process.env.PLACED_MAILTO
    //   ? process.env.PLACED_MAILTO.split(",").map(m => m.trim())
    //   : [];

    if (usermail?.email && !toArray.includes(usermail.email)) {
      toArray.push(usermail.email);
    }

    if (accountManagerEmail && !toArray.includes(accountManagerEmail)) {
      toArray.push(accountManagerEmail);
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

    const subject = `DIA Order Confirmation Ã¢â‚¬â€œ Booking Number Generated (Request ID: ${reqId})`;
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
                      <p>Dear ${usermail.firstName} ${usermail.lastName} and ${accountManager_name},</p>

                      <p>
                        Greetings from <strong style="color:#0E3346;">Sify Technologies Limited</strong>.
                      </p>

                      <p>
                        We are pleased to inform you that your <strong>DIA service order</strong>
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
                        Ã‚Â© ${currentYear} Sify Technologies Limited. All Rights Reserved.
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
              soNumberUpdateDate: new Date(),
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
            { soNumber: data[0].ORDER_NUMBER, status: "Order Implemented", linkId: data[0].LINK_ID, soNumberUpdateDate: new Date() });
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

exports.post_erp_order_new_test = async (reqId, next) => {
  try {
    const quote = await Quote.findOne({ reqId }).lean();
    if (!quote) {
      throw new Error(`Quote with reqId: ${reqId} not found.`);
    }

    let {
      locationDetails,
      ebsAccountNo,
      poRefNo,
      poDate,
      opportunityId
    } = quote;

    poDate = poDate ? poDate.toUpperCase() : "";

    const selectedLocations = locationDetails.filter(l => l.isSelect);
    const contractPeriod = selectedLocations[0]?.contractPeriod || 1;
    const contractPeriodLabel =
      contractPeriod === 1 ? "1 Year" : `${contractPeriod} Years`;

    const companyDetails = await loginDB
      .collection("companies")
      .findOne({ ebsaccountNo: ebsAccountNo });

    const erpDatas = companyDetails?.erpData || {};
    const accountManager =
      companyDetails?.accountManager_name || "GOMATHI.SITARAM";

    const orderDate = moment().format("DD-MMM-YYYY");

    // ---------------- HEADER ----------------
    const HEADER = {
      ID: reqId,
      OPPORTUNITY_ID: opportunityId,
      QUOTE_ID: "OSPILL-" + reqId,
      ORDER_TYPE: "Change",
      SCQH_REC_TYPE: "OM",
      ORDER_DATE: orderDate,
      BS_ID: "",
      CREATED_BY: accountManager,
      CREATED_DATE: orderDate,
      STATUS: "Y",
      ACCOUNT_NUMBER: ebsAccountNo,
      ACCOUNT_MANAGER: accountManager,
      CURRENCY: "INR",
      PO_NO: poRefNo,
      PO_DATE: poDate,
      NOTICE_PERIOD: erpDatas?.noticePeriod || "60 Days",
      CONTRACT_TYPE: "Fixed",
      TRANSPOSE_FLAG: "Y",
      CONTRACT_PERIOD: contractPeriodLabel,
      REMARKS: "",
      LEADBU: "DSP",
      IS_TELECOM: "true",
      IS_DC: "false",
      IS_CMS: "false",
      SITECODE:
        selectedLocations[0]?.shippingAddress?.shipToERP?.stl?.siteCode || null,
      START_DATE: "01-04-2025",
      END_DATE: "31-03-2026"
    };

    // ---------------- ITEMS ----------------
    let ITEMS = [];

    let SCOD_ID = (
      await reqID.findOneAndUpdate(
        { id: "scod_id" },
        { $inc: { reqId: 100 } }
      )
    ).reqId;

    let lineNo = 1;

    for (const location of selectedLocations) {
      const {
        basePlan,
        valueAddedService,
        reqBandwidth,
        reqBandwidthUOM,
        connectionType,
        feasibilityId,
        provisionType,
        billingAddress,
        shippingAddress,
        mastHeight,
        mastType
      } = location;

      const clean = (str) => (str ? str.replace(/['"]/g, "") : str);
      const getValueAddedService = (...matchers) =>
        valueAddedService?.find((service) =>
          matchers.some((matcher) =>
            typeof matcher === "function"
              ? matcher(service)
              : service?.erpPlanName === matcher
          )
        );

      const billTo =
        billingAddress.billToERP?.stl?.SITE_USE_ID ||
        billingAddress?.billToId ||
        billingAddress?.billTo ||
        null;
      const billSite =
        billingAddress.billToERP?.stl?.siteCode ||
        billingAddress?.siteCode ||
        null;

      const shipTo =
        shippingAddress.shipToERP?.stl?.SITE_USE_ID ||
        shippingAddress?.shipTo ||
        null;
      const shipSite =
        shippingAddress.shipToERP?.stl?.siteCode ||
        shippingAddress?.siteCode ||
        null;

      let products = [];

      const plan = basePlan[0];

      // EXPRESSCONNECT
      products.push({
        name: "EXPRESSCONNECT",
        type: "Telcom",
        arc: plan.arc,
        otc: plan.otc,
        org: 82,
        parent: "P",
        orderType: "STLIN_TS_DOM",
        formContext: "Express Connect Internet",
        planType: plan.planType,
        category: "internet",
        items: {
          link: { id: 931358, name: "EXPRESSCONNECT" },
          rc: { id: 813279, name: "EXPRESSCONNECT-RC" },
          ot: { id: 813292, name: "EXPRESSCONNECT-OT" }
        }
      });

      // MCPE
      let mcpeArc = 0,
        mcpeOtc = 0;

      valueAddedService?.forEach((v) => {
        if (v.serviceType === "bundled" || v.serviceType === "managed") {
          mcpeArc += v.arc || 0;
          mcpeOtc += v.otc || 0;
        }
      });

      if (mcpeArc || mcpeOtc) {
        products.push({
          name: "MCPE",
          type: "CMS",
          arc: mcpeArc,
          otc: mcpeOtc,
          org: 425,
          parent: "C",
          orderType: "SDSIN_NCS",
          formContext: "MCPE",
          category: "mcpe",
          items: {
            link: { id: 1144813, name: "MCPE" },
            rc: { id: 813273, name: "MCPE-RC" },
            ot: { id: 813290, name: "MCPE-OT" }
          }
        });
      }

      // -------- BUILD ITEMS --------
      for (const product of products) {
        let sub = 1;
        let linkId = null;

        for (const type of ["link", "rc", "ot"]) {
          let itemData = product.items[type];
          let amount =
            type === "rc" ? product.arc : type === "ot" ? product.otc : 0;

          const currentId = SCOD_ID++;
          if (type === "link") linkId = currentId;

          let extraAttributes = {};

          if (type === "link") {
            if (product.category === "mcpe") {
              const mcpeService =
                getValueAddedService("MCPE", (service) =>
                  ["bundled", "managed"].includes(service?.serviceType)
                ) || {};

              extraAttributes = {
                OPG_ATTRIBUTE7:
                  mcpeService.serviceType === "bundled"
                    ? "Bundled"
                    : mcpeService.serviceType === "managed"
                      ? "Managed"
                      : null,
                OPG_ATTRIBUTE11: "Router",
                OPG_ATTRIBUTE13: mcpeService.model || mcpeService.partCode || null,
                OPG_ATTRIBUTE32: null,
                OPG_ATTRIBUTE47: contractPeriodLabel,
                OPG_ATTRIBUTE40: provisionType,
                OPG_ATTRIBUTE8: "OPEN",
                OPG_ATTRIBUTE35: erpDatas?.noticePeriod || "60 Days",
                OPG_ATTRIBUTE36:
                  erpDatas?.billingPattenRC || "Quarterly in Advance",
                OPG_ATTRIBUTE38: poRefNo,
                OPG_ATTRIBUTE39: poDate
              };
            } else {
              extraAttributes = {
                OPG_ATTRIBUTE1: "Primary",
                OPG_ATTRIBUTE2: `${reqBandwidth}`,
                OPG_ATTRIBUTE3: `${reqBandwidthUOM}`,
                OPG_ATTRIBUTE4: `${connectionType}`,
                OPG_ATTRIBUTE17: null,
                OPG_ATTRIBUTE18:
                  product.planType === "Value" ? reqBandwidth : null,
                OPG_ATTRIBUTE19: null,
                OPG_ATTRIBUTE7: null,
                OPG_ATTRIBUTE8: "OPEN",
                OPG_ATTRIBUTE47: contractPeriod,
                OPG_ATTRIBUTE20: contractPeriodLabel,
                OPG_ATTRIBUTE38: poRefNo,
                OPG_ATTRIBUTE39: poDate,
                OPG_ATTRIBUTE40: provisionType,
                OPG_ATTRIBUTE43: "Sify",
                OPG_ATTRIBUTE26: `${reqBandwidth} ${reqBandwidthUOM}`,
                OPG_ATTRIBUTE22: mastType || "-",
                OPG_ATTRIBUTE23: "Sify",
                OPG_ATTRIBUTE24: `${mastHeight || 0}`,
                OPG_ATTRIBUTE25: "-",
                OPG_ATTRIBUTE28: "Sify",
                OPG_ATTRIBUTE48: product.planType,
                OPG_ATTRIBUTE36:
                  erpDatas?.billingPattenRC || "Quarterly in Advance",
                OPG_ATTRIBUTE35:
                  erpDatas?.noticePeriod || "60 Days",
                OPG_ATTRIBUTE61: "100%"
              };
            }
          } else {
            extraAttributes = {
              OPG_ATTRIBUTE38: poRefNo,
              OPG_ATTRIBUTE39: poDate,
              OPG_ATTRIBUTE8: "OPEN",
              OPG_ATTRIBUTE36:
                type === "ot"
                  ? erpDatas?.billingPattenOT || "100% in Advance"
                  : erpDatas?.billingPattenRC ||
                  "Quarterly in Advance",
              OPG_ATTRIBUTE35:
                erpDatas?.noticePeriod || "60 Days"
            };
          }

          ITEMS.push({
            SCOD_ID: currentId,
            SCQH_ID: reqId,
            SCLA_LINE_ID: `${lineNo}.${sub}`,
            ITEM_TYPE: type.toUpperCase(),
            SCLA_LINE_NO: lineNo,
            SCLA_LINE_DEC: sub,
            BATCH_ID: reqId,
            INVENTORY_ITEM_ID: itemData.id,
            ITEM: itemData.name,
            ITEM_DESCRIPTION:
              type === "link"
                ? product.formContext === "MCPE"
                  ? "Managed CPE"
                  : "Express Connect Internet"
                : type === "rc"
                  ? product.name === "MCPE"
                    ? "Recurring Charges for Managed CPE"
                    : "Recurring Charges for ExpressConnect Internet"
                  : product.name === "MCPE"
                    ? "Onetime charges for Managed CPE"
                    : "Onetime Charges for ExpressConnect Internet",
            UOM: type === "rc" ? "Days" : "Each",
            QUANTITY: 1,
            LIST_PRICE: amount,
            DISCOUNT: 0,
            NET_PRICE: amount,
            NET_AMOUNT: amount,
            ORDER_TYPE: product.orderType,
            SERVICE_REF_LINE_ID: type === "rc" ? linkId : null,
            CONTRACT_PERIOD: contractPeriodLabel,
            SHIP_SITE_CODE: shipSite,
            BILL_SITECODE: billSite,
            BILL_ADDRESS1: clean(billingAddress.address1),
            BILL_ADDRESS2: clean(billingAddress.address2),
            BILL_ADDRESS3: "",
            BILL_CITY: billingAddress.city,
            BILL_STATE: billingAddress.state,
            BILL_REGION: "East",
            BILL_PIN: billingAddress.pinCode,
            BILL_TO_ID: billTo,
            SHIP_TO_ID: shipTo,
            SHIP_ADDRESS1: clean(shippingAddress.address1),
            SHIP_ADDRESS2: clean(shippingAddress.address2),
            SHIP_ADDRESS3: "",
            SHIP_CITY: shippingAddress.city,
            SHIP_STATE: shippingAddress.state,
            SHIP_REGION: "East",
            SHIP_PIN: shippingAddress.pincode,
            BU: "NULL",
            BUSINESS_LINE: product.type,
            OPG_FORM_CONTEXT:
              type === "link"
                ? product.formContext
                : type === "rc"
                  ? "Not Applicable"
                  : "Onetime",
            ACTIVITY: provisionType,
            OPG_CONTEXT:
              type === "link"
                ? product.formContext
                : type === "rc"
                  ? "Not Applicable"
                  : "Onetime",
            BILL_GST_NO: billingAddress.gstNo || "UNREGISTERED",
            SHIP_GST_NO: shippingAddress.shipToGst || "UNREGISTERED",
            ORG_ID: product.org,
            FES_ID: feasibilityId,
            PARENT_CHILD_FLAG: product.parent,
            ...extraAttributes
          });

          sub++;
        }

        lineNo++;
      }
    }

    return { HEADER, ITEMS };
  } catch (err) {
    next(err);
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
exports.updateOpportunity = async (reqId) => {
  let { status, pageTracker } = await Quote.findOne({ reqId });

  pageTracker = pageTracker !== undefined ? pageTracker : null;
  await db.collection("opportunityDetails").findOneAndUpdate(
    { reqId },
    {
      $set: {
        status,
        pageTracker,
        updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ"),
      },
    }
  );
};

// const exportExcel = scheduleJob("0 5 * * *", async function () {
//   let dateTime = new Date();
//   dateTime.setDate(dateTime.getDate() - 1);
//   let previousDate = dateTime.toISOString().slice(0, 10);
//   console.log(previousDate);

//   // let buffer = await axios.post(`https://192.168.2.125:4009/onesify/network/common/get_export_excel`, {}, { responseType: "arraybuffer" });
//   let buffer = await axios.post(`${process.env.APP_PATH}/onesify/network/common/get_export_excel`, {}, { responseType: "arraybuffer" });
//   console.log("result", buffer.data);

//   const decodedString = buffer.data.toString();

//   let data;
//   try {
//     data = JSON.parse(decodedString);
//     if (data.status === "Error") {
//       return;
//     }
//   } catch (error) {
//     console.error("Invalid JSON:", error);
//   }

//   const toArray = ["technical@kstinfotech.com"];
//   const subject = `One Sify (OSP) DIA Report for ${previousDate}`;
//   const html = `<div style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747;font-family:'Myriad Pro', sans-serif" width="100%">
//       <p><span style="font-size: 16px; color: #0E3346;">Dear One Sify Admin</span></p>
//       <p>Please see the attached file for the daily DIA report from one sify portal.</p>
//       <br/>
//       </div>`;
//   const attachment = {
//     filename: `DIA-${previousDate}.xlsx`,
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
//                                   Chennai - 600 113, India</p>
//                                   <br>
//                           </td>
//                       </tr>
//                       <td style="
//                               font-size:16px; line-height:18px;
//                               color:#0A2134;" valign="top" align="center">
//                               <p>This is an auto generated mail. Please do not reply.<br>
//                                   Ã‚Â© 2024
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
