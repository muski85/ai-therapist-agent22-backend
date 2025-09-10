import mongoose from "mongoose";
import {logger} from "./logger";

const MONGODB_URI = 
process.env.MONGODB_URI || 
"mongodb+srv://ahmedmubarak097:DpJGpQlSQtB4GYmj@ai-therapist-agent.3whcxov.mongodb.net/?retryWrites=true&w=majority&appName=ai-therapist-agent"

// Migration function to add topic field to existing sessions
const runTopicFieldMigration = async () => {
  try {
    // Import ChatSession model here to avoid circular imports
    const { ChatSession } = await import('../models/ChatSession');
    
    // Check if migration is needed
    const sessionWithoutTopic = await ChatSession.findOne({ topic: { $exists: false } });
    
    if (sessionWithoutTopic) {
      logger.info("Running topic field migration for existing chat sessions...");
      
      const result = await ChatSession.updateMany(
        { topic: { $exists: false } },
        { $set: { topic: null } }
      );
      
      logger.info(`Topic field migration completed: ${result.modifiedCount} documents updated`);
    } else {
      logger.info("Topic field migration not needed - all sessions already have topic field");
    }
  } catch (error) {
    logger.error("Topic field migration failed:", error);
    // Don't exit the process - let the app continue running
  }
};

export const connectDB = async () => {
  try{
    await mongoose.connect(MONGODB_URI);
    logger.info("Connected to MongoDB Atlas");
    
    // Run migration after successful connection
    await runTopicFieldMigration();
    
  }catch (error){
    logger.error("MongoDB connection error:", error);
    process.exit(1);
  }
};