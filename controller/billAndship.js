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
    if (!reqId || !locationId) throw new Error("Missing required parameters: reqId or locationId.");

    const quote = await Quote.findOne({ reqId }).lean();
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);
    const { ebsAccountNo, companyName } = quote;

    // send_po_mail(reqId, quote);

    const opportunitypropect = await loginDB.collection("companies").find({ companyName: companyName }).toArray();
    const hasebsAccountNo = !!opportunitypropect[0].ebsaccountNo;

    const headers = {
      username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
      password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
      // apikey: process.env.ERP_API_KEY,
    };

    const getShipToAddress = async () => {
      const matchingLocation = await quote.locationDetails.find((value) => value.locationId === locationId);
      return matchingLocation.shippingAddress;
    };
    const getShipToStates = async () => {
      const apiUrl = `${process.env.GET_STATE}n_customer_no=${ebsAccountNo}&v_site_use_code=BILL_TO&n_org_id=425`;
      try {
        const response = await axios.get(apiUrl, { headers }, { httpsAgent });
        if (response.data.STATUS !== "S") {
          await common.errorLog({ stack: response?.data, message: `Error in ERP Address API: ${apiUrl} payload: ${JSON.stringify(headers)}`, filter: "ERPAddress" }, reqId);
          logger.error({ statusCode: 200, status: "Error", message: `Error in ERP Address API: ${apiUrl} payload: ${JSON.stringify(headers)}` });
          console.error("Error calling getShipToStates API:", response?.data);

          // throw new Error("Temporary service outage. Please try again later.");
          return [];
        }
        return response.data.n_address.map(({ SERVICES, PRIMARY_FLAG, ...state }) => state);
      } catch (error) {
        return [];
      }
    };

    const shipTo = await getShipToAddress();
    if (!shipTo?.state) throw new Error("locationId is missing in reqId");

    const stateList = hasebsAccountNo ? await getShipToStates() : [];
    // const gstdetails = await Gstdetails.findOne({ companyId: req.companyId, companyName: req.companyName, state: shipTo.state.toUpperCase() });

    res.send({
      status: "Success",
      shipTo,
      stateList,
    });
  } catch (err) {
    console.log(err);
    next(err);
  }
};
exports.get_address_list = async (req, res, next) => {
  try {
    const { reqId, locationId, stateName } = req.body;
    if (!reqId || !stateName) throw new Error("Missing required parameters: reqId or stateName.");

    const headers = {
      username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
      password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
      // apikey: process.env.ERP_API_KEY,
    };

    const quote = await Quote.findOne({ reqId });
    const { ebsAccountNo } = quote;
    const locationDetails = quote.locationDetails.find((item) => item.locationId === locationId);
    const { valueAddedService } = locationDetails;

    let hasManaged = valueAddedService?.some((data) => data.serviceType === "bundled" || data.serviceType === "managed");

    const apiUrl = `${process.env.GET_ADDRESS}n_customer_no=${ebsAccountNo}&v_site_use_code=BILL_TO&n_org_id=82&v_state=${stateName}`;
    const billToResponse = await axios.get(apiUrl, { headers }, { httpsAgent });

    if (billToResponse.data.STATUS !== "S") {
      await common.errorLog({ stack: billToResponse?.data, message: `Error in ERP Address API: ${apiUrl} payload: ${JSON.stringify(headers)}`, filter: "ERPAddress" }, reqId);
      logger.error({ statusCode: 200, status: "Error", message: `Error in ERP Address API: ${apiUrl} payload: ${JSON.stringify(headers)}` });
      console.error("Error calling getAddressList API:", billToResponse?.data);
      throw new Error("Temporary service outage. Please try again later.");
    }

    for await (const e of billToResponse.data.n_address) {
      delete e.SERVICES;
      delete e.PRIMARY_FLAG;
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({
      status: "Success",
      billTo: billToResponse.data.n_address,
    });
  } catch (err) {
    next(err);
  }
};
exports.post_new_address = async (req, res, next) => {
  let oracleDb;
  try {
    oracleDb = await common.getOracleDb();
    let { reqId, locationId, sameBillToForAll, shipToGst, hasShipToGst, billingAddress } = req.body;
    if (!reqId) throw new Error("Missing required parameters");
    if (Object.keys(billingAddress).length === 0) throw new Error("Billing Address is required");

    let { shipToERP, billToERP, matchingShipTo = { stl: [], sds: [] }, matchingBillTo = { stl: [], sds: [] } } = {};

    const quote = await Quote.findOne({ reqId });
    let { ebsAccountNo, quoteType, locationDetails } = quote;

    locationDetails = locationDetails.find((item) => item.locationId === locationId);
    let { valueAddedService, shippingAddress, postShipToERP = false } = locationDetails;

    let hasManaged = valueAddedService?.some((data) => data.serviceType === "bundled" || data.serviceType === "managed");
    shippingAddress.gstNo = shipToGst;

    const opportunitypropect = await loginDB.collection("companies").find({ companyName: quote.companyName }).toArray();
    const hasebsAccountNo = !!opportunitypropect[0].ebsaccountNo;
    const buildBillToAddress = (addr) => {
      return [
        addr.address1,
        addr.address2,
        addr.address3,
        addr.city,
        addr.state,
        addr.pincode
      ].filter(Boolean).join(" ").trim();
    };

    const findExistingShipTo = async (accountNumber, addr) => {
      const sql = `
     SELECT 
      SITE_USE_ID,
      SITE_CODE
    FROM SIFY_CPQ_CUST_ADDRESS_V@BI2APPS
    WHERE ORG_ID = 82
      AND SITE_USE_CODE = 'SHIP_TO'
      AND ACCOUNT_NUMBER = :accountNumber

      AND REGEXP_REPLACE(
            UPPER(
              NVL(ADDRESS1,'') || NVL(ADDRESS2,'') || NVL(ADDRESS3,'')
            ),
            '[^A-Z0-9]',
            ''
          )
      LIKE '%' ||
          REGEXP_REPLACE(
            UPPER(
              NVL(:address1,'') || NVL(:address2,'') || NVL(:address3,'')
            ),
            '[^A-Z0-9]',
            ''
          )
      || '%'
  `;
      const bind = {
        accountNumber,
        address1: addr.address1 || "",
        address2: addr.address2 || "",
        address3: addr.address3 || "",
      };

      const result = await oracleDb.execute(sql, bind);

      console.log("🔎 ERP Address Search Input:", bind);
      console.log("🔎 ERP Matching Rows:", result.rows);

      return result.rows;
    };




    if (!opportunitypropect[0].ebsaccountNo) {
      const result = await Quote.findOneAndUpdate(
        { reqId },
        {
          pageTracker: "billAndShip",
          $set: {
            "locationDetails.$[elem].shippingAddress.shipToGst": shipToGst,
            "locationDetails.$[elem].shippingAddress.hasShipToGst": hasShipToGst,
            // "locationDetails.$[elem].shippingAddress.shipToERP": shipToERP,
            // "locationDetails.$[elem].shippingAddress.postShipToERP": postShipToERP,
            "locationDetails.$[elem].billingAddress": { ...billingAddress } || null,
          },
        },
        {
          arrayFilters: [{ "elem.locationId": locationId }],
        }
      );

      await updateOpportunity(reqId);
      res.send({ status: "Success" });
      return;
    }

    const headers = {
      username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
      password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
    };

    const generateSiteCode = async (city) => {
      const autoCode = crypto.randomBytes(4).toString("hex");
      let siteCode = city.toUpperCase() + "-" + autoCode.toUpperCase();
      return siteCode;
    };

    const postAddressToERP = async (orgId, data, type) => {
      const siteCode = await generateSiteCode(data.city);
      let postData = {
        ACCOUNT_NUMBER: ebsAccountNo,
        SITE_CODE: siteCode,
        ADDRESS1: data.address1,
        ADDRESS2: data.address2 || "",
        ADDRESS3: data.address3 || "",
        ADDRESS4: "",
        CITY: data.city,
        STATE: data.state,
        POSTAL_CODE: data.pincode || data.pinCode,
        SITE_USE_CODE: type,
        ORG_ID: orgId,
        GST_NO: data.gstNo || "UNREGISTERED",
        COUNTRY_CODE: "IN",
      };
      console.log("postData", postData);
      const postAddress = await axios({
        method: "post",
        url: process.env.CREATE_ADDRESS,
        headers: {
          apikey: process.env.ERP_API_KEY,
          username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
          password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
          "Content-Type": "application/json",
        },
        httpsAgent,
        data: postData,
      });
      await common.errorLog({ response: postAddress?.data, message: `Post ERP Address API: ${process.env.CREATE_ADDRESS} payload: ${JSON.stringify(postData)}`, filter: "createERPAddress" }, reqId);
      logger.error({ statusCode: 200, status: "Log", message: `Post ERP Address API: ${process.env.CREATE_ADDRESS} payload: ${JSON.stringify(postData)}` });
      console.error("postAddressToERP API:", postAddress?.data);

      return { ...postAddress.data, siteCode };
    };

    const runTwice = async (func, data, type) => {
      const siteCode = await generateSiteCode(data.city);
      const response = {
        stl: await func("82", data, type, siteCode),
      };

      if (response.stl.STATUS === "E") {
        const target = type === "SHIP_TO" ? matchingShipTo : matchingBillTo;
        target.stl = response.stl.MATCHING;
        delete response.stl;
      }

      if (hasManaged) {
        const existingSds = await oracleDb.execute(
          `
    SELECT SITE_USE_ID, SITE_CODE
    FROM SIFY_CPQ_CUST_ADDRESS_V@BI2APPS
    WHERE ORG_ID = 425
      AND SITE_USE_CODE = '${type}'
      AND ACCOUNT_NUMBER = :accountNumber
      AND REGEXP_REPLACE(UPPER(NVL(ADDRESS1,'')||NVL(ADDRESS2,'')||NVL(ADDRESS3,'')),'[^A-Z0-9]','')
          LIKE '%' || REGEXP_REPLACE(UPPER(NVL(:address1,'')||NVL(:address2,'')||NVL(:address3,'')),'[^A-Z0-9]','') || '%'
    `,
          {
            accountNumber: ebsAccountNo,
            address1: data.address1 || "",
            address2: data.address2 || "",
            address3: data.address3 || ""
          }
        );

        if (existingSds.rows.length > 0) {
          const [sid, scode] = existingSds.rows[0];
          response.sds = {
            SITE_USE_ID: sid,
            siteCode: scode
          };
        } else {
          response.sds = await postAddressToERP("425", data, type);
        }
      }

      return response;
    };

    console.log(postShipToERP);
    const existing = await findExistingShipTo(ebsAccountNo, shippingAddress);

    if (existing.length > 0) {
      console.log("Skipping duplicate.");

      const [siteUseId, siteCode] = existing[0];

      shipToERP = {
        stl: {
          SITE_USE_ID: siteUseId,
          siteCode: siteCode
        }
      };

      postShipToERP = true;
    }
    else {
      console.log("Creating new in ERP.");

      shipToERP = await runTwice(postAddressToERP, shippingAddress, "SHIP_TO");

      const { stl, sds } = matchingShipTo;
      if (stl.length === 0 && (hasManaged ? sds.length === 0 : true)) {
        if (shipToERP.stl.STATUS === "S" && (hasManaged ? shipToERP.sds.STATUS === "S" : true)) {
          postShipToERP = true;
        }
      }
    }




    if (quoteType !== "New") {
      const result = await Quote.updateMany({ reqId }, { status: "Awaiting Signature" });
      if (!result) throw new Error("Failed To Update");
      const { stl, sds } = matchingShipTo;
      const isShipToEmpty = stl.length === 0 && (hasManaged ? sds.length === 0 : true);
    }/*  else if (["new", "sameas"].includes(billingAddress.billToAddressType)) {
      // if (billingAddress.isComplete) {
      billToERP = hasebsAccountNo ? await runTwice(postAddressToERP, billingAddress, "BILL_TO") : null;
      console.log("billToERP", billToERP);
      // }
    } */

    if (["new", "sameas"].includes(billingAddress.billToAddressType)) {
      // if (billingAddress.isComplete) {
      billToERP = hasebsAccountNo ? await runTwice(postAddressToERP, billingAddress, "BILL_TO") : null;
      console.log("billToERP", billToERP);
      // }
    } else if (Object.keys(billingAddress).length !== 0 && billingAddress.isComplete && hasManaged) {
      console.log("existing");

      billToERP = hasebsAccountNo
        ? await runTwice(postAddressToERP, billingAddress, "BILL_TO")
        : null;
    }

    const { stl: shipStl, sds: shipSds } = matchingShipTo;
    const { stl: billStl, sds: billSds } = matchingBillTo;
    const isAllPosted = shipStl.length || (hasManaged ? shipSds.length : true) || billStl?.length || (hasManaged ? billSds?.length : true);

    const buildToPostData = {
      ...billingAddress,
      billToERP,
    };

    if (shipStl.length) {
      shipToERP.stl = { SITE_USE_ID: shipStl[0].SITE_USE_ID, siteCode: shipStl[0].SITE_CODE };
      if (shipSds.length) {
        shipToERP.sds = { SITE_USE_ID: shipSds[0].SITE_USE_ID, siteCode: shipSds[0].SITE_CODE };
      }
    }
    if (billStl.length) {
      buildToPostData.address1 = billStl[0].ADDRESS1;
      buildToPostData.address2 = billStl[0].ADDRESS2;
      buildToPostData.address3 = billStl[0].ADDRESS3;
      buildToPostData.city = billStl[0].CITY;
      buildToPostData.state = billStl[0].STATE;
      buildToPostData.pinCode = billStl[0].POSTAL_CODE;
      buildToPostData.billToERP.stl = { SITE_USE_ID: billStl[0].SITE_USE_ID, siteCode: billStl[0].SITE_CODE };
      if (billSds.length) {
        billToERP.sds = { SITE_USE_ID: billSds[0].SITE_USE_ID, siteCode: billSds[0].SITE_CODE };
      }
    }

    console.log("buildToPostData", buildToPostData);
    console.log("buildToPostData.ERP", buildToPostData?.billToERP);

    const result = await Quote.findOneAndUpdate(
      { reqId },
      {
        pageTracker: "billAndShip",
        $set: {
          "locationDetails.$[elem].shippingAddress.shipToGst": shipToGst,
          "locationDetails.$[elem].shippingAddress.hasShipToGst": hasShipToGst,
          "locationDetails.$[elem].shippingAddress.shipToERP": shipToERP,
          "locationDetails.$[elem].shippingAddress.postShipToERP": postShipToERP,
          "locationDetails.$[elem].billingAddress": buildToPostData || null,
        },
      },
      {
        arrayFilters: [{ "elem.locationId": locationId }],
      }
    );

    await updateOpportunity(reqId);

    if (!result) {
      throw new Error("Temporary service outage. Please try again later.");
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", ...(isAllPosted ? { matchingBillTo, matchingShipTo } : {}) });
  } catch (err) {
    next(err);
    console.log(err.response?.data);
  }
};
// exports.post_new_address = async (req, res, next) => {
//   try {
//     let { reqId, locationId, sameBillToForAll, shipToGst, hasShipToGst, billingAddress } = req.body;
//     // const { companyId, companyName, ebsAccountNo } = req;
//     let { shipToERP, billToERP, matchingShipTo = { stl: [], sds: [] }, matchingBillTo = { stl: [], sds: [] } } = {};

//     if (Object.keys(billingAddress).length !== 0 && billingAddress.email.length === 0) throw "Email ID is required";
//     if (!reqId) throw "reqId Missing";

//     const quote = await Quote.findOne({ reqId });
//     const locationDetails = quote.locationDetails.find((item) => item.locationId === locationId);
//     const { ebsAccountNo, quoteType } = quote;
//     const { valueAddedService, shippingAddress, postShipToERP = false } = locationDetails;

//     let hasManaged = valueAddedService?.some((data) => data.serviceType === "bundled" || data.serviceType === "managed");
//     shippingAddress.gstNo = shipToGst;

//     const headers = {
//       username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
//       password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
//     };

//     const generateSiteCode = async (city) => {
//       const email = billingAddress.email || req.customermail;
//       const domainTLD = email.split("@")[1];
//       const autoCode = crypto.randomBytes(4).toString("hex");
//       let siteCode = city.toUpperCase() + "-" + autoCode.toUpperCase();
//       return siteCode;
//     };

//     const postAddressToERP = async (orgId, data, type) => {
//       const siteCode = await generateSiteCode(data.city);
//       let postData = {
//         ACCOUNT_NUMBER: ebsAccountNo,
//         SITE_CODE: siteCode,
//         ADDRESS1: data.address1,
//         ADDRESS2: data.address2,
//         ADDRESS3: "",
//         ADDRESS4: data.remarks || "",
//         CITY: data.city,
//         STATE: data.state,
//         POSTAL_CODE: data.pincode || data.pinCode,
//         SITE_USE_CODE: type,
//         ORG_ID: orgId,
//         GST_NO: data.gstNo,
//         COUNTRY_CODE: "IN",
//       };
//       const postAddress = await axios({
//         method: "post",
//         url: process.env.CREATE_ADDRESS,
//         headers: {
//           apikey: process.env.ERP_API_KEY,
//           username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
//           password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
//           "Content-Type": "application/json",
//         },
//         httpsAgent,
//         data: postData,
//       });
//       return { ...postAddress.data, siteCode };
//       // if (postAddress.data.STATUS === "S") {
//       //   return { ...postAddress.data, siteCode };
//       // } else if (postAddress.data.STATUS === "E") {
//       //   const target = type === "SHIP_TO" ? matchingShipTo : matchingBillTo;
//       //   target[orgId === "82" ? "stl" : "sds"] = postAddress.data.MATCHING;
//       // }

//       // if (postAddress.data.STATUS === "S") {
//       //   return { ...postAddress.data, siteCode };
//       // } else if (postAddress.data.STATUS === "E") {
//       //   if (type === "SHIP_TO") {
//       //     if (orgId === "82") {
//       //       matchingShipTo.stl = postAddress.data.MATCHING;
//       //     } else {
//       //       matchingShipTo.sds = postAddress.data.MATCHING;
//       //     }
//       //   } else if (type === "BILL_TO") {
//       //     if (orgId === "82") {
//       //       matchingBillTo.stl = postAddress.data.MATCHING;
//       //     } else {
//       //       matchingBillTo.sds = postAddress.data.MATCHING;
//       //     }
//       //   }
//       // }
//     };

//     const runTwice = async (func, data, type) => {
//       const response = {
//         stl: await func("82", data, type),
//       };

//       if (response.stl.STATUS === "E") {
//         const target = type === "SHIP_TO" ? matchingShipTo : matchingBillTo;
//         target.stl = response.stl.MATCHING;
//         delete response.stl;
//       }

//       if (hasManaged) {
//         response.sds = await postAddressToERP("425", data, type);
//         if (response.sds.STATUS === "E") {
//           const target = type === "SHIP_TO" ? matchingShipTo : matchingBillTo;
//           target.sds = response.sds.MATCHING;
//           delete response.sds;
//         }
//       }
//       return response;
//     };

//     if (!postShipToERP) {
//       shipToERP = await runTwice(postAddressToERP, shippingAddress, "SHIP_TO");
//       const { stl, sds } = matchingShipTo;
//       if (stl.length === 0 && (hasManaged ? sds.length === 0 : true)) {
//         if (shipToERP.stl.STATUS === "S" && (hasManaged ? shipToERP.sds.STATUS === "S" : true)) {
//           postShipToERP = true;
//         }
//       }
//     }

//     if (quoteType !== "New") {
//       const result = await Quote.updateMany({ reqId }, { status: "Awaiting Signature" });
//       if (!result) throw "Failed To Update";
//       const { stl, sds } = matchingShipTo;
//       // const matchingShipTo = { stl, sds };
//       const isShipToEmpty = stl.length === 0 && (hasManaged ? sds.length === 0 : true);

//       // logger.info(`${req.path} -- ${req.method} -- Success`);
//       // res.send({ status: "Success", ...(isShipToEmpty ? {} : { matchingBillTo, matchingShipTo }) });
//     }
//     else if (["new", "sameas"].includes(billingAddress.billToAddressType)) {
//       if (billingAddress.isComplete) {
//         billToERP = await runTwice(postAddressToERP, billingAddress, "BILL_TO");
//         console.log(billToERP);
//       }
//     }

//     const result = await Quote.findOneAndUpdate(
//       { reqId },
//       {
//         pageTracker: "billAndShip",
//         $set: {
//           "locationDetails.$[elem].shippingAddress.shipToGst": shipToGst,
//           "locationDetails.$[elem].shippingAddress.hasShipToGst": hasShipToGst,
//           "locationDetails.$[elem].shippingAddress.shipToERP": shipToERP,
//           "locationDetails.$[elem].shippingAddress.postShipToERP": postShipToERP,
//           "locationDetails.$[elem].billingAddress.billToERP": billToERP || null,
//         },
//       },
//       {
//         arrayFilters: [{ "elem.locationId": locationId }],
//       }
//     );

//     if (!result) throw "Failed To Update";

//     if (matchingBillTo.stl.length === 0) {
//       const result = await Quote.findOneAndUpdate(
//         { reqId },
//         {
//           $set: {
//             "locationDetails.$[elem].billingAddress": { ...billingAddress, billToERP },
//           },
//         },
//         {
//           arrayFilters: [{ "elem.locationId": locationId }],
//         }
//       );

//       if (!result) throw "Failed To Update";
//     }

//     const { stl: shipStl, sds: shipSds } = matchingShipTo;
//     const { stl: billStl, sds: billSds } = matchingBillTo;
//     const isAllPosted = shipStl.length || (hasManaged ? shipSds.length : true) || billStl?.length || (hasManaged ? billSds?.length : true);

//     logger.info(`${req.path} -- ${req.method} -- Success`);
//     res.send({ status: "Success", ...(isAllPosted ? { matchingBillTo, matchingShipTo } : {}) });
//   } catch (err) {
//     next(err);
//     console.log(err.response?.data);
//   }
// };
// exports.post_new_address = async (req, res, next) => {
//   try {
//     let { reqId, connectionID, sameBillToForAll, isPoNo, poRefNo, poDate, shipToGst, hasShipToGst, billingAddress } = req.body;
//     // const { companyId, companyName, ebsAccountNo } = req;
//     const companyId = "";
//     let companyName = "";
//     let ebsAccountNo = "2416";
//     let postShipToERP = false;
//     let shipToERP;
//     let billToERP;
//     let matchingShipTo;
//     let matchingBillTo;
//     let query = { reqId };

//     console.log("post_address");
//     // if (!poRefNo && isPoNo == true) throw '"poRefNo" named is required, is P.O is selected';
//     if (Object.keys(billingAddress).length !== 0 && billingAddress.email.length === 0) throw "Email ID is required";
//     if (reqId === 0) throw "reqId Missing";

//     // if (!isPoNo) {
//     //   poRefNo = `ILL-${reqId}`;
//     //   poDate = moment().format("DD-MMM-YY").toUpperCase();
//     // }

//     if (connectionID !== 0) {
//       query.connectionID = connectionID;
//     }
//     let quote = await Quote.findOne(query);

//     if (!quote) {
//       throw "reqId not found";
//     }

//     let hasManaged = false;
//     for await (const data of quote.valueAddedService) {
//       if (data.serviceType === "bundled" || data.serviceType === "managed") {
//         hasManaged = true;
//       }
//     }

//     const headers = {
//       username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
//       password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
//     };

//     const generateSiteCode = async (city) => {
//       const email = billingAddress.email || req.customermail;
//       const domainTLD = email.split("@")[1];
//       const domainName = domainTLD.split(".")[0];
//       const autoCode = crypto.randomBytes(4).toString("hex");
//       // let siteCode = domainName.toUpperCase() + "-" + "ILL-" + city.toUpperCase() + "-" + autoCode.toUpperCase();
//       let siteCode = city.toUpperCase() + "-" + autoCode.toUpperCase();
//       return siteCode;
//     };

//     // const updateOrCreateGstDetails = async (companyId, companyName, state, gstNo, declarationUrl) => {
//     //   const existingGstDetails = await Gstdetails.findOneAndUpdate(
//     //     { companyId, state: state.toUpperCase() },
//     //     {
//     //       companyId,
//     //       companyName,
//     //       state: state.toUpperCase(),
//     //       gstNo: gstNo || undefined,
//     //       hasGst: !!gstNo,
//     //       declarationUrl: gstNo ? undefined : declarationUrl || "url",
//     //     },
//     //     { upsert: true, new: true }
//     //   );

//     //   return existingGstDetails;
//     // };

//     // const shippingAddressState = quote.state;
//     // await updateOrCreateGstDetails(companyId, companyName, shippingAddressState, shipToGst, undefined);

//     const runTwice = async (func, data, type) => {
//       let responseData = {};
//       responseData.stl = await func("82", data, type);
//       if (hasManaged) responseData.sds = await func("425", data, type);
//       return responseData;
//     };

//     const postAddressToERP = async (orgId, data, type) => {
//       const siteCode = await generateSiteCode(data.city);
//       console.log(siteCode);
//       let postData = {
//         ACCOUNT_NUMBER: ebsAccountNo,
//         SITE_CODE: siteCode,
//         ADDRESS1: data.address1,
//         ADDRESS2: data.address2,
//         ADDRESS3: "",
//         ADDRESS4: data.remarks || "",
//         CITY: data.city,
//         STATE: data.state,
//         POSTAL_CODE: data.pincode || data.pinCode,
//         SITE_USE_CODE: type,
//         ORG_ID: orgId,
//         GST_NO: data.gstNo,
//         COUNTRY_CODE: "IN",
//       };
//       console.log(postData);
//       const postAddress = await axios({
//         method: "post",
//         url: process.env.CREATE_ADDRESS,
//         headers: {
//           apikey: process.env.ERP_API_KEY,
//           username: process.env.TO_GET_ERP_ADDRESS_USERNAME,
//           password: process.env.TO_GET_ERP_ADDRESS_PASSWORD,
//           "Content-Type": "application/json",
//         },
//         httpsAgent,
//         data: postData,
//       });
//       console.log(postAddress.data);
//       if (postAddress.data.STATUS === "S") {
//         return { ...postAddress.data, siteCode };
//       } else if (postAddress.data.STATUS === "E") {
//         if (type === "SHIP_TO") {
//           matchingShipTo = postAddress.data.MATCHING;
//         } else if (type === "BILL_TO") {
//           matchingBillTo = postAddress.data.MATCHING;
//         }
//       }
//     };

//     const shipTo = {
//       address1: quote.address1,
//       address2: quote.address2,
//       address3: quote.address3,
//       city: quote.city,
//       state: quote.state,
//       pincode: quote.pincode,
//       gstNo: shipToGst,
//     };

//     if (quote.quoteType !== "New") {
//       const result = await Quote.updateMany(query, {
//         pageTracker: "billAndShip",
//         status: "Awaiting Signature",
//         ebsAccountNo,
//         // isPoNo,
//         // poRefNo,
//         // poDate,
//         shipToGst,
//         hasShipToGst,
//         shipToERP: shipToERP || "",
//         postShipToERP,
//       });

//       if (!result) {
//         throw "Failed To Update";
//       }
//       logger.info(`${req.path} -- ${req.method} -- Success`);
//       res.send({ status: "Success" });
//       return;
//     }

//     // const getexistingShipAddress = async (name, orgId) => {
//     //   const existingShipTo = await axios.get(`https://ws-test.sify.net/osc_cpq/server/flashnet/customer_address.php?n_customer_no=${ebsAccountNo}&v_site_use_code=SHIP_TO&n_org_id=${orgId}&v_state=${shipTo.state}`, {
//     //     headers: headers,
//     //   });

//     //   if (existingShipTo.data.STATUS === "S") {
//     //     const shipToAddress = existingShipTo.data.n_address.find((e) => e.ADDRESS1 === shipTo.address1 && e.ADDRESS2 === shipTo.address2 && e.ADDRESS3 === shipTo.address3 && e.CITY === shipTo.city && e.STATE === shipTo.state && e.POSTAL_CODE === shipTo.pincode);
//     //     console.log("existing_ship", shipToAddress);
//     //     if (shipToAddress) {
//     //       shipToERP = {
//     //         [name]: {
//     //           ORG_ID: shipToAddress.ORG_ID,
//     //           SITE_USE_CODE: shipToAddress.SITE_USE_CODE,
//     //           SITE_CODE: shipToAddress.SITE_CODE,
//     //           SITE_USE_ID: shipToAddress.SITE_USE_ID,
//     //         },
//     //       };
//     //     }
//     //   }
//     // };

//     if (quote.postShipToERP === false) {
//       console.log("postShipToERP");
//       shipToERP = await runTwice(postAddressToERP, shipTo, "SHIP_TO");
//       console.log("Data", shipToERP);
//       if (matchingShipTo.length === 0) {
//         if (shipToERP.stl.STATUS === "S" && hasManaged ? shipToERP.sds.STATUS === "S" : true) {
//           postShipToERP = true;
//         }
//       }
//     }
//     if (billingAddress.billToAddressType === "new" || billingAddress.billToAddressType === "sameas") {
//       if (billingAddress.isComplete === true) {
//         // const billingAddressState = billingAddress.state;
//         // const billToGst = billingAddress.gstNo;
//         // await updateOrCreateGstDetails(companyId, companyName, billingAddressState, billToGst, undefined);
//         billToERP = await runTwice(postAddressToERP, billingAddress, "BILL_TO");
//       }
//       if (matchingBillTo.length === 0) {
//         const result = await Quote.findOneAndUpdate(
//           {
//             reqId,
//             connectionID,
//           },
//           {
//             pageTracker: "billAndShip",
//             ebsAccountNo,
//             poRefNo,
//             poDate,
//             shipToGst,
//             hasShipToGst,
//             shipToERP: shipToERP || "",
//             postShipToERP,
//             sameBillToForAll,
//             billToAddress: {
//               ...billingAddress,
//               billToERP,
//             },
//           }
//         );
//         // if (sameBillToForAll) {
//         //   const updateBillToForAll = await Quote.updateMany(
//         //     { reqId, isSelect: true },
//         //     {
//         //       sameBillToForAll,
//         //       billToAddress: {
//         //         ...billingAddress,
//         //         billToERP,
//         //       },
//         //     }
//         //   );
//         //   if (!updateBillToForAll) {
//         //     throw "Failed To Update";
//         //   }
//         // }
//         if (!result) {
//           throw "Failed To Update";
//         }
//         logger.info(`${req.path} -- ${req.method} -- Success`);
//         res.send({ status: "Success" });
//       }
//     } else {
//       // let billToERP;
//       if (billingAddress.isComplete === true) {
//         const billingAddressState = billingAddress.state;
//         // const billToGst = billingAddress.gstNo;

//         // await updateOrCreateGstDetails(companyId, companyName, billingAddressState, billToGst, undefined);

//         if (hasManaged) {
//           const bill_to = await axios.get(`https://ws-test.sify.net/osc_cpq/server/flashnet/customer_address.php?n_customer_no=${ebsAccountNo}&v_site_use_code=BILL_TO&n_org_id=425&v_state=${billingAddressState}`, { headers }, { httpsAgent });

//           if (bill_to.data.STATUS === "S") {
//             const billToAddressSDS = bill_to.data.n_address.find((e) => e.BILL_TO_ADDRESS === billingAddress.fullAddress);
//             if (billToAddressSDS) {
//               billToERP = {
//                 sds: {
//                   ORG_ID: billToAddressSDS.ORG_ID,
//                   SITE_USE_CODE: billToAddressSDS.SITE_USE_CODE,
//                   SITE_CODE: billToAddressSDS.SITE_CODE,
//                   SITE_USE_ID: billToAddressSDS.SITE_USE_ID,
//                 },
//               };
//             } else {
//               const sds = await postAddressToERP("425", billingAddress, "BILL_TO");
//               billToERP = {
//                 sds,
//               };
//             }
//           }
//         }
//       }

//       const result = await Quote.findOneAndUpdate(
//         {
//           reqId,
//           connectionID,
//         },
//         {
//           pageTracker: "billAndShip",
//           ebsAccountNo,
//           poRefNo,
//           poDate,
//           shipToGst,
//           hasShipToGst,
//           sameBillToForAll,
//           billToAddress: {
//             ...billingAddress,
//             billToERP,
//           },
//           postShipToERP,
//           shipToERP: shipToERP || "",
//         }
//       );
//       // if (sameBillToForAll) {
//       //   const updateBillToForAll = await Quote.updateMany(
//       //     { reqId, isSelect: true },
//       //     {
//       //       sameBillToForAll,
//       //       billToAddress: {
//       //         ...billingAddress,
//       //         billToERP,
//       //       },
//       //     }
//       //   );
//       //   if (!updateBillToForAll) {
//       //     throw "Failed To Update";
//       //   }
//       // }
//       if (!result) {
//         throw "Failed To Update";
//       }
//       logger.info(`${req.path} -- ${req.method} -- Success`);
//       res.send({ status: "Success" });
//     }
//   } catch (err) {
//     next(err);
//     console.log(err.response?.data);
//   }
// };
exports.post_po_no = async (req, res, next) => {
  let { reqId, isPoNo, poRefNo, poDate } = req.body;
  try {
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    let poDateISO;

    /// get companyId from quote
    const quote = await Quote.findOne({ reqId }, { companyId: 1 });
    const companyId = quote?.companyId;
    if (!companyId) throw new Error("Company ID not found for the given reqId.");
    const companyData = await loginDB.collection("companies").findOne({ _id: new mongoose.Types.ObjectId(companyId) });
    const cxmEmail = companyData?.cxmEmail;
    const userData = await loginDB
      .collection("users")
      .findOne(
        { email: cxmEmail },
        { projection: { parentRole: 1 } }
      );

    console.log("User Data:", userData);

    const parentRole = userData?.parentRole;
    if (!parentRole) throw new Error("Parent role not found for the user.");

    if (!parentRole.toLowerCase().includes("cxm")) {
      const { success, message } = await verifyOpportunity(reqId);
      if (!success) {
        return res.status(200).send({ status: "Error", message: message });
      }
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

    await updateOpportunity(reqId);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (err) {
    next(err);
  }
};