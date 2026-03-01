import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

// Use global prisma instance if available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Force dynamic rendering since this route relies on searchParams
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const agentId = searchParams.get("agentId");
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    if (!agentId) {
      return NextResponse.json(
        { error: "agentId is required" },
        { status: 400 }
      );
    }

    const tasks = await prisma.task.findMany({
      where: {
        assigneeId: agentId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: limit
    });

    // Handle schema variance for MessageLog (createdAt vs timestamp)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messages: any[] = [];
    try {
        messages = await prisma.messageLog.findMany({
            where: {
                fromId: agentId
            },
            take: limit
        });
    } catch (e) {
        // Ignore if table missing
    }

    // Combine and sort
    const combined = [
        ...tasks.map(t => ({
            timestamp: t.updatedAt,
            type: 'TASK',
            message: `Task "${t.title}" is ${t.status}`,
            id: t.id
        })),
        ...messages.map(m => ({
            timestamp: m.createdAt || m.timestamp || new Date(),
            type: 'MESSAGE',
            message: `Sent to ${m.toId} [${m.channel}]: ${m.subject}`,
            id: m.id
        }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
     .slice(0, limit);

    return NextResponse.json({
      agentId,
      logs: combined
    });

  } catch (error) {
    console.error("Error fetching agent logs:", error);
    return NextResponse.json({ 
        error: "Failed to fetch logs", 
        details: String(error) 
    }, { status: 500 });
  }
}
