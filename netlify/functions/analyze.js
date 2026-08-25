// netlify/functions/analyze.js
// Secure proxy: receives an image from the frontend, calls Gemini with the
// API key kept server-side (never exposed to the browser), and returns
// structured analysis JSON.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { imageBase64, mimeType } = body;
  if (!imageBase64 || !mimeType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing image data" }) };
  }

  const prompt = `You are a hair and scalp analysis assistant. Look at this photo and respond with ONLY valid JSON, no markdown, no extra text, in exactly this shape:

{
  "healthScore": <integer 0-100>,
  "hairType": "<short description e.g. 'Wavy, medium density'>",
  "scalpCondition": "<short description e.g. 'Mild dryness, no visible flaking'>",
  "recommendations": ["<short actionable tip>", "<short actionable tip>", "<short actionable tip>"],
  "summary": "<one encouraging, honest sentence about what you see>"
}

Be specific to what is actually visible in the image. If the image does not clearly show hair or scalp, set healthScore to 0 and explain in summary that a clearer photo is needed.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0.4 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return { statusCode: response.status, body: JSON.stringify({ error: "Gemini request failed", detail: errText }) };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { statusCode: 502, body: JSON.stringify({ error: "Could not parse analysis result" }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error("Unexpected server error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Unexpected server error", detail: String(err) }) };
  }
};
