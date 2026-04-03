import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  TASKS_KV: KVNamespace;
};

interface Task {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  done: boolean;
  deletedAt?: number | null;
}

interface StoredTasksPayload {
  tasks: Task[];
  updatedAt: number;
}

interface PairingPayload {
  code: string;
  syncId: string;
}

const TTL_SECONDS = 259200;
const MAX_TASKS = 200;
const PAIR_CODE_LENGTH = 8;

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = [
        "https://YOUR_GITHUB_USERNAME.github.io",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
      ];

      return allowed.includes(origin) ? origin : "";
    },
    allowMethods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Sync-Id"],
  }),
);

app.get("/", (c) => c.json({ ok: true, service: "koko-task-api" }));

app.get("/tasks/:syncId", async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) {
    return c.json({ error: "invalid syncId" }, 400);
  }

  const raw = await c.env.TASKS_KV.get(`tasks:${syncId}`);
  if (!raw) {
    return c.json({ tasks: [], serverTime: Date.now() });
  }

  const payload = parseStoredPayload(raw);
  const now = Date.now();
  const tasks = sanitizeTasks(payload.tasks, now);

  return c.json({
    tasks,
    serverTime: now,
    updatedAt: payload.updatedAt,
  });
});

app.put("/tasks/:syncId", async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) {
    return c.json({ error: "invalid syncId" }, 400);
  }

  let body: { tasks?: unknown; clientTime?: number; syncCode?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  if (!Array.isArray(body.tasks)) {
    return c.json({ error: "tasks must be an array" }, 400);
  }

  const now = Date.now();
  const tasks = sanitizeTasks(body.tasks, now);
  const payload: StoredTasksPayload = {
    tasks,
    updatedAt: now,
  };

  await c.env.TASKS_KV.put(`tasks:${syncId}`, JSON.stringify(payload), {
    expirationTtl: TTL_SECONDS,
  });

  const syncCode = typeof body.syncCode === "string" ? body.syncCode : null;
  if (syncCode && isValidPairCode(syncCode)) {
    await c.env.TASKS_KV.put(`pair:${syncCode}`, syncId, {
      expirationTtl: TTL_SECONDS,
    });
  }

  return c.json({ ok: true, serverTime: now });
});

app.delete("/tasks/:syncId", async (c) => {
  const { syncId } = c.req.param();
  if (!isValidUUID(syncId)) {
    return c.json({ error: "invalid syncId" }, 400);
  }

  await c.env.TASKS_KV.delete(`tasks:${syncId}`);
  return c.json({ ok: true });
});

app.get("/pair/:code", async (c) => {
  const { code } = c.req.param();
  const normalizedCode = code.trim().toUpperCase();

  if (!isValidPairCode(normalizedCode)) {
    return c.json({ error: "invalid code" }, 400);
  }

  const syncId = await c.env.TASKS_KV.get(`pair:${normalizedCode}`);
  if (!syncId || !isValidUUID(syncId)) {
    return c.json({ error: "pair not found" }, 404);
  }

  return c.json({ syncId, code: normalizedCode });
});

app.post("/pair", async (c) => {
  let body: PairingPayload;
  try {
    body = await c.req.json<PairingPayload>();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const syncId = body.syncId?.trim();
  const code = body.code?.trim().toUpperCase();
  if (!syncId || !code || !isValidUUID(syncId) || !isValidPairCode(code)) {
    return c.json({ error: "invalid payload" }, 400);
  }

  await c.env.TASKS_KV.put(`pair:${code}`, syncId, {
    expirationTtl: TTL_SECONDS,
  });

  return c.json({ ok: true, code, syncId });
});

function parseStoredPayload(raw: string): StoredTasksPayload {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTasksPayload> | Task[];
    if (Array.isArray(parsed)) {
      return {
        tasks: parsed,
        updatedAt: Date.now(),
      };
    }

    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return {
      tasks: [],
      updatedAt: Date.now(),
    };
  }
}

function sanitizeTasks(tasks: unknown[], now: number): Task[] {
  return tasks
    .map((task) => sanitizeTask(task))
    .filter((task): task is Task => Boolean(task))
    .filter((task) => now - task.createdAt < TTL_SECONDS * 1000)
    .slice(0, MAX_TASKS);
}

function sanitizeTask(task: unknown): Task | null {
  if (!task || typeof task !== "object") {
    return null;
  }

  const record = task as Partial<Task>;
  const id = String(record.id ?? "");
  const text = String(record.text ?? "").trim().slice(0, 120);
  const createdAt = Number(record.createdAt ?? 0);
  const updatedAtRaw = Number(record.updatedAt ?? createdAt);
  const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : createdAt;
  const deletedAtRaw =
    record.deletedAt == null ? null : Number(record.deletedAt);
  const deletedAt =
    deletedAtRaw != null && Number.isFinite(deletedAtRaw) && deletedAtRaw > 0
      ? deletedAtRaw
      : null;

  if (!id || !text || !Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }

  return {
    id,
    text,
    createdAt,
    updatedAt,
    done: Boolean(record.done),
    deletedAt,
  };
}

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function isValidPairCode(code: string): boolean {
  return new RegExp(`^[A-Z0-9]{${PAIR_CODE_LENGTH}}$`).test(code);
}

export default app;
