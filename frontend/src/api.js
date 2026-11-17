// The session lives only in memory: a refresh or new tab starts with an empty workspace.
// (Previously this was kept in localStorage, which is why uploads survived a reload.)
const SESSION_ID = crypto.randomUUID();

const headers = () => ({ "X-Session-ID": SESSION_ID });

// When the page is refreshed or closed, ask the server to delete what this session uploaded
// so abandoned resumes don't pile up in the database. sendBeacon is the only request type
// browsers reliably complete during unload; the server also purges stale data after a TTL.
window.addEventListener("pagehide", () => {
  navigator.sendBeacon(`/api/documents/clear?session_id=${SESSION_ID}`);
});

async function check(r) {
  if (r.ok) return r;
  let detail = r.statusText;
  try {
    const body = await r.json();
    detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  } catch {
    /* non-JSON error body */
  }
  throw new Error(detail);
}

export async function listDocuments() {
  const r = await check(await fetch("/api/documents", { headers: headers() }));
  return r.json();
}

export async function uploadDocument(file, docType) {
  const form = new FormData();
  form.append("doc_type", docType);
  form.append("file", file);
  const r = await check(
    await fetch("/api/documents", { method: "POST", headers: headers(), body: form }),
  );
  return r.json();
}

export async function deleteDocument(id) {
  await check(await fetch(`/api/documents/${id}`, { method: "DELETE", headers: headers() }));
}

/** Streams fit-analysis events ({type: progress|result|error}) to onEvent. */
export async function cachedFit(jobId) {
  const r = await check(await fetch(`/api/analysis/fit/${jobId}`, { headers: headers() }));
  return r.status === 204 ? null : r.json();
}

export async function analyseFit(jobId, onEvent, refresh = false) {
  const r = await check(
    await fetch(`/api/analysis/fit/${jobId}?refresh=${refresh}`, { method: "POST", headers: headers() }),
  );
  await readEvents(r, onEvent);
}

/** Streams chat events ({type: sources|token|done|error}) to onEvent. */
export async function streamChat(question, docIds, onEvent, signal) {
  const r = await check(
    await fetch("/api/chat", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ question, doc_ids: docIds?.length ? docIds : null }),
      signal,
    }),
  );
  await readEvents(r, onEvent);
}

async function readEvents(r, onEvent) {
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      if (part.startsWith("data:")) onEvent(JSON.parse(part.slice(5)));
    }
  }
}
