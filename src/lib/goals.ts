// Goals parser and manager
// Parses GOALS.md and provides structured access

export interface Goal {
  id: string;
  title: string;
  status: '🟢' | '🟡' | '🔴' | '⚪';
  progress: number;
  owner: string;
  blockers: string[];
  created?: string;
  completed?: string;
  repo?: string;
  priority: number;
}

export interface BlockingItem {
  id: string;
  description: string;
  action: string;
  link?: string;
  goalId?: string;
}

// Parse GOALS.md content into structured data
export function parseGoals(content: string): Goal[] {
  const goals: Goal[] = [];
  const goalRegex = /## (🟢|🟡|🔴|⚪) (G-\d+): (.+)/g;
  
  let match;
  let priority = 1;
  
  while ((match = goalRegex.exec(content)) !== null) {
    const [, status, id, title] = match;
    const startIndex = match.index;
    
    // Find the next goal or end of file to get this goal's content
    const nextMatch = goalRegex.exec(content);
    goalRegex.lastIndex = match.index + match[0].length; // Reset for next iteration
    const endIndex = nextMatch ? nextMatch.index : content.length;
    const goalContent = content.slice(startIndex, endIndex);
    
    // Extract details
    const ownerMatch = goalContent.match(/\*\*Owner:\*\* (.+)/);
    const createdMatch = goalContent.match(/\*\*Created:\*\* (.+)/);
    const completedMatch = goalContent.match(/\*\*Completed:\*\* (.+)/);
    const progressMatch = goalContent.match(/- \[x\]/gi);
    const totalMatch = goalContent.match(/- \[[ x]\]/gi);

    const progress = totalMatch
      ? Math.round((progressMatch?.length || 0) / totalMatch.length * 100)
      : status === '🟢' ? 100 : 0;

    // Extract blockers
    const blockers: string[] = [];
    const blockerSection = goalContent.match(/### Blockers?\n([\s\S]*?)(?=\n###|\n## |$)/);
    if (blockerSection) {
      const blockerLines = blockerSection[1].match(/- .+/g);
      if (blockerLines) {
        blockers.push(...blockerLines.map(b => b.replace(/^- /, '')));
      }
    }

    goals.push({
      id,
      title: title.trim(),
      status: status as Goal['status'],
      progress,
      owner: ownerMatch?.[1] || 'Rocket',
      blockers,
      created: createdMatch?.[1],
      completed: completedMatch?.[1],
      priority: priority++,
    });
  }
  
  return goals;
}

// Extract blocking items that need Dustin's attention
export function extractBlockingItems(goals: Goal[]): BlockingItem[] {
  const items: BlockingItem[] = [];
  
  goals.forEach(goal => {
    if (goal.status !== '🟢') {
      goal.blockers.forEach((blocker, idx) => {
        // Try to extract action links
        const prMatch = blocker.match(/PR #(\d+)/i);
        const mergeMatch = blocker.match(/merge|approve/i);
        const dnsMatch = blocker.match(/DNS|domain/i);
        const apiMatch = blocker.match(/API|key|credential/i);
        
        let link: string | undefined;
        let action = 'Review';
        
        if (prMatch) {
          link = `https://github.com/neg-0/comp-iq/pull/${prMatch[1]}`;
          action = mergeMatch ? 'Merge PR' : 'Review PR';
        } else if (dnsMatch) {
          action = 'Configure DNS';
        } else if (apiMatch) {
          action = 'Get Credentials';
        }
        
        items.push({
          id: `${goal.id}-blocker-${idx}`,
          description: blocker,
          action,
          link,
          goalId: goal.id,
        });
      });
    }
  });
  
  return items;
}

// Serialize goals back to markdown (for priority reordering)
export function serializeGoals(goals: Goal[], originalContent: string): string {
  // For now, just return original content
  // TODO: Implement proper reordering
  return originalContent;
}
