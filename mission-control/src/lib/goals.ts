// Goals parser — CEO Protocol
// Block-based parsing of GOALS.md with full round-trip support.
// The Markdown file IS the database.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoalBlock {
  /** Verbatim text of this goal block (everything from ## header to next ## or EOF) */
  rawContent: string;
  /** Parsed fields — derived from rawContent */
  id: string;
  title: string;
  statusEmoji: '🟢' | '🟡' | '🔴' | '⚪';
  statusText: string;
  owner: string;
  created: string;
  completed?: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  blockers: string[];
}

/** Legacy compat — some components use this shape */
export interface Goal {
  id: string;
  title: string;
  status: '🟢' | '🟡' | '🔴' | '⚪';
  progress: number;
  owner: string;
  blockers: string[];
  created?: string;
  completed?: string;
  priority: number;
}

export interface BlockingItem {
  id: string;
  description: string;
  action: string;
  link?: string;
  goalId?: string;
}

/** Result of splitting a GOALS.md file */
export interface GoalsFile {
  /** Everything before the first goal block (Prime Directive, How This Works, etc.) */
  header: string;
  /** Ordered list of goal blocks */
  goals: GoalBlock[];
  /** Everything after the last goal block (Recurring Tasks, Archive, etc.) */
  footer: string;
}

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export interface ValidationError {
  goalId?: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export class GoalsValidationError extends Error {
  validation: ValidationResult;
  constructor(message: string, validation: ValidationResult) {
    super(message);
    this.name = 'GoalsValidationError';
    this.validation = validation;
  }
}

// ---------------------------------------------------------------------------
// Regex patterns (from Goal System API Spec)
// ---------------------------------------------------------------------------

/** Matches a goal header: ## {EMOJI} G-{NNN}: {TITLE} */
const HEADER_RE = /^## (🟢|🟡|🔴|⚪) (G-\d+): (.+)$/m;

/** Matches Owner field */
const OWNER_RE = /^\*\*Owner:\*\* (.+)$/m;

/** Matches Created date */
const CREATED_RE = /^\*\*Created:\*\* (\d{4}-\d{2}-\d{2})$/m;

/** Matches Completed date */
const COMPLETED_RE = /^\*\*Completed:\*\* (.+)$/m;

/** Matches Status field: **Status:** {EMOJI} {TEXT} */
const STATUS_RE = /^\*\*Status:\*\* (🟢|🟡|🔴|⚪) (.+)$/m;

/** Matches any task checkbox */
const TASK_RE = /^- \[(x| )\] .+$/gm;

/** Matches completed task checkbox */
const DONE_TASK_RE = /^- \[x\] .+$/gm;

/** Valid goal ID pattern */
const GOAL_ID_RE = /^G-\d{3,}$/;

/** Valid date format */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valid status emojis */
const VALID_EMOJIS = new Set(['🟢', '🟡', '🔴', '⚪']);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Split a GOALS.md file into header, goal blocks, and footer.
 * Each block is split at `## ` boundaries. Only blocks whose header
 * matches the goal pattern (## {emoji} G-NNN: Title) become goal blocks.
 * Everything else becomes header (before goals) or footer (after goals).
 */
export function splitGoalBlocks(content: string): GoalsFile {
  // Split on both H1 and H2 headers to correctly separate
  // header/footer sections (e.g. "# Recurring Tasks") from goal blocks
  const blockSplitRe = /(?=^#{1,2} )/gm;
  const rawBlocks = content.split(blockSplitRe);

  let header = '';
  const goals: GoalBlock[] = [];
  let footer = '';
  let foundFirstGoal = false;

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const headerMatch = HEADER_RE.exec(trimmed);

    if (headerMatch) {
      foundFirstGoal = true;
      goals.push(parseGoalBlock(block));
    } else if (!foundFirstGoal) {
      header += block;
    } else {
      footer += block;
    }
  }

  return { header, goals, footer };
}

/**
 * Parse a single goal block's rawContent into structured fields.
 */
export function parseGoalBlock(rawContent: string): GoalBlock {
  const headerMatch = HEADER_RE.exec(rawContent);
  if (!headerMatch) {
    throw new Error(`Not a valid goal block: missing header. Content starts with: "${rawContent.slice(0, 60)}..."`);
  }

  const [, emoji, id, title] = headerMatch;
  const statusEmoji = emoji as GoalBlock['statusEmoji'];

  const ownerMatch = OWNER_RE.exec(rawContent);
  const createdMatch = CREATED_RE.exec(rawContent);
  const completedMatch = COMPLETED_RE.exec(rawContent);
  const statusMatch = STATUS_RE.exec(rawContent);

  const allTasks = rawContent.match(TASK_RE) || [];
  const doneTasks = rawContent.match(DONE_TASK_RE) || [];
  const totalTasks = allTasks.length;
  const completedTasks = doneTasks.length;

  let progress = 0;
  if (totalTasks > 0) {
    progress = Math.round((completedTasks / totalTasks) * 100);
  } else if (statusEmoji === '🟢') {
    progress = 100;
  }

  const blockers: string[] = [];
  const blockerSection = rawContent.match(/### Blockers?\n([\s\S]*?)(?=\n###|\n## |$)/);
  if (blockerSection) {
    const blockerLines = blockerSection[1].match(/^- .+$/gm);
    if (blockerLines) {
      blockers.push(...blockerLines.map(b => b.replace(/^- /, '')));
    }
  }

  return {
    rawContent,
    id,
    title: title.trim(),
    statusEmoji,
    statusText: statusMatch?.[2] || '',
    owner: ownerMatch?.[1] || 'Unknown',
    created: createdMatch?.[1] || '',
    completed: completedMatch?.[1],
    progress,
    totalTasks,
    completedTasks,
    blockers,
  };
}

/**
 * Reassemble a GOALS.md file from header, goals, and footer.
 * Goal blocks are joined with `---\n\n` separators.
 * Preserves rawContent verbatim — only the order changes.
 */
export function joinBlocks(file: GoalsFile): string {
  const parts: string[] = [];

  if (file.header.trim()) {
    parts.push(file.header.trimEnd());
    parts.push(''); // blank line
  }

  for (const goal of file.goals) {
    let block = goal.rawContent.trimEnd();
    if (!block.endsWith('---')) {
      block += '\n\n---';
    }
    parts.push(block);
    parts.push(''); // blank line
  }

  if (file.footer.trim()) {
    parts.push(file.footer.trimStart());
  }

  return parts.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single goal block for structural correctness.
 * Returns an array of errors/warnings.
 */
export function validateGoalBlock(block: GoalBlock): ValidationError[] {
  const errs: ValidationError[] = [];
  const ctx = { goalId: block.id };

  // 1. Valid header in raw content
  if (!HEADER_RE.test(block.rawContent)) {
    errs.push({
      ...ctx, field: 'header', severity: 'error',
      message: 'Goal block missing valid header. Expected: ## {emoji} G-NNN: {title}'
    });
  }

  // 2. ID format
  if (!GOAL_ID_RE.test(block.id)) {
    errs.push({
      ...ctx, field: 'id', severity: 'error',
      message: `Invalid goal ID "${block.id}". Must match G-NNN (e.g. G-001)`
    });
  }

  // 3. Emoji validity
  if (!VALID_EMOJIS.has(block.statusEmoji)) {
    errs.push({
      ...ctx, field: 'statusEmoji', severity: 'error',
      message: `Invalid status emoji "${block.statusEmoji}". Must be one of 🟢 🟡 🔴 ⚪`
    });
  }

  // 4. Owner required
  if (!block.owner || block.owner === 'Unknown') {
    errs.push({
      ...ctx, field: 'owner', severity: 'warning',
      message: 'Missing **Owner:** field'
    });
  }

  // 5. Created date
  if (!block.created) {
    errs.push({
      ...ctx, field: 'created', severity: 'warning',
      message: 'Missing **Created:** field'
    });
  } else if (!DATE_RE.test(block.created)) {
    errs.push({
      ...ctx, field: 'created', severity: 'error',
      message: `Invalid created date "${block.created}". Must be YYYY-MM-DD`
    });
  }

  // 6. Header emoji ↔ Status line emoji consistency
  const statusLineMatch = STATUS_RE.exec(block.rawContent);
  if (statusLineMatch) {
    const statusLineEmoji = statusLineMatch[1];
    if (statusLineEmoji !== block.statusEmoji) {
      errs.push({
        ...ctx, field: 'status', severity: 'error',
        message: `Status emoji mismatch: header has "${block.statusEmoji}" but **Status:** line has "${statusLineEmoji}"`
      });
    }
  } else {
    errs.push({
      ...ctx, field: 'status', severity: 'warning',
      message: 'Missing **Status:** metadata line'
    });
  }

  // 7. Task count sanity
  if (block.completedTasks > block.totalTasks) {
    errs.push({
      ...ctx, field: 'tasks', severity: 'error',
      message: `Completed tasks (${block.completedTasks}) exceeds total (${block.totalTasks})`
    });
  }

  // 8. 🟢 with unchecked tasks
  if (block.statusEmoji === '🟢' && block.totalTasks > 0 && block.completedTasks < block.totalTasks) {
    errs.push({
      ...ctx, field: 'tasks', severity: 'warning',
      message: `Marked 🟢 COMPLETE but ${block.totalTasks - block.completedTasks} tasks still unchecked`
    });
  }

  return errs;
}

/**
 * Validate a full GoalsFile for file-level integrity.
 */
export function validateGoalsFile(file: GoalsFile): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Duplicate IDs
  const ids = new Set<string>();
  for (const goal of file.goals) {
    if (ids.has(goal.id)) {
      errors.push({
        goalId: goal.id, field: 'id', severity: 'error',
        message: `Duplicate goal ID "${goal.id}"`
      });
    }
    ids.add(goal.id);
  }

  // Validate each block
  for (const goal of file.goals) {
    const blockErrors = validateGoalBlock(goal);
    for (const err of blockErrors) {
      if (err.severity === 'error') errors.push(err);
      else warnings.push(err);
    }
  }

  // Empty file
  if (file.goals.length === 0 && !file.header.trim() && !file.footer.trim()) {
    warnings.push({
      field: 'file', severity: 'warning',
      message: 'GOALS.md appears to be empty'
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate and join blocks for write-back.
 * Throws GoalsValidationError if any hard errors are found.
 * Returns the joined content and validation result (may contain warnings).
 */
export function validateAndJoin(file: GoalsFile): { content: string; validation: ValidationResult } {
  const validation = validateGoalsFile(file);
  if (!validation.valid) {
    const summary = validation.errors.map(e =>
      `[${e.goalId || 'FILE'}] ${e.field}: ${e.message}`
    ).join('\n');
    throw new GoalsValidationError(
      `Cannot write GOALS.md — ${validation.errors.length} validation error(s):\n${summary}`,
      validation
    );
  }
  return { content: joinBlocks(file), validation };
}

// ---------------------------------------------------------------------------
// Legacy helpers (used by GoalsTracker & alerts)
// ---------------------------------------------------------------------------

/** Convert GoalBlock[] to legacy Goal[] for components that need it */
export function toGoals(blocks: GoalBlock[]): Goal[] {
  return blocks.map((b, idx) => ({
    id: b.id,
    title: b.title,
    status: b.statusEmoji,
    progress: b.progress,
    owner: b.owner,
    blockers: b.blockers,
    created: b.created,
    completed: b.completed,
    priority: idx + 1,
  }));
}

/** Parse a full GOALS.md into legacy Goal[] (convenience wrapper) */
export function parseGoals(content: string): Goal[] {
  const file = splitGoalBlocks(content);
  return toGoals(file.goals);
}

/** Extract blocking items that need human attention */
export function extractBlockingItems(goals: Goal[]): BlockingItem[] {
  const items: BlockingItem[] = [];

  for (const goal of goals) {
    if (goal.status === '🟢') continue;

    for (let idx = 0; idx < goal.blockers.length; idx++) {
      const blocker = goal.blockers[idx];
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
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Block mutation helpers (for UI edits)
// ---------------------------------------------------------------------------

/**
 * Toggle a checkbox inside a goal block's rawContent.
 * `taskIndex` is the 0-based index of the task within the block.
 */
export function toggleTask(block: GoalBlock, taskIndex: number): GoalBlock {
  let idx = 0;
  const newRaw = block.rawContent.replace(/^(- \[)(x| )(\] .+)$/gm, (match, pre, check, post) => {
    if (idx === taskIndex) {
      idx++;
      const newCheck = check === 'x' ? ' ' : 'x';
      return `${pre}${newCheck}${post}`;
    }
    idx++;
    return match;
  });

  return parseGoalBlock(newRaw);
}

/**
 * Update the status emoji in a goal block's header and status line.
 */
export function updateStatus(block: GoalBlock, newEmoji: GoalBlock['statusEmoji'], newText: string): GoalBlock {
  let newRaw = block.rawContent;

  newRaw = newRaw.replace(
    /^(## )(🟢|🟡|🔴|⚪)( G-\d+:)/m,
    `$1${newEmoji}$3`
  );

  newRaw = newRaw.replace(
    /^(\*\*Status:\*\* )(🟢|🟡|🔴|⚪) .+$/m,
    `$1${newEmoji} ${newText}`
  );

  return parseGoalBlock(newRaw);
}
