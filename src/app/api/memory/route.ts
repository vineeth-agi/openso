import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/lib/insforge/server";
import { listDocuments } from "@/lib/memory/documents";
import { getAllEntities, getAllRelationships } from "@/lib/memory/graph-store";
import { getAgentActivities } from "@/lib/memory/notifications";
import { getProfile } from "@/lib/memory/profile";
import { getAllFacts, deleteFact, getFactsByCategory } from "@/lib/memory/store";

export async function GET(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view"); // "all" | "category" | "profile" | "documents" | "entities" | "relationships" | "graph" | "activities"
  const category = searchParams.get("category");

  if (view === "profile") {
    const profile = await getProfile(user.id);
    return NextResponse.json({ profile });
  }

  if (view === "documents") {
    const source = searchParams.get("source") ?? undefined;
    const docs = await listDocuments(user.id, source);
    return NextResponse.json({ documents: docs });
  }

  if (view === "category" && category) {
    const facts = await getFactsByCategory(user.id, category);
    return NextResponse.json({ facts });
  }

  if (view === "entities") {
    const entities = await getAllEntities(user.id);
    return NextResponse.json({ entities });
  }

  if (view === "relationships") {
    const relationships = await getAllRelationships(user.id);
    return NextResponse.json({ relationships });
  }

  if (view === "graph") {
    const [entities, relationships] = await Promise.all([
      getAllEntities(user.id),
      getAllRelationships(user.id),
    ]);
    return NextResponse.json({ entities, relationships });
  }

  if (view === "activities") {
    const limit = Number(searchParams.get("limit") ?? "20");
    const activityType = searchParams.get("type") ?? undefined;
    const activities = await getAgentActivities(user.id, { limit, activityType });
    return NextResponse.json({ activities });
  }

  // Default: all facts (for Memory Brain)
  const facts = await getAllFacts(user.id);
  return NextResponse.json({ facts });
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  const { factId } = await req.json();
  if (!factId) {
    return NextResponse.json({ error: "factId required" }, { status: 400 });
  }

  const success = await deleteFact(factId, user.id);
  return NextResponse.json({ success });
}
