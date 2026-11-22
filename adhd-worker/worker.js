import { validState } from "./public/state.js";
const encoder = new TextEncoder();

function json(value, status = 200) {
    return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

const emptyProgress = { done: {}, notes: {}, sheets: {}, wk: 0, tab: "prog" };

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
            if (url.pathname === "/api/progress") {
                if (!env.DB) return json({ error: "أضيفي ارتباط DB في Cloudflare." }, 503);
                return await progress(request, env.DB, url.origin);
            }
            if (!["/", "/index.html", "/state.js"].includes(url.pathname)) return new Response(null, { status: 404 });
            const response = await env.ASSETS.fetch(request);
            const headers = new Headers(response.headers);
            headers.set("Cache-Control", "no-store");
            headers.set("X-Frame-Options", "DENY");
            return new Response(response.body, { status: response.status, headers });
        } catch {
            return json({ error: "تعذّر تشغيل الدليل. تحققي من ارتباط DB وتنفيذ schema.sql." }, 500);
        }
    }
};
