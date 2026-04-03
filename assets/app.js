const STORAGE_KEY = "kiemono_tasks_v1";
const TTL_MS = 72 * 60 * 60 * 1000;
const EXPIRY_WARNING_THRESHOLD = 0.3;
const DELETE_ANIMATION_MS = 600;
const MAX_TASK_LENGTH = 120;
const UI_TICK_MS = 1000;

const state = {
  tasks: [],
  editingTaskId: null,
  activeRemovalIds: new Set(),
  isInputComposing: false,
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
};

init();

function init() {
  state.tasks = loadTasks();
  render();
  bindEvents();
  startClock();
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

  const text = rawText.slice(0, MAX_TASK_LENGTH);
  const task = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    text,
    createdAt: Date.now(),
    done: false,
  };

  state.tasks.unshift(task);
  persistTasks();
  render({ enterTaskId: task.id });

  elements.form.reset();
  updateCounter();
  elements.input.focus();
}

function toggleTaskDone(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  task.done = !task.done;
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
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  persistTasks();
  render();
}

function updateTaskText(taskId, nextText) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return false;
  }

  const trimmed = nextText.replace(/\s+/g, " ").trim().slice(0, MAX_TASK_LENGTH);
  if (!trimmed) {
    return false;
  }

  task.text = trimmed;
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
    const tasks = parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: String(item.id ?? ""),
        text: String(item.text ?? "").trim().slice(0, MAX_TASK_LENGTH),
        createdAt: Number(item.createdAt ?? 0),
        done: Boolean(item.done),
      }))
      .filter((item) => item.id && item.text && item.createdAt > 0)
      .filter((item) => now - item.createdAt < TTL_MS)
      .sort((left, right) => right.createdAt - left.createdAt);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return tasks;
  } catch (error) {
    console.error("Failed to parse tasks from storage.", error);
    return [];
  }
}

function persistTasks() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

function pruneExpiredTasks() {
  const now = Date.now();
  const expiredIds = state.tasks
    .filter((task) => now - task.createdAt >= TTL_MS)
    .map((task) => task.id);

  if (!expiredIds.length) {
    return;
  }

  expiredIds.forEach((taskId) => queueTaskRemoval(taskId));
}

function render(options = {}) {
  const { enterTaskId = null } = options;
  const activeTasks = state.tasks.filter((task) => !task.done);
  const doneTasks = state.tasks.filter((task) => task.done);

  elements.activeList.replaceChildren(...activeTasks.map((task) => createTaskCard(task, enterTaskId)));
  elements.doneList.replaceChildren(...doneTasks.map((task) => createTaskCard(task, enterTaskId)));

  elements.activeEmpty.hidden = activeTasks.length > 0;
  elements.doneEmpty.hidden = doneTasks.length > 0;
  elements.activeCount.textContent = `${activeTasks.length}件`;
  elements.doneCount.textContent = `${doneTasks.length}件`;

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
