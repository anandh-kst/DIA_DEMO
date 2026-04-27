
exports.post_erp_order = async (req, res, next) => {
  try {
    const { reqid } = req.body;
    if (typeof req.body.reqid === "undefined" || req.body.reqid === "") {
      throw "Missing Credential";
    }
    let headers_field;
    let items_field = [];
    let SCOD_ID_db = await reqId.findOneAndUpdate({ id: "scod_id" }, { $inc: { SCOD_ID: 1 } });
    let SCOD_ID = SCOD_ID_db.toObject();
    SCOD_ID = SCOD_ID.SCOD_ID;
    var quote = await Quote.findOne({
      reqid: reqid,
    });
    if (quote === null) {
      throw "reqid not found";
    }
    let requestId = reqid;
    let objectDate = new Date();
    let day = objectDate.getDate().toString().padStart(2, "0");
    let month = objectDate.toLocaleString("default", { month: "short" });
    let year = objectDate.getFullYear();
    let orderDate = `${day}-${month}-${year}`;
    let linkId = 0;
    headers_field = {
      ID: requestId,
      OPPORTUNITY_ID: 500000123456789,
      QUOTE_ID: "CLOUD-" + requestId,
      ORDER_TYPE: "Change",
      ORDER_DATE: orderDate,
      BS_ID: "",
      CREATED_BY: "gomathi.sitaram",
      STATUS: "Y",
      ACCOUNT_NUMBER: 644382,
      ACCOUNT_MANAGER: "RENJIT.JOY",
      CURRENCY: "INR",
      PO_NO: requestId.toString(),
      PO_DATE: orderDate,
      NOTICE_PERIOD: "3 Month",//contract
      CONTRACT_TYPE: "open",
      CONTRACT_PERIOD: 3,//contract
      REMARKS: "",
      LEADBU: "CMS",
      IS_TELECOM: "false",
      IS_DC: "true",
      SITECODE: "VASHI",//ship to
      IS_CMS: "true",
    };
    let service_ref_line_id;
    let apikey =
      "eyJ4NXQiOiJZMkUyWW1FMlpHWmpZekEzTmpJME1UY3paRFF6WXpaaE56VmhZVGM0TW1NeE0yRmpOelpsTnc9PSIsImtpZCI6ImdhdGV3YXlfY2VydGlmaWNhdGVfYWxpYXMiLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJtb2hhbnJhai5yc0BjYXJib24uc3VwZXIiLCJhcHBsaWNhdGlvbiI6eyJvd25lciI6Im1vaGFucmFqLnJzIiwidGllclF1b3RhVHlwZSI6bnVsbCwidGllciI6IjEwUGVyTWluIiwibmFtZSI6IkNNUyIsImlkIjoyOCwidXVpZCI6ImU5ZjQ4ZDM3LTZhMzEtNGQ4OC1hZjRlLTlmZGE4ZmYyMTUwMyJ9LCJpc3MiOiJodHRwczpcL1wvbWFuYWdlLWludC5zaWZ5Lm5ldDo0NDNcL2FwaW1cL29hdXRoMlwvdG9rZW4iLCJ0aWVySW5mbyI6eyJCcm9uemUiOnsidGllclF1b3RhVHlwZSI6InJlcXVlc3RDb3VudCIsImdyYXBoUUxNYXhDb21wbGV4aXR5IjowLCJncmFwaFFMTWF4RGVwdGgiOjAsInN0b3BPblF1b3RhUmVhY2giOnRydWUsInNwaWtlQXJyZXN0TGltaXQiOjAsInNwaWtlQXJyZXN0VW5pdCI6bnVsbH19LCJrZXl0eXBlIjoiU0FOREJPWCIsInBlcm1pdHRlZFJlZmVyZXIiOiIiLCJzdWJzY3JpYmVkQVBJcyI6W3sic3Vic2NyaWJlclRlbmFudERvbWFpbiI6ImNhcmJvbi5zdXBlciIsIm5hbWUiOiJDTVMtQ1JFQVRFLU9SREVSIiwiY29udGV4dCI6IlwvY21zXC9vcmRlclwvY3JlYXRlXC8xLjAiLCJwdWJsaXNoZXIiOiJhZG1pbiIsInZlcnNpb24iOiIxLjAiLCJzdWJzY3JpcHRpb25UaWVyIjoiQnJvbnplIn0seyJzdWJzY3JpYmVyVGVuYW50RG9tYWluIjoiY2FyYm9uLnN1cGVyIiwibmFtZSI6IkNNUy1GRVRDSC1MSU5LX1NFUVVFTkNFIiwiY29udGV4dCI6IlwvY21zXC9saW5rXC9zZXF1ZW5jZVwvMS4wIiwicHVibGlzaGVyIjoiYWRtaW4iLCJ2ZXJzaW9uIjoiMS4wIiwic3Vic2NyaXB0aW9uVGllciI6IkJyb256ZSJ9LHsic3Vic2NyaWJlclRlbmFudERvbWFpbiI6ImNhcmJvbi5zdXBlciIsIm5hbWUiOiJDTVMtT1JERVItREVUQUlMUyIsImNvbnRleHQiOiJcL2Ntc1wvb3JkZXJkZXRhaWxzXC8xLjAiLCJwdWJsaXNoZXIiOiJhZG1pbiIsInZlcnNpb24iOiIxLjAiLCJzdWJzY3JpcHRpb25UaWVyIjoiQnJvbnplIn0seyJzdWJzY3JpYmVyVGVuYW50RG9tYWluIjoiY2FyYm9uLnN1cGVyIiwibmFtZSI6IkNQUS1DTVMtR0VULVBSSUNJTkciLCJjb250ZXh0IjoiXC9jbXNcL3ByaWNpbmdcL2RldGFpbHNcLzEuMCIsInB1Ymxpc2hlciI6ImFkbWluIiwidmVyc2lvbiI6IjEuMCIsInN1YnNjcmlwdGlvblRpZXIiOiJCcm9uemUifSx7InN1YnNjcmliZXJUZW5hbnREb21haW4iOiJjYXJib24uc3VwZXIiLCJuYW1lIjoiQ1BRLUNNUy1QUklDSU5HLUZJRUxEUyIsImNvbnRleHQiOiJcL2Ntc1wvcHJpY2luZ1wvZmllbGRzXC8xLjAiLCJwdWJsaXNoZXIiOiJhZG1pbiIsInZlcnNpb24iOiIxLjAiLCJzdWJzY3JpcHRpb25UaWVyIjoiQnJvbnplIn1dLCJleHAiOjE3MDM5MDc0ODUsInRva2VuX3R5cGUiOiJhcGlLZXkiLCJwZXJtaXR0ZWRJUCI6IiIsImlhdCI6MTY3MjM3MTQ4NSwianRpIjoiNmMxM2U3ZmItZmFlYy00OWJmLWI4ODItYTcyOWQwOWY1NGUxIn0=.sFyAfhipkReyB79O2Fp_YVO6xdoT-6qSrEicoIwIvi7ebRnDtzN8mN_bs3vY_zt0_GPT4QuNjMrSyNoDGWtaWlB8iXtYA6p14a1kZCtjC5sPHSYfhJeVr8BcZLP-fIh4vlrNR7BfA8kBQoGlnXAxGBDAPoOUvnnZhulm6sXLqhgPkbxCDM92MYrywj96azKeBROeP2-Nz__x1-RxCUY5PBc6T74u9nYt2GXlSvMgTppWF0b49wjsqgKIOJo_dpeKKsJHMkujIm0cZH2SjiuzmP0yl2zOUeWGmTdNJm76aNvrFx74OT1z7veIWue7TXntEczsWKQsA8TAOnYGtPn5QA==";
    for (const [i, data] of quote.sub_product_detail.entries()) {
      console.log(data.item_name);
      const coll = db.collection("erp_item_id");
      // let item_id = coll.find({ item_code: new RegExp(data.item_name) }).lean();
      for (let x = 0; x < data.unit; x++) {
        for (let j = 0; j < 3; j++) {
          let activity = "";

          let OPG_ATTRIBUTE1 = "INFRA-APPLICATION-SUPPORT";
          let OPG_ATTRIBUTE2 = "ACTIVEDIR-PROFICIENT-ADDON-200 USERS";
          let OPG_ATTRIBUTE38 = requestId.toString();
          let OPG_ATTRIBUTE39 = orderDate;

          if (j == 0) {
            let item_id;
            if (data.item_name === "CLOUD-INTERNET") {
              item_id = await coll.findOne({ item_code: "CI-NETWORK" });
            } else {
              item_id = await coll.findOne({ item_code: data.item_name });
            }
            console.log(data.item_name);

            // item_id = await item_id.toArray();
            // console.log(item_id.inventory_item_id);
            link = "LINK";
            service_ref_line_id = null;
            INVENTORY_ITEM_ID = 12344;
            ITEM = item_id.item_code;
            ITEM_DESCRIPTION = item_id.description;
            LIST_PRICE = "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = "0.0";
            NET_AMOUNT = "0.00";
            OPG_FORM_CONTEXT = "Not Applicable";
          }
          if (j == 1) {
            link = "RC";
            service_ref_line_id = SCOD_ID - 1;
            INVENTORY_ITEM_ID = 546957;
            ITEM = "DC-MANAGED-SERVICES-RC";
            ITEM_DESCRIPTION = "Recurring Charges for DC-MANAGED-SERVICES";
            LIST_PRICE = "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = "0.0";
            NET_AMOUNT = "0.0";
            OPG_FORM_CONTEXT = "Not Applicable";
          }
          if (j == 2) {
            link = "OT";
            service_ref_line_id = null;
            INVENTORY_ITEM_ID = 546949;
            ITEM = "DC-MANAGED-SERVICES-OT";
            ITEM_DESCRIPTION = "Onetime Charges for DC-MANAGED-SERVICES";
            LIST_PRICE = "0.0";
            DISCOUNT = "0.0";
            NET_PRICE = "0.0";
            NET_AMOUNT = "0.0";
            OPG_FORM_CONTEXT = "Onetime";
          }
          items_field.push({
            SCOD_ID: SCOD_ID++,
            SCQH_ID: requestId,
            SCLA_LINE_ID: parseFloat((1).toString() + "." + (j + 1).toString()),
            ITEM_TYPE: link,
            SCLA_LINE_NO: i + 1,
            SCLA_LINE_DEC: j + 1,
            BATCH_ID: requestId,
            INVENTORY_ITEM_ID: INVENTORY_ITEM_ID,
            ITEM: ITEM,
            ITEM_DESCRIPTION: ITEM_DESCRIPTION,
            QUANTITY: 1,
            LIST_PRICE: LIST_PRICE,
            DISCOUNT: DISCOUNT,
            NET_PRICE: NET_PRICE,
            NET_AMOUNT: NET_AMOUNT,
            ORDER_TYPE: "SDSIN_CMS",
            SERVICE_REF_LINE_ID: service_ref_line_id,
            CONTRACT_PERIOD: 3,
            SHIP_SITE_CODE: "NAVI MUMBAI-10249",
            BILL_SITECODE: "COCHIN-10128",
            BILL_ADDRESS1: "Alpha Plaza K.P.Vallon Road Kadavanthra",
            BILL_ADDRESS2: "Cochin - 682020 Kerala, India.",
            BILL_ADDRESS3: "",
            BILL_CITY: "COCHIN",
            BILL_STATE: "Kerala",
            BILL_REGION: "East",
            BILL_PIN: "682020",
            BILL_TO_ID: 4156802,
            SHIP_TO_ID: 4156801,
            SHIP_ADDRESS1: "Sify, Reliable Plaza",
            SHIP_ADDRESS2: "Kalwa Industrial Area",
            SHIP_ADDRESS3: "Plot No K10, Airoli",
            SHIP_CITY: "NAVI MUMBAI",
            SHIP_STATE: "Maharashtra",
            SHIP_REGION: "East",
            SHIP_PIN: "400708",
            BU: "NULL",
            BUSINESS_LINE: "CMS",
            OPG_FORM_CONTEXT: OPG_FORM_CONTEXT,
            ACTIVITY: "New-Link",
            LINK_ID: parseInt(linkId),
            OPG_CONTEXT: OPG_FORM_CONTEXT,
            BILL_GST_NO: "12AAACS9032R1Z2",
            SHIP_GST_NO: "06AAACS9032R1ZV",
            ORG_ID: 425,
            OPG_ATTRIBUTE40: "New-Link",
            OPG_ATTRIBUTE1: OPG_ATTRIBUTE1,
            OPG_ATTRIBUTE2: OPG_ATTRIBUTE2,
            OPG_ATTRIBUTE3: "1",
            OPG_ATTRIBUTE4: "DC-DR",
            OPG_ATTRIBUTE48: "DRILL PER YEAR",
            OPG_ATTRIBUTE38: OPG_ATTRIBUTE38, //po
            OPG_ATTRIBUTE39: OPG_ATTRIBUTE39,//po date
            OPG_ATTRIBUTE36: "Billing Pattern",
            OPG_ATTRIBUTE46: null,
            OPG_ATTRIBUTE35: "30",
            OPG_ATTRIBUTE15: "",
            OPG_ATTRIBUTE43: "30",
            OPG_ATTRIBUTE47: "3 month",
          });
        }
      }
    }
    // for (i = 5; i < 6; i++) {
    //   const config = {
    //     headers: {
    //       apikey: apikey,
    //     },
    //   };
    //   await axios
    //     .get("https://interface.sify.net/api/cms/link/sequence", config)
    //     .then((response) => {
    //       console.log(response.data);
    //       if (response.data.STATUS == "S") {
    //         //return
    //         linkId = response.data.SEQUENCE.LINK_ID;
    //       }
    //     })
    //     .catch((error) => {
    //       // logger.log({'Status': 'Error', 'message': 'Cannot get sequence API'})
    //       res.send({ Status: error, message: "Cannot get sequence API" });
    //       // return;
    //     });
    //   for (let j = 0; j < 3; j++) {
    //     let activity = "";

    //     let OPG_ATTRIBUTE1 = "INFRA-APPLICATION-SUPPORT";
    //     let OPG_ATTRIBUTE2 = "ACTIVEDIR-PROFICIENT-ADDON-200 USERS";
    //     let OPG_ATTRIBUTE38 = requestId.toString();
    //     let OPG_ATTRIBUTE39 = orderDate;

    //     if (j == 0) {
    //       link = "LINK";
    //       service_ref_line_id = null;
    //       INVENTORY_ITEM_ID = 546956;
    //       ITEM = "DC-MANAGED-SERVICES";
    //       ITEM_DESCRIPTION = "DC-MANAGED-SERVICES";
    //       LIST_PRICE = "0.0";
    //       DISCOUNT = "0.0";
    //       NET_PRICE = "0.0";
    //       NET_AMOUNT = "0.00";
    //       OPG_FORM_CONTEXT = "Not Applicable";
    //     }
    //     if (j == 1) {
    //       link = "RC";
    //       service_ref_line_id = SCOD_ID - 1;
    //       INVENTORY_ITEM_ID = 546957;
    //       ITEM = "DC-MANAGED-SERVICES-RC";
    //       ITEM_DESCRIPTION = "Recurring Charges for DC-MANAGED-SERVICES";
    //       LIST_PRICE = "0.0";
    //       DISCOUNT = "0.0";
    //       NET_PRICE = "0.0";
    //       NET_AMOUNT = "0.0";
    //       OPG_FORM_CONTEXT = "Not Applicable";
    //     }
    //     if (j == 2) {
    //       link = "OT";
    //       service_ref_line_id = null;
    //       INVENTORY_ITEM_ID = 546949;
    //       ITEM = "DC-MANAGED-SERVICES-OT";
    //       ITEM_DESCRIPTION = "Onetime Charges for DC-MANAGED-SERVICES";
    //       LIST_PRICE = "0.0";
    //       DISCOUNT = "0.0";
    //       NET_PRICE = "0.0";
    //       NET_AMOUNT = "0.0";
    //       OPG_FORM_CONTEXT = "Onetime";
    //     }
    //     items_field.push({
    //       SCOD_ID: SCOD_ID++,
    //       SCQH_ID: requestId,
    //       SCLA_LINE_ID: parseFloat((i + 1).toString() + "." + (j + 1).toString()),
    //       ITEM_TYPE: link,
    //       SCLA_LINE_NO: i + 1,
    //       SCLA_LINE_DEC: j + 1,
    //       BATCH_ID: requestId,
    //       INVENTORY_ITEM_ID: INVENTORY_ITEM_ID,
    //       ITEM: ITEM,
    //       ITEM_DESCRIPTION: ITEM_DESCRIPTION,
    //       QUANTITY: 1,
    //       LIST_PRICE: LIST_PRICE,
    //       DISCOUNT: DISCOUNT,
    //       NET_PRICE: NET_PRICE,
    //       NET_AMOUNT: NET_AMOUNT,
    //       ORDER_TYPE: "SDSIN_CMS",
    //       SERVICE_REF_LINE_ID: service_ref_line_id,
    //       CONTRACT_PERIOD: 3,
    //       SHIP_SITE_CODE: "NAVI MUMBAI-10249",
    //       BILL_SITECODE: "COCHIN-10128",
    //       BILL_ADDRESS1: "Alpha Plaza K.P.Vallon Road Kadavanthra",
    //       BILL_ADDRESS2: "Cochin - 682020 Kerala, India.",
    //       BILL_ADDRESS3: "",
    //       BILL_CITY: "COCHIN",
    //       BILL_STATE: "Kerala",
    //       BILL_REGION: "East",
    //       BILL_PIN: "682020",
    //       BILL_TO_ID: 4156802,
    //       SHIP_TO_ID: 4156801,
    //       SHIP_ADDRESS1: "Sify, Reliable Plaza",
    //       SHIP_ADDRESS2: "Kalwa Industrial Area",
    //       SHIP_ADDRESS3: "Plot No K10, Airoli",
    //       SHIP_CITY: "NAVI MUMBAI",
    //       SHIP_STATE: "Maharashtra",
    //       SHIP_REGION: "East",
    //       SHIP_PIN: "400708",
    //       BU: "NULL",
    //       BUSINESS_LINE: "CMS",
    //       OPG_FORM_CONTEXT: OPG_FORM_CONTEXT,
    //       ACTIVITY: "New-Link",
    //       LINK_ID: parseInt(linkId),
    //       OPG_CONTEXT: OPG_FORM_CONTEXT,
    //       BILL_GST_NO: "12AAACS9032R1Z2",
    //       SHIP_GST_NO: "06AAACS9032R1ZV",
    //       ORG_ID: 425,
    //       OPG_ATTRIBUTE40: "New-Link",
    //       OPG_ATTRIBUTE1: OPG_ATTRIBUTE1,
    //       OPG_ATTRIBUTE2: OPG_ATTRIBUTE2,
    //       OPG_ATTRIBUTE3: "1",
    //       OPG_ATTRIBUTE4: "DC-DR",
    //       OPG_ATTRIBUTE48: "DRILL PER YEAR",
    //       OPG_ATTRIBUTE38: OPG_ATTRIBUTE38,
    //       OPG_ATTRIBUTE39: OPG_ATTRIBUTE39,
    //       OPG_ATTRIBUTE36: "Billing Pattern",
    //       OPG_ATTRIBUTE46: null,
    //       OPG_ATTRIBUTE35: "30",
    //       OPG_ATTRIBUTE15: "",
    //       OPG_ATTRIBUTE43: "30",
    //       OPG_ATTRIBUTE47: "3 month",
    //     });
    //   }
    // }
    res.status(200).send({ HEADER: headers_field, ITEMS: items_field });
  } catch (err) {
    next(err);
  }
};
