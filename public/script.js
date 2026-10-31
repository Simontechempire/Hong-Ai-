const $ = id => document.getElementById(id);

const STORAGE_KEY = "hong_ai_conversations_v2";
const SETTINGS_KEY = "hong_ai_settings_v2";

const state = {
  chats: [],
  activeChat: null,
  image: null,
  imageUrl: null,
  busy: false,
  recorder: null,
  audioChunks: [],
  recording: false
};

const welcome = $("welcome");
const messagesElement = $("messages");
const chatScroll = $("chatScroll");
const messageInput = $("messageInput");
const sendButton = $("sendButton");
const imageInput = $("imageInput");
const attachmentPreview = $("attachmentPreview");
const typingIndicator = $("typingIndicator");

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function saveChats() {
  try {
    const safeChats = state.chats.map(chat => ({
      ...chat,
      messages: chat.messages.map(message => ({
        role: message.role,
        content: message.content,
        imageName: message.imageName || null
      }))
    }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeChats));
  } catch (error) {
    console.error("History storage error:", error);
  }
}

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    state.chats = Array.isArray(saved)
      ? saved.filter(chat => chat && Array.isArray(chat.messages))
      : [];

  } catch {
    state.chats = [];
  }

  updateHistory();
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings() {
  const settings = {
    personality: $("personality").value,
    customInstructions: $("customInstructions").value.trim()
  };

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  closeSettings();

  showToast("Settings saved");
}

function loadSettings() {
  const settings = getSettings();

  $("personality").value = settings.personality || "balanced";

  $("customInstructions").value =
    settings.customInstructions || "";
}

/* CHAT MANAGEMENT */

function createChat() {
  const chat = {
    id: makeId(),
    title: "New conversation",
    messages: [],
    createdAt: Date.now()
  };

  state.chats.unshift(chat);
  state.activeChat = chat.id;

  saveChats();
  updateHistory();
  renderMessages();

  return chat;
}

function getActiveChat() {
  return state.chats.find(
    chat => chat.id === state.activeChat
  );
}

function selectChat(id) {
  state.activeChat = id;

  clearAttachment();
  renderMessages();
  updateHistory();

  closeSidebar();
}

function deleteChat(id) {
  state.chats = state.chats.filter(chat => chat.id !== id);

  if (state.activeChat === id) {
    state.activeChat = null;
  }

  saveChats();
  updateHistory();

  if (!state.activeChat) {
    if (state.chats.length) {
      selectChat(state.chats[0].id);
    } else {
      createChat();
    }
  } else {
    renderMessages();
  }
}

function updateHistory() {
  const list = $("historyList");

  list.innerHTML = "";

  $("historyCount").textContent = state.chats.length;

  if (!state.chats.length) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    empty.textContent = "Your conversations will appear here.";
    list.appendChild(empty);
    return;
  }

  state.chats.forEach(chat => {
    const item = document.createElement("div");

    item.className =
      "history-item" +
      (chat.id === state.activeChat ? " active" : "");

    const icon = document.createElement("span");
    icon.textContent = "◷";

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = chat.title || "New conversation";

    const remove = document.createElement("button");
    remove.className = "delete-chat";
    remove.textContent = "×";
    remove.title = "Delete conversation";

    remove.addEventListener("click", event => {
      event.stopPropagation();

      if (confirm("Delete this conversation?")) {
        deleteChat(chat.id);
      }
    });

    item.append(icon, title, remove);

    item.addEventListener("click", () => {
      selectChat(chat.id);
    });

    list.appendChild(item);
  });
}

/* MESSAGE DISPLAY */

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function formatMarkdown(text) {
  let safe = escapeHTML(text);

  const codeBlocks = [];

  safe = safe.replace(
    /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g,
    (match, language, code) => {
      const index = codeBlocks.length;

      codeBlocks.push({
        language: language || "code",
        code: code.replace(/\n$/, "")
      });

      return `%%CODE_BLOCK_${index}%%`;
    }
  );

  safe = safe.replace(
    /`([^`\n]+)`/g,
    "<code>$1</code>"
  );

  safe = safe.replace(
    /\*\*(.*?)\*\*/g,
    "<strong>$1</strong>"
  );

  safe = safe.replace(
    /^### (.+)$/gm,
    "<h3>$1</h3>"
  );

  safe = safe.replace(
    /^## (.+)$/gm,
    "<h2>$1</h2>"
  );

  safe = safe.replace(
    /^# (.+)$/gm,
    "<h1>$1</h1>"
  );

  safe = safe.replace(
    /^\s*[-*] (.+)$/gm,
    "• $1"
  );

  safe = safe.replace(
    /\n/g,
    "<br>"
  );

  codeBlocks.forEach((block, index) => {
    const html = `
      <div class="code-block">
        <div class="code-header">
          <span>${escapeHTML(block.language)}</span>
          <button class="copy-code" type="button">Copy code</button>
        </div>
        <pre><code>${escapeHTML(block.code)}</code></pre>
      </div>
    `;

    safe = safe.replace(`%%CODE_BLOCK_${index}%%`, html);
  });

  return safe;
}

function createMessageElement(message, index, chatId) {
  const row = document.createElement("article");

  row.className = `message ${message.role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "assistant" ? "H" : "U";

  const body = document.createElement("div");
  body.className = "message-body";

  if (message.imageUrl) {
    const image = document.createElement("img");

    image.className = "message-image";
    image.src = message.imageUrl;
    image.alt = message.imageName || "Uploaded image";

    body.appendChild(image);
  } else if (message.imageName && !message.imageUrl) {
    const note = document.createElement("p");
    note.className = "message-text";
    note.textContent = `Image attached: ${message.imageName}`;
    body.appendChild(note);
  }

  const content = document.createElement("div");
  content.className = "message-text";

  content.innerHTML = formatMarkdown(message.content || "");

  body.appendChild(content);

  const actions = document.createElement("div");
  actions.className = "message-actions";

  if (message.role === "assistant") {
    const copy = document.createElement("button");

    copy.className = "message-action";
    copy.textContent = "Copy";

    copy.addEventListener("click", () => {
      copyText(message.content || "");
      copy.textContent = "Copied";

      setTimeout(() => {
        copy.textContent = "Copy";
      }, 1200);
    });

    const speak = document.createElement("button");

    speak.className = "message-action";
    speak.textContent = "Listen";

    speak.addEventListener("click", () => {
      speakText(message.content || "");
    });

    actions.append(copy, speak);
  }

  if (message.role === "user" && message.imageUrl) {
    const download = document.createElement("button");

    download.className = "message-action";
    download.textContent = "Download image";

    download.addEventListener("click", () => {
      downloadImage(
        message.imageUrl,
        message.imageName || "hong-ai-image"
      );
    });

    actions.appendChild(download);
  }

  if (actions.children.length) {
    body.appendChild(actions);
  }

  row.append(avatar, body);

  return row;
}

function renderMessages() {
  messagesElement.innerHTML = "";

  const chat = getActiveChat();

  const hasMessages = chat && chat.messages.length > 0;

  welcome.classList.toggle("hidden", Boolean(hasMessages));

  if (!chat) return;

  chat.messages.forEach((message, index) => {
    messagesElement.appendChild(
      createMessageElement(message, index, chat.id)
    );
  });

  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  });
}

/* COPY AND DOWNLOAD */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  } catch {
    const area = document.createElement("textarea");

    area.value = text;
    document.body.appendChild(area);
    area.select();

    document.execCommand("copy");
    area.remove();

    showToast("Copied");
  }
}

function downloadImage(url, filename) {
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* IMAGE ATTACHMENT */

function showAttachment(file) {
  if (!file) return;

  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ];

  if (!allowed.includes(file.type)) {
    showToast("Use JPG, PNG, WEBP or GIF images.");
    return;
  }

  if (file.size > 14 * 1024 * 1024) {
    showToast("Image must be smaller than 14 MB.");
    return;
  }

  clearAttachment();

  state.image = file;
  state.imageUrl = URL.createObjectURL(file);

  $("attachmentName").textContent = file.name;

  $("attachmentSize").textContent =
    `${(file.size / 1024 / 1024).toFixed(2)} MB • Ready`;

  const thumb = $("attachmentThumb");
  thumb.innerHTML = "";

  const img = document.createElement("img");
  img.src = state.imageUrl;
  img.alt = "Image preview";

  thumb.appendChild(img);

  attachmentPreview.classList.remove("hidden");
}

function clearAttachment() {
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
  }

  state.image = null;
  state.imageUrl = null;

  imageInput.value = "";
  attachmentPreview.classList.add("hidden");
  $("attachmentThumb").textContent = "▧";
}

/* AI CHAT */

function setBusy(value) {
  state.busy = value;
  sendButton.disabled = value;
  messageInput.disabled = value;

  typingIndicator.classList.add("hidden");

  sendButton.textContent = value ? "…" : "↑";
}

function getSettingsForRequest() {
  const settings = getSettings();

  return {
    personality: settings.personality || "balanced",
    customInstructions: settings.customInstructions || ""
  };
}

async function sendMessage() {
  if (state.busy) return;

  const text = messageInput.value.trim();
  const image = state.image;
  const imageUrl = state.imageUrl;

  if (!text && !image) return;

  let chat = getActiveChat();

  if (!chat) {
    chat = createChat();
  }

  const userMessage = {
    role: "user",
    content: text,
    imageName: image ? image.name : null,
    imageUrl: imageUrl || null
  };

  chat.messages.push(userMessage);

  if (chat.messages.length === 1) {
    chat.title = text
      ? text.slice(0, 38)
      : `Image: ${image.name.slice(0, 25)}`;
  }

  const imageToSend = image;

  clearAttachment();

  messageInput.value = "";
  autoResize();

  saveChats();
  updateHistory();
  renderMessages();

  const assistantMessage = {
    role: "assistant",
    content: ""
  };

  chat.messages.push(assistantMessage);

  const assistantElement = createMessageElement(
    assistantMessage,
    chat.messages.length - 1,
    chat.id
  );

  messagesElement.appendChild(assistantElement);

  setBusy(true);
  scrollToBottom();

  try {
    const form = new FormData();

    form.append("message", text);

    form.append(
      "history",
      JSON.stringify(
        chat.messages.slice(0, -2).map(message => ({
          role: message.role,
          content: message.content
        }))
      )
    );

    const settings = getSettingsForRequest();

    form.append("personality", settings.personality);
    form.append("customInstructions", settings.customInstructions);

    if (imageToSend) {
      form.append("image", imageToSend, imageToSend.name);
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      body: form
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));

      throw new Error(
        result.error || `Server error (${response.status})`
      );
    }

    if (!response.body) {
      throw new Error("Streaming is not supported by this browser.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let finished = false;

    while (!finished) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const line = event
          .split("\n")
          .find(item => item.startsWith("data: "));

        if (!line) continue;

        let data;

        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (data.type === "token") {
          assistantMessage.content += data.content;

          updateStreamingMessage(
            assistantElement,
            assistantMessage.content
          );
        }

        if (data.type === "error") {
          throw new Error(data.message || "AI request failed.");
        }

        if (data.type === "done") {
          finished = true;
        }
      }
    }

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = "I couldn't generate a response. Please try again.";
      updateStreamingMessage(
        assistantElement,
        assistantMessage.content
      );
    }

  } catch (error) {
    console.error(error);

    assistantMessage.content =
      `⚠️ ${error.message || "Something went wrong. Please try again."}`;

    updateStreamingMessage(
      assistantElement,
      assistantMessage.content
    );

  } finally {
    setBusy(false);
    saveChats();
    updateHistory();
    scrollToBottom();
  }
}

function updateStreamingMessage(element, text) {
  const content = element.querySelector(".message-text");

  if (!content) return;

  content.innerHTML = formatMarkdown(text);

  scrollToBottom();
}

/* INPUT */

function autoResize() {
  messageInput.style.height = "auto";

  messageInput.style.height =
    Math.min(messageInput.scrollHeight, 160) + "px";
}

messageInput.addEventListener("input", autoResize);

messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

$("newChat").addEventListener("click", () => {
  if (state.busy) return;

  clearAttachment();
  createChat();
  closeSidebar();
  messageInput.focus();
});

$("attachButton").addEventListener("click", () => {
  imageInput.click();
});

imageInput.addEventListener("change", event => {
  const file = event.target.files?.[0];

  if (file) showAttachment(file);
});

$("removeAttachment").addEventListener("click", clearAttachment);

document.querySelectorAll(".suggestion-card").forEach(button => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.prompt || "";
    autoResize();
    messageInput.focus();
  });
});

/* VOICE INPUT */

$("voiceButton").addEventListener("click", toggleRecording);

async function toggleRecording() {
  if (state.recording) {
    state.recorder?.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("Voice recording is not supported by this browser.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    state.audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";

    state.recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );

    state.recorder.ondataavailable = event => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };

    state.recorder.onstop = async () => {
      const type = state.recorder.mimeType || "audio/webm";

      const blob = new Blob(state.audioChunks, {
        type
      });

      stream.getTracks().forEach(track => track.stop());

      state.recording = false;

      $("voiceButton").classList.remove("recording");
      $("voiceButton").textContent = "🎙";

      await transcribeAudio(blob);
    };

    state.recorder.start();

    state.recording = true;

    $("voiceButton").classList.add("recording");
    $("voiceButton").textContent = "■";

    showToast("Recording started. Tap again to finish.");

  } catch (error) {
    console.error(error);
    showToast("Microphone permission was not granted.");
  }
}

async function transcribeAudio(blob) {
  try {
    const form = new FormData();

    form.append("audio", blob, "recording.webm");

    showToast("Converting your voice to text...");

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: form
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Transcription failed.");
    }

    if (result.text) {
      messageInput.value =
        `${messageInput.value} ${result.text}`.trim();

      autoResize();
      messageInput.focus();
    }

  } catch (error) {
    showToast(error.message || "Voice transcription failed.");
  }
}

/* VOICE OUTPUT */

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    showToast("Speech playback is not supported.");
    return;
  }

  window.speechSynthesis.cancel();

  const speech = new SpeechSynthesisUtterance(text);

  speech.rate = 1;
  speech.pitch = 1;

  window.speechSynthesis.speak(speech);
}

/* SETTINGS */

function openSettings() {
  $("settingsModal").classList.remove("hidden");
}

function closeSettings() {
  $("settingsModal").classList.add("hidden");
}

$("settingsButton").addEventListener("click", openSettings);
$("topSettingsButton").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("saveSettings").addEventListener("click", saveSettings);

$("settingsModal").addEventListener("click", event => {
  if (event.target === $("settingsModal")) {
    closeSettings();
  }
});

$("clearHistory").addEventListener("click", () => {
  if (!confirm("Delete all saved conversations?")) return;

  state.chats = [];
  state.activeChat = null;

  saveChats();
  updateHistory();
  createChat();

  showToast("Conversation history cleared.");
});

/* MOBILE SIDEBAR */

function openSidebar() {
  $("sidebar").classList.add("open");
  $("sidebarOverlay").classList.add("show");
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarOverlay").classList.remove("show");
}

$("menuButton").addEventListener("click", openSidebar);
$("closeSidebar").addEventListener("click", closeSidebar);
$("sidebarOverlay").addEventListener("click", closeSidebar);

$("historyButton").addEventListener("click", () => {
  $("historyList").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  closeSidebar();
});

$("homeButton").addEventListener("click", () => {
  if (!state.activeChat) {
    createChat();
  }

  renderMessages();
  closeSidebar();
});

/* CODE COPY */

messagesElement.addEventListener("click", event => {
  const button = event.target.closest(".copy-code");

  if (!button) return;

  const code = button
    .closest(".code-block")
    ?.querySelector("pre code")
    ?.textContent;

  if (code) {
    copyText(code);
    button.textContent = "Copied";

    setTimeout(() => {
     
