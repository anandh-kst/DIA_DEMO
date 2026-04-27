const logger = require("../config/winston");
const common = require("../common");
const ExcelJS = require("exceljs");
const https = require("https");
const moment = require("moment");
const { default: axios } = require("axios");
const fs = require("fs");
const handlebars = require("handlebars");
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

exports.get_contract_period = async (req, res, next) => {
  try {
    const { reqId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const { hasRateCard, ebsAccountNo, rateCode } = quote;
    let contractPeriod = ["1", "2", "3"];

    if (hasRateCard) {
      const getDate = await axios.get(
        process.env.DATE_URL,
        {
          headers: {
            apikey: process.env.ERP_API_KEY,
          },
        },
        { httpsAgent }
      );
      console.log(getDate.data);
      let dateData = getDate.data.data.filter((item) => item.account_number == ebsAccountNo && item.price_sheet == rateCode);
      console.log(dateData);
      contractPeriod = [dateData[0] ? dateData[0].contract_period : null];
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", data: contractPeriod });
  } catch (error) {
    next(error);
  }
};
exports.get_base_plan_details = async (req, res, next) => {
  try {
    const { reqId, locationId, contractPeriod, contractUnit, updatePrice } = req.body;
    if (!reqId || !locationId || !contractPeriod || !contractUnit) throw new Error("Missing required parameters: reqId, contractPeriod or contractUnit.");

    const postContractPeriod = await Quote.findOneAndUpdate(
      { reqId },
      {
        $set: {
          "locationDetails.$[elem].contractPeriod": contractPeriod,
          "locationDetails.$[elem].contractUnit": contractUnit,
        },
      },
      {
        arrayFilters: [{ "elem.locationId": locationId }],
      }
    );
    if (!postContractPeriod) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const quote = await Quote.findOne({ reqId });
    const { hasRateCard, rateCode } = quote;
    const locationDetails = quote.locationDetails.find((item) => item.locationId === locationId);

    let { reqBandwidth, valueAddedService = [], additionalPrice = [], connectionType, mastHeight, cxmConformation, mastType, opex, capex, otherIspOtc, otherIspArc } = locationDetails;

    if (connectionType === "Other ISP") {
      opex = otherIspArc;
      capex = otherIspOtc;
    }

    const basePlan = {
      plans: [],
      valueAddedService: [
        { serviceType: "ip", isSelect: false, name: "Additional IPs", desc: "" },
        { serviceType: "managedBundled", isSelect: false, name: "Managed Bundled Router", desc: "The bundled router charges will vary depending on the contact period." },
        { serviceType: "ddos", isSelect: false, name: "DDOS", desc: "" },
      ],
      additionalPrice: [],
    };

    if (hasRateCard && rateCode.includes("CXM_RC_SPL")) {
      if (connectionType === "Other ISP") {
        connectionType = "Fiber";
      }
      const dbCollection = db.collection("cxmrcprices");
      const baseprice = await dbCollection.find({ product: "DIA", type: /bw/, bandwidth: reqBandwidth, connectionType, rateCode }).toArray();
      console.log({ product: "DIA", type: /bw/, bandwidth: reqBandwidth, connectionType, rateCode });
      if (baseprice.length === 0) throw new Error("Baseprice Has No Data");

      for await (const addOn of basePlan.valueAddedService) {
        addOn.arc = addOn.arc || 0;
        addOn.otc = addOn.otc || 0;

        let matched = false;

        for (const quoteAddOn of valueAddedService) {
          if (addOn.serviceType === "managedBundled" && (quoteAddOn.serviceType === "managed" || quoteAddOn.serviceType === "bundled")) {
            addOn.arc += quoteAddOn.arc || 0;
            addOn.otc += quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          } else if (addOn.serviceType === "ddos" && quoteAddOn.serviceType === "ddos") {
            addOn.arc = quoteAddOn.arc || 0;
            addOn.otc = quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          } else if (addOn.serviceType === "ip" && quoteAddOn.serviceType === "ip") {
            addOn.arc = quoteAddOn.arc || 0;
            addOn.otc = quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          }
        }
        if (!matched) {
          addOn.arc = null;
          addOn.otc = null;
          addOn.isSelect = false; // Optionally set isSelect to false
        }
      }

      if (connectionType === "Wireless" && parseInt(mastHeight) !== 0 && !cxmConformation) {
        const tower = await dbCollection.find({ type: "tower", bandwidth: mastHeight, rateCode }).toArray();
        console.log({ type: "tower", bandwidth: mastHeight, rateCode });
        const hasTowerPrice = tower.length > 0;

        basePlan.additionalPrice.push({
          priceType: "tower",
          arc: 0,
          otc: hasTowerPrice ? tower[0].otc : 0,
          actualARC: 0,
          actualOTC: hasTowerPrice ? tower[0].otc : 0,
          mastHeight: mastHeight,
          unit: tower[0]?.unit || "Meter",
          mastType: mastType,
        });
        await Quote.findOneAndUpdate(
          { reqId },
          {
            $set: {
              "locationDetails.$[elem].additionalPrice": basePlan.additionalPrice,
            },
          },
          {
            arrayFilters: [{ "elem.locationId": locationId }],
          }
        );
      } else if (cxmConformation) {
        basePlan.additionalPrice = additionalPrice.filter((data) => data.priceType === "tower").map((data) => data);
      }

      const planTypes = ["Value", "Premium"];
      const plans = planTypes.reduce((acc, type) => {
        acc[type.toLowerCase()] = {};
        return acc;
      }, {});
      const connectionTypePrice = planTypes.reduce((acc, type) => {
        acc[type] = {};
        return acc;
      }, {});

      const plansToAdd = new Set();

      planTypes.forEach((planType) => {
        baseprice
          .filter((data) => data.plan === planType)
          .forEach((data) => {
            const plan = plans[planType.toLowerCase()];
            const connectionTypePrices = connectionTypePrice[planType];
            plan.arc = data.arc;
            plan.otc = data.otc;
            connectionTypePrices.arc = data.lastMileArc;
            connectionTypePrices.otc = 0;
            plansToAdd.add(planType);
          });
      });

      const calculatePrice = async (markupPrice, planType, planName, property) => {
        const isFiberConnection = connectionType === "Fiber" || connectionType === "Other ISP";
        const baseValue = planType[property] + connectionTypePrice[planName][property];

        if (isFiberConnection) {
          if (!markupPrice) {
            return Math.round(baseValue);
          } else {
            connectionTypePrice[property] = markupPrice;
            return Math.round(planType[property] + markupPrice);
          }
        } else {
          return Math.round(baseValue);
        }
      };

      const addPlan = async (planType, planName) => {
        const arc = await calculatePrice(opex, planType, planName, "arc");
        const otc = await calculatePrice(capex, planType, planName, "otc");
        console.log("additionalPrice", basePlan.additionalPrice);
        basePlan.plans.push({
          planType: planName,
          lastmileType: connectionType === "Fiber" || connectionType === "Other ISP" ? "SifyFiber" : "SifyRF",
          erpPlanName: "EXPRESSCONNECT",
          arc,
          otc,
          totalARC: arc + (basePlan.additionalPrice[0]?.arc || 0),
          totalOTC: otc + (basePlan.additionalPrice[0]?.otc || 0),
          bandwidthARC: planType.arc,
          bandwidthOTC: planType.otc,
          connectionTypeARC: connectionTypePrice[planName].arc,
          connectionTypeOTC: connectionTypePrice[planName].otc,
          desc:
            planName === "Value"
              ? ["1. Suitable for Small and medium enterprise having dependency on Internet for Day to day operations.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. IPV4 and IPV6 compatible with IP advertisements done in major International PoP’s locations like Singapore and London.", "4. Unlimited and un-contended Internet Bandwidth with no fair usage policy.", "5. Latency and uptime centric offering with Service levels and service credits available as part of SLA commitments.", "6. Can subscribe on the go for Sify’s value added services like Clean Connect, Managed Router and Managed network services like Pro-Active network monitoring."]
              : ["1. Suitable for enterprise organisations having latency sensitive applications operating on Internet.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. High availability with industry best latencies to any geographies across the Globe.", "4. Highly prioritised product variant with premium customers getting the top priority during cable cuts and International outage.", "5. 100% committed bandwidth restoration in case of any outage which is not termed as “force Majeure”.", "6. Unlimited and un-contended Internet Bandwidth with no fair usage policy."],
          // : ["1. Suitable for enterprise organisations having latency sensitive applications operating on Internet.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. High availability with industry best latencies to any geographies across the Globe.", "4. Highly prioritised product variant with premium customers getting the top priority during cable cuts and International outage.", "5. 100% committed bandwidth restoration in case of any outage which is not termed as “force Majeure”.", "6. Unlimited and un-contended Internet Bandwidth with no fair usage policy."],
        });
      };

      await Promise.all(Array.from(plansToAdd).map((planName) => addPlan(plans[planName.toLowerCase()], planName)));
    } else if (hasRateCard) {
      if (updatePrice) {
        const [bundledData, managedData] = await Promise.all([db.collection("baseyearprice").findOne({ plan: "bundled", Max_Bandwidth: reqBandwidth }), db.collection("baseprice").find({ plan: "managed", Type: "Link" }).toArray()]);
        console.log(bundledData, managedData);
        if (!bundledData || !managedData) {
          throw new Error("No Data");
        }

        const calculateBundledPrice = (data, priceType) => {
          const priceData = data.find((item) => item.Price_Type === priceType);
          return priceData ? Math.round(priceData.Price) : "";
        };

        const arcPrice = calculateBundledPrice(managedData, "ARC");
        const otcPrice = calculateBundledPrice(managedData, "OTC");

        const updateServiceDetails = (details, serviceType) => {
          if (serviceType === "bundled") {
            details.arc = Math.round(bundledData[`Year${contractPeriod}`]);
            details.totalcost = details.arc;
          } else if (serviceType === "managed") {
            details.otc = otcPrice;
            details.arc = arcPrice;
            details.totalcost = (otcPrice === "" ? "" : otcPrice) + (arcPrice === "" ? "" : arcPrice);
          }
        };

        valueAddedService.forEach((element) => {
          updateServiceDetails(element, element.serviceType);
        });

        const updateResult = await Quote.findOneAndUpdate(
          { reqId },
          {
            $set: { "locationDetails.$[elem].valueAddedService": valueAddedService },
          },
          {
            arrayFilters: [{ "elem.locationId": locationId }],
            new: true,
          }
        );
        const updatePrice = await common.update_price(reqId, next);
        if (!updateResult || !updatePrice) throw new Error("Insert Failed");
      }

      const dbCollection = db.collection(hasRateCard ? "ratecardprices" : "baseprice");
      const baseprice = await dbCollection.find({ plan: /bw/, bandwidth: reqBandwidth, Price_Sheet: hasRateCard ? rateCode : "BASE" }).toArray();

      if (baseprice.length === 0) throw new Error("Baseprice Has No Data");

      const discountData = await db
        .collection("baseyearprice")
        .find({ Part_code: /EXPRESSCONNECT/ })
        .toArray();

      const discount = discountData.reduce((acc, val) => {
        if (val.Part_code.includes("RC")) acc.arc = val[`Year${contractPeriod}`];
        if (val.Part_code.includes("OT")) acc.otc = val[`Year${contractPeriod}`];
        return acc;
      }, {});

      for await (const addOn of basePlan.valueAddedService) {
        addOn.arc = addOn.arc || 0;
        addOn.otc = addOn.otc || 0;

        let matched = false;

        for (const quoteAddOn of valueAddedService) {
          if (addOn.serviceType === "managedBundled" && (quoteAddOn.serviceType === "managed" || quoteAddOn.serviceType === "bundled")) {
            addOn.arc += quoteAddOn.arc || 0;
            addOn.otc += quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          } else if (addOn.serviceType === "ddos" && quoteAddOn.serviceType === "ddos") {
            addOn.arc = quoteAddOn.arc || 0;
            addOn.otc = quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          } else if (addOn.serviceType === "ip" && quoteAddOn.serviceType === "ip") {
            addOn.arc = quoteAddOn.arc || 0;
            addOn.otc = quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          }
        }
        if (!matched) {
          addOn.arc = null;
          addOn.otc = null;
          addOn.isSelect = false;
        }
      }

      if (connectionType === "Wireless" && parseInt(mastHeight) !== 0 && !cxmConformation) {
        const tower = await dbCollection.find({ plan: "tower", bandwidth: mastHeight, Price_Sheet: hasRateCard ? rateCode : "BASE" }).toArray();
        console.log(tower);
        const hasTowerPrice = tower.length > 0;

        basePlan.additionalPrice.push({
          priceType: "tower",
          arc: 0,
          otc: hasTowerPrice ? tower[0].Price : 0,
          actualARC: 0,
          actualOTC: hasTowerPrice ? tower[0].Price : 0,
          mastHeight: mastHeight,
          unit: tower[0]?.unit || "Meter",
          mastType: mastType,
        });
        await Quote.findOneAndUpdate(
          { reqId },
          {
            $set: {
              "locationDetails.$[elem].additionalPrice": basePlan.additionalPrice,
            },
          },
          {
            arrayFilters: [{ "elem.locationId": locationId }],
          }
        );
      } else if (cxmConformation) {
        basePlan.additionalPrice = additionalPrice.filter((data) => data.priceType === "tower").map((data) => data);
      }

      const planTypes = ["Value", "Premium"];
      const plans = planTypes.reduce((acc, type) => {
        acc[type.toLowerCase()] = {};
        return acc;
      }, {});
      let connectionTypePrice = { arc: 0, otc: 0 };
      const plansToAdd = new Set();

      planTypes.forEach((planType) => {
        baseprice
          .filter((data) => data.Condition3 === `serviceVariant=${planType}`)
          .forEach((data) => {
            const plan = plans[planType.toLowerCase()];
            if (data.Part_Code === "EXPRESSCONNECT-RC") {
              plan.arc = data.Price;
            } else if (data.Part_Code === "EXPRESSCONNECT-OT") {
              plan.otc = data.Price;
            }
            plansToAdd.add(planType);
          });
      });

      baseprice.forEach((data) => {
        if ((data.plan === "bw_fiber" && (connectionType === "Fiber" || connectionType === "Other ISP")) || (data.plan === "bw_rf" && connectionType === "Wireless")) {
          if (data.Part_Code === "LASTMILE-RC") connectionTypePrice.arc = data.Price;
          else if (data.Part_Code === "LASTMILE-OT") connectionTypePrice.otc = data.Price;
        }
      });

      const calculatePrice = async (markupPrice, planType, property, noDiscount) => {
        const isFiberConnection = connectionType === "Fiber" || connectionType === "Other ISP";
        const baseValue = planType[property] - (noDiscount ? (planType[property] * discount[property]) / 100 : 0) + connectionTypePrice[property];

        if (isFiberConnection) {
          if (!markupPrice) {
            return Math.round(baseValue);
          } else {
            connectionTypePrice[property] = markupPrice;
            return Math.round(planType[property] - (noDiscount ? (planType[property] * discount[property]) / 100 : 0) + markupPrice);
          }
        } else {
          return Math.round(baseValue);
        }
      };

      const addPlan = async (planType, planName) => {
        const arc = await calculatePrice(opex, planType, "arc", true);
        const otc = await calculatePrice(capex, planType, "otc", true);
        const noDiscountARC = await calculatePrice(opex, planType, "arc", false);
        const noDiscountOTC = await calculatePrice(capex, planType, "otc", false);

        basePlan.plans.push({
          planType: planName,
          lastmileType: connectionType === "Fiber" || connectionType === "Other ISP" ? "SifyFiber" : "SifyRF",
          erpPlanName: "EXPRESSCONNECT",
          arc,
          otc,
          noDiscountARC,
          noDiscountOTC,
          discountARCPer: discount.arc,
          discountOTCPer: discount.otc,
          totalARC: arc + (basePlan.additionalPrice[0]?.arc || 0),
          totalOTC: otc + (basePlan.additionalPrice[0]?.otc || 0),
          bandwidthARC: planType.arc,
          bandwidthOTC: planType.otc,
          connectionTypeARC: connectionTypePrice.arc,
          connectionTypeOTC: connectionTypePrice.otc,
          desc:
            planName === "Value"
              ? ["1. Suitable for Small and medium enterprise having dependency on Internet for Day to day operations.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. IPV4 and IPV6 compatible with IP advertisements done in major International PoP’s locations like Singapore and London.", "4. Unlimited and un-contended Internet Bandwidth with no fair usage policy.", "5. Latency and uptime centric offering with Service levels and service credits available as part of SLA commitments.", "6. Can subscribe on the go for Sify’s value added services like Clean Connect, Managed Router and Managed network services like Pro-Active network monitoring."]
              : ["1. Suitable for enterprise organisations having latency sensitive applications operating on Internet.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. High availability with industry best latencies to any geographies across the Globe.", "4. Highly prioritised product variant with premium customers getting the top priority during cable cuts and International outage.", "5. 100% committed bandwidth restoration in case of any outage which is not termed as “force Majeure”.", "6. Unlimited and un-contended Internet Bandwidth with no fair usage policy."],
          // : ["1. Suitable for enterprise organisations having latency sensitive applications operating on Internet.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. High availability with industry best latencies to any geographies across the Globe.", "4. Highly prioritised product variant with premium customers getting the top priority during cable cuts and International outage.", "5. 100% committed bandwidth restoration in case of any outage which is not termed as “force Majeure”.", "6. Unlimited and un-contended Internet Bandwidth with no fair usage policy."],
        });
      };

      await Promise.all(Array.from(plansToAdd).map((planName) => addPlan(plans[planName.toLowerCase()], planName)));
    } else {
      if (updatePrice) {
        const managedBundled = await db.collection("cpprices").findOne({ type: "managedBundled", filter_min: { $lte: reqBandwidth }, filter_max: { $gte: reqBandwidth } });

        if (!managedBundled) {
          throw new Error("No Data");
        }

        const updateServiceDetails = (details, serviceType) => {
          if (serviceType === "bundled") {
            details.otc = managedBundled.otc;
            details.arc = Math.round(managedBundled[`Year${contractPeriod}`]);
            details.totalcost = managedBundled.otc + Math.round(managedBundled[`Year${contractPeriod}`]);
          } else if (serviceType === "managed") {
            details.otc = 0;
            details.arc = managedBundled.managedArc;
            details.totalcost = managedBundled.managedArc;
          }
        };

        valueAddedService.forEach((element) => {
          updateServiceDetails(element, element.serviceType);
        });

        const updateResult = await Quote.findOneAndUpdate(
          { reqId },
          {
            $set: { "locationDetails.$[elem].valueAddedService": valueAddedService },
          },
          {
            arrayFilters: [{ "elem.locationId": locationId }],
            new: true,
          }
        );
        const updatePrice = await common.update_price(reqId, next);
        if (!updateResult || !updatePrice) throw new Error("Insert Failed");
      }

      if (connectionType === "Other ISP") {
        connectionType = "Fiber";
      }
      const dbCollection = db.collection("cpprices");
      const baseprice = await dbCollection.find({ product: "DIA", type: /bw/, bandwidth: reqBandwidth, connectionType }).toArray();
      console.log({ product: "DIA", type: /bw/, bandwidth: reqBandwidth, connectionType });
      if (baseprice.length === 0) throw new Error("Baseprice Has No Data");

      for await (const addOn of basePlan.valueAddedService) {
        addOn.arc = addOn.arc || 0;
        addOn.otc = addOn.otc || 0;

        let matched = false;

        for (const quoteAddOn of valueAddedService) {
          if (addOn.serviceType === "managedBundled" && (quoteAddOn.serviceType === "managed" || quoteAddOn.serviceType === "bundled")) {
            addOn.arc += quoteAddOn.arc || 0;
            addOn.otc += quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          } else if (addOn.serviceType === "ddos" && quoteAddOn.serviceType === "ddos") {
            addOn.arc = quoteAddOn.arc || 0;
            addOn.otc = quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          } else if (addOn.serviceType === "ip" && quoteAddOn.serviceType === "ip") {
            addOn.arc = quoteAddOn.arc || 0;
            addOn.otc = quoteAddOn.otc || 0;
            addOn.isSelect = quoteAddOn.isSelect;
            matched = true;
          }
        }
        if (!matched) {
          addOn.arc = null;
          addOn.otc = null;
          addOn.isSelect = false; // Optionally set isSelect to false
        }
      }

      if (connectionType === "Wireless" && parseInt(mastHeight) !== 0 && !cxmConformation) {
        const tower = await dbCollection.find({ type: "tower", bandwidth: mastHeight }).toArray();
        console.log(tower);
        const hasTowerPrice = tower.length > 0;

        basePlan.additionalPrice.push({
          priceType: "tower",
          arc: 0,
          otc: hasTowerPrice ? tower[0].otc : 0,
          actualARC: 0,
          actualOTC: hasTowerPrice ? tower[0].otc : 0,
          mastHeight: mastHeight,
          unit: tower[0]?.unit || "Meter",
          mastType: mastType,
        });
        await Quote.findOneAndUpdate(
          { reqId },
          {
            $set: {
              "locationDetails.$[elem].additionalPrice": basePlan.additionalPrice,
            },
          },
          {
            arrayFilters: [{ "elem.locationId": locationId }],
          }
        );
      } else if (cxmConformation) {
        basePlan.additionalPrice = additionalPrice.filter((data) => data.priceType === "tower").map((data) => data);
      }

      const planTypes = ["Value", "Premium"];
      const plans = planTypes.reduce((acc, type) => {
        acc[type.toLowerCase()] = {};
        return acc;
      }, {});
      const connectionTypePrice = planTypes.reduce((acc, type) => {
        acc[type] = {};
        return acc;
      }, {});

      const plansToAdd = new Set();

      planTypes.forEach((planType) => {
        baseprice
          .filter((data) => data.plan === planType)
          .forEach((data) => {
            const plan = plans[planType.toLowerCase()];
            const connectionTypePrices = connectionTypePrice[planType];
            plan.arc = data.arc;
            plan.otc = data.otc;
            connectionTypePrices.arc = data.lastMileArc;
            connectionTypePrices.otc = 0;
            plan.msp = data.msp || 0;
            plansToAdd.add(planType);
          });
      });

      const calculatePrice = async (markupPrice, planType, planName, property) => {
        const isFiberConnection = connectionType === "Fiber" || connectionType === "Other ISP";
        const baseValue = planType[property] + connectionTypePrice[planName][property];

        if (!isFiberConnection) {
          return Math.round(baseValue);
        }

        // if (!markupPrice) {
        //   return Math.round(baseValue);
        // }

        connectionTypePrice[property] = markupPrice;

        if (property === "arc") {
          const calculatedPrice = Math.round(planType[property] + markupPrice);
          console.log(planType.msp);
          return calculatedPrice < planType.msp ? planType.msp : Math.round(planType.msp + markupPrice);
        }
        return Math.round(planType[property] + markupPrice);
      };

      const addPlan = async (planType, planName) => {
        const arc = await calculatePrice(opex, planType, planName, "arc");
        const otc = await calculatePrice(capex, planType, planName, "otc");
        console.log("additionalPrice", basePlan.additionalPrice);
        basePlan.plans.push({
          planType: planName,
          lastmileType: connectionType === "Fiber" || connectionType === "Other ISP" ? "SifyFiber" : "SifyRF",
          erpPlanName: "EXPRESSCONNECT",
          arc,
          otc,
          totalARC: arc + (basePlan.additionalPrice[0]?.arc || 0),
          totalOTC: otc + (basePlan.additionalPrice[0]?.otc || 0),
          bandwidthARC: planType.arc,
          bandwidthOTC: planType.otc,
          connectionTypeARC: connectionTypePrice[planName].arc,
          connectionTypeOTC: connectionTypePrice[planName].otc,
          desc:
            planName === "Value"
              ? ["1. Suitable for Small and medium enterprise having dependency on Internet for Day to day operations.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. IPV4 and IPV6 compatible with IP advertisements done in major International PoP’s locations like Singapore and London.", "4. Unlimited and un-contended Internet Bandwidth with no fair usage policy.", "5. Latency and uptime centric offering with Service levels and service credits available as part of SLA commitments.", "6. Can subscribe on the go for Sify’s value added services like Clean Connect, Managed Router and Managed network services like Pro-Active network monitoring."]
              : ["1. Suitable for enterprise organisations having latency sensitive applications operating on Internet.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. High availability with industry best latencies to any geographies across the Globe.", "4. Highly prioritised product variant with premium customers getting the top priority during cable cuts and International outage.", "5. 100% committed bandwidth restoration in case of any outage which is not termed as “force Majeure”.", "6. Unlimited and un-contended Internet Bandwidth with no fair usage policy."],
          // : ["1. Suitable for enterprise organisations having latency sensitive applications operating on Internet.", "2. Burst and Fixed bandwidth offerings with Pay as per use model (Speak to our Customer Care executive to avail this offer).", "3. High availability with industry best latencies to any geographies across the Globe.", "4. Highly prioritised product variant with premium customers getting the top priority during cable cuts and International outage.", "5. 100% committed bandwidth restoration in case of any outage which is not termed as “force Majeure”.", "6. Unlimited and un-contended Internet Bandwidth with no fair usage policy."],
        });
      };

      await Promise.all(Array.from(plansToAdd).map((planName) => addPlan(plans[planName.toLowerCase()], planName)));
    }
    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({
      status: "Success",
      data: basePlan,
    });
  } catch (error) {
    next(error);
  }
};
exports.get_modify_base_plan = async (req, res, next, sendResponse = true) => {
  try {
    const { reqId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    let { locationDetails, hasRateCard, rateCode, parentRole } = quote;
    locationDetails = locationDetails.filter((item) => item.isSelect === true);
    let isCxm = parentRole === "CXM + Customer";

    let basePlan = {
      plans: [],
    };

    for await (const [i, data] of locationDetails.entries()) {
      let additionalPrice = [];
      const { provisionType } = data;
      const hasOtc = provisionType !== "Downgrade" && provisionType !== "Upgrade";
      let { classofService, contractPeriod, linkId, reqBandwidth, reqBandwidthUOM, connectionType, totalArc } = data.existingPlanDetails;
      console.log(" data", data);
      console.log("existingPlanDetails", data.existingPlanDetails);
      if (hasRateCard) {
        const dbCollection = db.collection(hasRateCard ? "ratecardprices" : "baseprice");
        const baseprice = await dbCollection.find({ plan: /bw/, bandwidth: data.reqBandwidth, Condition3: `serviceVariant=${classofService}`, Price_Sheet: hasRateCard ? rateCode : "BASE" }).toArray();
        console.log(baseprice);
        if (baseprice.length === 0) throw new Error("No Data");
        if (!contractPeriod) {
          contractPeriod = 1;
        }
        let planData = {};
        let connectionTypePrice = {
          arc: 0,
          otc: 0,
        };

        const discountData = await db
          .collection("baseyearprice")
          .find({ Part_code: /EXPRESSCONNECT/ })
          .toArray();

        const discount = discountData.reduce((acc, val) => {
          if (val.Part_code.includes("RC")) acc.arc = val[`Year${contractPeriod}`];
          if (val.Part_code.includes("OT")) acc.otc = val[`Year${contractPeriod}`];
          return acc;
        }, {});

        if (data.connectionType === "Wireless" && data.mastHeight !== 0 && !data.cxmConformation) {
          const tower = await dbCollection.find({ plan: "tower", bandwidth: data.mastHeight, Price_Sheet: hasRateCard ? rateCode : "" }).toArray();
          // if (tower === 0) throw "No Data";
          additionalPrice.push({
            priceType: "tower",
            arc: 0,
            otc: tower[0]?.Price || 0,
            actualARC: 0,
            actualOTC: tower[0]?.Price || 0,
            mastHeight: data.mastHeight,
            unit: tower[0]?.unit || "Meter",
            mastType: data.mastType,
          });
          // const updateResult = await Quote.findOneAndUpdate(
          //   { reqId },
          //   {
          //     $set: { "locationDetails.$[elem].additionalPrice": additionalPrice },
          //   },
          //   {
          //     arrayFilters: [{ "elem.locationId": locationId }],
          //     new: true,
          //   }
          // );
        } else if (data.cxmConformation) {
          additionalPrice = data.additionalPrice.filter((data) => data.priceType === "tower").map((data) => data);
        }
        console.log("tower", additionalPrice);

        for await (const value of baseprice) {
          if (value.Part_Code === "EXPRESSCONNECT-RC") {
            planData.arc = value.Price;
          } else if (value.Part_Code === "EXPRESSCONNECT-OT") {
            planData.otc = hasOtc ? value.Price : 0;
          }

          if ((value.plan === "bw_fiber" && (data.connectionType === "Fiber" || data.connectionType === "Other ISP")) || (value.plan === "bw_rf" && data.connectionType === "Wireless")) {
            if (value.Part_Code === "LASTMILE-RC") {
              connectionTypePrice.arc = value.Price;
            } else if (value.Part_Code === "LASTMILE-OT") {
              connectionTypePrice.otc = hasOtc ? value.Price : 0;
            }
          }
        }

        let opex = data.opex;
        let capex = data.capex;

        if (data.connectionType === "Other ISP") {
          opex = data.otherIspOtc;
          capex = data.otherIspArc;
        }
        const calculatePrice = async (markupPrice, planType, property, noDiscount) => {
          const isFiberConnection = data.connectionType === "Fiber" || data.connectionType === "Other ISP";
          const baseValue = planType[property] - (noDiscount ? (planType[property] * discount[property]) / 100 : 0) + connectionTypePrice[property];

          if (isFiberConnection) {
            if (!markupPrice) {
              return Math.round(baseValue);
            } else {
              console.log(property, markupPrice);
              connectionTypePrice[property] = markupPrice;
              return Math.round(planType[property] - (noDiscount ? (planType[property] * discount[property]) / 100 : 0) + markupPrice);
            }
          } else {
            return Math.round(baseValue);
          }
        };
        console.log(planData);
        let lastmileType = data.connectionType === "Fiber" || data.connectionType === "Other ISP" ? "SifyFiber" : "SifyRF";

        let arc = await calculatePrice(opex, planData, "arc", true);
        let otc = await calculatePrice(capex, planData, "otc", true);
        let noDiscountARC = await calculatePrice(opex, planData, "arc", false);
        let noDiscountOTC = await calculatePrice(capex, planData, "otc", false);

        basePlan.plans.push({
          current: {
            linkId,
            connectionType,
            reqBandwidth,
            reqBandwidthUOM,
            location: "city",
            totalArc,
          },
          proposed: {
            connectionType: data.connectionType,
            reqBandwidth: data.reqBandwidth,
            reqBandwidthUOM: data.reqBandwidthUOM,
            location: data.city,
            totalARC: arc + (additionalPrice[i]?.arc || 0),
          },
          basePlan: {
            planType: classofService,
            lastmileType,
            erpPlanName: "EXPRESSCONNECT",

            arc,
            otc: otc,

            discountARCPer: discount.arc,
            discountOTCPer: discount.otc,

            noDiscountARC,
            noDiscountOTC: noDiscountOTC,

            totalARC: arc + (additionalPrice[0]?.arc || 0),
            totalOTC: otc + (additionalPrice[0]?.otc || 0),

            bandwidthARC: planData.arc,
            bandwidthOTC: planData.otc,

            connectionTypePriceARC: connectionTypePrice.arc,
            connectionTypePriceOTC: connectionTypePrice.otc,

            additionalPrice,
          },
        });

        // const deleteOld = await Quote.findOneAndUpdate({ reqId, locationId: data.locationId }, { $pull: { basePlan: {} } });
        const updateNew = await Quote.findOneAndUpdate(
          { reqId },
          {
            pageTracker: "plan",
            $set: {
              "locationDetails.$[elem].basePlan": [basePlan.plans[i].basePlan],
            },
          },
          {
            arrayFilters: [{ "elem.locationId": data.locationId }],
          }
        );

        if (!updateNew) throw new Error("Insert Failed");
      } else {
        let selectedConnectionType = data.connectionType === "Other ISP" ? "Fiber" : data.connectionType;

        const dbCollection = db.collection("cpprices");
        const baseprice = await dbCollection
          .find({
            product: "DIA",
            type: /bw/,
            plan: classofService,
            bandwidth: data.reqBandwidth,
            connectionType: selectedConnectionType,
          })
          .toArray();
        console.log("query",{
          porduct: "DIA",
          type: /bw/,
          plan: classofService,
          bandwidth: data.reqBandwidth,
          connectionType: selectedConnectionType,
        });
        if (baseprice.length === 0) throw new Error("No Data");
        if (!contractPeriod) {
          contractPeriod = 1;
        }
        let planData = {};
        let connectionTypePrice = {
          arc: 0,
          otc: 0,
        };

        if (data.connectionType === "Wireless" && data.mastHeight !== 0 && !data.cxmConformation) {
          const tower = await dbCollection.find({ type: "tower", bandwidth: data.mastHeight }).toArray();
          // if (tower === 0) throw "No Data";
          additionalPrice.push({
            priceType: "tower",
            arc: 0,
            otc: tower[0]?.otc || 0,
            actualARC: 0,
            actualOTC: tower[0]?.otc || 0,
            mastHeight: data.mastHeight,
            unit: tower[0]?.unit || "Meter",
            mastType: data.mastType,
          });
        } else if (data.cxmConformation) {
          additionalPrice = data.additionalPrice.filter((data) => data.priceType === "tower").map((data) => data);
        }
        console.log("tower", additionalPrice);

        for await (const value of baseprice) {
          planData.arc = value.arc;
          planData.otc = hasOtc ? value.otc : 0;
          planData.msp = value.msp || 0;

          connectionTypePrice.arc = value.lastMileArc;
          connectionTypePrice.otc = 0;
        }

        let opex = data.opex;
        let capex = data.capex;

        if (selectedConnectionType === "Other ISP") {
          opex = data.otherIspOtc;
          capex = data.otherIspArc;
        }
        const calculatePrice = async (markupPrice, planType, property, noDiscount) => {
          const isFiberConnection = data.connectionType === "Fiber" || data.connectionType === "Other ISP";
          const baseValue = planType[property] + connectionTypePrice[property];

          if (!isFiberConnection) {
            return Math.round(baseValue);
          }
          // if (!markupPrice) {
          //   return Math.round(baseValue);
          // }

          connectionTypePrice[property] = markupPrice;

          if (property === "arc") {
            const calculatedPrice = Math.round(planType[property] + markupPrice);
            console.log(planType.msp);
            return calculatedPrice < planType.msp ? planType.msp : Math.round(planType.msp + markupPrice);
          }

          return Math.round(planType[property] + markupPrice);
        };
        console.log(planData);
        let lastmileType = data.connectionType === "Fiber" || data.connectionType === "Other ISP" ? "SifyFiber" : "SifyRF";

        let arc = await calculatePrice(opex, planData, "arc", true);
        let otc = await calculatePrice(capex, planData, "otc", true);

        basePlan.plans.push({
          current: {
            linkId,
            connectionType,
            reqBandwidth,
            reqBandwidthUOM,
            location: "city",
            totalArc,
          },
          proposed: {
            connectionType: data.connectionType,
            reqBandwidth: data.reqBandwidth,
            reqBandwidthUOM: data.reqBandwidthUOM,
            location: data.city,
            totalARC: arc + (additionalPrice[i]?.arc || 0),
          },
          basePlan: {
            planType: classofService,
            lastmileType,
            erpPlanName: "EXPRESSCONNECT",

            arc,
            otc: otc,

            totalARC: arc + (additionalPrice[0]?.arc || 0),
            totalOTC: otc + (additionalPrice[0]?.otc || 0),

            bandwidthARC: planData.arc,
            bandwidthOTC: planData.otc,

            connectionTypePriceARC: connectionTypePrice.arc,
            connectionTypePriceOTC: connectionTypePrice.otc,

            additionalPrice,
          },
        });

        // const deleteOld = await Quote.findOneAndUpdate({ reqId, locationId: data.locationId }, { $pull: { basePlan: {} } });
        const updateNew = await Quote.findOneAndUpdate(
          { reqId },
          {
            pageTracker: "plan",
            $set: {
              "locationDetails.$[elem].basePlan": [basePlan.plans[i].basePlan],
            },
          },
          {
            arrayFilters: [{ "elem.locationId": data.locationId }],
          }
        );

        if (!updateNew) throw new Error("Insert Failed");
      }
    }
    await common.updateOpportunity(reqId);
    const updatePrice = await common.update_price(reqId, next);
    if (!updatePrice) throw new Error("Insert Failed");

    if (sendResponse) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({
        status: "Success",
        data: basePlan,
      });
    } else {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({
        status: "Success",
      });
    }
  } catch (error) {
    next(error);
  }
};
exports.get_addons_details = async (req, res, next) => {
  try {
    const { reqId, locationId, serviceType } = req.body;
    if (!reqId || !locationId) throw new Error("Missing required parameters: reqId or locationId.");

    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const { hasRateCard } = quote;

    const locationDetails = quote.locationDetails.find((item) => item.locationId === locationId);
    if (!locationDetails) throw new Error("Location not found in quote");

    let { reqBandwidth, contractPeriod } = locationDetails;

    let serviceDetails = [];

    switch (serviceType) {
      case "ip":
        const ipData = await db.collection("cpprices").find({ type: serviceType, planStatus: true }).toArray();
        serviceDetails = ipData
          .map((data) => ({
            serviceType: data.type,
            name: "Additional IPs",
            isSelect: false,
            plan: `${data.IPPool} IP Pool with ${data.IPCount} IPs`,
            ipPool: data.IPPool,
            ipCount: data.IPCount,
            desc: "",
            otc: 0,
            arc: data.arc * data.IPCount,
            totalcost: data.arc * data.IPCount,
          }))
          .sort((a, b) => b.ipCount - a.ipCount);
        break;
      case "ddos":
        reqBandwidth *= 2;
        const ddosGB = Math.round(reqBandwidth / 1024);
        const ddosData = await db
          .collection("baseprice")
          .find({ plan: serviceType, bandwidth: { $gte: ddosGB } })
          .project({ _id: 0, Price: 1, Price_Type: 1, bandwidth: 1, unit: 1 })
          .toArray();
        // const ddosData = await getServiceDetails(serviceType, { bandwidth: { $gte: ddosGB } });

        if (!ddosData.length) throw "No Data";

        const serviceDetailsMap = new Map();
        ddosData.forEach((data) => {
          const { Price_Type, Price, bandwidth, unit } = data;

          if (!serviceDetailsMap.has(bandwidth)) {
            serviceDetailsMap.set(bandwidth, {
              serviceType: "ddos",
              name: "DDOS",
              erpPlanName: "MGD-NW-DDOS",
              desc: "",
              isSelect: false,
              plan: bandwidth,
              unit,
              otc: "",
              arc: "",
              totalcost: 0,
            });
          }

          const serviceEntry = serviceDetailsMap.get(bandwidth);

          if (Price_Type === "OTC") {
            serviceEntry.otc = Price;
          } else if (Price_Type === "ARC") {
            serviceEntry.arc = Price;
          }

          serviceEntry.totalcost = (serviceEntry.otc || 0) + (serviceEntry.arc || 0);
        });

        serviceDetails = Array.from(serviceDetailsMap.values());
        break;
      case "managedBundled":
        if (hasRateCard) {
          const bundledData = await db.collection("baseyearprice").findOne({ plan: "bundled", Max_Bandwidth: reqBandwidth });
          const managedData = await db.collection("baseprice").find({ plan: "managed", Type: "Link" }).toArray();
          if (!bundledData || !managedData) throw new Error("No Data");

          const calculatePrice = (data, priceType) => {
            const priceData = data.find((item) => item.Price_Type === priceType);
            return priceData ? Math.round(priceData.Price) : "";
          };

          const arcPrice = calculatePrice(managedData, "ARC");
          const otcPrice = calculatePrice(managedData, "OTC");

          serviceDetails.push(
            {
              serviceType: "bundled",
              name: "Bundled Router",
              erpPlanName: "MCPE",
              isSelect: false,
              desc: bundledData.Product_description,
              otc: 0,
              arc: Math.round(bundledData[`Year${contractPeriod}`]),
              totalcost: Math.round(bundledData[`Year${contractPeriod}`]),
            },
            {
              serviceType: "managed",
              name: "Managed Service",
              erpPlanName: "MANAGED NOC",
              desc: "Content Required",
              isSelect: false,
              otc: otcPrice,
              arc: arcPrice,
              totalcost: (otcPrice === "" ? "" : otcPrice) + (arcPrice === "" ? "" : arcPrice),
            }
          );
        } else {
          const managedBundled = await db.collection("cpprices").findOne({ type: "managedBundled", filter_min: { $lte: reqBandwidth }, filter_max: { $gte: reqBandwidth } });

          serviceDetails.push(
            {
              serviceType: "bundled",
              name: "Bundled Router",
              erpPlanName: "MCPE",
              isSelect: false,
              desc: "",
              otc: managedBundled.otc,
              arc: Math.round(managedBundled[`Year${contractPeriod}`]),
              totalcost: managedBundled.otc + Math.round(managedBundled[`Year${contractPeriod}`]),
            },
            {
              serviceType: "managed",
              name: "Managed Service",
              erpPlanName: "MANAGED NOC",
              desc: "Content Required",
              isSelect: false,
              otc: 0,
              arc: managedBundled.managedArc,
              totalcost: managedBundled.managedArc,
            }
          );
        }
        break;
      default:
        throw new Error("Invalid service type");
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", data: serviceDetails });
  } catch (error) {
    next(error);
  }
};
exports.post_plan_details = async (req, res, next) => {
  try {
    const { reqId, locationId, basePlan, valueAddedService } = req.body;
    if (!reqId || !locationId) throw new Error("Missing required parameters: reqId or locationId.");

    if (basePlan.length !== 0) {
      const updatePlan = await Quote.findOneAndUpdate(
        { reqId },
        {
          pageTracker: "plan",
          $set: {
            "locationDetails.$[elem].basePlan": basePlan,
          },
        },
        {
          arrayFilters: [{ "elem.locationId": locationId }],
        }
      );
      const updatePrice = await common.update_price(reqId, next);
      await common.updateOpportunity(reqId);

      if (!updatePlan || !updatePrice) throw new Error("Insert Failed");
    }
    if (valueAddedService.length !== 0) {
      const serviceTypes = Object.values(valueAddedService).map((element) => element.serviceType);
      if (serviceTypes.includes("bundled") && !serviceTypes.includes("managed")) {
        serviceTypes.push("managed");
      }
      if (serviceTypes.includes("managed") && !serviceTypes.includes("bundled")) {
        serviceTypes.push("bundled");
      }

      const deleteOld = await Quote.findOneAndUpdate(
        { reqId },
        { $pull: { "locationDetails.$[elem].valueAddedService": { serviceType: { $in: serviceTypes } } } },
        {
          arrayFilters: [{ "elem.locationId": locationId }],
        }
      );

      const updateNew = await Quote.findOneAndUpdate(
        { reqId },
        {
          $push: {
            "locationDetails.$[elem].valueAddedService": {
              $each: valueAddedService,
            },
          },
        },
        {
          arrayFilters: [{ "elem.locationId": locationId }],
          new: true,
        }
      );
      const updatePrice = await common.update_price(reqId, next);
      if (!deleteOld || !updateNew || !updatePrice) throw new Error("Insert Failed");
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (error) {
    next(error);
  }
};
exports.delete_addons = async (req, res, next) => {
  const { reqId, locationId, serviceType } = req.body;
  try {
    if (!reqId || !locationId) throw new Error("Missing required parameters: reqId or locationId.");

    const deleteAddons = await Quote.findOneAndUpdate(
      { reqId },
      { $pull: { "locationDetails.$[elem].valueAddedService": { serviceType: { $in: serviceType } } } },
      {
        arrayFilters: [{ "elem.locationId": locationId }],
      }
    );
    if (!deleteAddons) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success" });
  } catch (error) {
    next(error);
  }
};
exports.post_selected_locationId = async (req, res, next) => {
  try {
    const { reqId, locationIdList } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const bulkWriteOperations = [
      {
        updateMany: {
          filter: { reqId },
          update: {
            $set: {
              "locationDetails.$[].isSelect": false,
            },
          },
        },
      },
    ];

    if (locationIdList.length > 0) {
      bulkWriteOperations.push({
        updateMany: {
          filter: { reqId, "locationDetails.locationId": { $in: locationIdList } },
          update: {
            $set: {
              "locationDetails.$[elem].isSelect": true,
            },
          },
          arrayFilters: [{ "elem.locationId": { $in: locationIdList } }],
        },
      });
    }

    const bulkUpdate = await Quote.bulkWrite(bulkWriteOperations);
    const updatePrice = await common.update_price(reqId, next);
    if (!bulkUpdate || !updatePrice || bulkUpdate.matchedCount === 0) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({
      status: "Success",
    });
  } catch (error) {
    next(error);
  }
};
exports.get_quote_feasability_status = async (req, res, next) => {
  try {
    const { reqId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const locationDetailsList = quote.locationDetails.filter((item) => item.isSelect === false && item.status === "Feasible");

    if (locationDetailsList.length > 0) {
      throw new Error("You have chosen only some of the feasible locations. Would you like to proceed to the next step or select additional links?");
    }

    await Quote.findOneAndUpdate({ reqId }, { pageTracker: "Pricing" });
    await common.updateOpportunity(reqId);
    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({
      status: "Success",
    });
  } catch (error) {
    next(error);
  }
};
exports.post_excel_plan = async (req, res, next) => {
  try {
    const { reqId, submitAll } = req.body;

    if (submitAll === "true") {
      await Quote.updateMany(
        { reqId },
        {
          $set: {
            "locationDetails.$[].isSelect": true,
          },
        },
        {
          arrayFilters: [{ "elem.status": "Feasible" }],
        }
      );

      await this.get_modify_base_plan({ body: { reqId } }, res, next, false);
    } else {
      const buffer = req.file.buffer;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const worksheet = workbook.getWorksheet(1);
      const headers = worksheet.getRow(1).values;

      const data = [];

      const keyMappings = {
        "Connection Id": "locationId",
        "Feasibility Status": "status",
        "Place Order": "placeOrder",
      };
      let validCount = 0;
      let invalidCount = 0;
      let totalCount = 0;
      for (let i = 2; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i).values;
        const rowData = {};
        let isValid = true;

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
              rowData[statusKey] = "Invalid";
              rowData[messageKey] = "Missing Value";
              rowData["isActive"] = false;
              isValid = false;
            } else {
              if (key === "Place Order") {
                if (value.toUpperCase() === "YES" || value.toUpperCase() === "NO") {
                  rowData[statusKey] = "Valid";
                  rowData[messageKey] = "";
                  rowData["isActive"] = true;
                } else {
                  rowData[statusKey] = "Invalid";
                  rowData[messageKey] = "Missing Value";
                  rowData["isActive"] = false;
                  isValid = false;
                }
              } else {
                rowData[statusKey] = "Valid";
                rowData[messageKey] = "";
                rowData["isActive"] = true;
              }
            }
          }
        }

        data.push(rowData);
        if (isValid) {
          validCount++;
        } else {
          invalidCount++;
        }
        totalCount++;
      }

      let count = {
        totalCount,
        validCount,
        invalidCount,
      };
      console.log(count);
      // console.log(data);
      const connectionIDArray = await Promise.all(
        data.map(async (item) => {
          return item.placeOrder.toUpperCase() === "YES" && item.status === "Feasible" && item.locationId;
        })
      );

      const filteredConnectionIDs = connectionIDArray.filter((id) => id !== false);
      console.log(reqId, filteredConnectionIDs);
      if (filteredConnectionIDs.length === 0) {
        throw "Please choose the desire option to view proposal";
      }

      const bulkWriteOperations = [
        {
          updateMany: {
            filter: { reqId },
            update: {
              $set: {
                "locationDetails.$[].isSelect": false,
              },
            },
          },
        },
      ];

      if (locationIdList.length > 0) {
        bulkWriteOperations.push({
          updateMany: {
            filter: { reqId, "locationDetails.locationId": { $in: filteredConnectionIDs } },
            update: {
              $set: {
                "locationDetails.$[elem].isSelect": true,
              },
            },
            arrayFilters: [{ "elem.locationId": { $in: filteredConnectionIDs } }],
          },
        });
      }

      const bulkUpdate = await Quote.bulkWrite(bulkWriteOperations);
      if (!bulkUpdate || bulkUpdate.matchedCount === 0) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

      await this.get_modify_base_plan({ body: { reqId } }, res, next, false);
    }
  } catch (error) {
    next(error);
  }
};
exports.post_tower_price = async (req, res, next) => {
  try {
    const { reqId, locationId, additionalPrice, opex, capex } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const updateAdditionalPrice = await db.collection("quoteills").findOneAndUpdate(
      { reqId },
      {
        $set: {
          "locationDetails.$[elem].feasibilityStatus": "Feasible",
          "locationDetails.$[elem].additionalPrice": additionalPrice,
          "locationDetails.$[elem].opex": opex,
          "locationDetails.$[elem].capex": capex,
          "locationDetails.$[elem].towerPriceVerified": true,
        },
      },
      {
        arrayFilters: [{ "elem.locationId": locationId }],
        returnDocument: "after", // This option ensures the updated document is returned
      }
    );
    const { lastErrorObject, value: updatedQuote, ok } = updateAdditionalPrice;
    if (lastErrorObject.n === 0) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    const selectedData = updatedQuote.locationDetails.filter((data) => data.locationId === locationId);
    await db.collection("opportunityDetails").findOneAndUpdate({ feasibilityId: selectedData[0].feasibilityId }, { $set: { status: "Feasible", updatedDate: moment().format("YYYY-MM-DDTHH:mm:ss.SSSZ") } });
    await common.update_quote_common_status(updatedQuote);

    try {
      // const toArray = [quote.customermail];
      const toArray = ["technical@kstinfotech.com"];
      const subject = `One Sify - Request ID: ${reqId} - Feasibility Update for ILL Services`;

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

      function capitalizeFirstLetter(str) {
        return str.replace(/\b\w/g, (char) => char.toUpperCase());
      }
      const templateData = {
        reqId: reqId,
        quoteType: updatedQuote.quoteType === "New" ? "New-Link" : capitalizeFirstLetter(updatedQuote.quoteType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()),
        // quoteType: updatedQuote.provisionType || updatedQuote.locationDetails[0].provisionType,
        customerName: updatedQuote.customerName,
        customerNumber: updatedQuote.customerNumber,
        locationDetails: updatedQuote.locationDetails,
        url: process.env.APP_PATH,
        isNew: updatedQuote.quoteType === "New",
      };
      const html = template(templateData);

      common.sendMailUntilSuccess(reqId, toArray, [], subject, html, null);
    } catch (error) {
      console.log("Error in send mail", error);
    }

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({
      status: "Success",
    });
  } catch (error) {
    next(error);
  }
};

exports.get_pricing_list = async (req, res, next) => {
  try {
    const { reqId, version } = req.body;
    if (!reqId) {
      return res.send({ status: "Error", message: "Missing required parameters: reqId." });
    }
    const quote = await Quote.findOne({ reqId });
    if (!quote) {
      return res.send({ status: "Error", message: `Quote with reqId ${reqId} does not exists.` });
    }
    const lineItems = await common.format_lineItem(reqId, version);
    console.log(lineItems);
    const link = await common.get_min_max_values(lineItems.links);
    const links = Object.values(
      link.reduce((acc, item) => {
        if (!acc[item.linkName]) {
          acc[item.linkName] = { linkName: item.linkName, lineItems: [] };
        }
        const { linkName, ...lineItem } = item; // remove linkName from lineItems
        acc[item.linkName].lineItems.push(lineItem);
        return acc;
      }, {})
    );
    res.send({
      status: "Success",
      message: "Pricing list fetched successfully",
      data: {
        reqId: quote.reqId,
        links,
        totalOtc: lineItems.totalOtc,
        totalArc: lineItems.totalArc,
      },
    });
  } catch (error) {
    console.error("Error in get_pricing_list:", error.message);
    return res.send({ status: "Error", message: "Fetching price list - Failed" });
  }
};

exports.save_quote_version = async (req, res, next) => {
  try {
    const { reqId, links } = req.body;
    console.log(reqId, links);
    if (!reqId) {
      res.send({ status: "Error", message: "ReqId is required!" });
      return;
    }
    const quoteDetails = await Quote.findOne({ reqId: reqId });
    if (!quoteDetails) {
      return res.send({ status: "Error", message: `Quote with reqId ${reqId} not found.` });
    }
    const newQuote = quoteDetails;
    const versionExists = await db.collection("quoteversions").findOne({ reqId: reqId });
    if (!versionExists) {
      console.log("inside if condition");
      const update_quote_ills = db.collection("quoteills").updateOne({ reqId: reqId }, { $set: { version: "V1", updatedDate: new Date() } });
      const quote1 = await Quote.findOne({ reqId: reqId });
      const quote_version_save = db.collection("quoteversions").insertOne({
        reqId: reqId,
        ebsAccountNo: quoteDetails.ebsAccountNo,
        companyId: quoteDetails.companyId,
        companyName: quoteDetails.companyName,
        product: "DIA",
        productCategory: quoteDetails.quoteType,
        quoteVersion: [
          {
            version: "V1",
            quote: quote1,
          },
        ],
      });
      // const update_quote_ills = db.collection("quoteills").updateOne({ reqId: reqId }, { $set: { version: "V1", updatedDate: Date.now() } });
    } else {
      let totalArc = 0,
        totalOtc = 0;
      links.forEach((link, index) => {
        let linkTotalOtc = 0,
          linkTotalArc = 0;
        link.lineItems.forEach((item) => {
          if (item.itemType == "bw") {
            newQuote.locationDetails[index].basePlan[0].otc = item.newOtc || 0;
            newQuote.locationDetails[index].basePlan[0].arc = item.newArc || 0;
          } else if (item.itemType == "tower") {
            newQuote.locationDetails[index].additionalPrice[0].otc = item.newOtc || 0;
            newQuote.locationDetails[index].additionalPrice[0].arc = item.newArc || 0;
          } else {
            newQuote.locationDetails[index].valueAddedService.map((vas) => {
              if (item.serviceType == "managed" && vas.serviceType == "managed") {
                vas.otc = item.newOtc || 0;
                vas.arc = item.newArc || 0;
                vas.totalcost = item.newOtc || 0 + item.newArc || 0;
              }
              if (item.serviceType == "ddos" && vas.serviceType == "ddos") {
                vas.otc = item.newOtc || 0;
                vas.arc = item.newArc || 0;
                vas.totalcost = item.newOtc || 0 + item.newArc || 0;
              }
              if (item.serviceType == "ip" && vas.serviceType == "ip") {
                vas.otc = item.newOtc || 0;
                vas.arc = item.newArc || 0;
                vas.totalcost = item.newOtc || 0 + item.newArc || 0;
              }
              if (item.serviceType == "bundled" && vas.serviceType == "bundled") {
                vas.otc = item.newOtc || 0;
                vas.arc = item.newArc || 0;
                vas.totalcost = item.newOtc|| 0 + item.newArc || 0;
              }
            });
          }
          console.log(item, "kkk");
          linkTotalOtc = linkTotalOtc + item.newOtc;
          linkTotalArc = linkTotalArc + item.newArc;
        });
        console.log("000", linkTotalArc);
        console.log("---", linkTotalOtc);
        newQuote.locationDetails[index].basePlan[0].totalOTC = newQuote.locationDetails[index]?.basePlan[0]?.otc + newQuote.locationDetails[index].additionalPrice[0]?.otc || 0;
        newQuote.locationDetails[index].basePlan[0].totalARC = newQuote.locationDetails[index]?.basePlan[0]?.arc + newQuote.locationDetails[index].additionalPrice[0]?.arc || 0;
        newQuote.locationDetails[index].totalARC = linkTotalArc;
        newQuote.locationDetails[index].totalOTC = linkTotalOtc;
        totalArc += linkTotalArc;
        totalOtc += linkTotalOtc;
      });
      const totalPrice = totalOtc + totalArc;
      console.log("!!!", totalOtc);
      console.log("###", totalArc);
      console.log("{{{", totalPrice);
      newQuote.totalOTC = totalOtc;
      newQuote.totalARC = totalArc;
      newQuote.totalPrice = totalPrice;
      console.log(quoteDetails.version);
      const version = `V${parseInt(quoteDetails.version.slice(1), 10) + 1}`;
      newQuote.version = version;
      newQuote.updatedDate = new Date();
      const updateQuote = await db.collection("quoteills").updateOne({ reqId: reqId }, { $set: { version: version, updatedDate: new Date(), locationDetails: newQuote.locationDetails, totalARC: totalArc, totalOTC: totalOtc, totalPrice: totalPrice } });
      const quote_version_save = await db.collection("quoteversions").updateOne(
        { reqId: reqId },
        {
          $push: {
            quoteVersion: {
              version: version,
              quote: newQuote,
            },
          },
        }
      );
    }
    res.send({ status: "Success", message: "Quote updated successfully", newQuote: newQuote });
    return;
  } catch (err) {
    console.log(err);
    res.send({ status: "Error", message: "Error Saving quote" });
    return;
  }
};

exports.get_total_quote_price = async (req, res) => {
  try {
    const { links } = req.body;

    if (!Array.isArray(links)) {
      return res.status(400).json({
        status: "Error",
        message: "Invalid input: 'links' must be an array.",
      });
    }

    let totalOtc = 0,
      totalArc = 0;

    const items = links.flatMap((link) => link.lineItems.map((item) => ({ ...item, linkName: link.linkName })));

    items.forEach((item) => {
      if (item.newOtc && item.newArc) {
        totalOtc += item.newOtc;
        totalArc += item.newArc;
      } else {
        return res.send({ status: "Error", message: "Invalid Input: newOtc, newArc is required." });
      }
    });

    res.send({
      status: "Success",
      message: "Total Price calculated successfully.",
      linkDetails: links,
      totalArc,
      totalOtc,
    });
    return;
  } catch (error) {
    console.error("Error in get_total_quote_price:", error);
    return res.send({
      status: "Error",
      message: "Something went wrong while calculating the total price.",
      error: error.message,
    });
  }
};

exports.check_min_price = async (req, res, next) => {
  try {
    const { lineItem, reqId, totalArc, totalOtc } = req.body;
    if (lineItem) {
      const condition = await common.buildMatchCondition(lineItem);
      const cppricedata = await db
        .collection("cpprices")
        .aggregate([
          {
            $match: condition,
          },
        ])
        .toArray();
      if (lineItem.serviceType == "managed") {
        if (lineItem.newArc !== undefined && lineItem.newArc !== null) {
          const { managedFloorArc, managedCeilArc } = cppricedata;
          const arcValue = lineItem.newArc;
          if (arcValue < managedFloorArc) {
            return res.status(200).json({ message: `Value must be greater than â‚¹${managedFloorArc}`, allow: false });
          }
          if (arcValue > managedCeilArc) {
            return res.status(200).json({ message: `Value must be lesser than â‚¹${managedCeilArc}`, allow: false });
          }
          return res.status(200).json({ message: "Value is within allowed range", allow: true });
        }
      } else {
        if (lineItem.newOtc !== undefined && lineItem.newOtc !== null) {
          const { floorOtc, ceilOtc } = cppricedata[0] || {};
          const otcValue = lineItem.newOtc;

          if (otcValue < floorOtc) {
            return res.status(200).json({ message: `OTC Value must be greater than â‚¹${floorOtc}`, allow: false });
          }
          if (otcValue > ceilOtc) {
            return res.status(200).json({ message: `OTC Value must be lesser than â‚¹${ceilOtc}`, allow: false });
          }
          return res.status(200).json({ message: "OTC Value is within allowed range", allow: true });
        }

        if (lineItem.newArc !== undefined && lineItem.newArc !== null) {
          const { floorArc, ceilArc } = cppricedata[0] || {};
          const arcValue = lineItem.newArc;
          if (arcValue < floorArc) {
            return res.status(200).json({ message: `ARC Value must be greater than â‚¹${floorArc}`, allow: false });
          }
          if (arcValue > ceilArc) {
            return res.status(200).json({ message: `ARC Value must be lesser than â‚¹${ceilArc}`, allow: false });
          }
          return res.status(200).json({ message: "ARC Value is within allowed range", allow: true });
        }
      }
    } else if (reqId && (totalArc || totalOtc)) {
      console.log("inside");
      const quote = await common.format_lineItem(reqId, "V1");
      const items = quote.flatMap((item) => item.lineItems);

      let minOtc = 0,
        minArc = 0,
        maxOtc = 0,
        maxArc = 0;

      await Promise.all(
        items.map(async (item, index) => {
          const condition = await common.buildMatchCondition(item);
          const cppricedata = await db
            .collection("cpprices")
            .aggregate([{ $match: condition }])
            .toArray();

          const price = cppricedata[0];
          if (!price) {
            console.warn(`No price found for item ${index + 1}`);
            return;
          }
          console.log(`Item ${index + 1}:`);
          console.log("price", price);
          console.log("  floorArc:", price.floorArc);
          console.log("  floorOtc:", price.floorOtc);
          console.log("  ceilArc:", price.ceilArc);
          console.log("  ceilOtc:", price.ceilOtc);
          console.log("----------------------------");
          minArc += price.floorArc || 0;
          minOtc += price.floorOtc || 0;
          maxArc += price.ceilArc || 0;
          maxOtc += price.ceilOtc || 0;
        })
      );
      console.log("Final Min/Max Totals:");
      console.log("minArc:", minArc);
      console.log("minOtc:", minOtc);
      console.log("maxArc:", maxArc);
      console.log("maxOtc:", maxOtc);
      if (totalArc < minArc) return res.status(200).json({ message: `Total ARC must be greater than â‚¹${minArc}`, allow: false });

      if (totalOtc < minOtc) return res.status(200).json({ message: `Total OTC must be greater than â‚¹${minOtc}`, allow: false });

      if (totalArc > maxArc) return res.status(200).json({ message: `Total ARC must be lesser than â‚¹${maxArc}`, allow: false });

      if (totalOtc > maxOtc) return res.status(200).json({ message: `Total OTC must be lesser than â‚¹${maxOtc}`, allow: false });
      else return res.status(200).json({ message: `Value is within range`, allow: true });
    }
  } catch (error) {
    return res.status(500).json({ message: "error in checking min value", error: error.message });
  }
};

exports.split_by_total_price = async (req, res) => {
  try {
    const start = Date.now();
    const { totalOtc, totalArc, reqId, version = "V1" } = req.body;
    const quoteExists = await Quote.findOne({ reqId });
    if (!quoteExists) {
      return res.send({ status: "Error", message: `Quote with reqId ${reqId} not found.` });
    }
    // const standardQuote = await db.collection("quoteversions").aggregate([
    //   {
    //     $match: {
    //       reqId: reqId
    //     }
    //   },
    //   {
    //     $project: {
    //       quoteVersion: {
    //         $filter: {
    //           input: "$quoteVersion",
    //           as: "qv",
    //           cond: { $eq: ["$$qv.version", version] }
    //         }
    //       }
    //     }
    //   },
    //   {
    //     $unwind: "$quoteVersion"
    //   }
    // ]).toArray();
    const quote = await common.format_lineItem(reqId, version);
    const newlineItems = await common.get_min_max_values(quote.links);
    const finalLineItems = await common.allocateBudgets(newlineItems, totalOtc, totalArc);
    // const result = finalLineItems.items.map(({ floorArc, floorOtc, standardArc, standardOtc, ceilArc, ceilOtc, ...rest }) => rest);
    const groupedData = Object.values(
      finalLineItems.items.reduce((acc, item) => {
        if (!acc[item.linkName]) {
          acc[item.linkName] = { linkName: item.linkName, lineItems: [] };
        }
        const { linkName, ...lineItem } = item; // remove linkName from lineItems
        acc[item.linkName].lineItems.push(lineItem);
        return acc;
      }, {})
    );
    finalLineItems.items = groupedData;
    finalLineItems.existingOtc = quote.totalOtc;
    finalLineItems.existingArc = quote.totalArc;
    const duration = Date.now() - start;
    return res.send({
      status: "Success",
      message: "New List of Quote Items is Retrived",
      payload: newlineItems,
      finalLineItems: finalLineItems,
      responseTime: `${duration} milliseconds`,
    });
  } catch (err) {
    console.log(err);
    return res.send({ status: "Error", message: err });
  }
};

exports.get_updation_method = async (req, res) => {
  try {
    const { reqId, version } = req.body;
    const updateBy = [
      {
        header: "Update by Line Item",
        description: "Manually edit the OTC and ARC for each line item listed",
      },
      {
        header: "Update by Total Price",
        description: "Enter total OTC and ARC; the system will distribute values across all items proportionally",
      },
    ];

    const versionData = await db.collection("quoteversions").findOne({ reqId: reqId });
    if (!versionData) {
      return res.send({ status: "Error", message: `Quote with reqId ${reqId} not found.` });
    }
    const responseData = versionData.quoteVersion.map((version, index) => {
      const result = {
        version: version.version,
        versionSummary: {
          totalOtc: version.quote.totalOTC,
          totalArc: version.quote.totalARC,
        },
      };
      if (version.version === "V1") {
        result.plan = "standard";
      }
      const lastIndex = versionData.quoteVersion.length - 1;
      if (index == lastIndex) {
        result.isSelect = true;
      }
      return result;
    });
    const lineItems = await common.format_lineItem(reqId, version);

    const minmax_values = await common.get_min_max_values(lineItems.links);
    console.log(minmax_values);
    let totalMinOtc = 0,
      totalMinArc = 0,
      totalMaxOtc = 0,
      totalMaxArc = 0;
    minmax_values.map((links) => {
      totalMinOtc += links.floorOtc || 0;
      totalMinArc += links.floorArc || 0;
      totalMaxOtc += links.ceilOtc || 0;
      totalMaxArc += links.ceilArc || 0;
    });

    res.status(200).json({ status: "Success", message: "Versions retrieved successfully", data: { updateBy: updateBy, versions: responseData, totalMinOtc: totalMinOtc, totalMinArc: totalMinArc, totalMaxOtc: totalMaxOtc, totalMaxArc: totalMaxArc } });
  } catch (error) {
    return res.status(500).json({ message: "error in getting updation method", error: error.message });
  }
};

exports.post_final_quote = async (req, res) => {
  try {
    const { version, reqId } = req.body;
    if (!version) {
      res.send({ status: "Error", message: "version is required." });
      return;
    }
    const quote = await db
      .collection("quoteversions")
      .aggregate([
        {
          $match: {
            reqId: reqId,
          },
        },
        {
          $project: {
            quoteVersion: {
              $filter: {
                input: "$quoteVersion",
                as: "qv",
                cond: { $eq: ["$$qv.version", version] },
              },
            },
          },
        },
        {
          $unwind: "$quoteVersion",
        },
      ])
      .toArray();
    console.log(quote[0]);
    const updateQuote = await Quote.updateOne({ reqId: reqId }, { $set: quote[0].quoteVersion.quote });
    res.send({ status: "Success", message: "quote saved successfully!", data: quote[0].quoteVersion.quote });
  } catch (err) {
    res.send({ status: "Error", message: "error saving quote." });
    return;
  }
};
