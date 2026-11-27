import { guideAI } from "./ai.js";
import { validState } from "./public/state.js";
const encoder = new TextEncoder();

function json(value, status = 200) {
    return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

const emptyProgress = { done: {}, notes: {}, sheets: {}, wk: 0, tab: "prog" };
const publicFiles = new Set(["/", "/index.html", "/state.js", "/privacy.html", "/terms.html", "/404.html", "/robots.txt", "/sitemap.xml", "/favicon.svg", "/site.webmanifest", "/og-guide.jpg"]);
const metricEvents = new Set(["page_view", "consent_accept"]);
let telemetryReady;

function ensureTelemetry(db) {
    telemetryReady ||= db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS analytics_daily (
            day TEXT NOT NULL, path TEXT NOT NULL, event TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
            PRIMARY KEY (day, path, event))`),
        db.prepare(`CREATE TABLE IF NOT EXISTS error_daily (
            day TEXT NOT NULL, path TEXT NOT NULL, code TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
            PRIMARY KEY (day, path, code))`)
    ]).catch(error => { telemetryReady = undefined; throw error; });
    return telemetryReady;
}

function secure(response, path = "") {
    const headers = new Headers(response.headers);
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests");
    headers.set("Cache-Control", path === "/og-guide.jpg" || path === "/favicon.svg" ? "public, max-age=604800, immutable" : path.endsWith(".html") || path === "/" ? "no-cache" : "public, max-age=3600");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function limited(request, env) {
    if (!env.APP_RATE) return false;
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    return !(await env.APP_RATE.limit({ key: ip })).success;
}

async function recordMetric(request, env, origin) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (request.headers.get("Origin") !== origin || request.headers.get("Content-Type") !== "application/json") return json({ error: "Forbidden." }, 403);
    if (!env.DB || await limited(request, env)) return json({ error: "Try again later." }, 429);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const path = typeof body?.path === "string" && /^\/[a-z0-9._/-]{0,80}$/i.test(body.path) ? body.path : null;
    if (!path || !metricEvents.has(body?.event)) return json({ error: "Invalid request." }, 400);
    await ensureTelemetry(env.DB);
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`INSERT INTO analytics_daily(day, path, event, count) VALUES (?, ?, ?, 1)
        ON CONFLICT(day, path, event) DO UPDATE SET count = count + 1`).bind(day, path, body.event).run();
    return new Response(null, { status: 204 });
}

async function recordError(request, env, origin) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (request.headers.get("Origin") !== origin || request.headers.get("Content-Type") !== "application/json") return json({ error: "Forbidden." }, 403);
    if (!env.DB || await limited(request, env)) return json({ error: "Try again later." }, 429);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const path = typeof body?.path === "string" && /^\/[a-z0-9._/-]{0,80}$/i.test(body.path) ? body.path : null;
    const code = typeof body?.code === "string" && /^[a-z0-9_.-]{1,60}$/i.test(body.code) ? body.code : null;
    if (!path || !code) return json({ error: "Invalid request." }, 400);
    await ensureTelemetry(env.DB);
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`INSERT INTO error_daily(day, path, code, count) VALUES (?, ?, ?, 1)
        ON CONFLICT(day, path, code) DO UPDATE SET count = count + 1`).bind(day, path, code).run();
    return new Response(null, { status: 204 });
}

async function progress(request, db, origin) {
    const key = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") || "")?.[1];
    if (!key) return json({ error: "رابط المزامنة غير صالح." }, 400);
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
    const accessHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (request.method === "GET") {
        const row = await db.prepare("SELECT revision, payload FROM private_guide_progress WHERE access_hash = ?")
            .bind(accessHash).first();
        return json(row ? { revision: row.revision, state: JSON.parse(row.payload) } : { revision: 0, state: emptyProgress });
    }
    if (request.method !== "PUT") return json({ error: "طريقة الطلب غير مدعومة." }, 405);
    if (request.headers.get("Origin") !== origin || request.headers.get("Content-Type") !== "application/json") {
        return json({ error: "مصدر الطلب غير مسموح." }, 403);
    }
    const body = await request.text();
    if (encoder.encode(body).length > 900000) return json({ error: "حجم سجل التقدم يتجاوز حد الحفظ." }, 413);
    let update;
    try { update = JSON.parse(body); } catch { return json({ error: "صيغة الطلب غير صالحة." }, 400); }
    if (!Number.isSafeInteger(update?.revision) || update.revision < 0 || !validState(update.state)) {
        return json({ error: "صيغة سجل التقدم غير صالحة." }, 400);
    }
    const payload = JSON.stringify(update.state);
    const statement = update.revision === 0
        ? db.prepare(`INSERT INTO private_guide_progress(access_hash, revision, payload)
            VALUES (?, 1, ?) ON CONFLICT(access_hash) DO NOTHING RETURNING revision`).bind(accessHash, payload)
        : db.prepare(`UPDATE private_guide_progress SET payload = ?, revision = revision + 1
            WHERE access_hash = ? AND revision = ? RETURNING revision`).bind(payload, accessHash, update.revision);
    const row = await statement.first();
    return row ? json(row) : json({ error: "تغيّر السجل السحابي من جلسة أخرى." }, 409);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        try {
            if (request.headers.get("X-Forwarded-Proto") === "http") {
                url.protocol = "https:";
                return Response.redirect(url, 308);
            }
            if (url.pathname === "/api/ai") return secure(await guideAI(request, env, url.origin, json));
            if (url.pathname === "/api/analytics") return secure(await recordMetric(request, env, url.origin));
            if (url.pathname === "/api/errors") return secure(await recordError(request, env, url.origin));
            if (url.pathname === "/api/progress") {
                if (!env.DB) return json({ error: "أضيفي ارتباط DB في Cloudflare." }, 503);
                if (await limited(request, env)) return secure(json({ error: "طلبات كثيرة. حاولي بعد قليل." }, 429));
                return secure(await progress(request, env.DB, url.origin));
            }
            if (!publicFiles.has(url.pathname)) {
                const notFound = await env.ASSETS.fetch(new URL("/404.html", url.origin));
                return secure(new Response(notFound.body, { status: 404, headers: notFound.headers }), "/404.html");
            }
            const assetRequest = url.pathname === "/"
                ? new Request(new URL("/index.html", url.origin), request)
                : request;
            return secure(await env.ASSETS.fetch(assetRequest), url.pathname);
        } catch {
            return secure(json({ error: "تعذّر تشغيل الدليل. تحققي من ارتباط DB وتنفيذ schema.sql." }, 500));
        }
    }
};
