import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import Groq, { toFile } from "groq-sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-20b";

const VISION_MODEL =
  process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

if (!process.env.GROQ_API_KEY) {
  console.error("Missing GROQ_API_KEY in .env");
  process.exit(1);
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com"
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:"
        ],
        connectSrc: ["'self'"],
        mediaSrc: [
          "'self'",
          "blob:"
        ]
      }
    }
  })
);

app.use(express.json({ limit: "2mb" }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please wait a moment."
  }
});

app.use("/api/", limiter);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 14 * 1024 * 1024,
    files: 1
  },
  fileFilter(req, file, cb) {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error("Unsupported image. Use JPG, PNG, WEBP or GIF.")
      );
    }

    cb(null, true);
  }
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1
  },
  fileFilter(req, file, cb) {
    const allowed = [
      "audio/webm",
      "audio/wav",
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/ogg",
      "audio/x-m4a",
      "audio/m4a"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Unsupported audio format."));
    }

    cb(null, true);
  }
});

const PERSONALITIES = {
  balanced: "You are HONG AI, a helpful, accurate and friendly AI assistant.",
  developer: "You are HONG AI, an expert programming assistant. Explain code clearly and provide practical examples.",
  teacher: "You are HONG AI, a patient teacher. Explain difficult topics step by step.",
  creative: "You are HONG AI, a creative assistant for writing, brainstorming and ideas.",
  professional: "You are HONG AI, a professional assistant. Be clear, organised and concise."
};

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    name: "HONG AI",
    status: "online",
    version: "2.0.0"
  });
});

function cleanHistory(raw) {
  let history = [];

  try {
    history = JSON.parse(raw || "[]");
  } catch {
    history = [];
  }

  if (!Array.isArray(history)) return [];

  return history
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string"
    )
    .slice(-16)
    .map(item => ({
      role: item.role,
      content: item.content.slice(0, 12000)
    }));
}

app.post("/api/chat", imageUpload.single("image"), async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();

    const history = cleanHistory(req.body.history);

    const personality =
      PERSONALITIES[req.body.personality] ||
      PERSONALITIES.balanced;

    const customInstructions = String(
      req.body.customInstructions || ""
    ).slice(0, 1500);

    if (!message && !req.file) {
      return res.status(400).json({
        error: "Write a message or attach an image."
      });
    }

    const userContent = message || "Please examine this image and describe what you see.";

    const messages = [
      {
        role: "system",
        content:
          `${personality}\n` +
          `Your name is HONG AI. You are an independent AI assistant.\n` +
          `Be accurate. If you are uncertain, say so.\n` +
          `Format code using Markdown code blocks.\n` +
          `Do not claim to generate images or perform actions you cannot perform.\n` +
          (customInstructions
            ? `Additional user preferences: ${customInstructions}`
            : "")
      },
      ...history
    ];

    let finalUserMessage;

    if (req.file) {
      const base64 = req.file.buffer.toString("base64");
      const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

      finalUserMessage = {
        role: "user",
        content: [
          {
            type: "text",
            text: userContent
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl
            }
          }
        ]
      };
    } else {
      finalUserMessage = {
        role: "user",
        content: userContent
      };
    }

    messages.push(finalUserMessage);

    const model = req.file ? VISION_MODEL : CHAT_MODEL;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.flushHeaders();

    const sendEvent = data => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const stream = await groq.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_completion_tokens: 4096,
      stream: true
    });

    for await (const chunk of stream) {
      if (res.destroyed) break;

      const token =
        chunk.choices?.[0]?.delta?.content;

      if (typeof token === "string" && token.length) {
        sendEvent({
          type: "token",
          content: token
        });
      }
    }

    sendEvent({
      type: "done"
    });

    res.end();

  } catch (error) {
    console.error("HONG AI chat error:", error);

    if (res.headersSent) {
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            message: error.status === 401
              ? "Groq API key is invalid. Check your server environment variables."
              : "HONG AI could not complete the request. Please try again."
          })}\n\n`
        );

        res.end();
      }

      return;
    }

    res.status(500).json({
      error: error.status === 401
        ? "Invalid Groq API key."
        : "AI request failed. Please try again."
    });
  }
});

app.post("/api/transcribe", audioUpload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No audio file received."
      });
    }

    const audioFile = await toFile(
      req.file.buffer,
      req.file.originalname || "recording.webm",
      {
        type: req.file.mimetype
      }
    );

    const result = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo",
      response_format: "json"
    });

    res.json({
      success: true,
      text: result.text || ""
    });

  } catch (error) {
    console.error("Transcription error:", error);

    res.status(500).json({
      error: "Voice transcription failed. Please try again."
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) return next(error);

  res.status(error instanceof multer.MulterError ? 400 : 500).json({
    error: error.message || "Something went wrong."
  });
});

app.listen(PORT, () => {
  console.log("--------------------------------");
  console.log("       HONG AI SERVER");
  console.log("--------------------------------");
  console.log(`Status: ONLINE`);
  console.log(`Port: ${PORT}`);
  console.log(`Chat model: ${CHAT_MODEL}`);
  console.log(`Vision model: ${VISION_MODEL}`);
  console.log("--------------------------------");
});
