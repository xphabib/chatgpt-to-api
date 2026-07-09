# ChatGPT Tab Local API Bridge

This is a local prototype that exposes an Express API and uses a Chrome extension to send prompts to an already-open, logged-in ChatGPT tab.

It does not use the OpenAI API.

## Folder Structure

```text
chatgpt-to-api/
  local-server.js
  package.json
  extension/
    manifest.json
    background.js
    content.js
```

## Run The Local Server

```bash
npm install
npm start
```

The server runs at:

```text
http://localhost:3000
```

It also binds to `0.0.0.0`, so another device on your LAN can call it with your computer's IP, for example:

```text
http://192.168.68.130:3000
```

## Load The Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `extension/` folder.
5. Open `https://chatgpt.com` in a tab and log in.

## Test

OpenAI-compatible chat completions endpoint:

```bash
curl 'http://192.168.68.130:3000/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test-key' \
  -d '{
    "model": "custom-model",
    "messages": [
      {
        "role": "user",
        "content": "hello"
      }
    ]
  }'
```

Anthropic-style endpoint:

```bash
curl --location 'http://localhost:3000/v1/messages' \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: test-key' \
  --header 'anthropic-version: 2023-06-01' \
  --data '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "give me about something of bangladesh."
      }
    ]
  }'
```

LAN example:

```bash
curl --location 'http://192.168.68.130:3000/v1/messages' \
  --header 'Content-Type: application/json' \
  --header 'x-api-key: test-key' \
  --header 'anthropic-version: 2023-06-01' \
  --data '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "give me about something of bangladesh."
      }
    ]
  }'
```

Simple endpoint:

```bash
curl --location 'http://192.168.68.130:3000/api/chat' \
  --header 'Content-Type: application/json' \
  --data '{
    "input": "give me about something of bangladesh."
  }'
```

Localhost version:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"input":"Write a short explanation of what an API is."}'
```

The API request waits until the extension submits the prompt to ChatGPT and posts the response back.

## Important Limits

This is fragile because it automates ChatGPT's web UI. DOM selectors may change and need updates in `extension/content.js`.

Common failure cases:

- ChatGPT tab is not open.
- User is logged out.
- Captcha or account verification appears.
- ChatGPT rate limits the account.
- Network is slow.
- The response streams longer than the timeout.
- The page layout or button selectors change.
- Multiple API requests arrive at once.

The server includes a simple queue so only one prompt is sent to ChatGPT at a time.
