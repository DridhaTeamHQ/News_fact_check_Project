import { listPixPosts, pixConfigured } from "@/lib/pix";

export async function GET(request: Request) {
  if (!pixConfigured()) {
    return Response.json(
      { error: "PIX database is not connected. Add PIX_SUPABASE_URL and PIX_SUPABASE_SERVICE_ROLE_KEY to .env.local." },
      { status: 503 },
    );
  }
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json({ posts: await listPixPosts(q) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
