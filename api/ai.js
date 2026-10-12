// Vercel serverless funksiya: brauzer -> bu funksiya -> Gemini. Kalit faqat shu yerda (muhit o'zgaruvchisida) turadi.
const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []).concat(["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"]);
const hits = new Map();

module.exports = async function (req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "no_key" });

  // oddiy himoya: bitta IP dan daqiqasiga 20 ta so'rov
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 20) return res.status(429).json({ error: "rate_limited" });
  arr.push(now);
  hits.set(ip, arr);

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const prompt = String((b && b.prompt) || "").slice(0, 12000);
  if (!prompt) return res.status(400).json({ error: "empty" });

  const gen = { temperature: 0.7, maxOutputTokens: 8192 };
  if (b.json) gen.responseMimeType = "application/json";

  let status = 502;
  for (const m of MODELS) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gen }),
      });
      if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
      if (!r.ok) { status = r.status; continue; }
      const j = await r.json();
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
      if (text) return res.status(200).json({ text });
    } catch (e) { /* keyingi modelga o'tamiz */ }
  }
  return res.status(status >= 400 && status < 600 ? status : 502).json({ error: "ai_error" });
};
