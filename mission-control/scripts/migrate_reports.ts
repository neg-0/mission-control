import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

async function main() {
  console.log('📜 Migrating Reports...')
  
  const reportsDir = path.resolve(process.cwd(), '../../../projects/ai-army/reports')
  if (!fs.existsSync(reportsDir)) {
    console.error('Reports directory not found!')
    process.exit(1)
  }

  const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.md'))
  
  for (const file of files) {
    // Format: YYYY-MM-DD-agent.md or YYYY-MM-DD-briefing.md
    const content = fs.readFileSync(path.join(reportsDir, file), 'utf-8')
    
    // Parse Date
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/)
    const date = dateMatch ? new Date(dateMatch[1]) : new Date()
    
    // Parse Agent (Simplistic)
    let agentId = 'rocket' // Default owner of briefings
    if (file.includes('captain')) agentId = 'captain'
    if (file.includes('warden')) agentId = 'warden'
    if (file.includes('sarge')) agentId = 'sarge'
    
    // Extract Blockers
    const blockerMatch = content.match(/## (?:⚠️|🚧) (?:Alerts & )?Blockers(?: \/ Risks)?\n([\s\S]*?)(?=\n##|$)/i)
    const blockers = blockerMatch ? blockerMatch[1].trim() : null
    
    // Extract Status/Focus
    const statusMatch = content.match(/\*\*Status:\*\* (.*)/)
    const focus = statusMatch ? statusMatch[1].trim() : null

    // Ensure Agent Exists (or fallback to rocket)
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) {
        console.warn(`Agent ${agentId} not found, skipping report ${file}`)
        continue
    }

    await prisma.report.create({
      data: {
        agentId,
        date,
        focus,
        blockers,
        rawContent: content
      }
    })
    
    console.log(`  ✅ Migrated: ${file}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
