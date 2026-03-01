import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

async function main() {
  console.log('🧪 Migrating Ideas to The Lab...')
  
  const ideasDir = path.resolve(process.cwd(), '../../../projects/ideas')
  if (!fs.existsSync(ideasDir)) {
    console.error('Ideas directory not found!')
    process.exit(1)
  }

  // Find all IDEA-* folders
  const ideaFolders = fs.readdirSync(ideasDir).filter(f => f.startsWith('IDEA-'))
  
  for (const folder of ideaFolders) {
    const ideaJsonPath = path.join(ideasDir, folder, 'idea.json')
    const researchPath = path.join(ideasDir, folder, 'ANALYSIS.md')
    
    // Get ID from folder name "IDEA-005-anti-cpq" -> "IDEA-005"
    const id = folder.split('-').slice(0, 2).join('-')
    
    if (!fs.existsSync(ideaJsonPath)) {
        console.warn(`Skipping ${id} (No idea.json)`)
        continue
    }

    try {
        const data = JSON.parse(fs.readFileSync(ideaJsonPath, 'utf-8'))
        const researchNotes = fs.existsSync(researchPath) ? fs.readFileSync(researchPath, 'utf-8') : null
        
        // 1. Determine Status
        let status = 'new'
        if (data.status) status = data.status
        if (data.status === 'launched' || data.status === 'beta' || data.status === 'building') {
            status = 'graduated'
        }

        // 2. Upsert Idea
        await prisma.idea.upsert({
            where: { id },
            update: {
                title: data.name,
                description: data.description || data.bluf,
                source: data.source,
                status: status,
                score: data.score, // Legacy score field if present
                researchNotes
            },
            create: {
                id,
                title: data.name,
                description: data.description || data.bluf,
                source: data.source,
                status: status,
                score: data.score,
                researchNotes
            }
        })
        
        // 3. Migrate Scores to Scorecards
        if (data.scores) {
            // Delete old scores first to avoid dupes on re-run
            await prisma.scorecard.deleteMany({ where: { ideaId: id } })
            
            for (const [category, score] of Object.entries(data.scores)) {
                await prisma.scorecard.create({
                    data: {
                        ideaId: id,
                        category: category.replace(/_/g, ' '),
                        score: Number(score)
                    }
                })
            }
        }

        // 4. Link to Project (if graduated)
        // We assume Project ID matches Idea ID because of previous migrations
        if (status === 'graduated') {
            const project = await prisma.project.findUnique({ where: { id } })
            if (project) {
                await prisma.idea.update({
                    where: { id },
                    data: { projectId: id }
                })
                console.log(`  Linked Idea ${id} -> Project ${id}`)
            }
        }

        console.log(`  ✅ Processed Idea: ${id}`)

    } catch (e) {
        console.error(`  ❌ Failed to migrate ${id}:`, e)
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
