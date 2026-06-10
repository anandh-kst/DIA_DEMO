const logger = require("../config/winston");
const common = require("../common");
const fs = require("fs");
const oracledb = require("oracledb");
const { default: axios } = require("axios");
const https = require("https");
const moment = require("moment");
const { ObjectId } = require("mongodb");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
exports.send_mail_to_all = async (req, res, next) => {
  try {
    const { mailIdList, reqId } = req.body;
    if (!reqId) throw new Error("Missing required parameters: reqId.");

    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);

    await Quote.findOneAndUpdate({ reqId }, { $pull: { mailIdList: {} } });
    await Quote.findOneAndUpdate(
      { reqId },
      {
        $addToSet: {
          mailIdList: { $each: mailIdList },
        },
      }
    );
    let mailIds = [];
    for await (const data of mailIdList) {
      mailIds.push(data.mail);
    }
    const poPdfUrl = `${process.env.APP_PATH}/onesify/network/docu_sign/${quote.quoteType === "New" ? "get_sign_order" : "get_modify_sign_order/true"}/ILL-SO-${reqId}`;

    const subject = "Purchase Order - Sify";
    const html = `<html>
        <head>
            <title>ILL Purchase Order</title>
        </head>
        <body>
            <div style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747;font-family:'Myriad Pro', sans-serif" width="100%">
                <br/>
                <table align="center" border="0" cellpadding="0" cellspacing="0"
                    width="70%" bgcolor="white" >
                    <tbody>
                        <tr style="border: none;
                        background-color: #ffffff;
                        height: 40px;
                        color:white;
                        padding-bottom: 20px;
                        text-align: left;">
                            <td height="50px" align="left">
                            <a href="" style="border: 0; text-decoration:none;">
                                    <!--[if mso]>
                                    <table width="50%"><tr><td><img width="200" src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png" alt="One Sify" style="text-align: right; width: 207px; border: 0; text-decoration:none; vertical-align: baseline;"></td></tr></table>
                                        <div style="display:none">
                                        <![endif]-->
                                        <!--[if mso]>
                                        </div>
                                    <![endif]-->
                                    <!--[if !mso]>-->
                                        <img  src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png" alt="One Sify" style="text-align: right; min-width: 50px; max-width: 207px; border: 0; text-decoration:none; vertical-align: baseline;">
                                    <!--<![endif]-->
                                </a>
                                <hr/>
                            </td>
                        </tr>
                        <tr style="display: inline-block;">
                            <td style="
                            border: none;
                            background-color: white;
                            padding-left: 25px;
                            padding-right: 25px;">
                                <p>Dear <span style="font-size: 18px; color: #0E3346;">${quote.companyName}</span></p>
                                <p>You have signed the DIA purchase order successfully.</p>
                                <br/>
                            </td>
                        </tr>
        
                        <!-- Green Card -->
                        <tr style="display: inline-block;">
                            <td style="height: 150px;
                                    width: 100%;
                                    padding-left: 25px;
                                    padding-right: 25px;
                                    border: none;
                                    background-color: white;">
                                    <!--[if mso]>
                                        <table style="width: 100%;
                                        height: 100px;
                                        background: #E9EBEC;
                                        padding: 25px;
                                        box-sizing: border-box;
                                        border-radius: 5px;
                                        color: #FFF;">
                                            <tr>
                                                <td style="border-radius: 2px; text-align: left;">
                                                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${poPdfUrl}"  style="background-color: #E9EBEC;
            ">                                          color: #FFFFFF;
                                                        padding: 20px;
                                                        margin: 50px;
                                                        padding-left: 50px;
                                                        border-radius: 5px;
                                                    <w:anchorlock/>
                                                    <center style="background-color: #0E3346;
                                                        border: none;
                                                        border-radius: 5px;
                                                        font-family: 'Myriad Pro', sans-serif;
                                                        color: #fff;
                                                        padding: 15px 32px;
                                                        text-align: center;
                                                        text-decoration: none;
                                                        display: inline-block;
                                                        font-size: 16px;
                                                        margin: 20px 0px;
                                                        cursor: pointer;">Click Here to See</center>
                                                    </v:roundrect>
                                                </td>
                                            </tr>
                                        </table>
                                <![endif]-->
                                <!--[if !mso]>-->
                                    <table style="width: 100%;
                                        height: 100px;
                                        background: #E9EBEC;
                                        padding: 15px;
                                        border-radius: 5px;
                                        box-sizing: border-box;
                                        color: #FFF;">
                                        <tr>
                                            <td style="border-radius: 2px; text-align: left;">
                                                <a href="${poPdfUrl}" target="_blank" style="background-color: #0E3346;
                                                            border: none;
                                                            border-radius: 5px;
                                                            font-family: 'Myriad Pro', sans-serif;
                                                            color: #fff;
                                                            padding: 15px 32px;
                                                            text-align: center;
                                                            text-decoration: none;
                                                            display: inline-block;
                                                            font-size: 16px;
                                                            margin: 20px 0px;
                                                            cursor: pointer;">
                                                    Click Here to See
                                                </a>
                                            </td>
                                        </tr>
                                    </table>
                                <!--<![endif]-->
                                <h4>(or)</h4>
                                <p style="margin-bottom: 0px;">Click the link</p>
                                <p>
                                <a href="${poPdfUrl}" class="link">${process.env.APP_PATH}</a>
                                </p>
                                <br>
                                <p class="bestRegards">Best Regards,</p>
                                <p>Sify Team</p>
                                <p><a href="mailto:online.sales@sifycorp.com" target="_blank" class="link">online.sales@sifycorp.com</a>
                                </p>
                                <br>
                                <p>If you do not recognize this activity or did not initiate the request, report to the above email id.</p>
                                <br>
                            </td>
                        </tr>
                        <tr style="border: none;
                        /* background-color: #0B617A; */
                        height: 40px;
                        color:#0A2134;
                        text-align: center; background: #fff;">
                        <td height="40px" align="center">
                            <p style="color: #0A2134;
                            line-height: 1.5em;">
                            <a style="color:#0A2134;" href="">Sify.com</a> | <a style="color:#0A2134;" href="">Login</a> | <a style="color:#0A2134;" href="">Knowledge Base</a>
                            </p>
                            <hr/>
                            <a href="https://www.linkedin.com/company/sify" target="_blank"
                            style="border:none;
                                text-decoration: none;
                                padding: 5px;">
                            <img height="30"
                            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij4KICA8ZyBpZD0ibGlua2VkaW4iIHRyYW5zZm9ybT0idHJhbnNsYXRlKC02MjUgLTg2NSkiPgogICAgPGcgaWQ9IkVsbGlwc2VfMjU0IiBkYXRhLW5hbWU9IkVsbGlwc2UgMjU0IiB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2MjUgODY1KSIgZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjNmE3MzdjIiBzdHJva2Utd2lkdGg9IjEiPgogICAgICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMiIgc3Ryb2tlPSJub25lIi8+CiAgICAgIDxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjExLjUiIGZpbGw9Im5vbmUiLz4KICAgIDwvZz4KICAgIDxwYXRoIGlkPSJJY29uX3pvY2lhbC1saW5rZWRpbiIgZGF0YS1uYW1lPSJJY29uIHpvY2lhbC1saW5rZWRpbiIgZD0iTS0uMTgsMS4zQTEuMDE3LDEuMDE3LDAsMCwxLC4xNTEuNTIzLDEuMjEzLDEuMjEzLDAsMCwxLDEuMDEuMjE2YTEuMTc3LDEuMTc3LDAsMCwxLC44NDEuMywxLjA2NiwxLjA2NiwwLDAsMSwuMzMxLjgxMiwxLDEsMCwwLDEtLjMyMS43NTZBMS4yMTUsMS4yMTUsMCwwLDEsLjk5MSwyLjRILjk4MmExLjE1NiwxLjE1NiwwLDAsMS0uODQxLS4zMTJBMS4wNDcsMS4wNDcsMCwwLDEtLjE4LDEuM1ptLjEyMyw4LjI2NlYzLjI1OGgyLjF2Ni4zMWgtMi4xWm0zLjI1OSwwSDUuM1Y2LjA0NWExLjM2LDEuMzYsMCwwLDEsLjA3Ni0uNTEsMS4zNywxLjM3LDAsMCwxLC40LS41NDMsMS4wMjYsMS4wMjYsMCwwLDEsLjY3NS0uMjIyUTcuNTEsNC43NjksNy41MSw2LjJWOS41NjhoMi4xVjUuOTVhMy4wNDEsMy4wNDEsMCwwLDAtLjY2MS0yLjEyMUEyLjI1NiwyLjI1NiwwLDAsMCw3LjIsMy4xMDcsMi4xNDQsMi4xNDQsMCwwLDAsNS4zLDQuMTU1di4wMTlINS4yOUw1LjMsNC4xNTV2LS45SDMuMnEuMDE5LjMuMDE5LDEuODhUMy4yLDkuNTY4WiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNjMyLjMwMyA4NzIuMTIzKSIgZmlsbD0iIzZhNzM3YyIvPgogIDwvZz4KPC9zdmc+Cg=="
                            width="30" style="position: relative;" />
                            </a>
                            <a href="https://www.youtube.com/user/SifyTechnologies" target="_blank"
                            style="border:none;
                            text-decoration: none;
                            padding: 5px;">
                            <img height="30"
                            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij4KICA8ZyBpZD0ieW91dHViZSIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTY2NyAtODY1KSI+CiAgICA8ZyBpZD0iRWxsaXBzZV8yNTUiIGRhdGEtbmFtZT0iRWxsaXBzZSAyNTUiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDY2NyA4NjUpIiBmaWxsPSIjZmZmIiBzdHJva2U9IiM2YTczN2MiIHN0cm9rZS13aWR0aD0iMSI+CiAgICAgIDxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEyIiBzdHJva2U9Im5vbmUiLz4KICAgICAgPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTEuNSIgZmlsbD0ibm9uZSIvPgogICAgPC9nPgogICAgPHBhdGggaWQ9Ikljb25fbWV0cm8teW91dHViZS1wbGF5IiBkYXRhLW5hbWU9Ikljb24gbWV0cm8teW91dHViZS1wbGF5IiBkPSJNMTEuOCwxMS4yMjRhLjQxNS40MTUsMCwwLDAtLjIxNi0uMzg5TDcuODkxLDguNTI4YS40MzUuNDM1LDAsMCwwLS40NjktLjAxNC40MjkuNDI5LDAsMCwwLS4yMzguNHY0LjYxM2EuNDI5LjQyOSwwLDAsMCwuMjM4LjQuNS41LDAsMCwwLC4yMjMuMDU4LjQxMS40MTEsMCwwLDAsLjI0NS0uMDcybDMuNjkxLTIuMzA3YS40MTUuNDE1LDAsMCwwLC4yMTYtLjM4OVptMy42OTEsMHEwLC42OTItLjAwNywxLjA4MXQtLjA2MS45ODRhNy45NzQsNy45NzQsMCwwLDEtLjE2MiwxLjA2MywxLjY4NiwxLjY4NiwwLDAsMS0uNS44ODcsMS41MiwxLjUyLDAsMCwxLS44OTQuNDE4LDQ3LjI1OSw0Ny4yNTksMCwwLDEtNC44MzcuMTgsNDcuMjU5LDQ3LjI1OSwwLDAsMS00LjgzNy0uMTgsMS41MzcsMS41MzcsMCwwLDEtLjktLjQxOCwxLjY3NiwxLjY3NiwwLDAsMS0uNS0uODg3LDguOTIzLDguOTIzLDAsMCwxLS4xNTUtMS4wNjNxLS4wNTQtLjU5NS0uMDYxLS45ODR0LS4wMDctMS4wODFxMC0uNjkyLjAwNy0xLjA4MXQuMDYxLS45ODRBNy45NzQsNy45NzQsMCwwLDEsMi44LDguMWExLjY4NiwxLjY4NiwwLDAsMSwuNS0uODg3LDEuNTIsMS41MiwwLDAsMSwuODk0LS40MThBNDcuMjU5LDQ3LjI1OSwwLDAsMSw5LjAzLDYuNjFhNDcuMjU4LDQ3LjI1OCwwLDAsMSw0LjgzNy4xOCwxLjUzNiwxLjUzNiwwLDAsMSwuOS40MTgsMS42NzYsMS42NzYsMCwwLDEsLjUuODg3LDguOTIzLDguOTIzLDAsMCwxLC4xNTUsMS4wNjNxLjA1NC41OTUuMDYxLjk4NFQxNS40ODgsMTEuMjI0WiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNjY5Ljk3MSA4NjUuODU0KSIgZmlsbD0iIzZhNzM3YyIvPgogIDwvZz4KPC9zdmc+Cg=="
                            width="30" style="position: relative;" />
                            </a>
                            <a href="https://twitter.com/sifytech" target="_blank"
                            style="border:none;
                            text-decoration: none;
                            padding: 5px;">
                            <img height="30"
                            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij4KICA8ZyBpZD0iVHdpdHRlciIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTcwOSAtODY1KSI+CiAgICA8ZyBpZD0iRWxsaXBzZV8yNTYiIGRhdGEtbmFtZT0iRWxsaXBzZSAyNTYiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDcwOSA4NjUpIiBmaWxsPSIjZmZmIiBzdHJva2U9IiM2YTczN2MiIHN0cm9rZS13aWR0aD0iMSI+CiAgICAgIDxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEyIiBzdHJva2U9Im5vbmUiLz4KICAgICAgPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTEuNSIgZmlsbD0ibm9uZSIvPgogICAgPC9nPgogICAgPHBhdGggaWQ9Ikljb25fbWV0cm8tdHdpdHRlciIgZGF0YS1uYW1lPSJJY29uIG1ldHJvLXR3aXR0ZXIiIGQ9Ik0xNS43MjYsNi4wODNhNS40LDUuNCwwLDAsMS0xLjU1LjQyNSwyLjcwNywyLjcwNywwLDAsMCwxLjE4Ny0xLjQ5Myw1LjQsNS40LDAsMCwxLTEuNzE0LjY1NSwyLjcsMi43LDAsMCwwLTQuNiwyLjQ2Miw3LjY2Myw3LjY2MywwLDAsMS01LjU2My0yLjgyLDIuNywyLjcsMCwwLDAsLjgzNSwzLjZBMi42ODgsMi42ODgsMCwwLDEsMy4xLDguNTc3YzAsLjAxMSwwLC4wMjMsMCwuMDM0YTIuNywyLjcsMCwwLDAsMi4xNjUsMi42NDcsMi43LDIuNywwLDAsMS0xLjIxOS4wNDYsMi43LDIuNywwLDAsMCwyLjUyMSwxLjg3NCw1LjQxNSw1LjQxNSwwLDAsMS0zLjM1MiwxLjE1NSw1LjQ3NCw1LjQ3NCwwLDAsMS0uNjQ0LS4wMzhBNy42NzYsNy42NzYsMCwwLDAsMTQuMzg3LDcuODI5cTAtLjE3Ni0uMDA4LS4zNDlhNS40ODMsNS40ODMsMCwwLDAsMS4zNDctMS40WiIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNzExLjkzIDg2Ny4xODMpIiBmaWxsPSIjNmE3MzdjIi8+CiAgPC9nPgo8L3N2Zz4K"
                            width="30" style="position: relative;"/>
                            </a>
                        </td>
                        </tr>
                        <tr style="display: inline-block;">
                            <td style="height: 150px;
                                    padding: 20px;
                                    border: none;
                                    background-color: white;">
                                    <h4>Headquarters</h4>
                                    <p>II Floor, TIDEL Park,<br/>
                                    No.4, Rajiv Gandhi Salai, Taramani,<br/>
                                    Chennai - 600 113, India</p>
                                    <br>
                            </td>
                        </tr>
                        <td style="
                                font-size:16px; line-height:18px;
                                color:#0A2134;" valign="top" align="center">
                                <p>This is an auto generated mail. Please do not reply.<br>
                                    Â© 2023
         Sify Technologies Limited. All Rights Reserved.</p>
                            </td>
                        </tr>
                </tbody>
                </table>
                <br/>
                </div>
        </body>
    </html>`;

    const sendMail = await common.send_mail(mailIds, null, subject, html, (attachments = null), next);
    if (sendMail) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      res.send({ status: "Success" });
    }
  } catch (error) {
    next(error);
  }
};
exports.send_mail_to_sign = async (req, res, next) => {
  try {
    const { to, cc, reqId } = req.body;
    if (!to || to.length === 0) {
      throw new Error("Error Missing Data");
    }

    const withTimeout = (promise, timeout = 30000) => {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Email sending operation timed out")), timeout)
        ),
      ]);
    };

    const quote = await Quote.findOne({ reqId });
    if (!quote) throw new Error(`Quote with reqId: ${reqId} not found or is inactive.`);
    console.log("quote", quote);
    console.log("quote.companyId", quote.companyId);
    if (quote.status === "Order Signed" || quote.status === "Order Placed") {
      res.send({
        status: "Error",
        message: `Order already signed for reqId: ${reqId}`,
      });
      return;
    }
    let companyName = "";

    let companyFilter = null;

    if (ObjectId.isValid(quote.companyId)) {
      companyFilter = { _id: new ObjectId(quote.companyId) };
    } else {
      companyFilter = { companyId: quote.companyId };
    }

    const companyRecord = await loginDB.collection("companies").findOne(companyFilter);
    console.log("companyRecord", companyRecord);

    if (companyRecord && companyRecord.companyName) {
      companyName = companyRecord.companyName;

    }

    if (!companyName) {
      throw new Error(`Company not found in companies table for companyId: ${quote.companyId}`);
    }

    const currentYear = moment().format("YYYY");
    const toArray = (to || []).map((item) => item.mail);
    const ccArray = cc || [];
    if (!toArray.length) {
      throw new Error("No recipients defined");
    }
    const renderTemplate = (template, data = {}) => {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return data[key] ?? "";
      });
    };

    const docuSignUrl = `${process.env.APP_PATH}/onesify/network/common/share_and_sign/${reqId}/${to[0].name}/${to[0].mail}`;
    const docuSignUrlForCc = `${process.env.APP_PATH}/onesify/network/docu_sign/view_sign_order/ILL-SO-${reqId}`;

    const parentRole = quote.parentRole;
    const customerName = quote.customerName;
    const customerMail = quote.customermail;

    let subject = "";
    let html = "";
    let subjectForCc = "";
    let htmlForCc = "";

    const htmlTemplateCustomer = `<html>
 <head>
          <title>DIA Template</title>
      </head>
      <body>
          <div style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747;font-family:'Myriad Pro', sans-serif" width="100%">
              <br/>
              <table align="center" border="0" cellpadding="0" cellspacing="0"
                  width="70%" bgcolor="white" >
                  <tbody>
                      <tr style="border: none;
                      background-color: #ffffff;
                      height: 40px;
                      color:white;
                      padding-bottom: 20px;
                      text-align: right;">
                          <td height="50px" align="right">
                          <a href="" style="border: 0; text-decoration:none;">
                                      <img  src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png" alt="One Sify" style="text-align: right; min-width: 50px; max-width: 207px; border: 0; text-decoration:none; vertical-align: baseline;">
                              </a>
                              <hr/>
                          </td>
                      </tr>
                      <tr style="display: inline-block;">
                          <td style="
                          border: none;
                          background-color: white;
                          padding-left: 25px;
                          padding-right: 25px;">
                              <p>Dear <span style="font-size: 18px; color: #0E3346;">{{name}}</span></p>
                              <p>The user {{firstName}} {{lastName}} from the company {{companyName}} has shared the document for your signature.</p>
                              <br/>
                          </td>
                      </tr>
                      <!-- Green Card -->
                      <tr style="display: inline-block;">
                          <td style="height: 150px;
                                  width: 100%;
                                  padding-left: 25px;
                                  padding-right: 25px;
                                  border: none;
                                  background-color: white;">
                                  <!--[if mso]>
                                      <table style="width: 100%;
                                      height: 100px;
                                      background: #E9EBEC;
                                      padding: 25px;
                                      box-sizing: border-box;
                                      border-radius: 5px;
                                      color: #FFF;">
                                          <tr>
                                              <td style="border-radius: 2px; text-align: left;">
                                                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{docuSignUrl}}"  style="background-color: #E9EBEC;
          ">                                          color: #FFFFFF;
                                                      padding: 20px;
                                                      margin: 50px;
                                                      padding-left: 50px;
                                                      border-radius: 5px;
                                                  <w:anchorlock/>
                                                  <center style="background-color: #0E3346;
                                                      border: none;
                                                      border-radius: 5px;
                                                      font-family: 'Myriad Pro', sans-serif;
                                                      color: #fff;
                                                      padding: 15px 32px;
                                                      text-align: center;
                                                      text-decoration: none;
                                                      display: inline-block;
                                                      font-size: 16px;
                                                      margin: 20px 0px;
                                                      cursor: pointer;">Click Here to Sign</center>
                                                  </v:roundrect>
                                              </td>
                                          </tr>
                                      </table>
                              <![endif]-->
                              <!--[if !mso]>-->
                                  <table style="width: 100%;
                                      height: 100px;
                                      background: #E9EBEC;
                                      padding: 15px;
                                      border-radius: 5px;
                                      box-sizing: border-box;
                                      color: #FFF;">
                                      <tr>
                                          <td style="border-radius: 2px; text-align: left;">
                                              <a href="{{docuSignUrl}}" target="_blank" style="background-color: #0E3346;
                                                          border: none;
                                                          border-radius: 5px;
                                                          font-family: 'Myriad Pro', sans-serif;
                                                          color: #fff;
                                                          padding: 15px 32px;
                                                          text-align: center;
                                                          text-decoration: none;
                                                          display: inline-block;
                                                          font-size: 16px;
                                                          margin: 20px 0px;
                                                          cursor: pointer;">
                                                  Click Here to Sign
                                              </a>
                                          </td>
                                      </tr>
                                  </table>
                              <!--<![endif]-->
                              <h4>(or)</h4>
                              <p style="margin-bottom: 0px;">Click the link</p>
                              <p>
                              <a href="{{docuSignUrl}}" class="link">{{appPath}}</a>
                              </p>
                              <br>
                              <p class="bestRegards">Best Regards,</p>
                              <p>Sify Team</p>
                              <p><a href="mailto:online.sales@sifycorp.com" target="_blank" class="link">online.sales@sifycorp.com</a>
                              </p>
                              <br>
                              <p>If you do not recognize this activity or did not initiate the request, report to the above email id.</p>
                              <br>
                          </td>
                      </tr>
                      <tr style="display: inline-block;">
                          <td style="height: 150px;
                                  padding: 20px;
                                  border: none;
                                  background-color: white;">
                                  <h4>Headquarters</h4>
                                  <p>II Floor, TIDEL Park,<br/>
                                  No.4, Rajiv Gandhi Salai, Taramani,<br/>
                                  Chennai - 600 113, India</p>
                                  <br>
                          </td>
                      </tr>
                      <td style="
                              font-size:16px; line-height:18px;
                              color:#0A2134;" valign="top" align="center">
                              <p>This is an auto generated mail. Please do not reply.<br>
                                  © {{currentYear}}
       Sify Technologies Limited. All Rights Reserved.</p>
                          </td>
                      </tr>
              </tbody>
              </table>
              <br/>
              </div>
      </body>
    </html>`;
    const htmlForCcCustomer = `<html>
<head>
      <title>DIA Template</title>
  </head>
<body>
      <div style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747;font-family:'Myriad Pro', sans-serif" width="100%">
          <br/>
          <table align="center" border="0" cellpadding="0" cellspacing="0"
              width="70%" bgcolor="white" >
              <tbody>
                  <tr style="border: none;
                  background-color: #ffffff;
                  height: 40px;
                  color:white;
                  padding-bottom: 20px;
                  text-align: right;">
                      <td height="50px" align="right">
                      <a href="" style="border: 0; text-decoration:none;">
                                  <img  src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png" alt="One Sify" style="text-align: right; min-width: 50px; max-width: 207px; border: 0; text-decoration:none; vertical-align: baseline;">
                          </a>
                          <hr/>
                      </td>
                  </tr>
                  <tr style="display: inline-block;">
                      <td style="
                      border: none;
                      background-color: white;
                      padding-left: 25px;
                      padding-right: 25px;">
                          <p>Dear <span style="font-size: 18px; color: #0E3346;">{{name}}</span></p>
                          <p>The user {{firstName}} {{lastName}} from the company {{companyName}} has shared the document.</p>
                          <br/>
                      </td>
                  </tr>
  
                  <!-- Green Card -->
                  <tr style="display: inline-block;">
                      <td style="height: 150px;
                              width: 100%;
                              padding-left: 25px;
                              padding-right: 25px;
                              border: none;
                              background-color: white;">
                              <!--[if mso]>
                                  <table style="width: 100%;
                                  height: 100px;
                                  background: #E9EBEC;
                                  padding: 25px;
                                  box-sizing: border-box;
                                  border-radius: 5px;
                                  color: #FFF;">
                                      <tr>
                                          <td style="border-radius: 2px; text-align: left;">
                                              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{docuSignUrlForCc}}"  style="background-color: #E9EBEC;
      ">                                          color: #FFFFFF;
                                                  padding: 20px;
                                                  margin: 50px;
                                                  padding-left: 50px;
                                                  border-radius: 5px;
                                              <w:anchorlock/>
                                              <center style="background-color: #0E3346;
                                                  border: none;
                                                  border-radius: 5px;
                                                  font-family: 'Myriad Pro', sans-serif;
                                                  color: #fff;
                                                  padding: 15px 32px;
                                                  text-align: center;
                                                  text-decoration: none;
                                                  display: inline-block;
                                                  font-size: 16px;
                                                  margin: 20px 0px;
                                                  cursor: pointer;">Click Here to View</center>
                                              </v:roundrect>
                                          </td>
                                      </tr>
                                  </table>
                          <![endif]-->
                          <!--[if !mso]>-->
                              <table style="width: 100%;
                                  height: 100px;
                                  background: #E9EBEC;
                                  padding: 15px;
                                  border-radius: 5px;
                                  box-sizing: border-box;
                                  color: #FFF;">
                                  <tr>
                                      <td style="border-radius: 2px; text-align: left;">
                                          <a href="{{docuSignUrlForCc}}" target="_blank" style="background-color: #0E3346;
                                                      border: none;
                                                      border-radius: 5px;
                                                      font-family: 'Myriad Pro', sans-serif;
                                                      color: #fff;
                                                      padding: 15px 32px;
                                                      text-align: center;
                                                      text-decoration: none;
                                                      display: inline-block;
                                                      font-size: 16px;
                                                      margin: 20px 0px;
                                                      cursor: pointer;">
                                              Click Here to View
                                          </a>
                                      </td>
                                  </tr>
                              </table>
                          <!--<![endif]-->
                          <h4>(or)</h4>
                          <p style="margin-bottom: 0px;">Click the link</p>
                          <p>
                          <a href="{{docuSignUrlForCc}}" class="link">{{appPath}}</a>
                          </p>
                          <br>
                          <p class="bestRegards">Best Regards,</p>
                          <p>Sify Team</p>
                          <p><a href="mailto:online.sales@sifycorp.com" target="_blank" class="link">online.sales@sifycorp.com</a>
                          </p>
                          <br>
                          <p>If you do not recognize this activity or did not initiate the request, report to the above email id.</p>
                          <br>
                      </td>
                  </tr>
                  <tr style="display: inline-block;">
                      <td style="height: 150px;
                              padding: 20px;
                              border: none;
                              background-color: white;">
                              <h4>Headquarters</h4>
                              <p>II Floor, TIDEL Park,<br/>
                              No.4, Rajiv Gandhi Salai, Taramani,<br/>
                              Chennai - 600 113, India</p>
                              <br>
                      </td>
                  </tr>
                  <td style="
                          font-size:16px; line-height:18px;
                          color:#0A2134;" valign="top" align="center">
                          <p>This is an auto generated mail. Please do not reply.<br>
                              © {{currentYear}}
   Sify Technologies Limited. All Rights Reserved.</p>
                      </td>
                  </tr>
          </tbody>
          </table>
          <br/>
          </div>
  </body>
    </html>`;


    const htmlForCp = `<html>
      <head>
  <title>Sify-Channel Partner - Document for E-Signature</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      margin: 0;
      padding: 0;
      background-color: #ffffff;
    }
    .container {
      width: 100%;
      max-width: 595pt;
      margin: 0 auto;
    }
    .main-content {
      padding: 20px;
    }
    p {
      margin-bottom: 10px;
      color: rgb(29, 31, 33);
      line-height: 1.5;
    }
    .sub-heading {
      color: #0E3346;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .logo {
      text-align: right;
      margin-bottom: 20px;
    }
    .logo svg {
      width: 55px;
      height: 29px;
    }
    .bullet-table {
      margin-left: 15px;
    }
    .bullet-table td {
      vertical-align: top;
      font-size: 10pt;
      color: rgb(29, 31, 33);
      padding: 2px 0;
    }
    .bullet-icon {
      width: 10px;
      text-align: left;
      padding-right: 5px;
    }
    .button-details {
      margin-top: 20px;
    }
    .button-details p {
      margin-bottom: 30px;
      line-height: 1;
    }
    .link {
      color: #3b80ff;
      text-decoration: none;
    }
    .link:hover {
      text-decoration: underline;
    }
    .footer {
      padding: 15px 20px;
      text-align: center;
      font-size: 9pt;
      color: #555;
      margin-top: 30px;
    }
    .footer span {
      display: block;
      margin-top: -30px;
    }
    .top-header {
      margin-top: 15px;
    }
    .greeting-section {
      margin-top: 10px;
    }
    @media only screen and (max-width: 600px) {
      .main-content {
        padding: 15px;
      }
      .logo {
        text-align: center;
      }
      .footer {
        padding: 10px 15px;
        margin-top: 20px;
      }
      .footer span {
        margin-bottom: 8px;
      }
      .bullet-table {
        margin-left: 10px;
      }
    }
  </style>
</head>
      <body>
        <div
          style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747; font-family:'Myriad Pro', sans-serif;"
          width="100%">
          <br />
          <table align="center" border="0" cellpadding="0" cellspacing="0" width="70%" bgcolor="white">
            <tbody>
              <tr>
                <td align="right" height="50px">
                  <a href="https://www.sifytechnologies.com" style="border: 0; text-decoration:none;">
                    <img src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png"
                      alt="One Sify"
                      style="text-align: right; min-width: 50px; max-width: 207px; border: 0; text-decoration:none; vertical-align: baseline;">
                  </a>
                  <hr />
                </td>
              </tr>
              <tr>
                <td style="padding: 25px;">
                  <p>Dear <span style="font-size: 18px; color: #0E3346;">{{name}}</span>,</p>
                  <p>Greetings from Sify!</p>
                  <p><strong>{{firstName}} {{lastName}}</strong>, from 
                    <strong>{{companyName}}</strong>, a trusted Channel Partner of Sify, has shared a document that requires  your review and signature.

                  <p><strong>Order Details</strong></p>
                  <ul style="padding-left: 20px;">
                    <li><strong>Name of document:</strong> ILL-SO-{{reqId}}</li>
                    <li><strong>Request ID:</strong> {{reqId}}</li>
                    <li><strong>Product name:</strong> DIA</li>
                  </ul>
                  <p>To proceed, kindly review and sign the document using <a href="{{docuSignUrl}}">DocuSign Link</a> or below
                    button:</p>
                  <table style="width: 100%; background: #E9EBEC; padding: 15px; border-radius: 5px; box-sizing: border-box;">
                    <tr>
                      <td style="text-align: left;">
                        <a href="{{docuSignUrl}}" target="_blank"
                          style="background-color: #0E3346; border: none; border-radius: 5px; font-family: 'Myriad Pro', sans-serif; color: #fff; padding: 15px 32px; text-align: center; text-decoration: none; display: inline-block; font-size: 16px; cursor: pointer;">
                          Sign Order Document
                        </a>
                      </td>
                    </tr>
                  </table>
                  <br />
                  <p>Please complete the signing process at your earliest convenience to avoid any delays in order processing.
                  </p>
                  <p>For any queries, feel free to reach out to <strong>{{customerName}}</strong> at <a
                      href="mailto:{{customerMail}}">{{customerMail}}</a>, or write to us at <a
                      href="mailto:onesify@sifycorp.com">onesify@sifycorp.com</a></p>
                  <br />
                  <p>Thank you for choosing Sify.</p>
                  <p class="bestRegards">Best Regards,</p>
                  <p>Team Sify</p>
                  <p><a href="https://www.sifytechnologies.com" target="_blank">Sify Website Link</a></p>
                  <br />
                </td>
              </tr>
              <tr>
                <td style="font-size: 14px; color: #0A2134;" align="center">
                    © {{currentYear}} Sify Technologies Limited. All Rights Reserved.</p><br />
                    <p>This is an auto-generated email. Please do not reply.<br />
                </td>
              </tr>
            </tbody>
          </table>
          <br />
        </div>
      </body>
    </html>`;

    const htmlForCcCp = `<html>
      <head>
  <title> Sify - Channel Partner - Document for E-Signature</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      margin: 0;
      padding: 0;
      background-color: #ffffff;
    }
    .container {
      width: 100%;
      max-width: 595pt;
      margin: 0 auto;
    }
    .main-content {
      padding: 20px;
    }
    p {
      margin-bottom: 10px;
      color: rgb(29, 31, 33);
      line-height: 1.5;
    }
    .sub-heading {
      color: #0E3346;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .logo {
      text-align: right ! important;
      margin-bottom: 20px;
    }
    .logo svg {
      width: 55px;
      height: 29px;
    }
    .bullet-table {
      margin-left: 15px;
    }
    .bullet-table td {
      vertical-align: top;
      font-size: 10pt;
      color: rgb(29, 31, 33) !important;
      padding: 2px 0;
    }
    .bullet-icon {
      width: 10px;
      text-align: left;
      padding-right: 5px;
    }
    .button-details {
      margin-top: 20px;
    }
    .button-details p {
      margin-bottom: 30px;
      line-height: 1;
    }
    .link {
      color: #3b80ff;
      text-decoration: none;
    }
    .link:hover {
      text-decoration: underline;
    }
    .footer {
      padding: 15px 20px;
      text-align: center;
      font-size: 9pt;
      color: #555;
      margin-top: 30px;
    }
    .footer span {
      display: block;
      margin-top: -30px;
    }
    .top-header {
      margin-top: 15px;
    }
    .greeting-section {
      margin-top: 10px;
    }
    @media only screen and (max-width: 600px) {
      .main-content {
        padding: 15px;
      }
      .logo {
        text-align: center;
      }
      .footer {
        padding: 10px 15px;
        margin-top: 20px;
      }
      .footer span {
        margin-bottom: 8px;
      }
      .bullet-table {
        margin-left: 10px;
      }
    }
  </style>
</head>
      <body>
        <div
          style="background-color:#ffffff; margin: 1px; font-size: 16px; color: #474747; font-family:'Myriad Pro', sans-serif;"
          width="100%">
          <br />
          <table align="center" border="0" cellpadding="0" cellspacing="0" width="70%" bgcolor="white">
            <tbody>
              <tr>
                <td align="right" height="50px">
                  <a href="https://www.sifytechnologies.com" style="border: 0; text-decoration:none;">
                    <img src="https://www.sifytechnologies.com/wp-content/uploads/2022/04/logo_007800781_2166.png"
                      alt="One Sify"
                      style="text-align: right; min-width: 50px; max-width: 207px; border: 0; text-decoration:none; vertical-align: baseline;">
                  </a>
                  <hr />
                </td>
              </tr>
              <tr>
                <td style="padding: 25px;">
                  <p>Dear <span style="font-size: 18px; color: #0E3346;">{{name}}</span>,</p>
                  <p>Greetings from Sify!</p>
                  <p><strong>{{customerName}}</strong>, Sify's Channel Partner from
                    <strong>{{cpcompanyName}}</strong>, has shared an order document for your review.
                    Please find the order details below:</p>
                  <p><strong>Order Details</strong></p>
                  <ul style="padding-left: 20px;">
                    <li><strong>Name of document:</strong> ILL-SO-{{reqId}}</li>
                    <li><strong>Request ID:</strong> {{reqId}}</li>
                    <li><strong>Product name:</strong> DIA</li>
                  </ul>
                  <p>To proceed, kindly review the document using <a href="{{docuSignUrlForCc}}">view the document</a> or below
                    button:</p>
                  <table style="width: 100%; background: #E9EBEC; padding: 15px; border-radius: 5px; box-sizing: border-box;">
                    <tr>
                      <td style="text-align: left;">
                        <a href="{{docuSignUrlForCc}}" target="_blank"
                          style="background-color: #0E3346; border: none; border-radius: 5px; font-family: 'Myriad Pro', sans-serif; color: #fff; padding: 15px 32px; text-align: center; text-decoration: none; display: inline-block; font-size: 16px; cursor: pointer;">
                          Click Here to View
                        </a>
                      </td>
                    </tr>
                  </table>
                  <br />
                  <p>For any queries, feel free to reach out to <strong>{{customerName}}</strong> at <a
                      href="mailto:{{customerMail}}">{{customerMail}}</a>, or write to us at <a
                      href="mailto:onesify@sifycorp.com">onesify@sifycorp.com</a></p>
                  <br />
                  <p>Thank you for choosing Sify.</p>
                  <p class="bestRegards">Best Regards,</p>
                  <p>Team Sify</p>
                  <p><a href="https://www.sifytechnologies.com" target="_blank">Sify Website Link</a></p>
                  <br />
                </td>
              </tr>
              <tr>
                <td style="font-size: 14px; color: #0A2134;" align="center">
                  <p>This is an auto-generated email. Please do not reply.<br />
                    © {{currentYear}} Sify Technologies Limited. All Rights Reserved.</p>
                </td>
              </tr>
            </tbody>
          </table>
          <br />
        </div>
      </body>
    </html>`;



    if (parentRole === "CP + Customer") {
      subject = `Sify - Channel Partner - ILL-SO-${reqId} for E-Signature`;
      html = htmlForCp;

      subjectForCc = `Sify - Channel Partner - ILL-SO-${reqId} for E-Signature`;
      htmlForCc = htmlForCcCp;
    } else {
      subject = `Sign the Enclosed Document - Sify`;
      html = htmlTemplateCustomer;

      subjectForCc = `The Enclosed Document - Sify`;
      htmlForCc = htmlForCcCustomer;
    }

    let sendMail = null;
    let sendMailToCc = null;

    const toData = {
      name: to?.[0]?.name || "",
      firstName: req?.firstName || "",
      lastName: req?.lastName || "",
      companyName: companyName || "",
      cpcompanyName: companyRecord?.cpcompanyName || "",
      docuSignUrl: docuSignUrl || "",
      docuSignUrlForCc: docuSignUrlForCc || "",
      appPath: process.env.APP_PATH || "",
      currentYear: moment().format("YYYY"),
      customerName: customerName || "",
      customerMail: customerMail || "",
      reqId: reqId || "",
    };

    const htmlForTo = renderTemplate(html, toData);

    const sendMailPromise = withTimeout(
      common.send_mail(toArray, [], subject, htmlForTo, null),
      50000
    );

    const ccPromise =
      ccArray?.length > 0
        ? Promise.allSettled(
          ccArray.map((ccUser) => {
            const htmlForCc = renderTemplate(htmlForCc, {
              name: ccUser.name,
              firstName: req.firstName,
              lastName: req.lastName,
              companyName,
              docuSignUrlForCc,
              appPath: process.env.APP_PATH,
              currentYear,
            });

            return withTimeout(
              common.send_mail(
                [ccUser.mail],
                [],
                subjectForCc,
                htmlForCc,
                null
              ),
              50000
            );
          })
        )
        : Promise.resolve([]);

    [sendMail, sendMailToCc] = await Promise.all([
      sendMailPromise,
      ccPromise,
    ]);

    await db.collection("mailToSignLogs").insertOne({
      to,
      cc,
      reqId,
      product: "DIA",
      insertedAt: new Date(),
      response: {
        sendMail,
        sendMailToCc,
      },
    });

    console.log("sendMail", sendMail);
    console.log("sendMailToCc", sendMailToCc);

    if (sendMail) {
      logger.info(`${req.path} -- ${req.method} -- Success`);
      return res.send({ status: "Success" });
    } else {
      logger.error(`${req.path} -- ${req.method} -- Failed to send mail`);
      return res.status(500).json({
        status: "Error",
        message: "Failed to send mail",
      });
    }
  } catch (error) {
    next(error);
  }
};

exports.test_pdf = async (req, res, next) => {
  try {
    const signedPdfUrl = `https://onesifydemo.sifytechnologies.com/onesify/docusign/api/v1/view/signed-file/MPLS-SO-${100566}`;
    const pdfPath = `${appRoot}/public/signedOrders/MPLS-SO-${100566}.pdf`;

    const response = await axios.get(signedPdfUrl, { responseType: "stream" }, { httpsAgent });
    const outputStream = fs.createWriteStream(pdfPath);

    response.data.pipe(outputStream);

    await new Promise((resolve, reject) => {
      outputStream.on("finish", resolve);
      outputStream.on("error", reject);
    });

    const pdfData = fs.readFileSync(pdfPath);

    // var arrByte = new Uint8Array(Buffer.from(pdfData));
    // var pdfBlob = new Blob([arrByte], { type: "application/pdf" });

    const { reqId } = await reqID.findOneAndUpdate({ id: "file_id" }, { $inc: { reqId: 1 } });

    const bindParams = {
      FILE_ID: reqId,
      CREATE_ON: new Date().toISOString().slice(0, 23).replace("T", " "),
      FILE_CONTENT: pdfData,
      BS_ID: 1000345,
      FILE_NAME: 100007,
      FILE_EXTENSION: "pdf",
      FILE_CONTENT_TYPE: "application/pdf",
    };

    const query = `
    INSERT INTO SIFY_OSC_FILE_ATTACHMENT@link2ebst (
      FILE_ID, CREATE_ON, FILE_CONTENT, BS_ID, FILE_NAME, FILE_EXTENSION, FILE_CONTENT_TYPE
    ) VALUES (
      :FILE_ID,
      TO_TIMESTAMP(:CREATE_ON, 'YYYY-MM-DD HH24:MI:SS.FF'),
      :FILE_CONTENT,
      :BS_ID,
      :FILE_NAME,
      :FILE_EXTENSION,
      :FILE_CONTENT_TYPE
    )
  `;
    const dbConfig = {
      user: process.env.ORACAL_USERNAME,
      password: process.env.ORACAL_PASSWORD,
      connectString: process.env.ORACAL_CONNECTIONSTRING_TEST,
    };
    const oracalDb = await oracledb.getConnection(dbConfig);
    const result = await oracalDb.execute(query, bindParams, { autoCommit: true });

    logger.info(`${req.path} -- ${req.method} -- Success`);
    res.send({ status: "Success", result });
  } catch (error) {
    next(error);
  } finally {
    if (oracalDb) {
      await oracalDb.close();
    }
  }
};

exports.send_proposal_mail = async (req, res, next) => {
  try {
    const {
      reqId,
      version,
      channelPartnerName,
      channelPartnerEmail,
      to,
      cc
    } = req.body;


    if (
      !reqId ||
      !version ||
      !channelPartnerName ||
      !channelPartnerEmail ||
      !Array.isArray(to)
    ) {
      return res.status(400).json({
        error:
          'Missing required: reqId, version, channelPartnerName, channelPartnerEmail, to'
      });
    }


    const quote = await common.versionProposal(reqId, version);
    if (!quote) {
      return res
        .status(404)
        .json({ error: `No quote found for reqId=${reqId}, version=${version}` });
    }


    const toEmails = to
      .map((entry) => (entry && entry.email ? entry.email : null))
      .filter(Boolean);
    if (toEmails.length === 0) {
      return res
        .status(400)
        .json({ error: '"to" must contain at least one { email }' });
    }

    const ccEmails = Array.isArray(cc)
      ? cc.map((entry) => (entry && entry.email ? entry.email : null)).filter(Boolean)
      : [];

    const toEmailName = to.map((entry) => (entry && entry.name ? entry.name : null))
    const proposalName = quote.fileName;
    const productName = quote.product;
    const customerName = quote.companyName;
    const proposalUrl = quote.fileUrl;
    const subject = `Sify - Channel Partner - ${proposalName} Shared for Your Review`;
    const primaryEmail = toEmailName[0];

    const html = `
   <html>
   <head>
   <style>
    body {
      font-family: 'Myriad Pro', sans-serif;
      color: #333;
      line-height: 1.5;
      margin: 0; padding: 0;
      background-color: #ffffff;
    }
    .container { max-width: 600px; margin: 20px auto; padding: 20px; }
    h4 { color: rgb(60, 75, 73); margin-top: 30px; }
    ul { margin: .5em 0 1em 1.2em; }
    .btn {
      display: inline-block;
      padding: 10px 20px;
      background-color: rgb(94, 120, 115);
      color: #fff !important;
      text-decoration: none;
      border-radius: 4px;
      margin: 10px 0 20px;
      cursor: pointer;
    }
    .footer-main { margin-top: 30px; }
    .footer-separator { border: none; border-top: 2px solid #A5C639; margin: 10px 0 20px; }
    .footer-meta { display: flex; justify-content: space-between; font-size: 14px; color: #333; }
    .footer-meta .left, .footer-meta .right { width: 48%; }
    .footer-meta a { color: #333; text-decoration: none; }
    .footer-bottom { padding: 12px 0; text-align: center; font-size: 12px; color: #777; }
    </style>
    </head>
    <body>
   <div class="container">
    <p>Dear ${toEmailName},</p>
    <p>Greetings from <strong>Sify</strong>!</p>
    <p>
      ${channelPartnerName}, a trusted Channel Partner of
      Sify, has shared a pricing proposal
      for your review as part of your ongoing engagement with us.
    </p>
    <h4>Proposal Details</h4>
    <ul>
      <li><strong>Proposal Name:</strong> ${proposalName}</li>
      <li><strong>Version:</strong> ${version}</li>
      <li><strong>Request ID:</strong> ${reqId}</li>
      <li><strong>Product/Service:</strong> ${productName}</li>
    </ul>
    <p>You can view and download the proposal here:</p>
    <p><a href="${proposalUrl}" class="btn">View Proposal Document</a></p>
    <p>
      For any queries or changes, please reach out to
      <strong>${channelPartnerName}</strong> at
      <a href="mailto:${channelPartnerEmail}">${channelPartnerEmail}</a>,
      or write to Sify at
      <a href="mailto:${process.env.supportmail}">${process.env.supportmail}</a>.
    </p>
    <p>
      Once you approve the proposal, please confirm with your
      channel partner to proceed with the order.
    </p>
    <p>Thank you for choosing Sify.</p>
    <p>Best Regards,<br/>Team Sify</p>

    <!-- footer -->
    <div class="footer-main">
      <hr class="footer-separator"/>
      <div class="footer-meta">
        <div class="left">
          <strong>Sify Technologies</strong><br/>
          II Floor, TIDEL Park, No.4,<br/>
          Rajiv Gandhi Salai, Taramani,<br/>
          Chennai - 600 113
        </div>
        <div class="right">
          <a href="#">Terms & Conditions</a><br/>
          <a href="#">Privacy Policy</a><br/>
          <a href="#">Legal</a>
        </div>
      </div>
      <div class="footer-bottom">
        2025 Sify Technologies Limited. All Rights Reserved.
      </div>
    </div>
    </div>
    </body>
    </html>
    `;



    const sent = await common.send_mail(
      toEmails,
      ccEmails,
      subject,
      html,
      null,
      next
    );

    if (sent) {
      await db.collection('quoteversions').updateOne(
        { reqId },
        {
          $push: {
            'quoteVersion.$[v].sharedToMailId': { $each: to },
            'quoteVersion.$[v].sharedCcMailId': { $each: cc },
          },
          $inc: {
            'quoteVersion.$[v].sharedToCount': to.length,
            'quoteVersion.$[v].sharedCcCount': cc.length,
          }
        },
        {
          arrayFilters: [{ 'v.version': version }],
          // safe: false  // optional, depending on your driver / write concern
        }
      );
      logger.info(
        `${req.path} [POST] - mail sent to ${toEmails.join(
          ', '
        )} cc ${ccEmails.join(', ')}`
      );
      return res.json({ status: 'Success' });
    } else {
      return res.status(500).json({ status: 'Failed to send mail' });
    }
  } catch (err) {
    logger.error(`Error in ${req.path}:`, err);
    return next(err);
  }
};

exports.getSharedMails = async (req, res, next) => {
  try {
    let { reqId, version } = req.body;
    reqId = Number(reqId);

    const projection = version
      ? { projection: { 'quoteVersion.$': 1, createdDate: 1 } }
      : { projection: { quoteVersion: 1, createdDate: 1 } };

    const filter = { reqId };
    if (version) filter['quoteVersion.version'] = version;

    const doc = await db
      .collection('quoteversions')
      .findOne(filter, projection);

    if (!doc) {
      return res.status(404).json({
        status: 'Error',
        message: `No quoteversions found for reqId=${reqId}`
      });
    }

    const v = (doc.quoteVersion || [])[0] || {};

    // correctly pull from `email` (or fallback to `mail`)
    const seen = new Set();
    (v.sharedToMailId || []).forEach(e => seen.add(e.email || e.mail));
    (v.sharedCcMailId || []).forEach(e => seen.add(e.email || e.mail));
    const mails = Array.from(seen);

    const totalARC = v.quote?.totalARC ?? null;
    const totalOTC = v.quote?.totalOTC ?? null;

    const createdDate = moment(doc.createdDate)
      .format('MMM D,YYYY [at] HH.mm');

    return res.json({
      status: 'Success',
      reqId,
      version: version || 'all',
      mails,
      totalARC,
      totalOTC,
      createdDate
    });
  }
  catch (err) {
    next(err);
  }
};