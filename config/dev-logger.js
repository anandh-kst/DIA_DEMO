const {format, createLogger, transports} = require('winston')
const { printf, combine, timestamp } = format
const appRoot = require('app-root-path')



function buildDevLogger() {
  const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} ${level}: ${stack || message}`;
  });
  return createLogger({
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss'}),
      format.errors({stack: true}),
      logFormat
    ),
    transports: [
      new transports.File({ filename: `${appRoot}/logs/onesify_network_ill_api_errors.log`, level: 'error', json: true}),
      new transports.File({ filename: `${appRoot}/logs/onesify_network_ill_api_activity.log`, level: 'info', json: true})
    ]
  })
}


module.exports = buildDevLogger