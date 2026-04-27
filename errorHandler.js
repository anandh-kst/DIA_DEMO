const logger = require("./config/winston");

exports.errorHandler = async (error, req, res, next) => {
  console.log(error);

  await new NetworkErrorLogs({
    reqId: req.body?.reqId || 0,
    message: error.message || error,
    stack: error.stack,
    filter: error.filter || null,
    response: error.response || null,
    path: req.path,
  }).save();

  logger.error(`${req.path} -- ${req.method}`, {
    statusCode: error.statusCode || 200,
    status: "Error",
    message: error.message || error,
  });

  res.status(error.statusCode || 200).send({
    status: "Error",
    message: error.message || error.toString(),
  });
};
