import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

async function main() {
  console.log('🎯 Migrating Goals and Tasks...')
  
  // Define map of files to parse
  const goalFiles = [
    { path: 'GOALS.md', owner: 'rocket' },
    // Add other known GOALS.md paths here if found
    { path: 'ric-flare/GOALS.md', owner: 'ric-flare' },
  ]

  for (const fileDef of goalFiles) {
    const filePath = path.resolve(process.cwd(), '../../../', fileDef.path)
    
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`)
        continue
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const agentId = fileDef.owner

    // Parse Goal Blocks (## 🟡 G-001: Title)
    // Regex logic: Find a header, then capture everything until the next header
    const sections = content.split(/^## /gm).slice(1)

    for (const section of sections) {
        const lines = section.split('\n')
        const header = lines[0].trim()
        
        // Parse Header: "🟡 G-001: The Factory (Empire Scaling)"
        const headerMatch = header.match(/^(🟢|🟡|⚪|🔴) (G-\d+): (.*)$/)
        if (!headerMatch) continue

        const statusIcon = headerMatch[1]
        const localId = headerMatch[2] // G-001
        const title = headerMatch[3].trim()
        
        // **Generate Unique ID**: agentId + localId (e.g., rocket-G-001)
        // This solves the conflict issue.
        const uniqueGoalId = `${agentId}-${localId}`.toLowerCase()
        
        // Map Status
        const statusMap: Record<string, string> = { '🟢': 'complete', '🟡': 'in_progress', '⚪': 'queued', '🔴': 'blocked' }
        const status = statusMap[statusIcon] || 'queued'

        // Upsert Goal
        await prisma.goal.upsert({
            where: { id: uniqueGoalId },
            update: { title, status, ownerAgentId: agentId },
            create: { id: uniqueGoalId, title, status, ownerAgentId: agentId }
        })
        console.log(`  Goal: ${uniqueGoalId}`)

        // Parse Tasks ( - [ ] Task Name)
        const taskRegex = /- \[(x| )\] (.*)/g
        let taskMatch
        
        while ((taskMatch = taskRegex.exec(section)) !== null) {
            const isChecked = taskMatch[1] === 'x'
            const taskTitle = taskMatch[2].trim()
            const taskStatus = isChecked ? 'done' : 'todo'
            
            // Deduplication: Simple hash or title match?
            // Let's create a deterministic ID based on goal + title hash to avoid duplicates on re-run
            // Or just check if exists connected to this goal
            
            // Simple approach: Check if task with same title exists under this goal
            const existingTask = await prisma.task.findFirst({
                where: {
                    goalId: uniqueGoalId,
                    title: taskTitle
                }
            })

            if (existingTask) {
                await prisma.task.update({
                    where: { id: existingTask.id },
                    data: { status: taskStatus }
                })
            } else {
                await prisma.task.create({
                    data: {
                        title: taskTitle,
                        status: taskStatus,
                        goalId: uniqueGoalId,
                        assigneeId: agentId, // Default assign to goal owner
                        priority: 'medium'
                    }
                })
                console.log(`    Task: ${taskTitle}`)
            }
        }
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
