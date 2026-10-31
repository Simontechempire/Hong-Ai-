// =====================================
// HONG AI - FRONTEND JAVASCRIPT
// =====================================

const $ = (id) => document.getElementById(id);


// =====================================
// APP STATE
// =====================================

const state = {
  chats: JSON.parse(
    localStorage.getItem("hongai_chats") || "[]"
  ),

  activeId: null,

  image: null,

  busy: false,

  recorder: null,

  chunks: []
};


// =====================================
// SETTINGS
// =====================================

const settings = JSON.parse(
  localStorage.getItem("hongai_settings") || "{}"
);

$("personality").value =
  settings.personality || "friendly";

$("customInstructions").value =
  settings.customInstructions || "";


// =====================================
// SAVE CHAT HISTORY
// =====================================

function saveChats() {

  localStorage.setItem(
    "hongai_chats",
    JSON.stringify(state.chats)
  );

  renderHistory();

}


// =====================================
// GET ACTIVE CHAT
// =====================================

function activeChat() {

  return state.chats.find(
    chat => chat.id === state.activeId
  );

}


// =====================================
// CREATE NEW CHAT
// =====================================

function newChat() {

  const chat = {

    id: crypto.randomUUID(),

    title: "New conversation",

    messages: [],

    updated: Date.now()

  };

  state.chats.unshift(chat);

  state.activeId = chat.id;

  saveChats();

  renderMessages();

  closeSidebar();

}


// =====================================
// SELECT CHAT
// =====================================

function selectChat(id) {

  state.activeId = id;

  renderMessages();

  renderHistory();

  closeSidebar();

}


// =====================================
// DISPLAY CHAT HISTORY
// =====================================

function renderHistory() {

  const list = $("historyList");

  list.replaceChildren();

  state.chats
    .sort((a, b) => b.updated - a.updated)
    .forEach(chat => {

      const button = document.createElement("button");

      button.className =
        "history-item" +
        (chat.id === state.activeId ? " active" : "");

      button.textContent =
        chat.title || "New conversation";

      button.title =
        chat.title || "New conversation";

      button.addEventListener("click", () => {

        selectChat(chat.id);

      });

      list.append(button);

    });

}


// =====================================
// DISPLAY MESSAGES
// =====================================

function renderMessages() {

  const chat = activeChat();

  const messages = $("messages");

  messages.replaceChildren();

  $("welcome").style.display =
    chat && chat.messages.length
      ? "none"
      : "block";

  if (!chat) return;

  for (const item of chat.messages) {

    const row = document.createElement("div");

    row.className = `message ${item.role}`;

    const avatar = document.createElement("div");

    avatar.className = "message-avatar";

    avatar.textContent =
      item.role === "user" ? "Y" : "H";

    const body = document.createElement("div");

    const bubble = document.createElement("div");

    bubble.className = "bubble";

    const text = document.createElement("div");

    text.textContent = item.content;

    bubble.append(text);

    const meta = document.createElement("div");

    meta.className = "message-meta";

    meta.textContent =
      item.role === "user"
        ? "YOU"
        : "HONG AI";

    body.append(bubble, meta);

    row.append(avatar, body);

    messages.append(row);

  }

  $("chatArea").scrollTop =
    $("chatArea").scrollHeight;

}


// =====================================
// ADD MESSAGE
// =====================================

function addMessage(role, content) {

  const chat = activeChat();

  if (!chat) return;

  chat.messages.push({

    role,

    content

  });

  if (
    role === "user" &&
    chat.title === "New conversation"
  ) {

    chat.title = (
      content || "New conversation"
    ).slice(0, 34);

  }

  chat.updated = Date.now();

  saveChats();

  renderMessages();

}


// =====================================
// NOTIFICATION
// =====================================

function toast(message) {

  const el = $("toast");

  el.textContent = message;

  el.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {

    el.classList.remove("show");

  }, 2800);

}


// =====================================
// BUSY STATE
// =====================================

function setBusy(value) {

  state.busy = value;

  $("sendBtn").disabled = value;

  $("micBtn").disabled = value;

  $("sendBtn").textContent =
    value ? "…" : "↑";

}


// =====================================
// SIDEBAR
// =====================================

function closeSidebar() {

  $("sidebar").classList.remove("open");

}


// =====================================
// AI THINKING INDICATOR
// =====================================

function showTyping() {

  const row = document.createElement("div");

  row.className = "message assistant";

  row.id = "typingRow";

  const avatar = document.createElement("div");

  avatar.className = "message-avatar";

  avatar.textContent = "H";

  const bubble = document.createElement("div");

  bubble.className = "bubble typing";

  bubble.textContent = "HONG AI is thinking…";

  row.append(avatar, bubble);

  $("messages").append(row);

  $("chatArea").scrollTop =
    $("chatArea").scrollHeight;

}


// =====================================
// SEND MESSAGE TO GROQ
// =====================================

async function sendMessage() {

  if (state.busy) return;

  const text =
    $("messageInput").value.trim();

  if (!text && !state.image) return;

  if (!activeChat()) {

    newChat();

  }

  const imageFile = state.image;

  const userText =
    text || "Please describe this image.";

  addMessage(
    "user",
    imageFile
      ? `${userText}\n[Image attached: ${imageFile.name}]`
      : userText
  );

  $("messageInput").value = "";

  $("messageInput").style.height = "auto";

  clearImage();

  setBusy(true);

  showTyping();

  const chat = activeChat();

  const history = chat.messages

    .filter(
      (message, index) =>
        index < chat.messages.length - 1
    )

    .slice(-20)

    .map(message => ({

      role: message.role,

      content: message.content

    }));


  // Prepare request

  const form = new FormData();

  form.append("message", text);

  form.append(
    "history",
    JSON.stringify(history)
  );

  form.append(
    "personality",
    $("personality").value
  );

  form.append(
    "customInstructions",
    $("customInstructions").value
  );

  if (imageFile) {

    form.append("image", imageFile);

  }


  // Send request

  try {

    const response = await fetch(
      "/api/chat",
      {
        method: "POST",
        body: form
      }
    );

    const data = await response.json();

    if (!response.ok) {

      throw new Error(
        data.error || "Request failed."
      );

    }

    addMessage(
      "assistant",
      data.answer
    );

  } catch (error) {

    addMessage(
      "assistant",
      `Sorry, I couldn't complete that request.\n\n${error.message}`
    );

  } finally {

    $("typingRow")?.remove();

    setBusy(false);

  }

}


// =====================================
// IMAGE UPLOAD
// =====================================

function clearImage() {

  state.image = null;

  $("imageInput").value = "";

  $("attachmentPreview").hidden = true;

  $("attachmentName").textContent = "";

}


$("attachBtn").addEventListener(
  "click",
  () => {

    $("imageInput").click();

  }
);


$("imageInput").addEventListener(
  "change",
  (event) => {

    const file = event.target.files[0];

    if (!file) return;

    const allowed = [

      "image/jpeg",

      "image/png",

      "image/webp",

      "image/gif"

    ];

    if (!allowed.includes(file.type)) {

      toast("Unsupported image format.");

      return;

    }

    if (file.size > 8 * 1024 * 1024) {

      toast("Image must be smaller than 8 MB.");

      return;

    }

    state.image = file;

    $("attachmentName").textContent =
      `Image attached: ${file.name}`;

    $("attachmentPreview").hidden = false;

  }
);


$("removeAttachment").addEventListener(
  "click",
  clearImage
);


// =====================================
// SEND BUTTON
// =====================================

$("chatForm").addEventListener(
  "submit",
  (event) => {

    event.preventDefault();

    sendMessage();

  }
);


// =====================================
// ENTER TO SEND
// =====================================

$("messageInput").addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendMessage();

    }

  }
);


// =====================================
// AUTO RESIZE TEXTAREA
// =====================================

$("messageInput").addEventListener(
  "input",
  () => {

    const el = $("messageInput");

    el.style.height = "auto";

    el.style.height =
      `${Math.min(el.scrollHeight, 150)}px`;

  }
);


// =====================================
// QUICK PROMPTS
// =====================================

document
  .querySelectorAll(".suggestion")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        $("messageInput").value =
          button.dataset.prompt;

        $("messageInput").focus();

        $("messageInput").dispatchEvent(
          new Event("input")
        );

      }
    );

  });


// =====================================
// NEW CHAT BUTTON
// =====================================

$("newChat").addEventListener(
  "click",
  newChat
);


// =====================================
// MOBILE SIDEBAR
// =====================================

$("openSidebar").addEventListener(
  "click",
  () => {

    $("sidebar").classList.add("open");

  }
);


$("closeSidebar").addEventListener(
  "click",
  closeSidebar
);


// =====================================
// SETTINGS
// =====================================

function openSettings() {

  $("settingsModal").hidden = false;

}


function closeSettings() {

  $("settingsModal").hidden = true;

}


$("settingsOpen").addEventListener(
  "click",
  openSettings
);


$("settingsOpenTop").addEventListener(
  "click",
  openSettings
);


$("settingsClose").addEventListener(
  "click",
  closeSettings
);


$("settingsCancel").addEventListener(
  "click",
  closeSettings
);


$("settingsSave").addEventListener(
  "click",
  () => {

    const data = {

      personality:
        $("personality").value,

      customInstructions:
        $("customInstructions").value.trim()

    };

    localStorage.setItem(
      "hongai_settings",
      JSON.stringify(data)
    );

    closeSettings();

    toast("AI settings saved.");

  }
);


// =====================================
// VOICE INPUT
// GROQ WHISPER
// =====================================

$("micBtn").addEventListener(
  "click",
  async () => {

    // Stop recording

    if (
      state.recorder &&
      state.recorder.state === "recording"
    ) {

      state.recorder.stop();

      $("micBtn").textContent = "🎙";

      return;

    }


    // Browser support

    if (
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder
    ) {

      toast(
        "Voice recording is not supported in this browser."
      );

      return;

    }


    try {

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true
        });

      state.chunks = [];

      state.recorder =
        new MediaRecorder(stream);


      state.recorder.ondataavailable =
        (event) => {

          if (event.data.size) {

            state.chunks.push(event.data);

          }

        };


      // When recording stops

      state.recorder.onstop =
        async () => {

          stream.getTracks().forEach(
            track => track.stop()
          );

          const blob = new Blob(
            state.chunks,
            {
              type: "audio/webm"
            }
          );

          const form = new FormData();

          form.append(
            "audio",
            blob,
            "voice-message.webm"
          );

          toast("Transcribing your voice…");


          try {

            const response = await fetch(
              "/api/transcribe",
              {
                method: "POST",
                body: form
              }
            );

            const data = await response.json();

            if (!response.ok) {

              throw new Error(
                data.error || "Transcription failed."
              );

            }

            $("messageInput").value = [

              $("messageInput").value.trim(),

              data.text

            ].filter(Boolean).join(" ");

            $("messageInput").dispatchEvent(
              new Event("input")
            );

            $("messageInput").focus();

            toast("Voice added to your message.");

          } catch (error) {

            toast(error.message);

          }

        };


      state.recorder.start();

      $("micBtn").textContent = "■";

      toast(
        "Recording... tap the microphone again to stop."
      );

    } catch (error) {

      toast(
        "Microphone permission was not granted."
      );

    }

  }
);


// =====================================
// VOICE PLAYBACK
// DOUBLE CLICK AI RESPONSE
// =====================================

$("messages").addEventListener(
  "dblclick",
  (event) => {

    const bubble = event.target.closest(
      ".assistant .bubble"
    );

    if (
      !bubble ||
      !("speechSynthesis" in window)
    ) {

      return;

    }

    const utterance =
      new SpeechSynthesisUtterance(
        bubble.innerText
      );

    utterance.rate = 1;

    speechSynthesis.cancel();

    speechSynthesis.speak(utterance);

    toast("Reading response aloud.");

  }
);


// =====================================
// INITIALIZE HONG AI
// =====================================

if (!state.chats.length) {

  newChat();

} else {

  state.activeId = state.chats[0].id;

  renderHistory();

  renderMessages();

}


// =====================================
// HONG AI INITIALIZED
// =====================================

console.log(
  "HONG AI FRONTEND INITIALIZED"
);
