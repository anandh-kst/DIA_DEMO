const initializeModels = (req, res, next) => {
    db = req.db
    loginDB = req.loginDB
    Quote = req.Quote
    Exceltemp = req.Exceltemp
    FeasibilityIds = req.FeasibilityIds
    Gstdetails = req.Gstdetails
    reqID = req.reqID
    NetworkErrorLogs = req.NetworkErrorLogs
    
    next();
};

module.exports = initializeModels;