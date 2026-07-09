const SERVER_BASE_URL = "http://localhost:3000";
const POLL_INTERVAL_MINUTES = 0.05;

let processing = false;

async function pollForJob() {
  if (processing) return;

  try {
    const response = await fetch(`${SERVER_BASE_URL}/extension/next-job`);
    const data = await response.json();

    if (!data.hasJob) return;

    processing = true;
    await processJob(data.job);
  } catch (error) {
    console.warn("Could not poll local server:", error);
  } finally {
    processing = false;
  }
}

async function processJob(job) {
  try {
    const tab = await findChatGptTab();

    if (!tab?.id) {
      throw new Error("No open ChatGPT tab found. Open https://chatgpt.com and log in.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    await chrome.tabs.update(tab.id, { active: true });

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "SEND_PROMPT_TO_CHATGPT",
      prompt: job.prompt,
    });

    if (!result?.success) {
      throw new Error(result?.error || "ChatGPT automation failed");
    }

    await postJobResult(job.id, {
      response: result.response,
    });
  } catch (error) {
    await postJobResult(job.id, {
      error: error.message,
    });
  }
}

async function findChatGptTab() {
  const tabs = await chrome.tabs.query({});

  return tabs.find((tab) => {
    const url = tab.url || "";
    return url.startsWith("https://chatgpt.com/") || url.startsWith("https://chat.openai.com/");
  });
}

async function postJobResult(jobId, payload) {
  await fetch(`${SERVER_BASE_URL}/extension/job-result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId,
      ...payload,
    }),
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("ChatGPT Tab Local API Bridge installed.");
  chrome.alarms.create("poll-local-server", {
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("poll-local-server", {
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll-local-server") {
    pollForJob();
  }
});

pollForJob();
