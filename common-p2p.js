const nodemailer = require("nodemailer");
const axios = require("axios");
const { logger } = require("handlebars");
const https = require("https");
const oracledb = require("oracledb");
const { scheduleJob } = require("node-schedule");
const path = require("path");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

exports.errorLog = async (error, reqId) => {
  await new NetworkErrorLogs({
    reqId: reqId || 0,
    message: error.message || error,
    stack: error.stack,
    filter: error.filter,
    path: error?.path,
  }).save();
};
exports.create_feasibility = async (reqId, next) => {
  try {
    const quote = await Quote.findOne({ reqId: reqId, isActive: true });
    if (quote.length == 0) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);
    const { partyId, partyNo, connectionType, reqBandwidth, reqBandwidthUOM, newConnectionA, newConnectionB, serviceProvider } = quote;

    let connectionTypeWireless = "";
    let connectionTypeFiber = "";
    let connectionTypeOtherISP = "";

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

    const commonPostData = {
      source: "DSP",
      method: "createFeasibility",
      ACCOUNT_MANAGER: "GOMATHI.SITARAM",
      AM_USER_ID: 5895,
      AM_OSC_ID: 100000000289504,
      PARTY_ID: partyId, // External API
      PARTY_NUMBER: partyNo, // External API
      OPPORTUNITY_ID: partyId, // party id
      OPPORTUNITY_NUMBER: partyNo, // party id
      OPPORTUNITY_NAME: "DSP-OSP",
      OSC_PARTY_ID: 300000610492325,
      SALES_REMARK: "TEST REMARKS FROM OSP -- DSP",
      REQUESTER_CONTACT_NO: 9943441504,
      LOCALLOOP_TYPE: connectionTypeWireless,
      SIFYONNET_FIBER: connectionTypeFiber,
      SIFYOFFNET_LL: connectionTypeOtherISP,
      ORDER_STATUS: "Firm",
      LOCALLOOP_BW: reqBandwidth,
      LOCALLOOP_BW_TYPE: reqBandwidthUOM,
      PORT_BW: reqBandwidth,
      PORT_BW_TYPE: reqBandwidthUOM, // end new connection form
      PROVISION_TYPE: "New-Link",
      LINK_ID: "",
    };
    const connectionDataArray = [newConnectionA, newConnectionB];
    let feasibilityResults = [];
    console.log(" Quote Data from create_feasibility : ", quote);

    for await (const [index, value] of connectionDataArray.entries()) {
      const contactPerson =
        quote[`localContactPerson${index === 0 ? "A" : "B"}`] ||
        quote.localContactPersonA;
      if (value.dataCenterType === "Non Connected DC") {
        const postData = {
          ...commonPostData,
          CONT_NAME: `${contactPerson.contactFirstName} ${contactPerson.contactLastName}`,
          CUST_ADDR: `${value.address1}, ${value.address2}, ${value.address3}`,
          ADDRESS1: value.address1,
          ADDRESS2: value.address2,
          ADDRESS3: value.address3,
          CITY: value.city.toUpperCase(),
          PIN: value.pincode,
          PHONE1: `${contactPerson.contactPhoneNumber1}`,
          PHONE2: `${contactPerson.contactPhoneNumber2}`,
          EMAIL: `${contactPerson.contactEmail}`,
        };

        console.log("Post Data:", postData);

        const config = {
          headers: { apikey: process.env.ERP_API_KEY },
        };

        let feasibilityId, feasibilityOpt, feasibilityReqStatus, OPEX, CAPEX, TOWER_HEIGHT, mastType, updatedData;
        let usedFallback = false;

        try {
          const createFeasibility = await axios.post(`${process.env.CREATE_FEASIBILITY}`, postData);
          console.log("Create Feasibility Response:", createFeasibility.data);

          const isApiError = createFeasibility?.data?.WSstatus === "Error" || createFeasibility?.data?.WSerror;

          if (isApiError) {
            if (createFeasibility?.data?.WSerror === "Invalid Pincode") {
              throw new Error("Invalid Pincode – feasibility status not updated");
            }
            console.warn("Feasibility API error — using fallback random feasibility ID for demo.", createFeasibility?.data?.WSerror);
            usedFallback = true;
          } else {
            const isFiberConnection = connectionType === "Fiber";
            let data;

            console.log("Response Data:", createFeasibility.data);

            switch (connectionType.toLowerCase()) {
              case "wireless":
                data = createFeasibility.data.Wireless?.[0];
                break;
              case "fiber":
                data = createFeasibility.data.Fiber?.[0];
                break;
              default: {
                const offnetData = createFeasibility.data.Offnet;
                const match = serviceProvider?.match(/\[(.*?)\]/);
                offnetData?.forEach((element) => {
                  if (element["BSO"] === match?.[1]) data = element;
                });
                break;
              }
            }

            if (!data) {
              console.warn("No feasibility data in response — using fallback for demo.");
              usedFallback = true;
            } else {
              ({ FEAS_OPT: feasibilityOpt, req_Status: feasibilityReqStatus, OPEX, CAPEX, TOWER_HEIGHT, TOWER_TYPE: mastType, UPDATED_DATE: updatedData, FEASIBILITY_ID: feasibilityId } = data);
            }
          }
        } catch (apiErr) {
          if (apiErr.message === "Invalid Pincode – feasibility status not updated") throw apiErr;
          console.warn("Feasibility API call failed — using fallback for demo.", apiErr.message);
          usedFallback = true;
        }

        if (usedFallback) {
          feasibilityId = String(reqId) + "0" + String(index);
          feasibilityOpt = "Pending";
          feasibilityReqStatus = "2";
          OPEX = 0; CAPEX = 0; TOWER_HEIGHT = 0; mastType = ""; updatedData = new Date().toISOString();
        }

        const isFiberConnection = connectionType === "Fiber";
        const opex = isFiberConnection ? parseInt(OPEX) : 0;
        const capex = isFiberConnection ? parseInt(CAPEX) : 0;
        const mastHeight = isFiberConnection ? TOWER_HEIGHT : parseInt(TOWER_HEIGHT || "0");

        // Store results temporarily
        feasibilityResults.push({
          index,
          updateData: {
            feasibilityId,
            mastType,
            mastHeight,
            opex,
            capex,
            feasibilityOpt,
            feasibilityReqStatus,
            updatedData,
          },
        });

      } else if (quote.newConnectionA === "Connected DC" && quote.newConnectionB === "Connected DC") {
        feasibilityResults.push({
          index,
          updateData: {
            status: "Feasible",
            [`feasibilityStatus${index === 0 ? "A" : "B"}`]: "Feasible",
          },
        });
      } else {
        feasibilityResults.push({
          index,
          updateData: {
            status: "CHECKING FEASIBILITY",
            [`feasibilityStatus${index === 0 ? "A" : "B"}`]: "Feasible",
          },
        });
      }
    }

    for (const { index, updateData } of feasibilityResults) {
      await Quote.findOneAndUpdate(
        { reqId },
        {
          [`feasibilityStatusNewConnection${index === 0 ? "A" : "B"}`]: updateData.feasibilityId ? updateData : undefined,
          ...(!updateData.feasibilityId ? updateData : {}),
          status: updateData.status || "CHECKING FEASIBILITY",
          [`feasibilityStatus${index === 0 ? "A" : "B"}`]: updateData.feasibilityId ? "CHECKING FEASIBILITY" : updateData[`feasibilityStatus${index === 0 ? "A" : "B"}`],
        }
      );

      if (updateData.feasibilityId) {
        const feasibilityIds = new FeasibilityIds({
          feasibilityId: updateData.feasibilityId,
          serviceType: "P2P",
          status: "Pending",
        });
        await feasibilityIds.save();
      }
    }
    return true;
  } catch (error) {
    next(error);
  }
};
exports.update_feasibility = async (next) => {
  //console.log(partyNo,"partyNo");
  const feasibilityids = await FeasibilityIds.find({ serviceType: "P2P", status: "Pending" });
  console.log("feasibilityids", feasibilityids);
  for await (const value of feasibilityids) {
    const partyNo = await Quote.findOne({
      $or: [{ "feasibilityStatusNewConnectionA.feasibilityId": value.feasibilityId }, { "feasibilityStatusNewConnectionB.feasibilityId": value.feasibilityId }],
    });
    console.log(partyNo);
    if (!partyNo) {
      continue;
    }
    const postData = {
      source: "DSP",
      method: "getFeasibiltiyRequestsById",
      FEASIBILITY_ID: value.feasibilityId,
      PARTY_NUMBER: partyNo.partyNo,
    };

    const updateFeasibility = await axios.post("https://ws-test.sify.net/api/DSPFUSIONfeasibilityRequest.php", postData, { httpsAgent });
    if (!updateFeasibility) {
      throw "Feasibility Request Failed";
    }
    if (updateFeasibility.data.code) {
      return true;
    }
    console.log(updateFeasibility, " console.log(fiberData);");
    const fiberData = updateFeasibility.data.Fiber;
    const wirelessData = updateFeasibility.data.Wireless;

    const isFiberConnection = fiberData.length !== 0;

    const data = isFiberConnection ? fiberData[0] : wirelessData[0];
    if (!data) {
      //throw "No Data";
      continue;
    }
    const { FEAS_OPT: feasibilityOpt, req_Status: feasibilityReqStatus, OPEX, CAPEX, TOWER_HEIGHT, TOWER_TYPE: mastType, UPDATED_DATE: updatedData, FEASIBILITY_ID: feasibilityId } = data;

    const opex = isFiberConnection ? parseInt(OPEX) : 0;
    const capex = isFiberConnection ? parseInt(CAPEX) : 0;
    const mastHeight = isFiberConnection ? TOWER_HEIGHT : parseInt(TOWER_HEIGHT || "0");
    const getQuote = await Quote.findOne({
      $or: [
        {
          "feasibilityStatusNewConnectionA.feasibilityId": feasibilityId,
        },
        {
          "feasibilityStatusNewConnectionB.feasibilityId": feasibilityId,
        },
      ],
    });
    if (getQuote?.feasibilityStatusNewConnectionA?.feasibilityId === feasibilityId && feasibilityOpt !== "Pending") {
      const updateQuote = await Quote.findOneAndUpdate(
        {
          reqId: getQuote.reqId,
        },
        {
          $set: {
            feasibilityStatusA: feasibilityReqStatus === "1" ? "Feasible" : "Not Feasible",
            feasibilityStatusNewConnectionA: {
              ...getQuote.feasibilityStatusNewConnectionA,
              feasOpt: feasibilityOpt,
              feasUpdatededDate: updatedData,
              req_Status: feasibilityReqStatus,
              opex,
              capex,
              mastHeight,
              mastType,
            },
          },
        }
      );
      const updateFeasibilityIds = await FeasibilityIds.findOneAndUpdate({ feasibilityId }, { status: feasibilityReqStatus === "1" ? "Feasible" : "Not Feasible" });
    } else if (getQuote?.feasibilityStatusNewConnectionB?.feasibilityId === feasibilityId && feasibilityOpt !== "Pending") {
      const updateQuote = await Quote.findOneAndUpdate(
        {
          reqId: getQuote.reqId,
        },
        {
          $set: {
            feasibilityStatusB: feasibilityReqStatus === "1" ? "Feasible" : "Not Feasible",
            feasibilityStatusNewConnectionB: {
              ...getQuote.feasibilityStatusNewConnectionB,
              feasOpt: feasibilityOpt,
              feasUpdatededDate: updatedData,
              req_Status: feasibilityReqStatus,
              opex,
              capex,
              mastHeight,
              mastType,
            },
          },
        }
      );
      const updateFeasibilityIds = await FeasibilityIds.findOneAndUpdate({ feasibilityId }, { status: feasibilityReqStatus === "1" ? "Feasible" : "Not Feasible" });
    }
    const quote = await Quote.findOne({ reqId: getQuote.reqId });
    let status;
    if (quote?.feasibilityStatusA === "Feasible" && quote.feasibilityStatusB === "Feasible") {
      status = "Feasible";
    } else if (quote.feasibilityStatusA === "Not Feasible" || quote.feasibilityStatusB === "Not Feasible") {
      status = "Not Feasible";
    } else {
      status = "CHECKING FEASIBILITY";
    }
    const updateQuote = await Quote.findOneAndUpdate(
      {
        reqId: quote.reqId,
      },
      {
        status,
      }
    );
  }
  return true;
};
exports.send_mail = async (to, cc, subject, html, attachment) => {
  try {
    let bcc = ["technical@kstinfotech.com", "yars@yuviony.com","anandhkstinfotech@gmail.com"];

    const [mailcredentials] = await db.collection("mailcredentials").find({}).toArray();

    const transporter = nodemailer.createTransport({
      host: mailcredentials.SMTP_Mail_Host,
      port: mailcredentials.SMTP_Mail_port,
      secure: false,
      auth: {
        user: mailcredentials.SMTP_TO_EMAIL,
        pass: mailcredentials.SMTP_TO_PASSWORD,
      },
      tls: { rejectUnauthorized: true },
    });

    const sendMail = await transporter.sendMail({
      from: mailcredentials.SMTP_TO_EMAIL,
      to,
      cc,
      bcc,
      subject,
      html,
      ...(attachment ? { attachments: [attachment] } : {}),
    });
    return sendMail;
  } catch (error) {
    return error;
  }
};
exports.sendMailUntilSuccess = async (reqId, to, cc, subject, html, attachment = null, maxRetries = 5, retryDelay = 3000) => {
  let attemptCount = 0;

  async function trySendingMail() {
    try {
      const bcc = ["yars@yuviony.com", "technical@kstinfotech.com","anandhkstinfotech@gmail.com"];
      const [mailcredentials] = await db.collection("mailcredentials").find({}).toArray();

      const transporter = nodemailer.createTransport({
        host: mailcredentials.SMTP_Mail_Host,
        port: mailcredentials.SMTP_Mail_port,
        secure: false,
        auth: {
          user: mailcredentials.SMTP_TO_EMAIL,
          pass: mailcredentials.SMTP_TO_PASSWORD,
        },
        tls: { rejectUnauthorized: true },
      });

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

// exports.NEW_IRDATE = async (req, res, next) => {
//   console.log("++++++++++++ Entered the function Modify order number +++++++++++++++");
//   const dbConfig = {
//     user: process.env.ORACAL_USERNAME,
//     password: process.env.ORACAL_PASSWORD,
//     connectString: process.env.ORACAL_CONNECTIONSTRING,
//   };
//   try {

//     console.log("++++++++++++ Configuration successful +++++++++++++++");
//     const oracalDb = await oracledb.getConnection(dbConfig);
//     const listOf = await Quote.find({
//       status: "Provisioning in Progress",
//       $or: [
//         { irDate: { $exists: false } },
//         { irDate: null },
//       ]
//     });
//     console.log(listOf.length);
//     const date = new Date();
//     for (let i = 0; i < listOf.length; i++) {
//       const newQuery = `select booked_date,
//        IR_date,
//        ordered_date,
//        order_header_status from apps.xxsify_order_details_vw@bi2apps  where order_number = ${listOf[i].leasedLineBookingNo}`;
//       console.log("New Query ::::::: ", newQuery);
//       const result = await oracalDb.execute(newQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//       console.log("result ::::::: ", result);
//       const data = result.rows;
//       console.log("type Of data", typeof (data));
//       console.log("data :::::::::: ", JSON.stringify(data));
//       if (data.length > 0 && data[0].IR_DATE) {
//         console.log("IrDate", data[0].IR_DATE)
//         console.log("reqId", listOf[i].reqId)
//        /*  const pointA = data.find(item => item.NEW_OPG_ATTRIBUTE41 === "Point A");
//         const pointB = data.find(item => item.NEW_OPG_ATTRIBUTE41 === "Point B"); */
//       const newIRDatas = await NewQuote.findOneAndUpdate(
//         { reqId: listOf[i].reqId },
//         {
//           irDate: data[0].IR_DATE,
//           status: "Order Implemented",
//           order_implementedDate:date,
//         }
//       );
//         console.log("newIRDatas ::::::::: ", newIRDatas);
//       }
//     }
//     return "Success"
//   } catch (error) {
//     return error;
//   }
// };

// exports.NEW_ORDER_NUMBER = async (req, res, next) => {
//   console.log("++++++++++++ Entered the function order number +++++++++++++++");
//   const dbConfig = {
//     user: process.env.ORACAL_USERNAME,
//     password: process.env.ORACAL_PASSWORD,
//     connectString: process.env.ORACAL_CONNECTIONSTRING,
//   };

//   try {
//     console.log("++++++++++++ Configuration successful +++++++++++++++");
//     const oracalDb = await oracledb.getConnection(dbConfig);
//     const listOf = await Quote.find({ status: "Order Placed" });
//     console.log(listOf.length);
//     const scqhIdValues = listOf.map(value => `'${value.reqId}'`).join(", ");
//     console.log(scqhIdValues)

//     const idExistQuery = `
//           SELECT *
//           FROM sify_online_sales_ord_header@bi2apps
//           WHERE scqh_id IN (${scqhIdValues})
//             AND TRANSPOSE_FLAG = 'Y'
//       `;
//       const idExistData = await oracalDb.execute(idExistQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//       const validReqIds = idExistData.rows.map(item => `'${item.SCQH_ID}'`);
//       console.log("Valid ReqIds:", validReqIds);
//       if (validReqIds.length === 0) {
//           console.log("No reqIds found with TRANSPOSE_FLAG = 'Y'");
//           return res.status(200).json({ status: "No Data", message: "No reqIds with TRANSPOSE_FLAG = 'Y'" });
//       }

//       const filteredScqhIdValues = validReqIds.join(", ");
//       const leasedLineBookingNo = `
//       SELECT DISTINCT
//           LINK_ID,
//           ORDER_NUMBER,
//           ITEM,
//           ITEM_TYPE,
//           MULTI_LINK_ID,
//           SCQH_ID,
//           OPG_ATTRIBUTE42,
//           OPG_ATTRIBUTE41
//       FROM
//           apps.sify_online_sales_ord_det@bi2apps
//       WHERE
//           model_type = 'OSP-P2P'
//           AND multi_link_id IN ('L1', 'L2')
//           AND item IN ('OTHER-ISP')
//           AND order_number IS NOT NULL
//           AND SCQH_ID IN (${filteredScqhIdValues})
//       ORDER BY
//           SCQH_ID
//       `;
//       const managedBookingNo = `
//   SELECT DISTINCT
//       LINK_ID,
//       ORDER_NUMBER,
//       ITEM, ITEM_TYPE,
//       SCQH_ID,
//       OPG_ATTRIBUTE42,
//       OPG_ATTRIBUTE41 ,MULTI_LINK_ID
//   FROM
//       apps.sify_online_sales_ord_det@bi2apps
//   WHERE
//       model_type = 'OSP-P2P'
//       AND multi_link_id IN ('L1', 'L2')
//       AND item IN ('MANAGED NOC')
//       AND order_number IS NOT NULL
//       AND SCQH_ID IN (${filteredScqhIdValues})
//   ORDER BY
//       SCQH_ID
//       `;
//       const routerDataBookingNo = `
//   SELECT DISTINCT
//       LINK_ID,
//       ORDER_NUMBER,
//       ITEM, ITEM_TYPE,
//       SCQH_ID,
//       OPG_ATTRIBUTE42,
//       OPG_ATTRIBUTE41 ,MULTI_LINK_ID
//   FROM
//       apps.sify_online_sales_ord_det@bi2apps
//   WHERE
//       model_type = 'OSP-P2P'
//       AND multi_link_id IN ('L1', 'L2')
//       AND item IN ('SAMSS-OT-INS', 'BBROUT000305')
//       AND order_number IS NOT NULL
//       AND SCQH_ID IN (${filteredScqhIdValues})
//   ORDER BY
//       SCQH_ID
//       `;

//     let queries = [leasedLineBookingNo, managedBookingNo, routerDataBookingNo]

//     const [data, managedData, routerData] = await Promise.all(
//       queries.map(query => oracalDb.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }))
//     ).then(results => results.map(result => result.rows));

//     for (let i = 0; i < listOf.length; i++) {
//       const reqId = listOf[i].reqId;
//       console.log(reqId);

//       const leasedItem = data.find(item => item.SCQH_ID === reqId);
//       const managedItem = managedData.find(item => item.SCQH_ID === reqId);
//       const routerItem = routerData.find(item => item.SCQH_ID === reqId);
//       const pointALink = data.find(
//         (item) =>
//           item.SCQH_ID === reqId &&
//           item.ITEM === "OTHER-ISP" &&
//           item.ITEM_TYPE === "LINK" &&
//           item.MULTI_LINK_ID === "L1" &&
//           item.OPG_ATTRIBUTE41 === "Point A"
//       );
//       console.log("PointALink",pointALink)

//       const pointBLink = data.find(
//         (item) =>
//           item.SCQH_ID === reqId &&
//           item.ITEM === "OTHER-ISP" &&
//           item.ITEM_TYPE === "LINK" &&
//           item.MULTI_LINK_ID === "L2" &&
//           item.OPG_ATTRIBUTE41 === "Point A"
//       );
//       console.log("PointALink",pointBLink)

//       const linkIdMNOC_1=managedData.find(
//         (item) =>
//           item.SCQH_ID === reqId &&
//           item.MULTI_LINK_ID === "L1"
//         )
//       const linkIdMNOC_2=managedData.find(  (item) =>
//           item.SCQH_ID === reqId &&
//           item.MULTI_LINK_ID === "L2"
//         )
//       const linkIdRouter_1=routerData.find(  (item) =>
//           item.SCQH_ID === reqId &&
//           item.MULTI_LINK_ID === "L1" &&
//           item.ITEM==='SAMSS-OT-INS'
//         );
//       const linkIdRouter_2=routerData.find(  (item) =>
//           item.SCQH_ID === reqId &&
//           item.MULTI_LINK_ID === "L2" &&
//           item.ITEM==='SAMSS-OT-INS'
//         );
//         const date = new Date();

//       const updateData = {
//         order_completedDate:date,

//         leasedLineBookingNo: leasedItem ? leasedItem.ORDER_NUMBER : null,
//         managedBookingNo: managedItem ? managedItem.ORDER_NUMBER : null,
//         routerBookingNo: routerItem ? routerItem.ORDER_NUMBER : null,
//         linkIdA_1:pointALink?pointALink.LINK_ID:null,
//         linkIdB_1:pointALink?pointALink.OPG_ATTRIBUTE42:null,
//         linkIdA_2:pointBLink?pointBLink.LINK_ID:null,
//         linkIdB_2:pointBLink?pointBLink.OPG_ATTRIBUTE42:null,

//         linkIdMNOC_1:linkIdMNOC_1?linkIdMNOC_1.LINK_ID:null,
//         linkIdMNOC_2:linkIdMNOC_2?linkIdMNOC_2.LINK_ID:null,
//         linkIdRouter_1:linkIdRouter_1?linkIdRouter_1.LINK_ID:null,
//         linkIdRouter_2:linkIdRouter_2?linkIdRouter_2.LINK_ID:null
//       };

//       await NewQuote.findOneAndUpdate({ reqId }, updateData, { new: true });

//       const updatedQuote = await Quote.findOne({ reqId });

//       if (updatedQuote &&
//           updatedQuote.leasedLineBookingNo) {
//         await NewQuote.findOneAndUpdate({ reqId }, { status: "Provisioning in Progress" });
//         console.log("Provisioning in Progress for reqId:", reqId);
//       }
//     }

//     return "Success"
//   } catch (error) {
//     return error;
//   }
// };

// const exportExcel = scheduleJob("0 * * * *", async function () {
//   let dateTime = new Date();
//   dateTime.setDate(dateTime.getDate() - 1);
//   let previousDate = dateTime.toISOString().slice(0, 10);
//   console.log("Previous Date :", previousDate);

//   // let buffer = await axios.post(`https://192.168.2.125:4013/onesify/mpls/common/get_export_excel`, {}, { responseType: "arraybuffer" });
//   let buffer = await axios.post(`${process.env.APP_PATH}/onesify/p2p/common/get_export_excel`, {}, { responseType: "arraybuffer" });
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
//   const subject = `One Sify (OSP) P2P Report for ${previousDate}`;
//   const html = `<div style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747;font-family:'Myriad Pro', sans-serif" width="100%">
//       <p><span style="font-size: 16px; color: #0E3346;">Dear One Sify Admin</span></p>
//       <p>Please see the attached file for the daily P2P report from one sify portal.</p>
//       <br/>
//       </div>`;
//   const attachment = {
//     filename: `P2P-${previousDate}.xlsx`,
//     content: buffer.data,
//   };

//   await exports.sendMailUntilSuccess(null, toArray, [], subject, html, attachment);
// });
