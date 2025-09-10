import express from "express";

// const express = require('express');
import {Request, Response} from "express";
import { serve } from "inngest/express";
import { inngest } from "./inngest";
import {functions as inngestFunctions} from "./inngest/functions";
import { logger } from "./utils/logger";
import { connectDB } from "./utils/db";
import  dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoutes from "./routes/auth";
import { errorHandler } from "./middleware/errorHandler";
import chatRouter from "./routes/chat";
import moodRouter from "./routes/mood";
import activityRouter from "./routes/activity";





dotenv.config();


const app = express();

//middleware
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));


// parse json body
app.use(express.json());

// Set up inngest endpoint
app.use("/api/inngest", serve({ client: inngest, functions: inngestFunctions }));

// routes 
app.use("/auth", authRoutes);
app.use("/chat", chatRouter);
app.use("/api/mood", moodRouter);
app.use("/api/activity", activityRouter);

// error handling
app.use(errorHandler);



const startServer = async () => {
    try {
  // connect to database
   await connectDB();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(
    `Inngest endpoint is available at http://localhost:${PORT}/api/inngest`
  );
  });

  }catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};
startServer();
// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}.`);
// });