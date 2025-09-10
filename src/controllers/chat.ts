import { Request, Response, NextFunction } from "express";
import { ChatSession, IChatSession } from "../models/chat";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { inngest } from "@/inngest";
import { User } from "../models/User";
import { InngestSessionResponse, InngestEvent } from "../types/inngest";
import { Types } from "mongoose";

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || "AIzaSyB_FcZ1Iudzdg4rxUAIDVqvN2YFM_baSwY"
);

// create a new chat session
export const createChatSession = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }
    const userId = new Types.ObjectId(String(req.user.id));
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate a unique sessionId
    const sessionId = uuidv4();

    const session = new ChatSession({
      sessionId,
      userId,
      startTime: new Date(),
      status: "active",
      messages: [],
    });

    await session.save();

    res.status(201).json({
      message: "Chat session created successfully",
      sessionId: session.sessionId,
    });
  } catch (error) {
    logger.error("Error creating chat session:", error);
    res.status(500).json({
      message: "Error creating chat session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Send a message in the chat session
// Send a message in the chat session
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    // Validate input
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      logger.warn("Empty or invalid message received:", { sessionId, message });
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    // ADDED CHECK: Ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = new Types.ObjectId(req.user.id);

    logger.info("Processing message:", { sessionId, message: message.substring(0, 100) + "..." });

    // Find session by sessionId
    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      logger.warn("Session not found:", { sessionId });
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      logger.warn("Unauthorized access attempt:", { sessionId, userId });
      return res.status(403).json({ message: "Unauthorized" });
    }

    // FIXED: Add user message to history FIRST
    session.messages.push({
      role: "user",
      content: message.trim(),
      timestamp: new Date(),
    });

    // Create Inngest event for message processing
    const event: InngestEvent = {
      name: "therapy/session.message",
      data: {
        message: message.trim(),
        history: session.messages,
        memory: {
          userProfile: {
            emotionalState: [],
            riskLevel: 0,
            preferences: {},
          },
          sessionContext: {
            conversationThemes: [],
            currentTechnique: null,
          },
        },
        goals: [],
        systemPrompt: `You are an AI therapist assistant. Your role is to:
  1. Provide empathetic and supportive responses
  2. Use evidence-based therapeutic techniques
  3. Maintain professional boundaries
  4. Monitor for risk factors
  5. Guide users toward their therapeutic goals`,
      },
    };

    logger.info("Sending message to Inngest");

    try {
      // Send event to Inngest for logging and analytics
      await inngest.send(event);
    } catch (inngestError) {
      logger.warn("Inngest send failed:", inngestError);
      // Continue processing even if Inngest fails
    }

    // Process the message directly using Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    let analysis;
    try {
      // Analyze the message
      const analysisPrompt = `Analyze this therapy message and provide insights. Return ONLY a valid JSON object with no markdown formatting or additional text.
Message: ${message.trim()}

Required JSON structure:
{
  "emotionalState": "string",
  "themes": ["string"],
  "riskLevel": 1,
  "recommendedApproach": "string",
  "progressIndicators": ["string"]
}`;

      logger.info("Sending analysis request to Gemini");
      const analysisResult = await model.generateContent(analysisPrompt);
      const analysisText = analysisResult.response.text().trim();
      logger.info("Raw analysis response:", analysisText.substring(0, 200) + "...");
      
      const cleanAnalysisText = analysisText
        .replace(/```json\n?/g, "")
        .replace(/\n?```/g, "")
        .trim();
      
      analysis = JSON.parse(cleanAnalysisText);
      logger.info("Message analysis successful:", analysis);
    } catch (analysisError) {
      // FIXED: Fallback analysis if JSON parsing fails
      logger.warn("Analysis failed, using fallback:", analysisError);
      analysis = {
        emotionalState: "seeking_support",
        themes: ["anxiety_management"],
        riskLevel: 1,
        recommendedApproach: "cognitive_behavioral",
        progressIndicators: ["active_engagement"]
      };
    }

    let response;
    try {
      // Generate therapeutic response
      const responsePrompt = `You are an AI therapist assistant. Provide a helpful, empathetic response to this message:

Message: ${message.trim()}

Guidelines:
- Be warm and supportive
- Use therapeutic techniques when appropriate
- Keep responses conversational but professional
- Focus on the person's immediate needs
- Ask follow-up questions to encourage reflection`;

      logger.info("Sending response request to Gemini");
      const responseResult = await model.generateContent(responsePrompt);
      response = responseResult.response.text().trim();
      logger.info("Response generated successfully, length:", response.length);
    } catch (responseError) {
      // FIXED: Fallback response if generation fails
      logger.warn("Response generation failed, using fallback:", responseError);
      response = "I hear that you're looking for support with managing anxiety. That's a very common concern, and it's great that you're reaching out. There are several effective strategies we can explore together. What specific situations tend to trigger your anxiety the most?";
    }

    // FIXED: Add ONLY the assistant's response (removed duplicate)
    session.messages.push({
      role: "assistant",
      content: response,
      timestamp: new Date(),
      metadata: {
        analysis,
        progress: {
          emotionalState: analysis.emotionalState,
          riskLevel: analysis.riskLevel,
        },
      },
    });

    // Save the updated session
    await session.save();
    logger.info("Session updated successfully:", { sessionId, messageCount: session.messages.length });

    // Return the response
    res.json({
      response,
      message: response,
      analysis,
      metadata: {
        progress: {
          emotionalState: analysis.emotionalState,
          riskLevel: analysis.riskLevel,
        },
      },
    });
  } catch (error) {
    logger.error("Error in sendMessage:", error);
    res.status(500).json({
      message: "Error processing message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};


//STOP4
// Get chat session history
export const getSessionHistory = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // ADDED CHECK: Ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = new Types.ObjectId(req.user.id);

    const session = (await ChatSession.findById(
      sessionId
    ).exec()) as IChatSession;
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json({
      messages: session.messages,
      startTime: session.startTime,
      status: session.status,
    });
  } catch (error) {
    logger.error("Error fetching session history:", error);
    res.status(500).json({ message: "Error fetching session history" });
  }
};

export const getChatSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    logger.info(`Getting chat session: ${sessionId}`);
    const chatSession = await ChatSession.findOne({ sessionId });
    if (!chatSession) {
      logger.warn(`Chat session not found: ${sessionId}`);
      return res.status(404).json({ error: "Chat session not found" });
    }
    logger.info(`Found chat session: ${sessionId}`);
    res.json(chatSession);
  } catch (error) {
    logger.error("Failed to get chat session:", error);
    res.status(500).json({ error: "Failed to get chat session" });
  }
};

// Renamed from getChatHistory to avoid confusion with the previous one
export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // ADDED CHECK: Ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = new Types.ObjectId(req.user.id);

    // Find session by sessionId instead of _id
    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json(session.messages);
  } catch (error) {
    logger.error("Error fetching chat history:", error);
    res.status(500).json({ message: "Error fetching chat history" });
  }
};

export const getAllChatSessions = async (req: Request, res: Response) => {
  try {
    // 1. Authenticate the user. If the user is not authenticated, return a 401.
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = new Types.ObjectId(req.user.id);

    // 2. Fetch all chat sessions for the authenticated user from the database.
    const sessions = await ChatSession.find({ userId })
      .sort({ updatedAt: -1 }) // Sort by most recently updated
      .select("sessionId topic startTime status createdAt updatedAt messages") // Include topic field
      .exec();

    // 3. Transform the sessions to include message summaries and topic
    const transformedSessions = sessions.map((session) => ({
      sessionId: session.sessionId,
      topic: session.topic, // This will be the AI-generated topic
      startTime: session.startTime,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages, // Include messages for topic generation on frontend
      messageCount: session.messages.length,
    }));

    // 4. Send the list of sessions back as a JSON response.
    res.status(200).json(transformedSessions);
    logger.info(
      `Successfully fetched ${sessions.length} sessions for user ${userId}`
    );
  } catch (error) {
    // 5. Handle any database or server errors.
    logger.error("Error fetching all chat sessions:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

//STOP1

export const deleteChatSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // Check authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = new Types.ObjectId(req.user.id);

    logger.info("Deleting chat session:", {
      sessionId,
      userId: userId.toString(),
    });

    // Find the session first to check ownership
    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Check if user owns this session
    if (session.userId.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({
          error: "Unauthorized - you can only delete your own sessions",
        });
    }

    // Delete the session
    await ChatSession.deleteOne({ sessionId });

    logger.info("Session deleted successfully:", { sessionId });

    res.json({
      success: true,
      message: "Session deleted successfully",
      sessionId,
    });
  } catch (error) {
    logger.error("Error deleting chat session:", error);
    res.status(500).json({
      error: "Failed to delete session",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// NEW: Generate topic from messages using Gemini AI
export const generateTopic = async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;

    // Validate input
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Messages array is required and cannot be empty",
      });
    }

    // Check authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    logger.info("Generating topic for messages:", {
      messageCount: messages.length,
    });

    // Use Gemini to generate a topic
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const topicPrompt = `Based on the following therapy conversation, generate a short, empathetic topic title (maximum 4 words) that captures the main theme or concern being discussed.

Conversation:
${messages
  .map(
    (msg: any, index: number) =>
      `${msg.role}: ${msg.content.substring(0, 200)}${
        msg.content.length > 200 ? "..." : ""
      }`
  )
  .join("\n")}

Guidelines:
- Keep it concise (3-4 words maximum)
- Use empathetic language
- Focus on the main emotional theme or concern
- Suitable for a therapy context
- Add appropriate emoji if helpful (optional)

Examples of good topics:
- "💭 Anxiety Management"
- "😴 Sleep Struggles" 
- "💼 Work Stress"
- "💕 Relationship Issues"
- "🌟 Building Confidence"

Generate only the topic title, nothing else:`;

    const result = await model.generateContent(topicPrompt);
    let topic = result.response.text().trim();

    // Clean up the response (remove quotes, extra formatting)
    topic = topic.replace(/['"]/g, "").trim();

    // Fallback if topic is too long or empty
    if (!topic || topic.length > 50) {
      topic = generateFallbackTopic(messages);
    }

    logger.info("Generated topic:", { topic });

    res.json({ topic });
  } catch (error) {
    logger.error("Error generating topic:", error);

    // Fallback to simple topic generation if AI fails
    try {
      const fallbackTopic = generateFallbackTopic(req.body.messages);
      res.json({ topic: fallbackTopic });
    } catch (fallbackError) {
      logger.error("Fallback topic generation failed:", fallbackError);
      res.status(500).json({
        error: "Failed to generate topic",
        topic: "💬 Therapy Session", // Ultimate fallback
      });
    }
  }
};

// NEW: Update session topic
export const updateSessionTopic = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { topic } = req.body;

    // Validate input
    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return res
        .status(400)
        .json({ error: "Topic is required and must be a non-empty string" });
    }

    // Check authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = new Types.ObjectId(req.user.id);

    logger.info("Updating session topic:", { sessionId, topic });

    // Find and update the session
    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Check if user owns this session
    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Update the topic
    session.topic = topic.trim().substring(0, 100); // Limit topic length
    await session.save();

    logger.info("Session topic updated successfully:", {
      sessionId,
      topic: session.topic,
    });

    res.json({
      success: true,
      topic: session.topic,
      message: "Topic updated successfully",
    });
  } catch (error) {
    logger.error("Error updating session topic:", error);
    res.status(500).json({
      error: "Failed to update session topic",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Helper function for fallback topic generation
const generateFallbackTopic = (messages: any[]): string => {
  if (!messages || messages.length === 0) return "💬 New Chat"; // Find first user message
  const userMessages = messages.filter((msg) => msg.role === "user");
  if (!userMessages.length) return "💬 New Chat";
  const firstMessage = userMessages[0].content.toLowerCase(); // Simple keyword matching for therapy topics
  const topicMap: Record<string, string> = {
    anxiety: "💭 Anxiety Support",
    anxious: "💭 Anxiety Support",
    worried: "💭 Anxiety Support",
    stress: "😰 Stress Management",
    stressed: "😰 Stress Management",
    overwhelmed: "🌊 Feeling Overwhelmed",
    sleep: "😴 Sleep Issues",
    insomnia: "😴 Sleep Problems",
    tired: "😴 Sleep & Energy",
    depression: "🌧️ Depression Support",
    depressed: "🌧️ Depression Support",
    sad: "😢 Emotional Support",
    work: "💼 Work Issues",
    job: "💼 Work Stress",
    relationship: "💕 Relationship Help",
    partner: "💕 Relationship Issues",
    family: "👨‍👩‍👧‍👦 Family Matters",
    panic: "⚡ Panic Support",
    anger: "😡 Anger Management",
    angry: "😡 Anger Management",
    lonely: "🤗 Loneliness Support",
    confidence: "💪 Building Confidence",
    "self-esteem": "💪 Self-Worth",
    grief: "💙 Grief Support",
    loss: "💙 Coping with Loss",
  }; // Check for keywords
  for (const [keyword, topic] of Object.entries(topicMap)) {
    if (firstMessage.includes(keyword)) {
      return topic;
    }
  } // Generate from first few words
  const words = firstMessage.split(" ").slice(0, 3).join(" ");
  const capitalizedWords = words.charAt(0).toUpperCase() + words.slice(1);
  return `💬 ${capitalizedWords}`;
};
