// Vercel funksiyasi: brauzer -> /api/ai -> Gemini.
// GEMINI_API_KEY faqat Vercel muhit o'zgaruvchisida turadi.

var SB_URL = "https://etjjqwaskuvnxputunyi.supabase.co";
var SB_KEY = "sb_publishable_rkeCvnQPvf-hALMp3LJNCA_mQ-ic6ES";

var MODELS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];
if (process.env.GEMINI_MODEL) MODELS.unshift(process.env.GEMINI_MODEL);

var hits = {};

module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  var key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "no_key" });

  // 1) Kirgan foydalanuvchi tokeni bo'lishi shart
  var auth = String(req.headers.authorization || "");
  var token = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "no_token" });

  // 2) Foydalanuvchi bo'yicha daqiqasiga 20 ta so'rov (faqat cheklov kaliti uchun)
  var uid = "";
  try {
    var payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    uid = String(payload.sub || "");
  } catch (e) {}
  if (!uid) uid = token.slice(-24);
  var now = Date.now();
  var list = (hits[uid] || []).filter(function (t) { return now - t < 60000; });
  if (list.length >= 20) return res.status(429).json({ error: "rate_limited" });
  list.push(now);
  hits[uid] = list;

  // 3) So'rov matni
  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  var prompt = String(body.prompt || "").slice(0, 12000);
  if (!prompt) return res.status(400).json({ error: "empty" });

  // 4) Limit serverda: Supabase tokenni tekshiradi va AI "bileti"ni yechadi
  try {
    var q = await fetch(SB_URL + "/rest/v1/rpc/app_ai_take", {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: "{}"
    });
    if (q.status === 401 || q.status === 403) {
      var d1 = "";
      try { d1 = (await q.text()).slice(0, 200); } catch (e) {}
      return res.status(401).json({ error: "bad_token", status: q.status, detail: d1 });
    }
    if (!q.ok) {
      var d2 = "";
      try { d2 = (await q.text()).slice(0, 200); } catch (e) {}
      return res.status(502).json({ error: "quota_check", status: q.status, detail: d2 });
    }
    var allowed = await q.json();
    if (allowed !== true) return res.status(402).json({ error: "no_quota" });
  } catch (e) {
    return res.status(502).json({ error: "quota_check" });
  }

  // 5) Gemini
  var gen = { temperature: 0.7, maxOutputTokens: 8192 };
  if (body.json) gen.responseMimeType = "application/json";

  var status = 502;
  for (var i = 0; i < MODELS.length; i++) {
    try {
      var r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + MODELS[i] + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gen })
        }
      );
      if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
      if (!r.ok) { status = r.status; continue; }
      var j = await r.json();
      var cand = (j.candidates || [])[0] || {};
      var parts = (cand.content || {}).parts || [];
      var text = parts.filter(function (p) { return !p.thought; })
        .map(function (p) { return p.text || ""; }).join("");
      if (text) return res.status(200).json({ text: text });
    } catch (e) { /* keyingi modelga o'tamiz */ }
  }
  return res.status(status >= 400 && status < 600 ? status : 502).json({ error: "ai_error" });
};
