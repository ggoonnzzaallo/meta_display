import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const MAX_BOOK_BYTES = 8 * 1024 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanCode(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    key = keys.default || key;
  } catch (_) {
    // Legacy service-role environment variable remains a supported fallback.
  }
  if (!url || !key) throw new Error("Leaf service configuration is incomplete");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function deviceFor(supabase: ReturnType<typeof createClient>, token: unknown, create = false) {
  const raw = String(token || "");
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error("Invalid device token");
  const tokenHash = await sha256(raw);
  if (create) {
    const { data, error } = await supabase
      .from("leaf_devices")
      .upsert({ token_hash: tokenHash, last_seen_at: new Date().toISOString() }, { onConflict: "token_hash" })
      .select("id")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("leaf_devices")
    .select("id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Unknown Leaf device");
  await supabase.from("leaf_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

function validateBook(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Missing book data");
  const raw = value as Record<string, unknown>;
  const title = String(raw.title || "Untitled").trim().slice(0, 300);
  const author = String(raw.author || "Unknown author").trim().slice(0, 300);
  if (!Array.isArray(raw.chapters) || raw.chapters.length < 1 || raw.chapters.length > 1200) {
    throw new Error("The book must contain between 1 and 1200 chapters");
  }
  const chapters = raw.chapters.map((item, index) => {
    const chapter = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const text = String(chapter.text || "").trim();
    if (!text) throw new Error(`Chapter ${index + 1} has no readable text`);
    return {
      id: String(chapter.id || `chapter-${index + 1}`).slice(0, 200),
      title: String(chapter.title || `Chapter ${index + 1}`).trim().slice(0, 400),
      text,
    };
  });
  const book = { title, author, chapters };
  const byteSize = new TextEncoder().encode(JSON.stringify(book)).length;
  if (byteSize > MAX_BOOK_BYTES) throw new Error("The converted book is larger than Leaf's 8 MB limit");
  return { book, byteSize };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const body = await request.json();
    const action = String(body.action || "");
    const supabase = adminClient();

    if (action === "create_pair") {
      const device = await deviceFor(supabase, body.device_token, true);
      await supabase
        .from("leaf_pairings")
        .delete()
        .eq("device_id", device.id)
        .is("consumed_at", null);
      let inserted = null;
      for (let attempt = 0; attempt < 6 && !inserted; attempt += 1) {
        const code = newCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const result = await supabase
          .from("leaf_pairings")
          .insert({ device_id: device.id, code, expires_at: expiresAt })
          .select("code, expires_at")
          .single();
        if (!result.error) inserted = result.data;
      }
      if (!inserted) throw new Error("Could not create a unique pairing code");
      return json(inserted);
    }

    if (action === "pair_status") {
      const device = await deviceFor(supabase, body.device_token);
      const { data, error } = await supabase
        .from("leaf_pairings")
        .select("book_id, consumed_at, expires_at")
        .eq("device_id", device.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const ready = Boolean(data && data.consumed_at && data.book_id);
      return json({ ready, book_id: ready ? data.book_id : null, expires_at: data?.expires_at || null });
    }

    if (action === "upload") {
      const code = cleanCode(body.code);
      if (code.length !== 8) return json({ error: "Enter the complete eight-character pairing code" }, 400);
      const { data: pairing, error: pairingError } = await supabase
        .from("leaf_pairings")
        .select("id, device_id, expires_at, consumed_at")
        .eq("code", code)
        .maybeSingle();
      if (pairingError) throw pairingError;
      if (!pairing || pairing.consumed_at || new Date(pairing.expires_at).getTime() < Date.now()) {
        return json({ error: "That pairing code is invalid, expired, or already used" }, 404);
      }
      const parsed = validateBook(body.book);
      const { data: saved, error: bookError } = await supabase
        .from("leaf_books")
        .insert({
          device_id: pairing.device_id,
          title: parsed.book.title,
          author: parsed.book.author,
          content: { chapters: parsed.book.chapters },
          byte_size: parsed.byteSize,
        })
        .select("id")
        .single();
      if (bookError) throw bookError;
      const { error: consumeError } = await supabase
        .from("leaf_pairings")
        .update({ consumed_at: new Date().toISOString(), book_id: saved.id })
        .eq("id", pairing.id)
        .is("consumed_at", null);
      if (consumeError) throw consumeError;
      return json({ ok: true, book_id: saved.id });
    }

    if (action === "library") {
      let device;
      try {
        device = await deviceFor(supabase, body.device_token);
      } catch (_) {
        return json({ books: [] });
      }
      const { data: rows, error } = await supabase
        .from("leaf_books")
        .select("id, title, author, created_at")
        .eq("device_id", device.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const { data: progressRows, error: progressError } = await supabase
        .from("leaf_progress")
        .select("book_id, chapter_index, anchor, font_size, updated_at")
        .eq("device_id", device.id);
      if (progressError) throw progressError;
      const progress = new Map((progressRows || []).map((row) => [row.book_id, row]));
      return json({ books: (rows || []).map((row) => ({ ...row, progress: progress.get(row.id) || null })) });
    }

    if (action === "get_book") {
      const device = await deviceFor(supabase, body.device_token);
      const { data: row, error } = await supabase
        .from("leaf_books")
        .select("id, title, author, content, created_at")
        .eq("id", String(body.book_id || ""))
        .eq("device_id", device.id)
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Book not found" }, 404);
      const { data: progress } = await supabase
        .from("leaf_progress")
        .select("chapter_index, anchor, font_size, updated_at")
        .eq("device_id", device.id)
        .eq("book_id", row.id)
        .maybeSingle();
      return json({
        book: {
          id: row.id,
          title: row.title,
          author: row.author,
          chapters: row.content.chapters,
          created_at: row.created_at,
          progress: progress || null,
        },
      });
    }

    if (action === "save_progress") {
      const device = await deviceFor(supabase, body.device_token);
      const bookId = String(body.book_id || "");
      const { data: owned } = await supabase
        .from("leaf_books")
        .select("id")
        .eq("id", bookId)
        .eq("device_id", device.id)
        .maybeSingle();
      if (!owned) return json({ error: "Book not found" }, 404);
      const progress = body.progress || {};
      const row = {
        device_id: device.id,
        book_id: bookId,
        chapter_index: Math.max(0, Math.floor(Number(progress.chapter_index) || 0)),
        anchor: Math.max(0, Math.floor(Number(progress.anchor) || 0)),
        font_size: Math.max(18, Math.min(44, Math.floor(Number(progress.font_size) || 28))),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("leaf_progress").upsert(row, { onConflict: "device_id,book_id" });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown Leaf action" }, 400);
  } catch (error) {
    console.error("Leaf function error", error);
    const message = error instanceof Error ? error.message : "Leaf service error";
    return json({ error: message }, 500);
  }
});
