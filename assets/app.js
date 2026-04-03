const STORAGE_KEY = "kiemono_tasks_v1";
const SYNC_KEY = "koko_sync_id";
const WORKER_URL = "https://koko-task-api.YOUR_SUBDOMAIN.workers.dev";
const TTL_MS = 72 * 60 * 60 * 1000;
const EXPIRY_WARNING_THRESHOLD = 0.3;
const DELETE_ANIMATION_MS = 600;
const MAX_TASK_LENGTH = 120;
const UI_TICK_MS = 1000;
const SYNC_INTERVAL_MS = 30000;
const SYNC_CODE_LENGTH = 8;

const state = {
  tasks: [],
  editingTaskId: null,
  activeRemovalIds: new Set(),
  isInputComposing: false,
  syncId: "",
  syncCode: "",
};

const elements = {
  form: document.querySelector("#task-form"),
  input: document.querySelector("#task-input"),
  charCounter: document.querySelector("#char-counter"),
  activeList: document.querySelector("#active-list"),
  doneList: document.querySelector("#done-list"),
  activeEmpty: document.querySelector("#active-empty"),
  doneEmpty: document.querySelector("#done-empty"),
  activeCount: document.querySelector("#active-count"),
  doneCount: document.querySelector("#done-count"),
  template: document.querySelector("#task-template"),
  syncOpen: document.querySelector("#sync-open"),
  syncModal: document.querySelector("#sync-modal"),
  syncClose: document.querySelector("#sync-close"),
  syncBackdrop: document.querySelector("#sync-modal .sync-modal__backdrop"),
  syncCodeDisplay: document.querySelector("#sync-code-display"),
  syncCodeInput: document.querySelector("#sync-code-input"),
  syncCodeSubmit: document.querySelector("#sync-code-submit"),
  syncFeedback: document.querySelector("#sync-feedback"),
};

init();

function init() {
  state.tasks = loadTasks();
  state.syncId = loadOrCreateSyncId();
  state.syncCode = syncIdToCode(state.syncId);
  render();
  bindEvents();
  startClock();
  startSync();
  registerServiceWorker();
}

function bindEvents() {
  elements.form.addEventListener("submit", handleAddTask);
  elements.input.addEventListener("input", updateCounter);
  elements.input.addEventListener("compositionstart", () => {
    state.isInputComposing = true;
  });
  elements.input.addEventListener("compositionend", () => {
    state.isInputComposing = false;
  });
  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.isComposing || state.isInputComposing)) {
      event.preventDefault();
    }
  });
  bindSyncModal();
  updateCounter();
}

function startClock() {
  setInterval(() => {
    pruneExpiredTasks();
    updateTaskTimers();
  }, UI_TICK_MS);
}

function handleAddTask(event) {
  event.preventDefault();

  if (state.isInputComposing) {
    return;
  }

  const rawText = elements.input.value.trim();
  if (!rawText) {
    elements.input.focus();
    return;
  }

  const now = Date.now();
  const text = rawText.slice(0, MAX_TASK_LENGTH);
  const task = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    text,
    createdAt: now,
    updatedAt: now,
    done: false,
    deletedAt: null,
  };

  state.tasks = sortTasks([task, ...state.tasks]);
  persistTasks();
  render({ enterTaskId: task.id });

  elements.form.reset();
  updateCounter();
  elements.input.focus();
}

function toggleTaskDone(taskId) {
  const task = state.tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) {
    return;
  }

  task.done = !task.done;
  task.updatedAt = Date.now();
  persistTasks();
  render();
}

function queueTaskRemoval(taskId) {
  if (state.activeRemovalIds.has(taskId)) {
    return;
  }

  const card = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!card) {
    removeTask(taskId);
    return;
  }

  state.activeRemovalIds.add(taskId);
  card.classList.add("is-removing");

  window.setTimeout(() => {
    removeTask(taskId);
  }, DELETE_ANIMATION_MS);
}

function removeTask(taskId) {
  state.activeRemovalIds.delete(taskId);

  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.deletedAt) {
    return;
  }

  const now = Date.now();
  task.deletedAt = now;
  task.updatedAt = now;
  persistTasks();
  render();
}

function updateTaskText(taskId, nextText) {
  const task = state.tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) {
    return false;
  }

  const trimmed = nextText.replace(/\s+/g, " ").trim().slice(0, MAX_TASK_LENGTH);
  if (!trimmed) {
    return false;
  }

  task.text = trimmed;
  task.updatedAt = Date.now();
  persistTasks();
  return true;
}

function loadTasks() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = Date.now();
    const tasks = sortTasks(
      parsed
        .map((item) => normalizeTask(item))
        .filter((item) => Boolean(item))
        .filter((item) => now - item.createdAt < TTL_MS),
    );

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return tasks;
  } catch (error) {
    console.error("Failed to parse tasks from storage.", error);
    return [];
  }
}

function persistTasks() {
  state.tasks = sortTasks(state.tasks);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  pushToServer();
}

function pruneExpiredTasks() {
  const now = Date.now();
  const filtered = state.tasks.filter((task) => now - task.createdAt < TTL_MS || !task.deletedAt);

  if (filtered.length !== state.tasks.length) {
    state.tasks = sortTasks(filtered);
    persistTasks();
    render();
  }

  state.tasks
    .filter((task) => !task.deletedAt && now - task.createdAt >= TTL_MS)
    .forEach((task) => queueTaskRemoval(task.id));
}

function render(options = {}) {
  const { enterTaskId = null } = options;
  const visibleTasks = state.tasks.filter((task) => !task.deletedAt);
  const activeTasks = visibleTasks.filter((task) => !task.done);
  const doneTasks = visibleTasks.filter((task) => task.done);

  elements.activeList.replaceChildren(...activeTasks.map((task) => createTaskCard(task, enterTaskId)));
  elements.doneList.replaceChildren(...doneTasks.map((task) => createTaskCard(task, enterTaskId)));

  elements.activeEmpty.hidden = activeTasks.length > 0;
  elements.doneEmpty.hidden = doneTasks.length > 0;
  elements.activeCount.textContent = `${activeTasks.length}件`;
  elements.doneCount.textContent = `${doneTasks.length}件`;

  updateSyncCodeDisplay();
  updateTaskTimers();
}

function createTaskCard(task, enterTaskId) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".task-card");
  const toggleButton = fragment.querySelector(".task-card__toggle");
  const deleteButton = fragment.querySelector(".task-card__delete");
  const text = fragment.querySelector(".task-card__text");

  card.dataset.taskId = task.id;
  card.classList.toggle("is-done", task.done);
  card.classList.toggle("is-entering", task.id === enterTaskId);
  card.classList.toggle("is-removing", state.activeRemovalIds.has(task.id));

  if (task.id === enterTaskId) {
    window.setTimeout(() => {
      card.classList.remove("is-entering");
    }, 700);
  }

  toggleButton.setAttribute(
    "aria-label",
    task.done ? "タスクを未完了に戻す" : "タスクを完了にする",
  );
  deleteButton.setAttribute("aria-label", "タスクを削除");

  text.textContent = task.text;
  text.dataset.taskId = task.id;
  text.dataset.originalText = task.text;

  toggleButton.addEventListener("click", () => toggleTaskDone(task.id));
  deleteButton.addEventListener("click", () => queueTaskRemoval(task.id));
  bindEditableText(text, task.id);

  return fragment;
}

function bindEditableText(element, taskId) {
  let isComposing = false;

  element.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  element.addEventListener("compositionend", () => {
    isComposing = false;
  });

  element.addEventListener("focus", () => {
    state.editingTaskId = taskId;
    element.dataset.originalText = element.textContent ?? "";
  });

  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !isComposing) {
      event.preventDefault();
      element.blur();
    }
  });

  element.addEventListener("blur", () => {
    const didUpdate = updateTaskText(taskId, element.textContent ?? "");
    state.editingTaskId = null;

    if (!didUpdate) {
      const task = state.tasks.find((item) => item.id === taskId);
      element.textContent = task?.text ?? element.dataset.originalText ?? "";
      return;
    }

    const task = state.tasks.find((item) => item.id === taskId);
    element.textContent = task?.text ?? "";
  });
}

function updateTaskTimers() {
  const now = Date.now();
  const cards = document.querySelectorAll(".task-card");

  cards.forEach((card) => {
    const taskId = card.dataset.taskId;
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }

    const remaining = Math.max(0, TTL_MS - (now - task.createdAt));
    const ratio = remaining / TTL_MS;
    const ttlElement = card.querySelector(".task-card__ttl");
    const stampElement = card.querySelector(".task-card__stamp");
    const meterFill = card.querySelector(".task-card__meter-fill");

    if (ttlElement) {
      ttlElement.textContent = formatRemainingTime(remaining);
    }

    if (stampElement) {
      stampElement.textContent = formatCreatedAt(task.createdAt, now);
    }

    if (meterFill) {
      meterFill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    }

    card.classList.toggle("is-urgent", ratio <= EXPIRY_WARNING_THRESHOLD);
  });
}

function formatRemainingTime(remaining) {
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 24) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (hours >= 1) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes >= 1) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function formatCreatedAt(createdAt, now) {
  const elapsed = Math.max(0, now - createdAt);
  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 1) {
    return "たった今";
  }

  if (minutes < 60) {
    return `${minutes}分前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}時間前`;
  }

  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

function updateCounter() {
  const currentLength = elements.input.value.trimStart().length;
  elements.charCounter.textContent = `${Math.min(currentLength, MAX_TASK_LENGTH)} / ${MAX_TASK_LENGTH}`;
}

function loadOrCreateSyncId() {
  let syncId = window.localStorage.getItem(SYNC_KEY);
  if (!syncId || !isValidSyncId(syncId)) {
    syncId = crypto.randomUUID();
    window.localStorage.setItem(SYNC_KEY, syncId);
  }
  return syncId;
}

function startSync() {
  if (!isSyncConfigured()) {
    return;
  }

  registerSyncCode();

  setInterval(() => {
    syncFromServer();
  }, SYNC_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncFromServer();
    }
  });

  syncFromServer();
}

async function syncFromServer() {
  if (!isSyncConfigured()) {
    return false;
  }

  try {
    const response = await fetch(`${workerBaseUrl()}/tasks/${state.syncId}`);
    if (!response.ok) {
      return false;
    }

    const { tasks: remoteTasks } = await response.json();
    return mergeTasks(remoteTasks);
  } catch {
    return false;
  }
}

async function pushToServer() {
  if (!isSyncConfigured()) {
    return;
  }

  try {
    await fetch(`${workerBaseUrl()}/tasks/${state.syncId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: state.tasks,
        clientTime: Date.now(),
        syncCode: state.syncCode,
      }),
    });
  } catch {
    // Ignore offline errors and retry on the next sync tick or focus event.
  }
}

function mergeTasks(remoteTasks) {
  if (!Array.isArray(remoteTasks)) {
    return false;
  }

  const localMap = new Map(state.tasks.map((task) => [task.id, task]));
  const merged = new Map(localMap);

  remoteTasks
    .map((task) => normalizeTask(task))
    .filter((task) => Boolean(task))
    .forEach((task) => {
      const existing = merged.get(task.id);
      const incomingTime = task.updatedAt ?? task.createdAt;
      const existingTime = existing?.updatedAt ?? existing?.createdAt ?? 0;

      if (!existing || incomingTime >= existingTime) {
        merged.set(task.id, task);
      }
    });

  const now = Date.now();
  const next = sortTasks(
    Array.from(merged.values()).filter((task) => now - task.createdAt < TTL_MS),
  );

  if (JSON.stringify(next) !== JSON.stringify(state.tasks)) {
    state.tasks = next;
    persistTasks();
    render();
    return true;
  }

  return false;
}

function bindSyncModal() {
  if (!elements.syncOpen || !elements.syncModal) {
    return;
  }

  updateSyncCodeDisplay();

  elements.syncOpen.addEventListener("click", () => {
    elements.syncModal.hidden = false;
    updateSyncCodeDisplay();

    if (elements.syncCodeInput) {
      elements.syncCodeInput.value = "";
      elements.syncCodeInput.focus();
    }

    if (isSyncConfigured()) {
      updateSyncFeedback("このコードを別のデバイスで入力すると同期できます。");
      registerSyncCode();
    } else {
      updateSyncFeedback("同期を有効にするには WORKER_URL を実際の Worker URL に更新してください。", "warning");
    }
  });

  elements.syncClose?.addEventListener("click", closeSyncModal);
  elements.syncBackdrop?.addEventListener("click", closeSyncModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.syncModal.hidden) {
      closeSyncModal();
    }
  });

  elements.syncCodeInput?.addEventListener("input", () => {
    const nextValue = elements.syncCodeInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, SYNC_CODE_LENGTH);

    if (elements.syncCodeInput.value !== nextValue) {
      elements.syncCodeInput.value = nextValue;
    }

    updateSyncFeedback("");
  });

  elements.syncCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.syncCodeSubmit?.click();
    }
  });

  elements.syncCodeSubmit?.addEventListener("click", async () => {
    const code = elements.syncCodeInput?.value.trim().toUpperCase() ?? "";
    if (code.length < SYNC_CODE_LENGTH) {
      updateSyncFeedback("8文字のコードを入力してください。", "warning");
      return;
    }

    await applySyncCode(code);
  });
}

function closeSyncModal() {
  if (!elements.syncModal) {
    return;
  }

  elements.syncModal.hidden = true;
}

function updateSyncCodeDisplay() {
  if (elements.syncCodeDisplay) {
    elements.syncCodeDisplay.textContent = state.syncCode || "--------";
  }
}

async function registerSyncCode() {
  if (!isSyncConfigured()) {
    return false;
  }

  try {
    const response = await fetch(`${workerBaseUrl()}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: state.syncCode,
        syncId: state.syncId,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function applySyncCode(code) {
  if (!isSyncConfigured()) {
    updateSyncFeedback("Worker URL が未設定のため、まだ同期できません。", "warning");
    return;
  }

  updateSyncFeedback("コードを確認しています...");

  try {
    const response = await fetch(`${workerBaseUrl()}/pair/${encodeURIComponent(code)}`);
    if (response.status === 404) {
      updateSyncFeedback("そのコードはまだ見つかりませんでした。", "error");
      return;
    }

    if (!response.ok) {
      updateSyncFeedback("同期コードの確認に失敗しました。", "error");
      return;
    }

    const { syncId } = await response.json();
    if (!isValidSyncId(syncId)) {
      updateSyncFeedback("受け取った同期情報の形式が不正です。", "error");
      return;
    }

    state.syncId = syncId;
    state.syncCode = syncIdToCode(syncId);
    window.localStorage.setItem(SYNC_KEY, state.syncId);
    updateSyncCodeDisplay();
    await registerSyncCode();
    await syncFromServer();

    if (elements.syncCodeInput) {
      elements.syncCodeInput.value = "";
    }

    updateSyncFeedback("同期先を切り替えました。タスクを取り込みました。");
  } catch {
    updateSyncFeedback("オフラインのためコード確認に失敗しました。", "error");
  }
}

function syncIdToCode(syncId) {
  try {
    const compact = syncId.replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(compact)) {
      return "--------";
    }

    const value = BigInt(`0x${compact.slice(0, 13)}`);
    return value.toString(36).toUpperCase().padStart(SYNC_CODE_LENGTH, "0").slice(-SYNC_CODE_LENGTH);
  } catch {
    return "--------";
  }
}

function normalizeTask(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const task = {
    id: String(item.id ?? ""),
    text: String(item.text ?? "").trim().slice(0, MAX_TASK_LENGTH),
    createdAt: Number(item.createdAt ?? 0),
    updatedAt: Number(item.updatedAt ?? item.createdAt ?? 0),
    done: Boolean(item.done),
    deletedAt: item.deletedAt == null ? null : Number(item.deletedAt),
  };

  if (!task.id || !task.text || !Number.isFinite(task.createdAt) || task.createdAt <= 0) {
    return null;
  }

  if (!Number.isFinite(task.updatedAt) || task.updatedAt <= 0) {
    task.updatedAt = task.createdAt;
  }

  if (!Number.isFinite(task.deletedAt) || task.deletedAt <= 0) {
    task.deletedAt = null;
  }

  return task;
}

function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }

    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return left.id.localeCompare(right.id);
  });
}

function updateSyncFeedback(message, tone = "default") {
  if (!elements.syncFeedback) {
    return;
  }

  elements.syncFeedback.textContent = message;
  elements.syncFeedback.dataset.tone = message ? tone : "";
}

function isValidSyncId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function isSyncConfigured() {
  return Boolean(WORKER_URL) && !WORKER_URL.includes("YOUR_SUBDOMAIN");
}

function workerBaseUrl() {
  return WORKER_URL.replace(/\/+$/, "");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.error("Service worker registration failed.", error);
  }
}
