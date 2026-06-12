var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var OUTCOMES = /* @__PURE__ */ new Set(["invicto", "campeon", "subcampeon", "eliminated-sf", "eliminated-qf", "eliminated-pool"]);
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
var ID_RE = /^[0-9]{4}-[a-z]{3}-[a-z0-9-]{1,80}$/;
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }), "json");
function dayIsCurrent(day) {
  if (!DAY_RE.test(day)) return false;
  const ms = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) <= 36 * 3600 * 1e3;
}
__name(dayIsCurrent, "dayIsCurrent");
async function todayStats(db, day, pickIds) {
  const rows = await db.prepare("SELECT wins, COUNT(*) AS c FROM results WHERE day = ? GROUP BY wins").bind(day).all();
  const distribution = {};
  let total = 0;
  for (const r of rows.results) {
    distribution[String(r.wins)] = r.c;
    total += r.c;
  }
  const inv = await db.prepare("SELECT COUNT(*) AS c FROM results WHERE day = ? AND outcome = 'invicto'").bind(day).first();
  const out = {
    total,
    invictos: inv?.c ?? 0,
    distribution
  };
  if (pickIds && pickIds.length > 0) {
    const marks = pickIds.map(() => "?").join(",");
    const picks = await db.prepare(`SELECT player_id, n FROM picks WHERE day = ? AND player_id IN (${marks})`).bind(day, ...pickIds).all();
    out.yourPicks = picks.results.map((p) => ({ id: p.player_id, n: p.n }));
  }
  return out;
}
__name(todayStats, "todayStats");
async function handleSubmit(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { day, clientId, wins, losses, outcome, picks } = body;
  if (typeof day !== "string" || !dayIsCurrent(day) || typeof clientId !== "string" || clientId.length < 8 || clientId.length > 64 || typeof wins !== "number" || !Number.isInteger(wins) || wins < 0 || wins > 7 || typeof losses !== "number" || !Number.isInteger(losses) || losses < 0 || losses > 4 || wins + losses < 4 || wins + losses > 7 || typeof outcome !== "string" || !OUTCOMES.has(outcome) || !Array.isArray(picks) || picks.length !== 12 || !picks.every((p) => typeof p === "string" && ID_RE.test(p))) {
    return json({ error: "bad request" }, 400);
  }
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO results (day, client_id, wins, losses, outcome) VALUES (?, ?, ?, ?, ?)"
  ).bind(day, clientId, wins, losses, outcome).run();
  if (inserted.meta.changes > 0) {
    const upsert = env.DB.prepare(
      "INSERT INTO picks (day, player_id, n) VALUES (?, ?, 1) ON CONFLICT(day, player_id) DO UPDATE SET n = n + 1"
    );
    await env.DB.batch(picks.map((p) => upsert.bind(day, p)));
  }
  return json(await todayStats(env.DB, day, picks));
}
__name(handleSubmit, "handleSubmit");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/result" && request.method === "POST") {
      return handleSubmit(request, env);
    }
    if (url.pathname === "/api/today" && request.method === "GET") {
      const day = url.searchParams.get("day") ?? "";
      if (!dayIsCurrent(day)) return json({ error: "bad day" }, 400);
      return json(await todayStats(env.DB, day));
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Syndyf/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Syndyf/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
