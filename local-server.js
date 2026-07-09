import express from "express";
import cors from "cors";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = process.env.API_KEY || "test-key";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const pendingJobs = [];
const activeJobs = new Map();
let isChatGptBusy = false;

function createJob(prompt) {
  return {
    id: crypto.randomUUID(),
    prompt,
    createdAt: Date.now(),
  };
}

function waitForJobResult(job, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      activeJobs.delete(job.id);
      isChatGptBusy = false;
      reject(new Error("Timed out waiting for ChatGPT response"));
    }, timeoutMs);

    activeJobs.set(job.id, {
      resolve,
      reject,
      timeout,
    });
  });
}

function requireApiKey(req, res, next) {
  const apiKey = req.header("x-api-key");
console.log("api key", apiKey)
  if (apiKey !== API_KEY) {
    return res.status(401).json({
      type: "error",
      error: {
        type: "authentication_error",
        message: "Invalid x-api-key",
      },
    });
  }

  next();
}

function requireBearerApiKey(req, res, next) {
  const authorization = req.header("authorization") || "";
  const expected = `Bearer ${API_KEY}`;

  // if (authorization !== expected) {
  //   return res.status(401).json({
  //     error: {
  //       message: "Invalid Authorization bearer token",
  //       type: "invalid_request_error",
  //       code: "invalid_api_key",
  //     },
  //   });
  // }

  next();
}

function extractTextFromAnthropicContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildPromptFromMessages(messages) {
  return messages
    .map((message) => {
      const role = message.role || "user";
      const text = extractTextFromAnthropicContent(message.content).trim();
      return `${role.toUpperCase()}:\n${text}`;
    })
    .join("\n\n");
}

function estimateTokenCount(text) {
  return Math.ceil(String(text || "").length / 4);
}

async function enqueuePromptAndWait(prompt) {
  const job = createJob(prompt);
  pendingJobs.push(job);

  const result = await waitForJobResult(job);

  return {
    job,
    response: result.response,
  };
}

// Public local API endpoint.
// Example:
// curl -X POST http://localhost:3000/api/chat \
//   -H "Content-Type: application/json" \
//   -d '{"input":"Write a short haiku about APIs."}'
app.post("/api/chat", async (req, res) => {
  const input = String(req.body?.input || "").trim();

  if (!input) {
    return res.status(400).json({
      success: false,
      error: "Missing input",
    });
  }

  try {
    const { job, response } = await enqueuePromptAndWait(input);

    return res.json({
      success: true,
      jobId: job.id,
      response,
    });
  } catch (error) {
    return res.status(504).json({
      success: false,
      error: error.message,
    });
  }
});

// Anthropic-style Messages API endpoint.
// This keeps your client curl shape, but the actual work is done through
// the Chrome extension and the already-open ChatGPT tab.
app.post("/v1/messages", requireApiKey, async (req, res) => {
  const anthropicVersion = req.header("anthropic-version");
  const { model, max_tokens: maxTokens, messages } = req.body || {};

  if (!anthropicVersion) {
    return res.status(400).json({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Missing anthropic-version header",
      },
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "messages must be a non-empty array",
      },
    });
  }

  const prompt = buildPromptFromMessages(messages).trim();

  if (!prompt) {
    return res.status(400).json({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "messages did not contain any text",
      },
    });
  }

  try {
    const { job, response } = await enqueuePromptAndWait(prompt);

    return res.json({
      id: `msg_${job.id.replaceAll("-", "")}`,
      type: "message",
      role: "assistant",
      model: model || "chatgpt-web",
      content: [
        {
          type: "text",
          text: response,
        },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: estimateTokenCount(prompt),
        output_tokens: estimateTokenCount(response),
      },
      max_tokens: maxTokens || null,
    });
  } catch (error) {
    return res.status(504).json({
      type: "error",
      error: {
        type: "timeout_error",
        message: error.message,
      },
    });
  }
});

// OpenAI-compatible Chat Completions style endpoint.
// Example:
// curl 'http://localhost:3000/v1/chat/completions' \
//   -H 'Content-Type: application/json' \
//   -H 'Authorization: Bearer test-key' \
//   -d '{"model":"custom-model","messages":[{"role":"user","content":"hello"}]}'
app.post("/v1/chat/completions", requireBearerApiKey, async (req, res) => {
  const { model, messages, temperature, max_tokens: maxTokens } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        message: "messages must be a non-empty array",
        type: "invalid_request_error",
        code: "invalid_messages",
      },
    });
  }

  const prompt = buildPromptFromMessages(messages).trim();

  if (!prompt) {
    return res.status(400).json({
      error: {
        message: "messages did not contain any text",
        type: "invalid_request_error",
        code: "empty_messages",
      },
    });
  }

  try {
    const { job, response } = await enqueuePromptAndWait(prompt);
    const created = Math.floor(Date.now() / 1000);

    return res.json({
      id: `chatcmpl-${job.id.replaceAll("-", "")}`,
      object: "chat.completion",
      created,
      model: model || "chatgpt-web",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: response,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: estimateTokenCount(prompt),
        completion_tokens: estimateTokenCount(response),
        total_tokens: estimateTokenCount(prompt) + estimateTokenCount(response),
      },
      system_fingerprint: null,
      temperature: temperature ?? null,
      max_tokens: maxTokens ?? null,
    });
  } catch (error) {
    return res.status(504).json({
      error: {
        message: error.message,
        type: "timeout_error",
        code: "chatgpt_timeout",
      },
    });
  }
});

// The Chrome extension polls this endpoint to get one job at a time.
// This queue prevents multiple prompts from being submitted to ChatGPT at once.
app.get("/extension/next-job", (req, res) => {
  if (isChatGptBusy || pendingJobs.length === 0) {
    return res.json({
      hasJob: false,
    });
  }

  const job = pendingJobs.shift();
  isChatGptBusy = true;

  return res.json({
    hasJob: true,
    job,
  });
});

// The extension posts the final ChatGPT answer here.
app.post("/extension/job-result", (req, res) => {
  const { jobId, response, error } = req.body || {};
  const waitingJob = activeJobs.get(jobId);

  isChatGptBusy = false;

  if (!waitingJob) {
    return res.status(404).json({
      success: false,
      error: "Unknown or expired job",
    });
  }

  clearTimeout(waitingJob.timeout);
  activeJobs.delete(jobId);

  if (error) {
    waitingJob.reject(new Error(error));
  } else {
    waitingJob.resolve({
      response,
    });
  }

  return res.json({
    success: true,
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    pendingJobs: pendingJobs.length,
    busy: isChatGptBusy,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Local API server running at http://${HOST}:${PORT}`);
  console.log(`Local machine URL: http://localhost:${PORT}`);
});
