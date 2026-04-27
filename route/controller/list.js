const logger = require("../config/winston");
const oracledb = require("oracledb");
const ExcelJS = require("exceljs");
const moment = require("moment");
const common = require("../common");

exports.cxm_tower_feasibility = async (req, res, next) => {
  try {
    const { limit, page, searchKeyword, parentRole, companyId } = req.body;
    const { fromDate, toDate } = req.body.filters;
    // const companyId = req.body.companyId ?? req.companyId;
    const pageNo = page - 1;

    // await common.update_feasibility(limit, page, companyId);

    const startDate = new Date(fromDate);
    startDate.setUTCHours(0, 0, 0, 0);

    const endDate = new Date(toDate);
    endDate.setUTCHours(23, 59, 59, 999);

    const dateRangeFilter = {};

    if (fromDate && toDate) {
      dateRangeFilter.createdDate = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    let query = {
      isActive: true,
      companyId,
      ...dateRangeFilter,
      cxmCommonStatus: "CHECKING FEASIBILITY",
      locationDetails: {
        $elemMatch: {
          feasibilityStatus: "CHECKING FEASIBILITY",
          cxmConformation: true,
        },
      },
      ...(searchKeyword && {
        $expr: {
          $regexMatch: {
            input: { $toString: "$reqId" },
            regex: searchKeyword,
          },
        },
      }),
    };
    console.log(query);
    const quotesCollection = db.collection("quoteills");

    const pipeline = [
      {
        $match: query,
      },
      {
        $addFields: {
          currentParentRole: parentRole, // Add the new parentRole to each document
        },
      },
      {
        $project: {
          reqId: 1,
          _id: 0,
          createdDate: 1,
          status: {
            $cond: {
              if: { $eq: ["$currentParentRole", "CXM + Customer"] },
              then: { $ifNull: ["$cxmCommonStatus", "$status"] },
              else: "$status",
            },
          },
          quoteType: 1,
          pageTracker: 1,
          modelName: 1,
          orderId: 1,
          isBulkUpload: 1,
          linkCount: { $size: "$locationDetails" },
          isFeasibleAndNotSelected: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$locationDetails",
                    as: "item",
                    cond: {
                      $and: [{ $eq: ["$$item.status", "Feasible"] }, { $eq: ["$$item.isSelect", false] }],
                    },
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $sort: { reqId: -1 },
      },
      {
        $skip: searchKeyword ? 0 : limit * pageNo,
      },
      {
        $limit: limit,
      },
    ];

    const [allFeasibility, totalRecords] = await Promise.all([quotesCollection.aggregate(pipeline).toArray(), quotesCollection.distinct("reqId", { ...query }).then((ids) => ids.length)]);
    const data = {
      limit,
      page,
      total: totalRecords,
      allFeasibility,
    };

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", data });
  } catch (error) {
    next(error);
  }
};
exports.feasibility = async (req, res, next) => {
  try {
    const { limit, page, searchKeyword } = req.body;
    const { status, fromDate, toDate } = req.body.filters;
    const companyId = req.body.companyId ?? req.companyId;
    const pageNo = page - 1;

    // await common.update_feasibility(limit, page, companyId);

    const startDate = fromDate ? new Date(fromDate).setUTCHours(0, 0, 0, 0) : null;
    const endDate = toDate ? new Date(toDate).setUTCHours(23, 59, 59, 999) : null;

    const dateRangeFilter = {};
    if (startDate || endDate) {
      dateRangeFilter.createdDate = {};
      if (startDate) dateRangeFilter.createdDate.$gte = new Date(startDate);
      if (endDate) dateRangeFilter.createdDate.$lte = new Date(endDate);
    }

    let query = {
      isActive: true,
      companyId,
      ...dateRangeFilter,
      ...(status && status.length !== 0 && { status: { $in: status } }),
      ...(searchKeyword && {
        $expr: {
          $regexMatch: {
            input: { $toString: "$reqId" },
            regex: searchKeyword,
          },
        },
      }),
    };
    console.log("Query:", query);

    const quotesCollection = db.collection("quoteills");

    const pipeline = [
      {
        $match: query,
      },
      // {
      //   $addFields: {
      //     currentParentRole: parentRole,
      //   },
      // },
      {
        $project: {
          reqId: 1,
          _id: 0,
          createdDate: 1,
          status: 1,
          quoteType: 1,
          pageTracker: 1,
          modelName: 1,
          orderId: 1,
          isBulkUpload: 1,
          linkCount: { $size: "$locationDetails" },
          isFeasibleAndNotSelected: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: "$locationDetails",
                    as: "item",
                    cond: {
                      $and: [{ $eq: ["$$item.status", "Feasible"] }, { $eq: ["$$item.isSelect", false] }],
                    },
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $sort: { reqId: -1 },
      },
      {
        $skip: searchKeyword ? 0 : limit * pageNo,
      },
      {
        $limit: limit,
      },
    ];

    // const [allFeasibility, totalRecords] = await Promise.all([Quote.aggregate(pipeline).exec(), Quote.countDocuments(query)]);
    const [allFeasibility, totalRecords] = await Promise.all([quotesCollection.aggregate(pipeline).toArray(), quotesCollection.distinct("reqId", { ...query, ...(status && status.length !== 0 && { status: { $in: status } }) }).then((ids) => ids.length)]);
    const data = {
      limit,
      page,
      total: totalRecords,
      allFeasibility,
    };

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", data });
  } catch (error) {
    next(error);
  }
};
exports.my_links = async (req, res, next, sendResponse = true) => {
  let oracalDb;
  try {
    let { ebsAccountNo, page, limit, searchKeyword, status } = req.body;
    const { connectionType, fromDate, toDate } = req.body.filters;

    oracalDb = await common.getOracleDb();

    const lastMileTypeFilter = () => {
      const commonTypes = ["SIFY FIBER", "Sify Fiber", "FIBER", "Sify fiber", "sify fiber", "FIber", "Fiber", "Sify FIBER", "SifyFiber", "wireless", "Sify RF", "Wireless"];

      if (connectionType.some((type) => type.toUpperCase() === "WIRELESS") && connectionType.length === 1) {
        return `AND last_mile_type IN ('Sify RF', 'Wireless', 'wireless')`;
      } else if (connectionType.some((type) => type.toUpperCase() === "FIBER") && connectionType.length === 1) {
        return `AND last_mile_type IN ('${commonTypes.slice(0, 9).join("', '")}')`;
      } else if (connectionType.length === 2) {
        return `AND last_mile_type IN ('${commonTypes.slice().join("', '")}')`;
      }

      return "";
    };

    const endDateFilter = () => {
      if (fromDate || toDate) {
        const queryParts = [];

        const formatDateToYYYYMMDD = (date) => {
          const day = ("0" + date.getUTCDate()).slice(-2);
          const month = ("0" + (date.getUTCMonth() + 1)).slice(-2);
          const year = date.getUTCFullYear();
          return `${year}-${month}-${day}`;
        };

        const addDateCondition = (date, isFromDate) => {
          const formattedDate = new Date(date);

          if (isFromDate) {
            formattedDate.setUTCHours(0, 0, 0, 0);
          } else {
            formattedDate.setUTCHours(23, 59, 59, 999);
          }

          const formattedDateString = formatDateToYYYYMMDD(formattedDate);
          const timePart = isFromDate ? "00:00:00" : "23:59:59";
          queryParts.push(`CONTRACT_END_DATE ${isFromDate ? ">=" : "<="} FROM_TZ(TO_TIMESTAMP('${formattedDateString} ${timePart}', 'YYYY-MM-DD HH24:MI:SS'), 'UTC')`);
        };

        if (fromDate || !toDate) addDateCondition(fromDate, true);
        if (toDate || !fromDate) addDateCondition(toDate, false);

        return `AND ${queryParts.join(" AND ")}`;
      }

      return "";
    };

    const searchKeywordFilter = () => {
      if (searchKeyword) {
        if (!isNaN(searchKeyword)) {
          return `AND LINK_ID LIKE '%${searchKeyword}%'`;
        } else {
          return `AND UPPER(SITE_CODE) LIKE '%${searchKeyword.toUpperCase()}%'`;
        }
      }
      return "";
    };

    /*     const statusFilter = () => {
          if (status) {
            return `AND CONTRACT_HEADER_STATUS = '${status}' AND
            CONTRACT_LINE_STATUS = '${status}'`;
          }
    
          return "";
        }; */

    const statusFilter = () => {
      if (status) {
        if (status === 'ACTIVE') {
          return `AND (sliv.CONTRACT_HEADER_STATUS = 'ACTIVE' OR sliv.CONTRACT_HEADER_STATUS = 'SIGNED') AND
      (sliv.CONTRACT_LINE_STATUS = 'ACTIVE' OR sliv.CONTRACT_LINE_STATUS = 'SIGNED')`;
        } else {
          return `AND sliv.CONTRACT_HEADER_STATUS = '${status}' AND
      sliv.CONTRACT_LINE_STATUS = '${status}'`;
        }
      } else {
        return `AND (sliv.CONTRACT_HEADER_STATUS = 'ACTIVE' OR sliv.CONTRACT_HEADER_STATUS = 'SIGNED') AND
    (sliv.CONTRACT_LINE_STATUS = 'ACTIVE' OR sliv.CONTRACT_LINE_STATUS = 'SIGNED')`;
      }
    };

    const totalCountQuery = `
    SELECT COUNT(*) AS total
    FROM ${process.env.ORACAL_INSTANCE} sliv
    WHERE
        sliv.product_type = 'EXPRESSCONNECT' AND
        sliv.ordered_code != 'LASTMILE-RC' AND
        sliv.customer_code = '${ebsAccountNo || req.ebsAccountNo}' AND
        sliv.bandwidth is not null
        ${statusFilter()}
        ${lastMileTypeFilter()}
        ${endDateFilter()}
        ${searchKeywordFilter()}`;
    // CONTRACT_HEADER_STATUS = 'ACTIVE' AND
    // CONTRACT_LINE_STATUS = 'ACTIVE' AND
    //EXPIRED
    console.log(totalCountQuery);
    const totalCountResult = await oracalDb.execute(totalCountQuery);
    const total = totalCountResult.rows[0][0];

    let offset;
    if (!sendResponse) {
      offset = 0;
      limit = total;
    } else {
      offset = (page - 1) * limit;
    }
    let paginatedDataQuery = `SELECT
    sliv.ORDERED_CODE,
    sliv.link_id AS "linkId",
    sliv.SITE_CODE AS "shipSiteCode",
    sliv.bandwidth AS "reqBandwidth",
    sliv.uom AS "reqBandwidthUOM",
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
    sliv.contract_end_date AS "endDate",
    sliv.contract_header_status AS "contractHeaderStatus",
    sliv.contract_line_status AS "contractLineStatus",
    sliv.ship_city AS "city",
    sliv.ship_state AS "state",
    sliv.ship_postal_code AS "pincode",
    DECODE(
      sliv.opg_form_context,
      'Express Connect Internet', 'DIA',
      'Site Connect MPLS Layer 3', 'MPLS',
      'Site Connect MPLS Layer 2', 'P2P',
      'Global Cloud Connect New', 'GCC',
      'Colo Internet', 'Colo Internet',
      'Cloud Internet', 'Cloud Internet'
    ) AS "coveredProduct"
FROM
    ${process.env.ORACAL_INSTANCE} sliv
WHERE
    sliv.product_type = 'EXPRESSCONNECT' AND
    sliv.ordered_code != 'LASTMILE-RC' AND
    sliv.customer_code = '${ebsAccountNo || req.ebsAccountNo}' AND
    sliv.bandwidth is not null
    ${lastMileTypeFilter()}
    ${statusFilter()}
    ${endDateFilter()}
    ${searchKeywordFilter()}
    ORDER BY
    CONTRACT_HEADER_STATUS ASC, CONTRACT_LINE_STATUS ASC, CONTRACT_END_DATE ASC, LINK_ID ASC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
`;

    //   let paginatedDataQuery = `SELECT
    //   OPG_FORM_CONTEXT,
    //   DECODE(
    //     OPG_FORM_CONTEXT,
    //     'Express Connect Internet', 'DIA',
    //     'Site Connect MPLS Layer 3', 'MPLS',
    //     'Site Connect MPLS Layer 2', 'P2P',
    //     'Global Cloud Connect New', 'GCC',
    //     'Colo Internet', 'Colo Internet',
    //     'Cloud Internet', 'Cloud Internet'
    //   ) AS "coveredProduct",
    //   DECODE(
    //     LAST_MILE_TYPE,
    //     'SIFY FIBER', 'Fiber',
    //     'Sify Fiber' ,'Fiber',
    //     'FIBER' ,'Fiber',
    //     'Sify fiber' ,'Fiber',
    //     'sify fiber', 'Fiber',
    //     'FIber' ,'Fiber',
    //     'Sify FIBER', 'Fiber',
    //     'Fiber', 'Fiber',
    //     'SifyFiber', 'Fiber',
    //     'Sify RF' , 'Wireless',
    //     'wireless' ,'Wireless',
    //     'Wireless', 'Wireless',
    //     'Leased Line' , 'Leased Line',
    //     'Sify DC' , 'Sify DC',
    //     'Offnet RF' , 'Offnet RF',
    //     'Offnet Wired Line (Ethernet)(Telco)' , 'Offnet Wired Line (Ethernet)(Telco)',
    //     'OffNet Wired Line (Ethernet)(Telco)' , 'OffNet Wired Line (Ethernet)(Telco)',
    //     'Broadband' , 'Broadband',
    //     'OffNet Wired Line (Ethernet' , 'OffNet Wired Line (Ethernet',
    //     'Broadband - MPLS' , 'Broadband - MPLS',
    //     'Sify' , 'Sify',
    //     'ISDN' , 'ISDN',
    //     'Ethernet Drop Sify BSTN' , 'Ethernet Drop Sify BSTN',
    //     'ADSL' , 'ADSL',
    //     'Ethernet Drop - Connected DC' , 'Ethernet Drop - Connected DC',
    //     '3G Datacard' , '3G Datacard',
    //     'Ethernet Drop - Sify PoP' , 'Ethernet Drop - Sify PoP',
    //     '4G LTE' , '4G LTE',
    //     'DR' , 'DR',
    //     'BSO Wireline' , 'BSO Wireline',
    //     'VSAT' , 'VSAT',
    //     'Ethernet Drop' , 'Ethernet Drop',
    //     'Offnet Wired Line(Non-Telco)' , 'Offnet Wired Line(Non-Telco)',
    //     'DC' , 'DC',
    //     'Ethernet Drop Sify POP' , 'Ethernet Drop Sify POP',
    //     'Ethernet Drop - Sify Bstn' , 'Ethernet Drop - Sify Bstn',
    //     'BSO Wireless' , 'BSO Wireless',
    //     'Ethernet' , 'Ethernet',
    //     'Metro Ethernet' , 'Metro Ethernet',
    //     'OffNet_Wired_Line_Ethernet' , 'OffNet_Wired_Line_Ethernet',
    //     'OFFNET WIRED LINE (ETHERNET)' , 'OFFNET WIRED LINE (ETHERNET)',
    //     '4G Datacard' , '4G Datacard',
    //     'Ethernet Drop SPDC' , 'Ethernet Drop SPDC',
    //     'Broadband - Internet' , 'Broadband - Internet'
    //   ) AS "connectionType",
    //   UOM AS "reqBandwidthUOM",
    //   SITE_CODE AS "shipSiteCode",
    //   BANDWIDTH AS "reqBandwidth",
    //   LINK_ID AS "linkId",
    //   CONTRACT_END_DATE AS "endDate",
    //   SHIP_POSTAL_CODE AS "pincode",
    //   SHIP_CITY AS "city",
    //   SHIP_STATE AS "state",
    //   CONTRACT_HEADER_STATUS AS "contractHeaderStatus",
    //   CONTRACT_LINE_STATUS AS "contractLineStatus"
    // FROM
    //   ${process.env.ORACAL_INSTANCE}
    // WHERE
    //   OPG_FORM_CONTEXT = 'Express Connect Internet' AND
    //   ORDERED_CODE = 'EXPRESSCONNECT-RC' AND
    //   customer_code = '${ebsAccountNo || req.ebsAccountNo}' AND
    //   BANDWIDTH is not null
    //   ${lastMileTypeFilter()}
    //   ${statusFilter()}
    //   ${endDateFilter()}
    //   ${searchKeywordFilter()}
    // ORDER BY
    // CONTRACT_HEADER_STATUS ASC, CONTRACT_LINE_STATUS ASC, CONTRACT_END_DATE ASC, LINK_ID ASC
    // OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    //   const result = await oracalDb.execute(paginatedDataQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    //   const data = result.rows;

    console.log(paginatedDataQuery);
    const result = await oracalDb.execute(paginatedDataQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const data = result.rows;

    if (sendResponse) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({ status: "Success", data, page, limit, total });
    }
    return data;
  } catch (error) {
    next(error);
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};
exports.all_links = async (req, res, next, sendResponse = true) => {
  let oracalDb;
  try {
    const { ebsAccountNo, page, limit, searchKeyword } = req.body;
    const { connectionType, productType, fromDate, toDate } = req.body.filters;

    const offset = (page - 1) * limit;

    oracalDb = await common.getOracleDb();

    const lastMileTypeFilter = () => {
      const commonTypes = ["SIFY FIBER", "Sify Fiber", "FIBER", "Sify fiber", "sify fiber", "FIber", "Fiber", "Sify FIBER", "SifyFiber", "wireless", "Sify RF", "Wireless"];

      if (connectionType.some((type) => type.toUpperCase() === "WIRELESS") && connectionType.length === 1) {
        return `AND LAST_MILE_TYPE IN ('Sify RF', 'Wireless', 'wireless')`;
      } else if (connectionType.some((type) => type.toUpperCase() === "FIBER") && connectionType.length === 1) {
        return `AND LAST_MILE_TYPE IN ('${commonTypes.slice(0, 9).join("', '")}')`;
      } else if (connectionType.length === 2) {
        return `AND LAST_MILE_TYPE IN ('${commonTypes.slice().join("', '")}')`;
      }

      return "";
    };

    const productTypeFilter = () => {
      const commonTypes = ["Express Connect Internet", "Site Connect MPLS Layer 3"];
      // const commonTypes = ["Express Connect Internet", "Site Connect MPLS Layer 3", "Site Connect MPLS Layer 2", "Global Cloud Connect New", "Colo Internet", "Cloud Internet"];

      if (productType.some((type) => type.toUpperCase() === "MPLS") && productType.length === 1) {
        return `AND OPG_FORM_CONTEXT = 'Site Connect MPLS Layer 3'`;
      } else if (productType.some((type) => type.toUpperCase() === "DIA") && productType.length === 1) {
        return `AND OPG_FORM_CONTEXT = 'Express Connect Internet'`;
      }

      return `AND OPG_FORM_CONTEXT IN ('${commonTypes.join("', '")}')`;
    };

    const endDateFilter = () => {
      if (fromDate && toDate) {
        let formattedFromDate = new Date(fromDate);
        let formattedToDate = new Date(toDate);

        formattedFromDate.setUTCHours(0, 0, 0, 0);
        formattedToDate.setUTCHours(23, 59, 59, 999);

        function formatDateToDDMMYY(date) {
          const day = ("0" + date.getUTCDate()).slice(-2);
          const month = ("0" + (date.getUTCMonth() + 1)).slice(-2);
          const year = date.getUTCFullYear();

          return `${day}-${month}-${year}`;
        }

        let formattedFromDateString = formatDateToDDMMYY(formattedFromDate);
        let formattedToDateString = formatDateToDDMMYY(formattedToDate);

        return `AND CONTRACT_END_DATE BETWEEN TO_DATE('${formattedFromDateString}', 'DD-MM-YY') AND TO_DATE('${formattedToDateString}', 'DD-MM-YY')`;
      }
      return "";
    };

    const searchKeywordFilter = () => {
      if (searchKeyword) {
        if (!isNaN(searchKeyword)) {
          return `AND LINK_ID LIKE '%${searchKeyword}%'`;
        } else {
          return `AND UPPER(SITE_CODE) LIKE '%${searchKeyword.toUpperCase()}%'`;
        }
      }
      return "";
    };

    const totalCountQuery = `
SELECT COUNT(*) AS total
FROM ${process.env.ORACAL_INSTANCE}
WHERE     
    ORDERED_CODE != 'LASTMILE-RC' AND 
    customer_code ='${ebsAccountNo || req.ebsAccountNo}' AND
    (CONTRACT_HEADER_STATUS = 'ACTIVE' OR CONTRACT_HEADER_STATUS = 'SIGNED') AND
    (CONTRACT_LINE_STATUS = 'ACTIVE' OR CONTRACT_LINE_STATUS = 'SIGNED')
    ${lastMileTypeFilter()}
    ${productTypeFilter()}
    ${endDateFilter()}
    ${searchKeywordFilter()}`;

    let sqlQuery = `SELECT 
    OPG_FORM_CONTEXT AS "OPGFormContext",
    DECODE (
      LAST_MILE_TYPE, 
        'Ethernet Drop', 'Ethernet',
        'SIFY FIBER', 'Fiber', 
        'Sify Fiber', 'Fiber', 
        'FIBER', 'Fiber', 
        'Sify fiber', 'Fiber', 
        'sify fiber', 'Fiber', 
        'FIber', 'Fiber',
        'Sify FIBER', 'Fiber',
        'Fiber', 'Fiber',
        'SifyFiber', 'Fiber',
        'Sify RF' , 'Wireless',
        'wireless', 'Wireless', 
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
      OPG_FORM_CONTEXT,
        'Express Connect Internet','DIA',
        'Site Connect MPLS Layer 3','MPLS',
        'Site Connect MPLS Layer 2','P2P',
        'Global Cloud Connect New','GCC',
        'Colo Internet','Colo Internet',
        'Cloud Internet','Cloud Internet'
    ) AS "coveredProduct",
    UOM AS "reqBandwidthUOM",
    SITE_CODE AS "shipSiteCode",
    BANDWIDTH AS "reqBandwidth",
    LINK_ID AS "linkId",
    CONTRACT_END_DATE AS "endDate",
    SHIP_POSTAL_CODE AS "pincode",
    SHIP_CITY AS "city",
    SHIP_STATE AS "state",
    CONTRACT_HEADER_STATUS AS "contractHeaderStatus", 
    CONTRACT_LINE_STATUS AS "contractLineStatus"
FROM
    ${process.env.ORACAL_INSTANCE}
WHERE     
    ORDERED_CODE != 'LASTMILE-RC'AND 
    customer_code ='${ebsAccountNo || req.ebsAccountNo}' AND
    (CONTRACT_HEADER_STATUS = 'ACTIVE' OR CONTRACT_HEADER_STATUS = 'SIGNED') AND
    (CONTRACT_LINE_STATUS = 'ACTIVE' OR CONTRACT_LINE_STATUS = 'SIGNED') AND
    BANDWIDTH is not null
    ${lastMileTypeFilter()}
    ${productTypeFilter()}
    ${endDateFilter()}
    ${searchKeywordFilter()}
ORDER BY 
CONTRACT_HEADER_STATUS ASC, CONTRACT_LINE_STATUS ASC, CONTRACT_END_DATE ASC, LINK_ID ASC`;
    // CONTRACT_HEADER_STATUS = 'ACTIVE'
    // AND CONTRACT_LINE_STATUS = 'ACTIVE'
    //if (!searchKeyword) {
    sqlQuery += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    //}

    const totalCountResult = await oracalDb.execute(totalCountQuery);
    const total = totalCountResult.rows[0][0];

    const startTime = performance.now();
    const result = await oracalDb.execute(sqlQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const data = result.rows;
    const endTime = performance.now();
    const elapsedTime = endTime - startTime;
    console.log(`Execution time: ${elapsedTime} milliseconds`);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", data, page, limit, total });
  } catch (error) {
    next(error);
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};
exports.get_all_links_excel = async (req, res, next) => {
  try {
    const myLinksData = await this.all_links(req, res, next, false);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    worksheet.columns = [
      { header: "Link Id", key: "linkId", width: 15 },
      { header: "Location", key: "shipSiteCode", width: 15 },
      { header: "Product", key: "coveredProduct", width: 15 },
      { header: "Connection Type", key: "connectionType", width: 20 },
      { header: "Requested Bandwidth", key: "reqBandwidth", width: 17 },
      { header: "Requested Bandwidth UOM", key: "reqBandwidthUOM", width: 19 },
      { header: "End Date", key: "endDate", width: 17 },
    ];

    worksheet.addRows(myLinksData);

    const currentDate = moment().format("DD-MMM-YYYY");

    worksheet.spliceRows(1, 0, [`Onesify Portal                                 Date: ${currentDate}`]);
    const headingRow1 = worksheet.getRow(1);
    headingRow1.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A1:I1");

    worksheet.spliceRows(2, 0, ["MPLS"]);
    const headingRow2 = worksheet.getRow(2);
    headingRow2.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A2:I2");

    const headingRow3 = worksheet.getRow(3);
    headingRow3.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "92D050" },
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

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=MPLS Order List.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
exports.get_my_links_excel = async (req, res, next) => {
  try {
    const myLinksData = await this.my_links(req, res, next, false);
    // console.log(myLinksData)
    // res.send({myLinksData})

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    worksheet.columns = [
      { header: "Link Id", key: "linkId", width: 15 },
      { header: "Location", key: "shipSiteCode", width: 15 },
      { header: "Product", key: "coveredProduct", width: 15 },
      { header: "Connection Type", key: "connectionType", width: 20 },
      { header: "Requested Bandwidth", key: "reqBandwidth", width: 17 },
      { header: "Requested Bandwidth UOM", key: "reqBandwidthUOM", width: 19 },
      { header: "End Date", key: "endDate", width: 17 },
      { header: "Status", key: "contractLineStatus", width: 17 },
    ];

    worksheet.addRows(myLinksData);

    const currentDate = moment().format("DD-MMM-YYYY");

    worksheet.spliceRows(1, 0, [`Onesify Portal                                 Date: ${currentDate}`]);
    const headingRow1 = worksheet.getRow(1);
    headingRow1.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A1:I1");

    worksheet.spliceRows(2, 0, ["DIA"]);
    const headingRow2 = worksheet.getRow(2);
    headingRow2.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A2:I2");

    const headingRow3 = worksheet.getRow(3);
    headingRow3.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "92D050" },
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

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=DIA Order List.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
exports.get_links_excel = async (req, res, next) => {
  try {
    const { fromDate, toDate, companyId } = req.body;
    const quotesCollection = db.collection("quoteills");
    const projection = {
      _id: 0,
      reqId: 1,
      connectionID: 1,
      quoteType: 1,
      provisionType: 1,
      city: 1,
      reqBandwidth: 1,
      reqBandwidthUOM: 1,
      connectionType: 1,
      createdDate: 1,
      status: 1,
    };

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
      companyId: companyId,
      isActive: true,
      ...dateRangeFilter,
    };

    const allFeasibility = await quotesCollection.find(query).sort(sort).toArray();

    if (allFeasibility.length === 0) {
      throw new Error("No Data");
    }

    console.log("allFeasibility", allFeasibility);

    const list = allFeasibility.flatMap((value) => {
      if (value.locationDetails && value.locationDetails.length > 0) {
        return value.locationDetails.map((data) => ({
          reqId: value.reqId,
          createdDate: moment(value.createdDate).format("DD-MMM-YYYY"),
          quoteType: value.quoteType,
          reqBandwidth: data.reqBandwidth,
          reqBandwidthUOM: data.reqBandwidthUOM,
          locationId: data.locationId,
          city: data.shippingAddress.city,
          connectionType: data.connectionType,
          status: value.status || data.feasibilityStatus,
          soNo: data.soNo || "",
          soUpdateDate: data.soUpdateDate || "",
          irDate: data.irDate || "",
          irUpdatedDate: data.irUpdatedDate || "",
          linkId: data.existingPlanDetails?.linkId || data.linkId || "",
          bookingNo: value.bookingNo || "",

        }));
      } else {
        return [
          {
            reqId: value.reqId,
            createdDate: moment(value.createdDate).format("DD-MMM-YYYY"),
            quoteType: value.quoteType,
            locationId: null,
            reqBandwidth: null,
            reqBandwidthUOM: null,
            city: null,
            connectionType: null,
            status: value.status,
          },
        ];
      }
    });
    console.log('list', list);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet 1");

    worksheet.columns = [
      { header: "Req Id", key: "reqId", width: 15 },
      { header: "Connection Id", key: "locationId", width: 17 },
      // { header: "Link Id", key: "existingPlanDetails.linkId", width: 17 },
      { header: "Quote Type", key: "quoteType", width: 17 },
      { header: "link Id", key: "linkId", width: 17 },
      { header: "Booking No", key: "bookingNo", width: 17 },
      { header: "IR Date", key: "irDate", width: 17 },
      { header: "City", key: "city", width: 17 },
      { header: "Req Bandwidth", key: "reqBandwidth", width: 17 },
      { header: "Req Bandwidth UOM", key: "reqBandwidthUOM", width: 19 },
      { header: "Connection Type", key: "connectionType", width: 17 },
      { header: "Created Date", key: "createdDate", width: 17 },
      { header: "Status", key: "status", width: 18 },
    ];

    worksheet.addRows(list);

    const currentDate = moment().format("DD-MMM-YYYY");

    worksheet.spliceRows(1, 0, [`Onesify Portal                                   Date: ${currentDate}`]);
    const headingRow1 = worksheet.getRow(1);
    headingRow1.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A1:L1");

    worksheet.spliceRows(2, 0, ["DIA"]);
    const headingRow2 = worksheet.getRow(2);
    headingRow2.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.font = { bold: true };
    });
    worksheet.mergeCells("A2:I2");

    const headingRow3 = worksheet.getRow(3);
    headingRow3.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "92D050" },
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
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=DIA Order List.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
// exports.get_feasibility_excel_by_reqid = async (req, res, next) => {
//   try {
//     const { reqId } = req.body;
//     const quotesCollection = db.collection("quoteills");
//     const projection = {
//       _id: 0,
//       reqId: 1,
//       connectionID: 1,
//       reqBandwidth: 1,
//       reqBandwidthUOM: 1,
//       connectionType: 1,
//       existingPlanDetails: 1,
//       contactFirstName: 1,
//       contactLastName: 1,
//       contactEmail: 1,
//       contactPhoneNumber1: 1,
//       feasibilityId: 1,
//       status: 1,
//     };

//     const sort = { reqId: -1 };

//     const query = {
//       reqId,
//       isActive: true,
//     };

//     const allFeasibility = await quotesCollection.find(query).project(projection).sort(sort).toArray();

//     if (allFeasibility.length === 0) {
//       throw new Error("No Data");
//     }

//     const workbook = new ExcelJS.Workbook();
//     const worksheet = workbook.addWorksheet("Sheet 1");

//     worksheet.columns = [
//       { header: "Link Id", key: "linkId", width: 17 },
//       { header: "Connection Id", key: "connectionID", width: 17 },
//       // { header: "Quote Type", key: "quoteType", width: 17 },
//       { header: "Connection Type", key: "connectionType", width: 17 },
//       { header: "Req Bandwidth", key: "reqBandwidth", width: 17 },
//       { header: "Req Bandwidth UOM", key: "reqBandwidthUOM", width: 19 },
//       { header: "Contact FirstName", key: "contactFirstName", width: 17 },
//       { header: "Contact LastName", key: "contactLastName", width: 17 },
//       { header: "Email", key: "contactEmail", width: 17 },
//       { header: "Phone", key: "contactPhoneNumber1", width: 17 },
//       { header: "Feasibility ID", key: "feasibilityId", width: 17 },
//       { header: "Feasibility Status", key: "status", width: 18 },
//       { header: "Place Order", key: "", width: 18 },
//     ];

//     const rowsWithCustomValues = allFeasibility.map((row) => {
//       return {
//         ...row,
//         linkId: row.existingPlanDetails.linkId,
//       };
//     });

//     worksheet.addRows(rowsWithCustomValues);

//     // worksheet.getCell("A1").protection = { locked: false, lockText: false };
//     // // -> for row: sheet.getRow(2).protection =  { locked: false, lockText: false };

//     // // step 2: protect the sheet with optional values
//     // await worksheet.protect("312dsasfafewr312edqwdqd213ed", { selectLockedCells: false, selectUnlockedCells: true });

//     // Set the column index you want to make read-only (e.g., column B is index 2)
//     const columnIndex = 2;

//     // Iterate through each row and set protection for the specified column
//     worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
//       const cell = row.getCell(columnIndex);
//       cell.protection = { locked: true, lockText: true };
//     });

//     // Set worksheet protection
//     await worksheet.protect("your_password", {
//       selectLockedCells: false,
//       selectUnlockedCells: true,
//     });

//     const headingRow3 = worksheet.getRow(1);
//     headingRow3.eachCell((cell) => {
//       cell.font = { bold: true };
//       cell.fill = {
//         type: "pattern",
//         pattern: "solid",
//         fgColor: { argb: "92D050" },
//       };
//       cell.border = {
//         top: { style: "thin" },
//         left: { style: "thin" },
//         bottom: { style: "thin" },
//         right: { style: "thin" },
//       };
//     });

//     worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
//       if (rowNumber > 2) {
//         row.eachCell((cell) => {
//           cell.alignment = { horizontal: "left" };
//         });
//       }
//     });

//     const buffer = await workbook.xlsx.writeBuffer();

//     res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
//     res.setHeader("Content-Disposition", "attachment; filename=DIA Link List.xlsx");
//     res.send(buffer);
//   } catch (error) {
//     next(error);
//   }
// };
exports.get_feasibility_excel_by_reqid = async (req, res, next) => {
  try {
    const { reqId } = req.body;
    const quotesCollection = db.collection("quoteills");

    const quote = await quotesCollection.findOne({
      reqId,
      isActive: true,
    });

    if (!quote) {
      throw new Error("No Data");
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");

    const headers = ["Link Id", "Connection Id", "Connection Type", "Req Bandwidth", "Req Bandwidth UOM", "Contact FirstName", "Contact LastName", "Email", "Contact Phone", "Feasibility ID", "Feasibility Status", "Place Order"];
    const headerRow = worksheet.addRow(headers);

    quote.locationDetails.forEach((row) => {
      const {
        existingPlanDetails: { linkId },
        locationId,
        connectionType,
        reqBandwidth,
        reqBandwidthUOM,
        contactDetails: { contactFirstName, contactLastName, contactEmail, contactPhoneNumber1 },
        feasibilityId,
        feasibilityStatus,
      } = row;
      const rowData = [linkId, locationId, connectionType, reqBandwidth, reqBandwidthUOM, contactFirstName, contactLastName, contactEmail, contactPhoneNumber1, feasibilityId, feasibilityStatus, ""];
      const dataValidation = {
        type: "list",
        formulae: ['"Yes,No"'],
        showErrorMessage: true,
        errorTitle: "Invalid Input",
        error: "Please select a value from the list.",
      };
      worksheet.addRow(rowData).eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber === 12) {
          cell.dataValidation = dataValidation;
          cell.protection = { locked: false };
        } else {
          cell.protection = { locked: true };
        }
      });
    });
    const customWidths = [
      15, // Link Id
      15, // Connection Id
      20, // Connection Type
      15, // Req Bandwidth
      20, // Req Bandwidth UOM
      20, // Contact FirstName
      20, // Contact LastName
      25, // Email
      15, // Contact Phone
      15, // Feasibility ID
      20, // Feasibility Status
      10, // Place Order
    ];

    headerRow.eachCell((cell, colNumber) => {
      const customWidth = customWidths[colNumber - 1];
      worksheet.getColumn(colNumber).width = customWidth;
    });
    // const phoneColumn = worksheet.getColumn(headers.indexOf("Contact Phone") + 1);
    // phoneColumn.eachCell({ includeEmpty: true }, (cell) => {
    //   cell.numFmt = "0"; // Set cell format as text
    // });

    // headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    //   const headerLength = cell.value ? cell.value.toString().length : 0;
    //   worksheet.getColumn(colNumber).width = headerLength + 2;
    // });

    await worksheet.protect("your_password", {
      selectLockedCells: false,
      selectUnlockedCells: true,
    });

    const headingRow3 = worksheet.getRow(1);
    headingRow3.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "92D050" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=DIA Link List.xlsx");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
