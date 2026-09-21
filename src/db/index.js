import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.SEARCH_AND_RETRIEVAL_DB_NAME,
    });
    console.log(`Connected to MongoDB. DB HOST: ${connectionInstance.connection.host}`);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
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

export { getAtsConnection, getProfilesCollection, connectDB };
