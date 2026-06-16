const logger = require("../config/winston");
const oracledb = require("oracledb");

exports.get_purchase_summary_by_linkid = async (req, res, next) => {
  const { linkId } = req.body;
  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING,
  };
  const oracalDb = await oracledb.getConnection(dbConfig);
  const isCP = req?.parentRole.toLowerCase().includes("cp");
  console.log("parent role is ", req?.parentRole, "isCP value is ", isCP);
  try {
    if (!linkId) throw new Error("Missing LinkId");

    const query = `
          SELECT 
          sliv.opg_form_context "OPGFormContext",
          opg_attribute48 "classofService",
          DECODE(
            sliv.last_mile_type,
            'SIFY FIBER', 'Fiber', 
            'Sify Fiber' ,'Fiber', 
            'FIBER' ,'Fiber', 
            'Sify fiber' ,'Fiber', 
            'sify fiber', 'Fiber', 
            'FIber' ,'Fiber',
            'Sify FIBER', 'Fiber',
            'Fiber', 'Fiber',
            'SifyFiber', 'Fiber',
            'Sify RF' , 'Wireless',
            'wireless' ,'Wireless', 
            'Wireless', 'Wireless',
            'Leased Line' , 'Leased Line',
            'Sify DC' , 'Sify DC',
            'Offnet RF' , 'Offnet RF',
            'Offnet Wired Line (Ethernet)(Telco)' , 'Offnet Wired Line (Ethernet)(Telco)',
            'OffNet Wired Line (Ethernet)(Telco)' , 'OffNet Wired Line (Ethernet)(Telco)',
            'Broadband' , 'Broadband',
            'OffNet Wired Line (Ethernet' , 'OffNet Wired Line (Ethernet',
            'Broadband - MPLS' , 'Broadband - MPLS',
            'Sify' , 'Sify',
            'ISDN' , 'ISDN',
            'Ethernet Drop Sify BSTN' , 'Ethernet Drop Sify BSTN',
            'ADSL' , 'ADSL',
            'Ethernet Drop - Connected DC' , 'Ethernet Drop - Connected DC',
            '3G Datacard' , '3G Datacard',
            'Ethernet Drop - Sify PoP' , 'Ethernet Drop - Sify PoP',
            '4G LTE' , '4G LTE',
            'DR' , 'DR',
            'BSO Wireline' , 'BSO Wireline',
            'VSAT' , 'VSAT',
            'Ethernet Drop' , 'Ethernet Drop',
            'Offnet Wired Line(Non-Telco)' , 'Offnet Wired Line(Non-Telco)',
            'DC' , 'DC',
            'Ethernet Drop Sify POP' , 'Ethernet Drop Sify POP',
            'Ethernet Drop - Sify Bstn' , 'Ethernet Drop - Sify Bstn',
            'BSO Wireless' , 'BSO Wireless',
            'Ethernet' , 'Ethernet',
            'Metro Ethernet' , 'Metro Ethernet',
            'OffNet_Wired_Line_Ethernet' , 'OffNet_Wired_Line_Ethernet',
            'OFFNET WIRED LINE (ETHERNET)' , 'OFFNET WIRED LINE (ETHERNET)',
            '4G Datacard' , '4G Datacard',
            'Ethernet Drop SPDC' , 'Ethernet Drop SPDC',
            'Broadband - Internet' , 'Broadband - Internet'
          ) AS "connectionType",
          DECODE (
            OPG_ATTRIBUTE47,
            null, 1
            ) "contractPeriod",
          DECODE (
              sliv.opg_form_context,
              'Express Connect Internet','DIA',
              'Site Connect MPLS Layer 3','MPLS',
              'Site Connect MPLS Layer 2','P2P',
              'Global Cloud Connect New','GCC',
              'Colo Internet','Colo Internet',
              'Cloud Internet','Cloud Internet'
          ) "coveredProduct",
          sliv.customer_name "customerName",
          sliv.customer_code "ebsAccountNo",
          sliv.contract_end_date AS "endDate",
          sliv.link_id AS "linkId",
          sliv.bandwidth "reqBandwidth",
          sliv.uom "reqBandwidthUOM",
          sliv.product_type "serviceItem",
          sliv.site_code "shipSiteCode",
          sliv.ship_to_id "shipsiteId",
          sliv.contract_start_date "startDate",
          sliv.line_amount "totalArc",
          sliv.contract_line_status "status",
          opg_attribute32,
          sliv.ship_to_id "shipTo",
          sliv.site_code "shipToLocation",
          sliv.ship_address1 "address1",
          sliv.ship_address2 "address2",
          sliv.ship_address3 "address3",
          sliv.ship_address4 "address4",
          sliv.ship_city "city",
          sliv.ship_state "state",
          sliv.ship_postal_code "pincode",
          sliv.bill_to_id "billTo",
          sliv.bill_location "billToLocation",
          sliv.bill_address1 "billAddress1",
          sliv.bill_address2 "billAddress2",
          sliv.bill_address3 "billAddress3",
          sliv.bill_address4 "billAddress4",
          sliv.bill_city "billCity",
          sliv.bill_state "billState",
          sliv.bill_postal_code "billPincode"
      FROM 
          ${process.env.ORACAL_INSTANCE} sliv
      WHERE  
       ${isCP ? " sliv.product_type = 'EXPRESSCONNECT'" : " sliv.product_type IN ('EXPRESSCONNECT', 'OTHER-ISP')"} AND
        sliv.ordered_code != 'LASTMILE-RC' AND
        sliv.bandwidth is not null AND
        (sliv.CONTRACT_HEADER_STATUS = 'ACTIVE' OR sliv.CONTRACT_HEADER_STATUS = 'SIGNED') AND
        (sliv.CONTRACT_LINE_STATUS = 'ACTIVE' OR sliv.CONTRACT_LINE_STATUS = 'SIGNED') AND
        sliv.link_id = '${linkId}'`;

    let bandwidthData = [];
    let shippingData = [];
    let billingData = [];

    const result = await oracalDb.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

    result.rows.forEach((row) => {
      bandwidthData.push({
        OPGFormContext: row.OPGFormContext,
        classofService: row.classofService,
        connectionType: row.connectionType,
        contractPeriod: row.contractPeriod,
        coveredProduct: row.coveredProduct,
        customerName: row.customerName,
        ebsAccountNo: row.ebsAccountNo,
        endDate: row.endDate,
        linkId: row.linkId,
        reqBandwidth: row.reqBandwidth,
        reqBandwidthUOM: row.reqBandwidthUOM,
        serviceItem: row.serviceItem,
        shipSiteCode: row.shipSiteCode,
        shipsiteId: row.shipsiteId,
        startDate: row.startDate,
        totalArc: row.totalArc,
        status: row.status,
        OPG_ATTRIBUTE32: row.OPG_ATTRIBUTE32 || null,
      });

      shippingData.push({
        shipTo: row.shipTo,
        shipToLocation: row.shipToLocation,
        address1: row.address1,
        address2: row.address2,
        address3: row.address3,
        address4: row.address4,
        city: row.city,
        state: row.state,
        pincode: row.pincode,
      });

      billingData.push({
        billTo: row.billTo,
        billToLocation: row.billToLocation,
        address1: row.billAddress1,
        address2: row.billAddress2,
        address3: row.billAddress3,
        address4: row.billAddress4,
        city: row.billCity,
        state: row.billState,
        pincode: row.billPincode,
      });
    });

    const output = {
      bandwidth: bandwidthData,
      shipping: shippingData,
      billing: billingData,
    };

    // const results = await Promise.all(
    //   queries.map(async ({ name, query }) => {
    //     const startTime = performance.now();
    //     const result = await oracalDb.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    //     const endTime = performance.now();
    //     const elapsedTime = endTime - startTime;
    //     console.log(result);
    //     console.log(`Execution time: ${elapsedTime} milliseconds`);
    //     return { [name]: result.rows };
    //   })
    // );

    const bandwidthArray = output.bandwidth;

    if (bandwidthArray && bandwidthArray.length >= 2) {
      const [firstItem, secondItem, ...rest] = bandwidthArray;
      firstItem.totalArc += secondItem.totalArc;
      output.bandwidth = [firstItem, ...rest];
    }

    const data = {
      status: "Success",
      data: {
        ...output,
        bandwidth: output.bandwidth.map(item => ({
          ...item,
          reqBandwidthUOM:
            item.reqBandwidthUOM === "MBPS"
              ? "Mbps"
              : item.reqBandwidthUOM
        }))
      }
    };

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send(data);
  } catch (error) {
    next(error);
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};
// exports.get_purchase_summary_by_linkid = async (req, res, next) => {
//   const { linkId } = req.body;
//   const dbConfig = {
//     user: process.env.ORACAL_USERNAME,
//     password: process.env.ORACAL_PASSWORD,
//     connectString: process.env.ORACAL_CONNECTIONSTRING,
//   };
//   const oracalDb = await oracledb.getConnection(dbConfig);
//   try {
//     if (!linkId) throw "Missing LinkId";

//     const queries = [
//       {
//         name: "bandwidth",
//         query: `
//           SELECT
//           OPG_FORM_CONTEXT "OPGFormContext",
//           OPG_ATTRIBUTE48 "classofService",
//           DECODE (
//               OPG_ATTRIBUTE4,
//               'Ethernet Drop', 'Ethernet',
//               'SIFY FIBER', 'Fiber',
//               'Sify Fiber', 'Fiber',
//               'FIBER', 'Fiber',
//               'Sify fiber', 'Fiber',
//               'sify fiber', 'Fiber',
//               'FIber', 'Fiber',
//               'Sify FIBER', 'Fiber',
//               'Fiber', 'Fiber',
//               'Sify RF', 'Wireless',
//               'wireless', 'Wireless',
//               'Wireless', 'Wireless',
//               'OFFNET WIREDLINE' , 'BSO WIRELINE',
//               'OFFNET WIRED LINE' , 'BSO WIRELINE',
//               'OFFNET WIRED NON-TELCO' , 'BSO WIRELINE',
//               'OFFNET WIRED LINE(NON-TELCO)' , 'BSO WIRELINE',
//               'OFFNET WIRED LINE (ETHERNET)' , 'Leased Line',
//               'OFFNET WIRELINE (ETHERNET) TELCO' , 'Leased Line',
//               'OFFNET WIRED LINE (ETHERNET)(TELCO)' , 'Leased Line',
//               'ETHERNET DROP SIFY POP' , 'Ethernet Drop',
//               'DC', 'SIFY DC'
//           ) "connectionType",
//           DECODE (
//             OPG_ATTRIBUTE47,
//             null, 1
//             ) "contractPeriod",
//           DECODE (
//               opg_form_context,
//               'Express Connect Internet','DIA',
//               'Site Connect MPLS Layer 3','MPLS',
//               'Site Connect MPLS Layer 2','P2P',
//               'Global Cloud Connect New','GCC',
//               'Colo Internet','Colo Internet',
//               'Cloud Internet','Cloud Internet'
//           ) "coveredProduct",
//           CUSTOMER_NAME "customerName",
//           ACCOUNT_NUMBER "ebsAccountNo",
//           CONTRACT_END_DATE "endDate",
//           LINK_ID "linkId",
//           OPG_ATTRIBUTE2 "reqBandwidth",
//           OPG_ATTRIBUTE3 "reqBandwidthUOM",
//           SERVICE_ITEM "serviceItem",
//           SHIP_TO_LOCATION "shipSiteCode",
//           SHIP_TO "shipsiteId",
//           CONTRACT_START_DATE "startDate",
//           LINE_AMOUNT "totalArc",
//           PRODUCT_STATUS "status",
//           OPG_ATTRIBUTE32
//       FROM
//           ${process.env.ORACAL_INSTANCE_BW}
//       WHERE
//       OPG_FORM_CONTEXT = 'Express Connect Internet' AND
//       service_ITEM in ('LASTMILE-RC', 'EXPRESSCONNECT-RC') AND

//       link_id = '${linkId}'
//           `,
//       },
//       // CONTRACT_HEADER_STATUS = 'ACTIVE' AND
//       // CONTRACT_LINE_STATUS = 'ACTIVE' AND
//       // contract_status !='EXPIRED' AND
//       // LINE_STATUS != 'EXPIRED' AND
//       // PRODUCT_STATUS != 'EXPIRED' AND
//       //       {
//       //         name: "ip",
//       //         query: `
//       //         SELECT SERVICE_ITEM "serviceItem",
//       //         OPG_ATTRIBUTE43     "lanipOwner",
//       //         OPG_ATTRIBUTE44     "lanipType",
//       //         OPG_ATTRIBUTE6      "ipPool",
//       //         LINE_AMOUNT "arc"
//       //    FROM ${process.env.ORACAL_INSTANCE_BW}
//       //  WHERE     SERVICE_ITEM = 'IPS-ARC'
//       //         AND COVERED_PRODUCT = 'EXPRESSCONNECT'
//       //         AND link_id = '${linkId}'
//       //         `,
//       //         // keys: ["serviceItem", "lanipOwner", "lanipType", "ipPool", "arc"],
//       //       },
//       //       {
//       //         name: "managed",
//       //         query: `
//       //         SELECT SERVICE_ITEM "serviceItem",
//       //         LINE_AMOUNT "arc",
//       //        link_id "linkId",
//       //        contract_start_date "startDate",
//       //        contract_end_date,
//       //        customer_name,
//       //        account_number
//       //   FROM ${process.env.ORACAL_INSTANCE_BW}
//       //  WHERE OPG_FORM_CONTEXT = 'Managed NOC' AND link_id = '${linkId}'
//       //         `,
//       //         // keys: ["serviceItem", "arc", "linkId", "startDate", "endDate", "customerName", "ebsAccountNo"],
//       //       },
//       //       {
//       //         name: "bundled",
//       //         query: `
//       //         SELECT SERVICE_ITEM "serviceItem",
//       //         LINE_AMOUNT "arc",
//       //         link_id "linkId",
//       //         contract_start_date "startDate",
//       //         contract_end_date "endDate",
//       //         customer_name "customerName",
//       //         account_number "ebsAccountNo"
//       //    FROM ${process.env.ORACAL_INSTANCE_BW}
//       //   WHERE OPG_FORM_CONTEXT = 'MCPE' AND link_id = '${linkId}'
//       //         `,
//       //         // keys: ["serviceItem", "arc", "linkId", "startDate", "endDate", "customerName", "ebsAccountNo"],
//       //       },
//       // {
//       //   name: "address",
//       //   query: `
//       //   SELECT
//       //   CUSTOMER_NAME "name",
//       //   COVERED_PRODUCT "coverdProduct",
//       //   BILL_TO "billTo",
//       //   BILL_TO_LOCATION "billToLocation",
//       //   BILL_TO_ADDRESS "billToAddress",
//       //   SHIP_TO "shipTo",
//       //   SHIP_TO_LOCATION "shipToLocation",
//       //   SHIP_TO_ADDRESS "shipToAddress",
//       //   CONTRACT_START_DATE "startDate",
//       //   CONTRACT_END_DATE "endDate",
//       //   OPG_ATTRIBUTE4 "connectionType"
//       //   FROM ${process.env.ORACAL_INSTANCE_BW} WHERE OPG_FORM_CONTEXT = 'Express Connect Internet'
//       //   AND contract_status !='EXPIRED' AND SERVICE_ITEM !='LASTMILE-RC' AND link_id = '${linkId}'
//       //   `,

//       // },
//       {
//         name: "shipping",
//         // query: `
//         // SELECT ADDRESS1 "address1",
//         //       ADDRESS2 "address2",
//         //       ADDRESS3 "address3",
//         //       ADDRESS4 "address4",
//         //       CITY "city",
//         //       STATE "state",
//         //       POSTAL_CODE "pincode"
//         // FROM apps.SIFY_CPQ_CUST_ADDRESS_V@BI2APPS
//         // WHERE SITE_USE_CODE = 'SHIP_TO'
//         // AND SITE_USE_ID = (SELECT SHIP_TO
//         //                   FROM apps.xxsify_orm_link_avail_v@BI2APPS
//         //                   WHERE contract_status !='EXPIRED' AND SERVICE_ITEM !='LASTMILE-RC' AND link_id = '${linkId}')
//         // `,
//         query: `SELECT
//         SHIP_TO_ID "shipTo",
//         SITE_CODE "shipToLocation",
//         SHIP_ADDRESS1 "address1",
//         SHIP_ADDRESS2 "address2",
//         SHIP_ADDRESS3 "address3",
//         SHIP_ADDRESS4 "address4",
//         SHIP_CITY "city",
//         SHIP_STATE "state",
//         SHIP_POSTAL_CODE "pincode"
//         from ${process.env.ORACAL_INSTANCE} WHERE LINK_ID ='${linkId}' AND
//         OPG_FORM_CONTEXT='Express Connect Internet' AND

//         ORDERED_CODE='EXPRESSCONNECT-RC'`,
//       },
//       {
//         name: "billing",
//         // query: `
//         // SELECT ADDRESS1 "address1",
//         //       ADDRESS2 "address2",
//         //       ADDRESS3 "address3",
//         //       ADDRESS4 "address4",
//         //       CITY "city",
//         //       STATE "state",
//         //       POSTAL_CODE "pincode"
//         // FROM apps.SIFY_CPQ_CUST_ADDRESS_V@BI2APPS
//         // WHERE SITE_USE_CODE = 'BILL_TO'
//         // AND SITE_USE_ID = (SELECT BILL_TO
//         //                   FROM apps.xxsify_orm_link_avail_v@BI2APPS
//         //                   WHERE contract_status !='EXPIRED' AND SERVICE_ITEM !='LASTMILE-RC' AND link_id = '${linkId}')
//         // `,
//         query: `SELECT
//         BILL_TO_ID "billTo",
//         BILL_LOCATION "billToLocation",
//         BILL_ADDRESS1 "address1",
//         BILL_ADDRESS2 "address2",
//         BILL_ADDRESS3 "address3",
//         BILL_ADDRESS4 "address4",
//         BILL_CITY "city",
//         BILL_STATE "state",
//         BILL_POSTAL_CODE "pincode"
//         from ${process.env.ORACAL_INSTANCE} WHERE LINK_ID ='${linkId}' AND
//         OPG_FORM_CONTEXT='Express Connect Internet' AND

//         ORDERED_CODE ='EXPRESSCONNECT-RC'`,
//       },
//       // {
//       //   name: "OPG_ATTRIBUTE32",
//       //   query: `SELECT OPG_ATTRIBUTE32 FROM ${process.env.ORACAL_INSTANCE_BW} WHERE link_id = '${linkId}'`,
//       // },
//     ];

//     // const transformedData = results.map((result, index) => {
//     //   const { keys } = queries[index];
//     //   return result.rows.map((resultRow) => {
//     //     const queryObject = {};
//     //     for (let i = 0; i < keys.length; i++) {
//     //       switch (resultRow[i]) {
//     //         case "Sify RF":
//     //           queryObject[keys[i]] = "WIRELESS";
//     //           break;
//     //         case "Sify Fiber":
//     //           queryObject[keys[i]] = "FIBER";
//     //           break;
//     //         case "EXPRESSCONNECT":
//     //           queryObject[keys[i]] = "DIA";
//     //           break;
//     //         default:
//     //           queryObject[keys[i]] = resultRow[i];
//     //       }
//     //     }
//     //     return queryObject;
//     //   });
//     // });

//     const results = await Promise.all(
//       queries.map(async ({ name, query }) => {
//         const startTime = performance.now();
//         const result = await oracalDb.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//         const endTime = performance.now();
//         const elapsedTime = endTime - startTime;
//         console.log(result);
//         console.log(`Execution time: ${elapsedTime} milliseconds`);
//         return { [name]: result.rows };
//       })
//     );

//     // results[0].bandwidth[0].OPG_ATTRIBUTE32 = results[3].OPG_ATTRIBUTE32[0].OPG_ATTRIBUTE32;

//     const data = {
//       status: "Success",
//       data: Object.assign({}, ...results),
//     };

//     const bandwidthArray = data.data.bandwidth;

//     if (bandwidthArray && bandwidthArray.length >= 2) {
//       const [firstItem, secondItem, ...rest] = bandwidthArray;
//       firstItem.totalArc += secondItem.totalArc;
//       data.data.bandwidth = [firstItem, ...rest];
//     }

//     logger.info(`${req.path} -- ${req.method} -- Success`);
//     res.send(data);
//   } catch (error) {
//     next(error);
//   } finally {
//     if (oracalDb) {
//       await oracalDb.close();
//     }
//   }
// };
exports.getPurchaseSummaryByLinkIdList = async (linkIdList, next) => {
  const dbConfig = {
    user: process.env.ORACAL_USERNAME,
    password: process.env.ORACAL_PASSWORD,
    connectString: process.env.ORACAL_CONNECTIONSTRING,
  };
  const oracalDb = await oracledb.getConnection(dbConfig);
  try {
    console.log(linkIdList);

    const query = `
    SELECT 
    sliv.opg_form_context "OPGFormContext",
    opg_attribute48 "classofService",
    DECODE(
      sliv.last_mile_type,
      'SIFY FIBER', 'Fiber', 
      'Sify Fiber' ,'Fiber', 
      'FIBER' ,'Fiber', 
      'Sify fiber' ,'Fiber', 
      'sify fiber', 'Fiber', 
      'FIber' ,'Fiber',
      'Sify FIBER', 'Fiber',
      'Fiber', 'Fiber',
      'SifyFiber', 'Fiber',
      'Sify RF' , 'Wireless',
      'wireless' ,'Wireless', 
      'Wireless', 'Wireless',
      'Leased Line' , 'Leased Line',
      'Sify DC' , 'Sify DC',
      'Offnet RF' , 'Offnet RF',
      'Offnet Wired Line (Ethernet)(Telco)' , 'Offnet Wired Line (Ethernet)(Telco)',
      'OffNet Wired Line (Ethernet)(Telco)' , 'OffNet Wired Line (Ethernet)(Telco)',
      'Broadband' , 'Broadband',
      'OffNet Wired Line (Ethernet' , 'OffNet Wired Line (Ethernet',
      'Broadband - MPLS' , 'Broadband - MPLS',
      'Sify' , 'Sify',
      'ISDN' , 'ISDN',
      'Ethernet Drop Sify BSTN' , 'Ethernet Drop Sify BSTN',
      'ADSL' , 'ADSL',
      'Ethernet Drop - Connected DC' , 'Ethernet Drop - Connected DC',
      '3G Datacard' , '3G Datacard',
      'Ethernet Drop - Sify PoP' , 'Ethernet Drop - Sify PoP',
      '4G LTE' , '4G LTE',
      'DR' , 'DR',
      'BSO Wireline' , 'BSO Wireline',
      'VSAT' , 'VSAT',
      'Ethernet Drop' , 'Ethernet Drop',
      'Offnet Wired Line(Non-Telco)' , 'Offnet Wired Line(Non-Telco)',
      'DC' , 'DC',
      'Ethernet Drop Sify POP' , 'Ethernet Drop Sify POP',
      'Ethernet Drop - Sify Bstn' , 'Ethernet Drop - Sify Bstn',
      'BSO Wireless' , 'BSO Wireless',
      'Ethernet' , 'Ethernet',
      'Metro Ethernet' , 'Metro Ethernet',
      'OffNet_Wired_Line_Ethernet' , 'OffNet_Wired_Line_Ethernet',
      'OFFNET WIRED LINE (ETHERNET)' , 'OFFNET WIRED LINE (ETHERNET)',
      '4G Datacard' , '4G Datacard',
      'Ethernet Drop SPDC' , 'Ethernet Drop SPDC',
      'Broadband - Internet' , 'Broadband - Internet'
    ) AS "connectionType",
    DECODE (
      OPG_ATTRIBUTE47,
      null, 1
      ) "contractPeriod",
    DECODE (
        sliv.opg_form_context,
        'Express Connect Internet','DIA',
        'Site Connect MPLS Layer 3','MPLS',
        'Site Connect MPLS Layer 2','P2P',
        'Global Cloud Connect New','GCC',
        'Colo Internet','Colo Internet',
        'Cloud Internet','Cloud Internet'
    ) "coveredProduct",
    sliv.customer_name "customerName",
    sliv.customer_code "ebsAccountNo",
    sliv.contract_end_date AS "endDate",
    sliv.link_id AS "linkId",
    sliv.bandwidth "reqBandwidth",
    sliv.uom "reqBandwidthUOM",
    sliv.product_type "serviceItem",
    sliv.site_code "shipSiteCode",
    sliv.ship_to_id "shipsiteId",
    sliv.contract_start_date "startDate",
    sliv.line_amount "totalArc",
    sliv.contract_line_status "status",
    opg_attribute32,
    sliv.ship_to_id "shipTo",
    sliv.site_code "shipToLocation",
    sliv.ship_address1 "address1",
    sliv.ship_address2 "address2",
    sliv.ship_address3 "address3",
    sliv.ship_address4 "address4",
    sliv.ship_city "city",
    sliv.ship_state "state",
    sliv.ship_postal_code "pincode",
    sliv.bill_to_id "billTo",
    sliv.bill_location "billToLocation",
    sliv.bill_address1 "billAddress1",
    sliv.bill_address2 "billAddress2",
    sliv.bill_address3 "billAddress3",
    sliv.bill_address4 "billAddress4",
    sliv.bill_city "billCity",
    sliv.bill_state "billState",
    sliv.bill_postal_code "billPincode"
FROM 
    ${process.env.ORACAL_INSTANCE} sliv
WHERE  
  sliv.product_type = 'EXPRESSCONNECT' AND
  sliv.ordered_code in ('LASTMILE-RC', 'EXPRESSCONNECT-RC') AND 
  sliv.link_id IN (${linkIdList.map((linkId) => `'${linkId}'`).join(", ")})`;

    let bandwidthData = [];
    let shippingData = [];
    let billingData = [];

    const result = await oracalDb.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

    result.rows.forEach((row) => {
      bandwidthData.push({
        OPGFormContext: row.OPGFormContext,
        classofService: row.classofService,
        connectionType: row.connectionType,
        contractPeriod: row.contractPeriod,
        coveredProduct: row.coveredProduct,
        customerName: row.customerName,
        ebsAccountNo: row.ebsAccountNo,
        endDate: row.endDate,
        linkId: row.linkId,
        reqBandwidth: row.reqBandwidth,
        reqBandwidthUOM: row.reqBandwidthUOM,
        serviceItem: row.serviceItem,
        shipSiteCode: row.shipSiteCode,
        shipsiteId: row.shipsiteId,
        startDate: row.startDate,
        totalArc: row.totalArc,
        status: row.status,
        OPG_ATTRIBUTE32: row.OPG_ATTRIBUTE32 || null,
      });

      shippingData.push({
        shipTo: row.shipTo,
        shipToLocation: row.shipToLocation,
        address1: row.address1,
        address2: row.address2,
        address3: row.address3,
        address4: row.address4,
        city: row.city,
        state: row.state,
        pincode: row.pincode,
      });

      billingData.push({
        billTo: row.billTo,
        billToLocation: row.billToLocation,
        address1: row.billAddress1,
        address2: row.billAddress2,
        address3: row.billAddress3,
        address4: row.billAddress4,
        city: row.billCity,
        state: row.billState,
        pincode: row.billPincode,
      });
    });

    const output = {
      bandwidth: bandwidthData,
      shipping: shippingData,
      billing: billingData,
    };

    const data = Object.assign({}, ...output);

    const bandwidthArray = data.bandwidth;

    const combinedBandwidth = {};

    bandwidthArray.forEach((item) => {
      const linkId = item.linkId;
      const totalArc = item.totalArc;

      if (combinedBandwidth.hasOwnProperty(linkId)) {
        combinedBandwidth[linkId].totalArc += totalArc;
      } else {
        combinedBandwidth[linkId] = {
          ...item,
        };
      }
    });

    const combinedBandwidthArray = Object.values(combinedBandwidth);

    data.bandwidth = combinedBandwidthArray;

    console.log(data);
    return data;
  } catch (error) {
    return error;
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};
// exports.getPurchaseSummaryByLinkIdList = async (linkIdList, next) => {
//   const dbConfig = {
//     user: process.env.ORACAL_USERNAME,
//     password: process.env.ORACAL_PASSWORD,
//     connectString: process.env.ORACAL_CONNECTIONSTRING,
//   };
//   const oracalDb = await oracledb.getConnection(dbConfig);
//   try {
//     console.log(linkIdList);

//     const queries = [
//       {
//         name: "bandwidth",
//         query: `
//           SELECT
//           OPG_FORM_CONTEXT "OPGFormContext",
//           OPG_ATTRIBUTE48 "classofService",
//           DECODE (
//               OPG_ATTRIBUTE4,
//               'Ethernet Drop', 'Ethernet',
//               'SIFY FIBER', 'Fiber',
//               'Sify Fiber', 'Fiber',
//               'FIBER', 'Fiber',
//               'Sify fiber', 'Fiber',
//               'sify fiber', 'Fiber',
//               'FIber', 'Fiber',
//               'Sify FIBER', 'Fiber',
//               'Fiber', 'Fiber',
//               'Sify RF', 'Wireless',
//               'wireless', 'Wireless',
//               'Wireless', 'Wireless',
//               'OFFNET WIREDLINE' , 'BSO WIRELINE',
//               'OFFNET WIRED LINE' , 'BSO WIRELINE',
//               'OFFNET WIRED NON-TELCO' , 'BSO WIRELINE',
//               'OFFNET WIRED LINE(NON-TELCO)' , 'BSO WIRELINE',
//               'OFFNET WIRED LINE (ETHERNET)' , 'Leased Line',
//               'OFFNET WIRELINE (ETHERNET) TELCO' , 'Leased Line',
//               'OFFNET WIRED LINE (ETHERNET)(TELCO)' , 'Leased Line',
//               'ETHERNET DROP SIFY POP' , 'Ethernet Drop',
//               'DC', 'SIFY DC'
//           ) "connectionType",
//           DECODE (
//             OPG_ATTRIBUTE47,
//             null, 1
//             ) "contractPeriod",
//           DECODE (
//               opg_form_context,
//               'Express Connect Internet','DIA',
//               'Site Connect MPLS Layer 3','MPLS',
//               'Site Connect MPLS Layer 2','P2P',
//               'Global Cloud Connect New','GCC',
//               'Colo Internet','Colo Internet',
//               'Cloud Internet','Cloud Internet'
//           ) "coveredProduct",
//           CUSTOMER_NAME "customerName",
//           ACCOUNT_NUMBER "ebsAccountNo",
//           CONTRACT_END_DATE "endDate",
//           LINK_ID "linkId",
//           OPG_ATTRIBUTE2 "reqBandwidth",
//           OPG_ATTRIBUTE3 "reqBandwidthUOM",
//           SERVICE_ITEM "serviceItem",
//           SHIP_TO_LOCATION "shipSiteCode",
//           SHIP_TO "shipsiteId",
//           CONTRACT_START_DATE "startDate",
//           LINE_AMOUNT "totalArc",
//           PRODUCT_STATUS "status"
//       FROM
//           ${process.env.ORACAL_INSTANCE_BW}
//       WHERE
//       OPG_FORM_CONTEXT = 'Express Connect Internet' AND
//       service_ITEM in ('LASTMILE-RC', 'EXPRESSCONNECT-RC') AND
//      link_id IN (${linkIdList.map((linkId) => `'${linkId}'`).join(", ")})`,
//       },
//       // PRODUCT_STATUS "status"
//       // contract_status !='EXPIRED'
//       // AND LINE_STATUS != 'EXPIRED'
//       // AND PRODUCT_STATUS != 'EXPIRED' AND
//       //       {
//       //         name: "ip",
//       //         query: `
//       //         SELECT SERVICE_ITEM "serviceItem",
//       //         OPG_ATTRIBUTE43     "lanipOwner",
//       //         OPG_ATTRIBUTE44     "lanipType",
//       //         OPG_ATTRIBUTE6      "ipPool",
//       //         LINE_AMOUNT "arc"
//       //    FROM ${process.env.ORACAL_INSTANCE_BW}
//       //  WHERE     SERVICE_ITEM = 'IPS-ARC'
//       //         AND COVERED_PRODUCT = 'EXPRESSCONNECT'
//       //         AND link_id = '${linkId}'
//       //         `,
//       //         // keys: ["serviceItem", "lanipOwner", "lanipType", "ipPool", "arc"],
//       //       },
//       //       {
//       //         name: "managed",
//       //         query: `
//       //         SELECT SERVICE_ITEM "serviceItem",
//       //         LINE_AMOUNT "arc",
//       //        link_id "linkId",
//       //        contract_start_date "startDate",
//       //        contract_end_date,
//       //        customer_name,
//       //        account_number
//       //   FROM ${process.env.ORACAL_INSTANCE_BW}
//       //  WHERE OPG_FORM_CONTEXT = 'Managed NOC' AND link_id = '${linkId}'
//       //         `,
//       //         // keys: ["serviceItem", "arc", "linkId", "startDate", "endDate", "customerName", "ebsAccountNo"],
//       //       },
//       //       {
//       //         name: "bundled",
//       //         query: `
//       //         SELECT SERVICE_ITEM "serviceItem",
//       //         LINE_AMOUNT "arc",
//       //         link_id "linkId",
//       //         contract_start_date "startDate",
//       //         contract_end_date "endDate",
//       //         customer_name "customerName",
//       //         account_number "ebsAccountNo"
//       //    FROM ${process.env.ORACAL_INSTANCE_BW}
//       //   WHERE OPG_FORM_CONTEXT = 'MCPE' AND link_id = '${linkId}'
//       //         `,
//       //         // keys: ["serviceItem", "arc", "linkId", "startDate", "endDate", "customerName", "ebsAccountNo"],
//       //       },
//       // {
//       //   name: "address",
//       //   query: `
//       //   SELECT
//       //   CUSTOMER_NAME "name",
//       //   COVERED_PRODUCT "coverdProduct",
//       //   BILL_TO "billTo",
//       //   BILL_TO_LOCATION "billToLocation",
//       //   BILL_TO_ADDRESS "billToAddress",
//       //   SHIP_TO "shipTo",
//       //   SHIP_TO_LOCATION "shipToLocation",
//       //   SHIP_TO_ADDRESS "shipToAddress",
//       //   CONTRACT_START_DATE "startDate",
//       //   CONTRACT_END_DATE "endDate",
//       //   OPG_ATTRIBUTE4 "connectionType"
//       //   FROM ${process.env.ORACAL_INSTANCE_BW} WHERE OPG_FORM_CONTEXT = 'Express Connect Internet'
//       //   AND contract_status !='EXPIRED' AND SERVICE_ITEM !='LASTMILE-RC' AND link_id = '${linkId}'
//       //   `,

//       // },
//       {
//         name: "shipping",
//         query: `SELECT
//         SHIP_TO_ID "shipTo",
//         SITE_CODE "shipToLocation",
//         SHIP_ADDRESS1 "address1",
//         SHIP_ADDRESS2 "address2",
//         SHIP_ADDRESS3 "address3",
//         SHIP_ADDRESS4 "address4",
//         SHIP_CITY "city",
//         SHIP_STATE "state",
//         SHIP_POSTAL_CODE "pincode",
//         LINK_ID "linkId"
//         from ${process.env.ORACAL_INSTANCE} WHERE LINK_ID IN (${linkIdList.map((linkId) => `'${linkId}'`).join(", ")}) AND
//         OPG_FORM_CONTEXT='Express Connect Internet' AND

//         ORDERED_CODE='EXPRESSCONNECT-RC'`,
//       },
//       {
//         name: "billing",
//         query: `SELECT
//         BILL_TO_ID "billTo",
//         BILL_LOCATION "billToLocation",
//         BILL_ADDRESS1 "address1",
//         BILL_ADDRESS2 "address2",
//         BILL_ADDRESS3 "address3",
//         BILL_ADDRESS4 "address4",
//         BILL_CITY "city",
//         BILL_STATE "state",
//         BILL_POSTAL_CODE "pincode",
//         LINK_ID "linkId"
//         from ${process.env.ORACAL_INSTANCE} WHERE LINK_ID IN (${linkIdList.map((linkId) => `'${linkId}'`).join(", ")}) AND
//         OPG_FORM_CONTEXT='Express Connect Internet' AND

//         ORDERED_CODE ='EXPRESSCONNECT-RC'`,
//       },
//     ];

//     const results = await Promise.all(
//       queries.map(async ({ name, query }) => {
//         const startTime = performance.now();
//         const result = await oracalDb.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
//         const endTime = performance.now();
//         const elapsedTime = endTime - startTime;

//         console.log(`Execution time for ${name}: ${elapsedTime} milliseconds`);

//         const rows = result.rows;
//         return { [name]: rows };
//       })
//     );

//     const data = Object.assign({}, ...results);

//     const bandwidthArray = data.bandwidth;

//     const combinedBandwidth = {};

//     bandwidthArray.forEach((item) => {
//       const linkId = item.linkId;
//       const totalArc = item.totalArc;

//       if (combinedBandwidth.hasOwnProperty(linkId)) {
//         combinedBandwidth[linkId].totalArc += totalArc;
//       } else {
//         combinedBandwidth[linkId] = {
//           ...item,
//         };
//       }
//     });

//     const combinedBandwidthArray = Object.values(combinedBandwidth);

//     data.bandwidth = combinedBandwidthArray;

//     // if (bandwidthArray && bandwidthArray.length >= 2) {
//     //   const aggregatedData = bandwidthArray.reduce((accumulator, currentItem) => {
//     //     accumulator.totalArc += currentItem.totalArc;
//     //     return accumulator;
//     //   });

//     //   data.data.bandwidth = [aggregatedData, ...bandwidthArray.slice(2)];
//     // }

//     console.log(data);
//     return data;
//   } catch (error) {
//     return error;
//   } finally {
//     if (oracalDb) {
//       await oracalDb.close();
//     }
//   }
// };
