const mongoose = require("mongoose");
const logger = require("./config/winston");
require("dotenv").config();

let db, loginDB;
let isConnected = false;
const connectDatabase = async () => {
  try {
    if (isConnected) {
      return { db, loginDB };
    }

    const uri = `${process.env.MONGODB_CLUSTER}/${process.env.MONGODB_DBNAME}`;
    // const uri = `mongodb://223.30.223.132:27017,223.30.223.133:27017,100.67.90.68:27017/network`;

    const connection = await mongoose.connect(uri, {
      auth: {
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
      },
      authSource: "admin",
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 30000, // 30 seconds
      //maxPoolSize: 1,
    });

    db = connection.connection;

    console.log("Database connected successfully");
    logger.info("Database connected successfully");

    loginDB = db.useDb(process.env.MONGODB_DBNAME_LOGIN);

    console.log("Login database connected successfully");
    logger.info("Login database connected successfully");

    isConnected = true;
    return { db, loginDB };
  } catch (error) {
    console.log("Error while connecting to databases:", error);
    throw new Error("Failed to connect to databases");
  }
};

const closeConnection = async (db, loginDB) => {
  try {
    // Close connections after request is completed
    console.log(db.readyState, loginDB.readyState);
    if (db.readyState === 1) {
      await db.client.close();
      console.log("Network MPLS Database connection closed successfully");
    }
    if (loginDB.readyState === 1) {
      await loginDB.client.close();
      console.log("Login Database connection closed successfully");
    }
  } catch (error) {
    console.log("Error closing database connections:", error);
  }
};

module.exports = { connectDatabase, closeConnection };
