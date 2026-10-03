# AI Pinpoint — Privacy statement

**AI Pinpoint does not collect user data.**

- **No data leaves your device.** Pins, labels, the short text snippets shown on pin cards, and your settings are stored only in your browser's local extension storage (`chrome.storage.local`). They are not synced, uploaded, or shared.
- **No network requests.** The extension contains no code that can make network requests: no analytics, telemetry, crash reporting, remote fonts, or update checks. Every build is checked automatically for network-capable code and fails if any is found.
- **No account.** There is nothing to sign up for and no identifier is created for you.
- **What the extension reads.** On the supported sites only (`gemini.google.com`, `chatgpt.com`, `chat.openai.com`, `claude.ai`), it reads the conversation page you have open, so it can place pin buttons and find pinned messages again. Message text is processed locally. Only a short snippet of each message you pin is stored, so the pin card can show it.
- **Permissions.**
  - `storage` keeps your pins on the device.
  - `contextMenus` adds "Pin this message" to the right-click menu.
  - Access to the four sites above is what lets the extension run on those pages. It does not run anywhere else.
- **Export and deletion.** You can export all your data as a JSON file, delete individual threads, or wipe everything from the options page. Uninstalling the extension removes its storage.
- **Third parties.** None. No data is sold, transferred, or used for any purpose other than the pinning feature itself.

Questions: open an issue in the project repository.
