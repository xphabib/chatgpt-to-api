if (!globalThis.__chatGptLocalApiBridgeLoaded) {
  globalThis.__chatGptLocalApiBridgeLoaded = true;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

function getComposer() {
  // ChatGPT DOM changes over time. Update these selectors when the page changes.
  return (
    document.querySelector("#prompt-textarea") ||
    document.querySelector('[data-testid="prompt-textarea"]') ||
    document.querySelector('textarea[placeholder*="Message"]') ||
    document.querySelector('div[contenteditable="true"]')
  );
}

function setComposerText(composer, text) {
  composer.focus();

  if (composer.tagName === "TEXTAREA") {
    composer.value = text;
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // Current ChatGPT input commonly uses a contenteditable element.
  composer.textContent = text;
  composer.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: text,
  }));
}

function getSendButton() {
  // These selectors are intentionally broad because ChatGPT markup changes.
  return (
    document.querySelector('[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send prompt"]') ||
    document.querySelector('button[aria-label="Send message"]')
  );
}

function getStopButton() {
  return (
    document.querySelector('[data-testid="stop-button"]') ||
    document.querySelector('button[aria-label*="Stop"]')
  );
}

function getAssistantMessages() {
  return Array.from(
    document.querySelectorAll('[data-message-author-role="assistant"]')
  );
}

function getLatestAssistantText() {
  const messages = getAssistantMessages();
  const latest = messages[messages.length - 1];

  if (!latest) return "";

  return latest.innerText.trim();
}

async function waitForComposer() {
  for (let i = 0; i < 80; i += 1) {
    const composer = getComposer();
    if (composer) return composer;
    await sleep(250);
  }

  throw new Error("Could not find ChatGPT message box");
}

async function waitForSendButton() {
  for (let i = 0; i < 80; i += 1) {
    const button = getSendButton();
    if (button && !button.disabled) return button;
    await sleep(250);
  }

  throw new Error("Could not find enabled ChatGPT send button");
}

async function waitUntilResponseStarts(previousAssistantCount) {
  for (let i = 0; i < 120; i += 1) {
    if (getAssistantMessages().length > previousAssistantCount) return;
    if (getLatestAssistantText()) return;
    await sleep(500);
  }

  throw new Error("ChatGPT response did not start");
}

async function waitUntilResponseFinishes() {
  let lastText = "";
  let stableTicks = 0;

  for (let i = 0; i < 360; i += 1) {
    const currentText = getLatestAssistantText();
    const stopButton = getStopButton();

    if (currentText && currentText === lastText) {
      stableTicks += 1;
    } else {
      stableTicks = 0;
      lastText = currentText;
    }

    // We require the text to be stable for a few checks and the stop button to be gone.
    // This handles streaming responses where the text changes gradually.
    if (currentText && stableTicks >= 4 && !stopButton) {
      return currentText;
    }

    await sleep(500);
  }

  throw new Error("Timed out waiting for ChatGPT to finish");
}

async function sendPromptToChatGpt(prompt) {
  const previousAssistantCount = getAssistantMessages().length;
  const composer = await waitForComposer();

  setComposerText(composer, prompt);

  const sendButton = await waitForSendButton();
  sendButton.click();

  await waitUntilResponseStarts(previousAssistantCount);
  const response = await waitUntilResponseFinishes();

  if (!response) {
    throw new Error("No assistant response found");
  }

  return response;
}

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "SEND_PROMPT_TO_CHATGPT") return false;

    sendPromptToChatGpt(message.prompt)
      .then((response) => {
        sendResponse({
          success: true,
          response,
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message,
        });
      });

    // Keep the message channel open for the async response.
    return true;
  });
}
