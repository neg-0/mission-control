import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

// Status Mappings
const STATUS_MAP: Record<string, string> = {
  '🟢': 'complete',
  '🟡': 'in_progress',
  '⚪': 'queued',
  'launched': 'launched',
  'beta': 'beta',
  'building': 'building',
  'validation': 'validation',
  'research_complete': 'research',
}

async function main() {
  console.log('🌱 Starting seed...')
  
  // 1. Parse AGENTS.md
  console.log('Parsing AGENTS.md...')
  const agentsPath = '/home/neg0/.openclaw/workspace-rocket/AGENTS.md'
  const agentsContent = fs.readFileSync(agentsPath, 'utf-8')
  
  // Regex to match "## 🚀 Rocket (Operator / COO)" and subsequent bullets
  const agentSections = agentsContent.split(/^## /m).slice(1)
  
  for (const section of agentSections) {
    const lines = section.split('\n')
    const header = lines[0].trim() // "Rocket (Operator / COO)"
    
    const idMatch = section.match(/- \*\*ID:\*\* `(.*?)`/)
    const workspaceMatch = section.match(/- \*\*Workspace:\*\* `(.*?)`/)
    const roleMatch = section.match(/- \*\*Role:\*\* (.*)/)

    if (idMatch && workspaceMatch) {
      const id = idMatch[1]
      const workspace = workspaceMatch[1]
      const role = roleMatch ? roleMatch[1] : header.split('(')[1]?.replace(')', '') || 'Agent'
      
      await prisma.agent.upsert({
        where: { id },
        update: { workspacePath: workspace, role, status: 'active' },
        create: { id, workspacePath: workspace, role, status: 'active' }
      })
      console.log(`  Processed Agent: ${id}`)
    }
  }

  // 2. Parse GOALS.md
  console.log('Parsing GOALS.md...')
  const goalsPath = path.resolve(process.cwd(), '../../../GOALS.md')
  const goalsContent = fs.readFileSync(goalsPath, 'utf-8')
  
  // Regex for "## 🟡 G-001: The Factory"
  const goalRegex = /^## (🟢|🟡|⚪) (G-\d+): (.*)$/gm
  let match
  
  // We need to iterate carefully to find status
  // Actually, split by "## " is safer to capture the block
  const goalSections = goalsContent.split(/^## /m).slice(1)
  
  for (const section of goalSections) {
    const firstLine = section.split('\n')[0].trim()
    // format: "🟡 G-001: The Factory (Empire Scaling)"
    const parts = firstLine.match(/^(🟢|🟡|⚪) (G-\d+): (.*)$/)
    
    if (parts) {
      const icon = parts[1]
      const id = parts[2]
      const title = parts[3]
      const status = STATUS_MAP[icon] || 'queued'
      
      // Attempt to find owner
      const ownerMatch = section.match(/\*\*Owner:\*\* (.*)/)
      const ownerId = ownerMatch ? ownerMatch[1].toLowerCase() : 'rocket' 
      // simple heuristic: map "Rocket" -> "rocket"
      
      await prisma.goal.upsert({
        where: { id },
        update: { title, status, ownerAgentId: ownerId },
        create: { id, title, status, ownerAgentId: ownerId }
      })
      console.log(`  Processed Goal: ${id}`)
    }
  }

  // 3. Parse PIPELINE.md (Project Ideas)
  console.log('Parsing PIPELINE.md...')
  const pipelinePath = path.resolve(process.cwd(), '../../../projects/ideas/PIPELINE.md')
  const pipelineContent = fs.readFileSync(pipelinePath, 'utf-8')
  
  // Simple table parsing
  // | **IDEA-006** | **Chocks (Sarge)** | **85.0** | 🟡 beta | MVP Polish |
  const tableLines = pipelineContent.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---'))
  
  for (const line of tableLines) {
    // skip header
    if (line.includes('Next Step')) continue
    
    const cols = line.split('|').map(c => c.trim()).filter(c => c)
    if (cols.length < 5) continue
    
    // col[0]: **IDEA-006**
    const id = cols[0].replace(/\*\*/g, '')
    // col[1]: **Chocks (Sarge)**
    const nameRaw = cols[1].replace(/\*\*/g, '')
    const nameMatch = nameRaw.match(/(.*) \((.*)\)/)
    const name = nameMatch ? nameMatch[1] : nameRaw
    const ownerName = nameMatch ? nameMatch[2].toLowerCase() : null
    
    // col[2]: **85.0**
    const score = parseFloat(cols[2].replace(/\*\*/g, ''))
    
    // col[3]: 🟡 beta
    const statusRaw = cols[3].split(' ').pop() || 'validation' // take last word "beta"
    const stage = STATUS_MAP[statusRaw] || statusRaw
    
    // Map owner name "Sarge" -> "sarge"
    // We try to match existing agents
    let ownerId = null
    if (ownerName) {
        // Try exact match or lowercase
        const agents = await prisma.agent.findMany()
        const found = agents.find(a => a.id.toLowerCase() === ownerName.toLowerCase())
        if (found) ownerId = found.id
    }

    // Determine DB Provider
    let dbProvider = 'none'
    if (name.toLowerCase().includes('chocks')) dbProvider = 'railway'
    else if (stage === 'launched' || stage === 'beta') dbProvider = 'supabase' // default for active ones unless specified
    
    // Hardcode knowns based on user input
    if (name.includes('SJA')) dbProvider = 'supabase'
    if (name.includes('GlassWall')) dbProvider = 'supabase'
    if (name.includes('Anti-CPQ')) dbProvider = 'supabase' // (paused but was supabase)
    
    const dbActive = (dbProvider === 'supabase' && (stage === 'beta' || stage === 'launched'))
    
    await prisma.project.upsert({
      where: { id },
      update: { 
        name, 
        stage, 
        score, 
        ownerAgentId: ownerId,
        dbProvider,
        dbActive
      },
      create: { 
        id, 
        name, 
        stage, 
        score, 
        ownerAgentId: ownerId,
        dbProvider,
        dbActive
      }
    })
    console.log(`  Processed Project: ${id} (${name})`)
  }
  
  // 4. Create Infra Resources (Hardcoded for now based on directive)
  console.log('Seeding Infra Resources...')
  
  // Supabase Limit
  await prisma.infraResource.createMany({
    data: [
      { type: 'supabase_project', name: 'Supabase Slot 1', status: 'claimed', projectId: 'IDEA-007' }, // SJA
      { type: 'supabase_project', name: 'Supabase Slot 2', status: 'claimed', projectId: 'IDEA-001' }, // GlassWall
    ],
    skipDuplicates: true
  })

  console.log('✅ Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
