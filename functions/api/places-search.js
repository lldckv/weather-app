/**
 * Cloudflare Pages Function: /api/places-search
 *
 * Прокси к Google Places API (New) — Text Search.
 * Ключ API хранится ТОЛЬКО как секрет окружения Cloudflare Pages
 * (env.GOOGLE_PLACES_API_KEY) и никогда не отправляется в браузер.
 *
 * Как задать секрет:
 *   Cloudflare Dashboard → Workers & Pages → ваш проект →
 *   Settings → Environment variables → Add variable
 *   Name: GOOGLE_PLACES_API_KEY, Value: <ваш ключ>, тип: Secret (encrypt)
 *   Добавьте для Production И Preview.
 *
 * Локальная разработка (опционально):
 *   создайте файл .dev.vars (добавьте в .gitignore!) со строкой
 *   GOOGLE_PLACES_API_KEY=ваш_ключ
 *   и запускайте `npx wrangler pages dev .`
 */

const GOOGLE_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export async function onRequestPost(context) {
  const { request, env } = context;

  // Базовая защита от чужих сайтов, которые могли бы дёргать наш прокси
  // напрямую и расходовать наш лимит/бюджет API.
  const url = new URL(request.url);
  const referer = request.headers.get("Referer") || "";
  if (referer && !referer.includes(url.host)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  if (!env.GOOGLE_PLACES_API_KEY) {
    return jsonResponse({ error: "Server misconfigured: missing API key" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const textQuery = typeof body?.textQuery === "string" ? body.textQuery.trim() : "";
  const languageCode = typeof body?.languageCode === "string" ? body.languageCode : "en";
  const includedType = typeof body?.includedType === "string" ? body.includedType : "locality";

  // Не дёргаем Google по слишком коротким/пустым запросам
  if (textQuery.length < 2) {
    return jsonResponse({ places: [] }, 200);
  }

  const googleRes = await fetch(GOOGLE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery, languageCode, includedType }),
  });

  const data = await googleRes.json().catch(() => ({}));
  return jsonResponse(data, googleRes.status);
}

// На прямые GET-запросы к этому пути (например, случайный переход по URL)
// отвечаем понятной ошибкой, а не 404/500.
export async function onRequestGet() {
  return jsonResponse({ error: "Method not allowed, use POST" }, 405);
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
