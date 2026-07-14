import { NextResponse } from "next/server";
import { storageDiagnostics } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Blob 연결 상태 확인 (토큰 값 자체는 노출하지 않음) */
export async function GET() {
  return NextResponse.json(storageDiagnostics());
}
