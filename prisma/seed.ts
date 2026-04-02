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
  const openclawHome = process.env.OPENCLAW_HOME;
  if (!openclawHome) throw new Error('OPENCLAW_HOME environment variable is not set');

  console.log('🌱 Starting seed...')

  // 1. Parse AGENTS.md
  console.log('Parsing AGENTS.md...')
  const agentsPath = path.join(openclawHome, 'workspace-rocket', 'AGENTS.md')
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

  // 5. Seed Fleet Authority Roles
  console.log('Seeding Fleet Authority Roles...')

  const roles = [
    {
      name: 'ceo',
      scope: 'project',
      singleton: false,
      capabilities: {
        deploy: 'execute',
        code_write: 'execute',
        schema: 'execute',
        credentials: 'read_only',
        purchase: 'request_only',
        bash_exec: 'execute',
        file_write: 'execute',
      },
      boundaries: undefined,
      description: 'Project CEO — full autonomy within their project scope',
    },
    {
      name: 'organizer',
      scope: 'fleet',
      singleton: false,
      capabilities: {
        credentials: 'admin',
        deploy: 'none',
        code_write: 'none',
        purchase: 'request_only',
        delegation: 'execute',
      },
      boundaries: undefined,
      description: 'Fleet organizer — manages credentials and coordinates agents',
    },
    {
      name: 'purchasing',
      scope: 'fleet',
      singleton: true,
      capabilities: {
        purchase: 'execute',
        deploy: 'none',
        code_write: 'none',
        credentials: 'none',
      },
      boundaries: undefined,
      description: 'Purchasing agent — singleton, handles all procurement',
    },
    {
      name: 'frontend-dev',
      scope: 'project',
      singleton: false,
      capabilities: {
        deploy: 'request_only',
        code_write: 'execute',
        schema: 'none',
        bash_exec: 'execute',
        file_write: 'execute',
      },
      boundaries: {
        forbiddenDirs: ['prisma/', 'src/lib/agent-runtime/', '.env'],
      },
      description: 'Frontend developer — can write code but not DB schema or runtime',
    },
    {
      name: 'qa',
      scope: 'project',
      singleton: false,
      capabilities: {
        deploy: 'none',
        code_write: 'execute',
        schema: 'none',
        bash_exec: 'execute',
        file_write: 'execute',
      },
      boundaries: {
        allowedDirs: ['src/__tests__/', 'e2e/', 'tests/'],
      },
      description: 'QA agent — can write tests but not production code',
    },
  ]

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { ...role },
      create: { ...role },
    })
    console.log(`  Seeded Role: ${role.name}`)
  }

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
