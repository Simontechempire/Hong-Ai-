import "dotenv/config";

import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import Groq, { toFile } from "groq-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = process.env.PORT || 3000;

const CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-20b";

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

if (!process.env.GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY is missing!");
  process.exit(1);
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);

app.use(express.json({ limit: "1mb" }));

// API request protection
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: "Too many requests. Please wait a moment."
    }
  })
);

// Image upload settings
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error("Only JPG, PNG, WEBP and GIF images are supported.")
      );
    }

    cb(null, true);
  }
});

// Audio upload settings
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "audio/webm",
      "audio/wav",
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "audio/x-m4a",
      "audio/mp3"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Unsupported audio format."));
    }

    cb(null, true);
  }
});

// AI personalities
const personalities = {
  friendly: "Be friendly, helpful and encouraging.",

  professional: "Be professional, accurate and organized.",

  concise: "Give short and direct answers.",

  tutor: "Act as a patient teacher. Explain things step by step.",

  coder: "Act as an experienced software developer. Write clean, practical code and explain it."
};

// Clean incoming text
function cleanText(value, max = 12000) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

// Build AI personality
function getSystemPrompt(personality, customInstructions) {
  const selected =
    personalities[personality] || personalities.friendly;

  const custom = cleanText(customInstructions, 1200);

  return `
You are HONG AI.

You are an intelligent AI assistant created for helpful conversations.

Your abilities include:
- Answering questions.
- Programming assistance.
- Website development.
- JavaScript and Node.js.
- Explaining difficult topics.
- Writing and editing.
- Creative brainstorming.
- Image understanding when an image is supplied.

Personality:
${selected}

Additional instructions:
${custom}

Always provide useful, clear and accurate answers.

If you do not know something, be honest.
`;
}

// Validate conversation history
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-20)
    .map((item) => {
      const role =
        item?.role === "assistant" ? "assistant" : "user";

      const content = cleanText(item?.content, 12000);

      if (!content) return null;

      return {
        role,
        content
      };
    })
    .filter(Boolean);
}

// Server health
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    name: "HONG AI",
    status: "ONLINE",
    chatModel: CHAT_MODEL,
    visionModel: VISION_MODEL
  });
});

// Main AI chat
app.post(
  "/api/chat",
  imageUpload.single("image"),
  async (req, res) => {
    try {
      const message = cleanText(req.body.message, 8000);

      const personality =
        cleanText(req.body.personality, 40) || "friendly";

      const customInstructions = cleanText(
        req.body.customInstructions,
        1200
      );

      const history = normalizeHistory(
        JSON.parse(req.body.history || "[]")
      );

      if (!message && !req.file) {
        return res.status(400).json({
          error: "Please enter a message or upload an image."
        });
      }

      let userContent;

      if (req.file) {
        userContent = [
          {
            type: "text",
            text: message || "Describe and explain this image."
          },
          {
            type: "image_url",
            image_url: {
              url:
                `data:${req.file.mimetype};base64,` +
                req.file.buffer.toString("base64")
            }
          }
        ];
      } else {
        userContent = message;
      }

      const messages = [
        {
          role: "system",
          content: getSystemPrompt(
            personality,
            customInstructions
          )
        },

        ...history,

        {
          role: "user",
          content: userContent
        }
      ];

      const completion =
        await groq.chat.completions.create({
          model: req.file ? VISION_MODEL : CHAT_MODEL,

          messages,

          temperature: 0.7,

          max_completion_tokens: 2048
        });

      const answer =
        completion.choices?.[0]?.message?.content;

      if (!answer) {
        throw new Error("The AI returned an empty response.");
      }

      res.json({
        success: true,
        answer,
        model: req.file ? VISION_MODEL : CHAT_MODEL
      });

    } catch (error) {
      console.error("HONG AI ERROR:", error.message);

      if (error.status === 401) {
        return res.status(401).json({
          error: "Invalid Groq API key. Check your .env file."
        });
      }

      res.status(500).json({
        error:
          "HONG AI could not process your request. Check your Groq model and account."
      });
    }
  }
);

// Voice-to-text
app.post(
  "/api/transcribe",
  audioUpload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No audio recording received."
        });
      }

      const audioFile = await toFile(
        req.file.buffer,
        req.file.originalname || "recording.webm",
        {
          type: req.file.mimetype || "audio/webm"
        }
      );

      const result =
        await groq.audio.transcriptions.create({
          file: audioFile,
          model: "whisper-large-v3-turbo",
          response_format: "json"
        });

      res.json({
        success: true,
        text: result.text || ""
      });

    } catch (error) {
      console.error("VOICE ERROR:", error.message);

      res.status(500).json({
        error: "Voice transcription failed."
      });
    }
  }
);

// Frontend
app.use(express.static(path.join(__dirname, "public")));

// Error handler
app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error.message);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: "Upload failed. Check your file size."
    });
  }

  res.status(400).json({
    error: error.message || "Something went wrong."
  });
});

// Start server
app.listen(PORT, () => {
  console.log("--------------------------------");
  console.log("       HONG AI STARTED");
  console.log("--------------------------------");
  console.log(`Website: http://localhost:${PORT}`);
  console.log("Status: ONLINE");
  console.log("AI: GROQ CONNECTED");
  console.log("--------------------------------");
});
