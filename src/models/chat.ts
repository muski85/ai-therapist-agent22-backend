// backend/src/models/chat.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export interface IChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: {
    technique?: string;
    goal?: string;
    progress?: any;
    analysis?: any; // From your controller
  };
}

export interface IChatSession extends Document {
  sessionId: string;
  userId: Types.ObjectId; // From your controller
  messages: IChatMessage[];
  topic?: string; // NEW: AI-generated topic field
  startTime: Date; // From your controller
  status: string; // From your controller
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  role: {
    type: String,
    enum: ["user", "assistant"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  metadata: {
  technique: String,
  goal: String,
  progress: Schema.Types.Mixed, // Remove the array brackets
  analysis: Schema.Types.Mixed,
},
});

const chatSessionSchema = new Schema<IChatSession>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    messages: [chatMessageSchema],
    topic: {
      type: String,
      required: false,
      maxlength: 100, // Limit topic length
    }, // NEW: Topic field
    startTime: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "completed", "paused"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

// FIX: Check if model already exists before creating it
export const ChatSession = mongoose.models.ChatSession || mongoose.model<IChatSession>(
  "ChatSession",
  chatSessionSchema
);