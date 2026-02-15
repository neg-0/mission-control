import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

async function main() {
  console.log('💡 Migrating PRDs...')
  
  const ideasDir = path.resolve(process.cwd(), '../../../projects/ideas')
  if (!fs.existsSync(ideasDir)) {
    console.error('Ideas directory not found!')
    process.exit(1)
  }

  // Find all IDEA-* folders
  const ideaFolders = fs.readdirSync(ideasDir).filter(f => f.startsWith('IDEA-'))
  
  for (const folder of ideaFolders) {
    const prdPath = path.join(ideasDir, folder, 'PRD.md')
    const ideaJsonPath = path.join(ideasDir, folder, 'idea.json')
    
    // 1. Extract Description from PRD.md
    let description = null
    let features: any = null
    let techStack: any = null
    
    if (fs.existsSync(prdPath)) {
      const content = fs.readFileSync(prdPath, 'utf-8')
      
      // Parse BLUF / Intro
      const blufMatch = content.match(/## (?:BLUF|Mission|Objective)\n([\s\S]*?)(?=\n##|$)/i)
      if (blufMatch) description = blufMatch[1].trim()
      
      // Parse Tech Stack
      const stackMatch = content.match(/## (?:Tech Stack|Technology)\n([\s\S]*?)(?=\n##|$)/i)
      if (stackMatch) techStack = stackMatch[1].split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/-\s*/, '').trim())
    }
    
    // 2. Extract Structured Data from idea.json
    if (fs.existsSync(ideaJsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(ideaJsonPath, 'utf-8'))
            if (data.description && !description) description = data.description
            if (data.features) features = data.features
        } catch (e) {
            console.warn(`Failed to parse ${ideaJsonPath}`)
        }
    }

    // 3. Update DB
    // Get ID from folder name "IDEA-005-anti-cpq" -> "IDEA-005"
    const id = folder.split('-').slice(0, 2).join('-')
    
    // Check if exists
    const project = await prisma.project.findUnique({ where: { id } })
    if (project) {
        await prisma.project.update({
            where: { id },
            data: {
                description,
                techStack: techStack ? JSON.stringify(techStack) : undefined,
                features: features ? JSON.stringify(features) : undefined
            }
        })
        console.log(`  ✅ Updated Project: ${id}`)
    } else {
        console.warn(`  ⚠️ Project ${id} not found in DB (Check AGENTS.md seed)`)
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
