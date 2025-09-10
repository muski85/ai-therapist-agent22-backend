// backend/src/routes/chat.ts
import express from "express";
import {
  sendMessage,
  getChatSession,
  getChatHistory,
  createChatSession,
  getAllChatSessions,
  generateTopic,      // NEW
  updateSessionTopic, // NEW
  deleteChatSession,
} from "@/controllers/chat";
import { auth } from "@/middleware/auth";

const router = express.Router();

// Apply auth middleware to all routes
router.use(auth);

// Create a new chat session
router.post("/sessions", createChatSession);

// Get a specific chat session
router.get("/sessions/:sessionId", getChatSession);

// Send a message in a chat session
router.post("/sessions/:sessionId/messages", sendMessage);

// Get chat history for a session
router.get("/sessions/:sessionId/history", getChatHistory);

// Get all chat sessions
router.get("/sessions", getAllChatSessions);

// NEW: Generate topic from messages
router.post("/generate-topic", generateTopic);

// NEW: Update session topic
router.patch("/sessions/:sessionId/topic", updateSessionTopic);

// delete a chat session
router.delete ("/sessions/:sessionId", deleteChatSession);

export default router;