import mongoose from "mongoose";
import logger from "../utils/logger.js";

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.SEARCH_AND_RETRIEVAL_DB_NAME,
    });
    logger.info({ host: connectionInstance.connection.host }, "connected to MongoDB");
  } catch (error) {
    logger.fatal({ err: error }, "error connecting to MongoDB");
    process.exit(1);
  }
};

let atsConnection;

const getAtsConnection = () => {
  if (!atsConnection) {
    atsConnection = mongoose.connection.useDb(process.env.ATS_DB_NAME, { useCache: true });
  }
  return atsConnection;
};

const getProfilesCollection = () =>
  getAtsConnection().collection(process.env.PROFILES_COLLECTION);

export { getProfilesCollection, connectDB };
