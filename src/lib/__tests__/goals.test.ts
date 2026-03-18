/**
 * Comprehensive test suite for the Goals system (CEO Protocol).
 *
 * Tests cover:
 * - Parsing (headers, metadata, tasks, blockers)
 * - Progress calculation
 * - Block splitting (header/goals/footer)
 * - Round-trip fidelity (parse → join → re-parse = identical)
 * - Mutations (toggleTask, updateStatus)
 * - Validation (structural errors, missing fields, corruption)
 * - Alerts (all 4 goal rules)
 * - Edge cases
 */

import {
  extractBlockingItems,
  GoalsFile,
  GoalsValidationError,
  joinBlocks,
  parseGoalBlock,
  parseGoals,
  splitGoalBlocks,
  toggleTask,
  toGoals,
  updateStatus,
  validateAndJoin,
  validateGoalBlock,
  validateGoalsFile
} from '../goals';

import { computeAlerts } from '../alerts';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MINIMAL_GOAL = `## 🟡 G-001: Build MVP
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS

- [ ] Task 1
- [x] Task 2
`;

const COMPLETE_GOAL = `## 🟢 G-002: Fix RLS Issues
**Owner:** Rocket
**Created:** 2026-02-01
**Completed:** 2026-02-03
**Status:** 🟢 COMPLETE

- [x] Understand RLS
- [x] Draft fix
- [x] Open PR
- [x] Tests pass
- [x] PR merged
`;

const BLOCKED_GOAL = `## 🔴 G-003: Deploy to Production
**Owner:** Captain
**Created:** 2026-02-05
**Status:** 🔴 BLOCKED

- [x] Build container
- [ ] Configure DNS
- [ ] Deploy

### Blockers
- DNS records not configured
- API key missing from vault
`;

const BACKLOG_GOAL = `## ⚪ G-004: Revenue Stream
**Owner:** Rocket
**Created:** 2026-01-01
**Status:** ⚪ BACKLOG

- [ ] Identify opportunity
- [ ] Complete work
- [ ] Receive payment
`;

const SAMPLE_FILE = `# GOALS.md - Active Objectives

---

## 🎯 PRIME DIRECTIVE: $1M MRR

**The North Star.** Build to $1,000,000 MRR.

---

## How This Works
- **Strict Format:** Do not deviate.

---

${MINIMAL_GOAL}
---

${COMPLETE_GOAL}
---

${BLOCKED_GOAL}
---

${BACKLOG_GOAL}
---

# Recurring Tasks

## 📋 CompIQ Weekly Update
**Schedule:** Wednesdays by 5pm PST
`;

// ===========================================================================
// PARSING TESTS
// ===========================================================================

describe('parseGoalBlock', () => {
  test('parses header fields correctly', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    expect(block.id).toBe('G-001');
    expect(block.title).toBe('Build MVP');
    expect(block.statusEmoji).toBe('🟡');
  });

  test('parses metadata fields', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    expect(block.owner).toBe('Rocket');
    expect(block.created).toBe('2026-02-01');
    expect(block.statusText).toBe('IN-PROGRESS');
  });

  test('parses completed date', () => {
    const block = parseGoalBlock(COMPLETE_GOAL);
    expect(block.completed).toBe('2026-02-03');
  });

  test('counts tasks correctly', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    expect(block.totalTasks).toBe(2);
    expect(block.completedTasks).toBe(1);
  });

  test('parses blockers', () => {
    const block = parseGoalBlock(BLOCKED_GOAL);
    expect(block.blockers).toHaveLength(2);
    expect(block.blockers[0]).toBe('DNS records not configured');
    expect(block.blockers[1]).toBe('API key missing from vault');
  });

  test('empty blockers for goals without blocker section', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    expect(block.blockers).toHaveLength(0);
  });

  test('preserves raw content', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    expect(block.rawContent).toBe(MINIMAL_GOAL);
  });

  test('throws on invalid block', () => {
    expect(() => parseGoalBlock('# Not a goal\nJust some text')).toThrow();
  });

  test('throws on H2 without goal pattern', () => {
    expect(() => parseGoalBlock('## Random Header\nSome content')).toThrow();
  });

  test('defaults owner to Unknown when missing', () => {
    const noOwner = `## 🟡 G-099: No Owner Goal
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS
`;
    const block = parseGoalBlock(noOwner);
    expect(block.owner).toBe('Unknown');
  });
});

// ===========================================================================
// PROGRESS CALCULATION
// ===========================================================================

describe('progress calculation', () => {
  test('calculates percentage from checked tasks', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    expect(block.progress).toBe(50); // 1/2 = 50%
  });

  test('100% when all tasks checked', () => {
    const block = parseGoalBlock(COMPLETE_GOAL);
    expect(block.progress).toBe(100); // 5/5
  });

  test('0% when no tasks checked', () => {
    const block = parseGoalBlock(BACKLOG_GOAL);
    expect(block.progress).toBe(0); // 0/3
  });

  test('🟢 with no tasks = 100%', () => {
    const noTasks = `## 🟢 G-100: Done Without Tasks
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟢 COMPLETE
`;
    const block = parseGoalBlock(noTasks);
    expect(block.progress).toBe(100);
    expect(block.totalTasks).toBe(0);
  });

  test('non-🟢 with no tasks = 0%', () => {
    const noTasks = `## 🟡 G-101: Active Without Tasks
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS
`;
    const block = parseGoalBlock(noTasks);
    expect(block.progress).toBe(0);
  });

  test('rounds correctly', () => {
    const threeOfSeven = `## 🟡 G-102: Rounding Test
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS

- [x] Done 1
- [x] Done 2
- [x] Done 3
- [ ] Todo 4
- [ ] Todo 5
- [ ] Todo 6
- [ ] Todo 7
`;
    const block = parseGoalBlock(threeOfSeven);
    expect(block.progress).toBe(43); // Math.round(3/7 * 100) = 43
  });
});

// ===========================================================================
// BLOCK SPLITTING
// ===========================================================================

describe('splitGoalBlocks', () => {
  test('separates header, goals, and footer', () => {
    const file = splitGoalBlocks(SAMPLE_FILE);
    expect(file.header).toContain('PRIME DIRECTIVE');
    expect(file.header).toContain('How This Works');
    expect(file.goals).toHaveLength(4);
    expect(file.footer).toContain('Recurring Tasks');
    expect(file.footer).toContain('CompIQ Weekly Update');
  });

  test('preserves goal order', () => {
    const file = splitGoalBlocks(SAMPLE_FILE);
    expect(file.goals[0].id).toBe('G-001');
    expect(file.goals[1].id).toBe('G-002');
    expect(file.goals[2].id).toBe('G-003');
    expect(file.goals[3].id).toBe('G-004');
  });

  test('non-goal H2 sections go to header/footer', () => {
    const file = splitGoalBlocks(SAMPLE_FILE);
    // PRIME DIRECTIVE and How This Works are H2s but not goals
    expect(file.header).toContain('🎯 PRIME DIRECTIVE');
    // CompIQ Weekly Update is after goals
    expect(file.footer).toContain('📋 CompIQ Weekly Update');
  });

  test('handles file with only goals (no header/footer)', () => {
    const goalsOnly = `${MINIMAL_GOAL}\n---\n\n${COMPLETE_GOAL}`;
    const file = splitGoalBlocks(goalsOnly);
    expect(file.header).toBe('');
    expect(file.goals).toHaveLength(2);
    expect(file.footer).toBe('');
  });

  test('handles empty content', () => {
    const file = splitGoalBlocks('');
    expect(file.header).toBe('');
    expect(file.goals).toHaveLength(0);
    expect(file.footer).toBe('');
  });

  test('handles file with only header (no goals)', () => {
    const headerOnly = '# GOALS.md\n\nSome intro text.\n';
    const file = splitGoalBlocks(headerOnly);
    expect(file.header).toContain('GOALS.md');
    expect(file.goals).toHaveLength(0);
  });
});

// ===========================================================================
// ROUND-TRIP FIDELITY
// ===========================================================================

describe('round-trip (parse → join → re-parse)', () => {
  test('goal count survives round-trip', () => {
    const file1 = splitGoalBlocks(SAMPLE_FILE);
    const joined = joinBlocks(file1);
    const file2 = splitGoalBlocks(joined);
    expect(file2.goals.length).toBe(file1.goals.length);
  });

  test('goal IDs survive round-trip', () => {
    const file1 = splitGoalBlocks(SAMPLE_FILE);
    const joined = joinBlocks(file1);
    const file2 = splitGoalBlocks(joined);
    const ids1 = file1.goals.map(g => g.id);
    const ids2 = file2.goals.map(g => g.id);
    expect(ids2).toEqual(ids1);
  });

  test('goal data survives round-trip', () => {
    const file1 = splitGoalBlocks(SAMPLE_FILE);
    const joined = joinBlocks(file1);
    const file2 = splitGoalBlocks(joined);

    for (let i = 0; i < file1.goals.length; i++) {
      expect(file2.goals[i].id).toBe(file1.goals[i].id);
      expect(file2.goals[i].title).toBe(file1.goals[i].title);
      expect(file2.goals[i].statusEmoji).toBe(file1.goals[i].statusEmoji);
      expect(file2.goals[i].progress).toBe(file1.goals[i].progress);
      expect(file2.goals[i].owner).toBe(file1.goals[i].owner);
      expect(file2.goals[i].blockers).toEqual(file1.goals[i].blockers);
    }
  });

  test('header and footer survive round-trip', () => {
    const file1 = splitGoalBlocks(SAMPLE_FILE);
    const joined = joinBlocks(file1);
    const file2 = splitGoalBlocks(joined);
    expect(file2.header).toContain('PRIME DIRECTIVE');
    expect(file2.footer).toContain('Recurring Tasks');
  });

  test('reorder survives round-trip', () => {
    const file1 = splitGoalBlocks(SAMPLE_FILE);
    // Reverse the goal order
    const reversed = { ...file1, goals: [...file1.goals].reverse() };
    const joined = joinBlocks(reversed);
    const file2 = splitGoalBlocks(joined);

    expect(file2.goals[0].id).toBe('G-004');
    expect(file2.goals[1].id).toBe('G-003');
    expect(file2.goals[2].id).toBe('G-002');
    expect(file2.goals[3].id).toBe('G-001');
  });
});

// ===========================================================================
// MUTATIONS
// ===========================================================================

describe('toggleTask', () => {
  test('checks an unchecked task', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    const toggled = toggleTask(block, 0); // Toggle first (unchecked) task
    expect(toggled.completedTasks).toBe(2); // was 1, now 2
    expect(toggled.progress).toBe(100);
    expect(toggled.rawContent).toContain('- [x] Task 1');
  });

  test('unchecks a checked task', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    const toggled = toggleTask(block, 1); // Toggle second (checked) task
    expect(toggled.completedTasks).toBe(0);
    expect(toggled.progress).toBe(0);
    expect(toggled.rawContent).toContain('- [ ] Task 2');
  });

  test('only toggles the targeted task', () => {
    const block = parseGoalBlock(BLOCKED_GOAL);
    const toggled = toggleTask(block, 1); // Toggle "Configure DNS" (unchecked)
    expect(toggled.rawContent).toContain('- [x] Build container'); // unchanged
    expect(toggled.rawContent).toContain('- [x] Configure DNS'); // toggled
    expect(toggled.rawContent).toContain('- [ ] Deploy'); // unchanged
  });

  test('preserves blockers after toggle', () => {
    const block = parseGoalBlock(BLOCKED_GOAL);
    const toggled = toggleTask(block, 1);
    expect(toggled.blockers).toHaveLength(2);
    expect(toggled.blockers[0]).toBe('DNS records not configured');
  });
});

describe('updateStatus', () => {
  test('updates header and status line', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    const updated = updateStatus(block, '🟢', 'COMPLETE');
    expect(updated.statusEmoji).toBe('🟢');
    expect(updated.statusText).toBe('COMPLETE');
    expect(updated.rawContent).toContain('## 🟢 G-001:');
    expect(updated.rawContent).toContain('**Status:** 🟢 COMPLETE');
  });

  test('preserves other fields', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    const updated = updateStatus(block, '🔴', 'BLOCKED');
    expect(updated.owner).toBe('Rocket');
    expect(updated.created).toBe('2026-02-01');
    expect(updated.totalTasks).toBe(2);
  });
});

// ===========================================================================
// VALIDATION
// ===========================================================================

describe('validateGoalBlock', () => {
  test('valid block has no errors', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    const errors = validateGoalBlock(block);
    const hardErrors = errors.filter(e => e.severity === 'error');
    expect(hardErrors).toHaveLength(0);
  });

  test('detects missing owner', () => {
    const noOwner = `## 🟡 G-050: No Owner
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS
`;
    const block = parseGoalBlock(noOwner);
    const errors = validateGoalBlock(block);
    expect(errors.some(e => e.field === 'owner')).toBe(true);
  });

  test('detects missing created date', () => {
    const noDate = `## 🟡 G-051: No Date
**Owner:** Rocket
**Status:** 🟡 IN-PROGRESS
`;
    const block = parseGoalBlock(noDate);
    const errors = validateGoalBlock(block);
    expect(errors.some(e => e.field === 'created')).toBe(true);
  });

  test('detects missing status line', () => {
    const noStatus = `## 🟡 G-052: No Status Line
**Owner:** Rocket
**Created:** 2026-02-01
`;
    const block = parseGoalBlock(noStatus);
    const errors = validateGoalBlock(block);
    expect(errors.some(e => e.field === 'status')).toBe(true);
  });

  test('detects emoji mismatch between header and status line', () => {
    const mismatch = `## 🟡 G-053: Mismatched Emoji
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟢 COMPLETE
`;
    const block = parseGoalBlock(mismatch);
    const errors = validateGoalBlock(block);
    const statusErr = errors.find(e => e.field === 'status' && e.severity === 'error');
    expect(statusErr).toBeDefined();
    expect(statusErr!.message).toContain('mismatch');
  });

  test('warns when 🟢 has unchecked tasks', () => {
    const greenUnchecked = `## 🟢 G-054: Done But Not Done
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟢 COMPLETE

- [x] Task 1
- [ ] Task 2 (forgot this one!)
`;
    const block = parseGoalBlock(greenUnchecked);
    const errors = validateGoalBlock(block);
    const taskWarn = errors.find(e => e.field === 'tasks' && e.severity === 'warning');
    expect(taskWarn).toBeDefined();
    expect(taskWarn!.message).toContain('unchecked');
  });
});

describe('validateGoalsFile', () => {
  test('valid file passes validation', () => {
    const file = splitGoalBlocks(SAMPLE_FILE);
    const result = validateGoalsFile(file);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('detects duplicate IDs', () => {
    const dupeBlock = parseGoalBlock(MINIMAL_GOAL);
    const file: GoalsFile = {
      header: '',
      goals: [dupeBlock, { ...dupeBlock }], // same ID
      footer: '',
    };
    const result = validateGoalsFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  test('empty file produces warning', () => {
    const file: GoalsFile = { header: '', goals: [], footer: '' };
    const result = validateGoalsFile(file);
    expect(result.valid).toBe(true); // no hard errors
    expect(result.warnings.some(e => e.message.includes('empty'))).toBe(true);
  });
});

describe('validateAndJoin', () => {
  test('succeeds for valid file', () => {
    const file = splitGoalBlocks(SAMPLE_FILE);
    const { content, validation } = validateAndJoin(file);
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
    expect(validation.valid).toBe(true);
  });

  test('throws GoalsValidationError for duplicate IDs', () => {
    const dupeBlock = parseGoalBlock(MINIMAL_GOAL);
    const file: GoalsFile = { header: '', goals: [dupeBlock, { ...dupeBlock }], footer: '' };
    expect(() => validateAndJoin(file)).toThrow(GoalsValidationError);
  });

  test('thrown error contains validation details', () => {
    const dupeBlock = parseGoalBlock(MINIMAL_GOAL);
    const file: GoalsFile = { header: '', goals: [dupeBlock, { ...dupeBlock }], footer: '' };
    try {
      validateAndJoin(file);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GoalsValidationError);
      const err = e as GoalsValidationError;
      expect(err.validation.errors.length).toBeGreaterThan(0);
      expect(err.message).toContain('Duplicate');
    }
  });
});

// ===========================================================================
// ALERTS
// ===========================================================================

describe('computeAlerts — goal rules', () => {
  test('blocked goal generates red alert', () => {
    const goals = toGoals([parseGoalBlock(BLOCKED_GOAL)]);
    const alerts = computeAlerts([], goals, []);
    const red = alerts.find(a => a.level === 'red' && a.source === 'goal');
    expect(red).toBeDefined();
    expect(red!.message).toContain('blocked');
  });

  test('stale active goal generates yellow alert (>5 days, <50%)', () => {
    // Fake a goal created 10 days ago with 20% progress
    const stale = `## 🟡 G-060: Stale Goal
**Owner:** Rocket
**Created:** 2025-01-01
**Status:** 🟡 IN-PROGRESS

- [x] One
- [ ] Two
- [ ] Three
- [ ] Four
- [ ] Five
`;
    const goals = toGoals([parseGoalBlock(stale)]);
    expect(goals[0].progress).toBe(20);
    const alerts = computeAlerts([], goals, []);
    const yellow = alerts.find(a => a.level === 'yellow' && a.source === 'goal');
    expect(yellow).toBeDefined();
    expect(yellow!.message).toContain('active for >5 days');
  });

  test('zombie goal generates gray alert (backlog >30 days)', () => {
    // BACKLOG_GOAL has created: 2026-01-01, which is >30 days from our test date
    const goals = toGoals([parseGoalBlock(BACKLOG_GOAL)]);
    const alerts = computeAlerts([], goals, []);
    const gray = alerts.find(a => a.level === 'gray');
    expect(gray).toBeDefined();
    expect(gray!.message).toContain('backlog');
  });

  test('quick win generates green alert (>=90% and not done)', () => {
    const quickWin = `## 🟡 G-070: Almost There
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS

- [x] Step 1
- [x] Step 2
- [x] Step 3
- [x] Step 4
- [x] Step 5
- [x] Step 6
- [x] Step 7
- [x] Step 8
- [x] Step 9
- [ ] Step 10
`;
    const goals = toGoals([parseGoalBlock(quickWin)]);
    expect(goals[0].progress).toBe(90);
    const alerts = computeAlerts([], goals, []);
    const green = alerts.find(a => a.level === 'green' && a.source === 'goal');
    expect(green).toBeDefined();
    expect(green!.message).toContain('quick win');
  });

  test('completed goal does not generate alerts', () => {
    const goals = toGoals([parseGoalBlock(COMPLETE_GOAL)]);
    const alerts = computeAlerts([], goals, []);
    // Should only have "all clear"
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('all-clear');
  });

  test('all clear when no issues', () => {
    const alerts = computeAlerts([], [], []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('green');
    expect(alerts[0].message).toBe('All clear');
  });
});

// ===========================================================================
// LEGACY COMPAT
// ===========================================================================

describe('toGoals (legacy)', () => {
  test('converts GoalBlock[] to Goal[] with priorities', () => {
    const file = splitGoalBlocks(SAMPLE_FILE);
    const goals = toGoals(file.goals);
    expect(goals).toHaveLength(4);
    expect(goals[0].priority).toBe(1);
    expect(goals[3].priority).toBe(4);
    expect(goals[0].status).toBe('🟡');
  });
});

describe('parseGoals (legacy)', () => {
  test('parses full file into Goal[]', () => {
    const goals = parseGoals(SAMPLE_FILE);
    expect(goals).toHaveLength(4);
    expect(goals.map(g => g.id)).toEqual(['G-001', 'G-002', 'G-003', 'G-004']);
  });
});

describe('extractBlockingItems', () => {
  test('extracts blockers from non-complete goals', () => {
    const goals = toGoals([parseGoalBlock(BLOCKED_GOAL)]);
    const items = extractBlockingItems(goals);
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe('DNS records not configured');
    expect(items[0].goalId).toBe('G-003');
  });

  test('ignores blockers from completed goals', () => {
    // Even if a completed goal had blockers, they shouldn't show
    const goals = toGoals([parseGoalBlock(COMPLETE_GOAL)]);
    const items = extractBlockingItems(goals);
    expect(items).toHaveLength(0);
  });

  test('detects DNS action', () => {
    const goals = toGoals([parseGoalBlock(BLOCKED_GOAL)]);
    const items = extractBlockingItems(goals);
    const dnsItem = items.find(i => i.action === 'Configure DNS');
    expect(dnsItem).toBeDefined();
  });

  test('detects API credential action', () => {
    const goals = toGoals([parseGoalBlock(BLOCKED_GOAL)]);
    const items = extractBlockingItems(goals);
    const apiItem = items.find(i => i.action === 'Get Credentials');
    expect(apiItem).toBeDefined();
  });
});

// ===========================================================================
// EDGE CASES
// ===========================================================================

describe('edge cases', () => {
  test('goal with multiline Objective section', () => {
    const multiline = `## 🟡 G-080: Complex Goal
**Objective:** This is a goal that spans
multiple lines and has lots of detail.

**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS

- [ ] Task A
`;
    const block = parseGoalBlock(multiline);
    expect(block.id).toBe('G-080');
    expect(block.title).toBe('Complex Goal');
    expect(block.totalTasks).toBe(1);
  });

  test('goal with no tasks and no status line', () => {
    const bare = `## 🟡 G-081: Bare Goal
**Owner:** Rocket
**Created:** 2026-02-01
`;
    const block = parseGoalBlock(bare);
    expect(block.totalTasks).toBe(0);
    expect(block.progress).toBe(0);
    expect(block.statusText).toBe('');
  });

  test('goal ID with large number', () => {
    const bigId = `## 🟡 G-9999: Big Number
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS
`;
    const block = parseGoalBlock(bigId);
    expect(block.id).toBe('G-9999');
  });

  test('special characters in title', () => {
    const special = `## 🟡 G-082: Build $1M ARR — "The Dream"
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS
`;
    const block = parseGoalBlock(special);
    expect(block.title).toBe('Build $1M ARR — "The Dream"');
  });

  test('preserves comments and notes inside blocks', () => {
    const withComments = `## 🟡 G-083: Goal With Notes
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS

Some internal notes here that should be preserved.
<!-- Hidden comment -->

- [ ] Task 1
`;
    const block = parseGoalBlock(withComments);
    const file: GoalsFile = { header: '', goals: [block], footer: '' };
    const joined = joinBlocks(file);
    expect(joined).toContain('Some internal notes');
    expect(joined).toContain('<!-- Hidden comment -->');
  });

  test('handles Windows line endings (CRLF)', () => {
    const crlf = '## 🟡 G-084: CRLF Goal\r\n**Owner:** Rocket\r\n**Created:** 2026-02-01\r\n**Status:** 🟡 IN-PROGRESS\r\n\r\n- [x] Task 1\r\n- [ ] Task 2\r\n';
    const block = parseGoalBlock(crlf);
    expect(block.id).toBe('G-084');
    expect(block.totalTasks).toBe(2);
    expect(block.completedTasks).toBe(1);
  });
});

// ===========================================================================
// PR ALERTS (covers alerts.ts lines 47-59)
// ===========================================================================

describe('computeAlerts — PR rules', () => {
  test('PR with failed CI >24h generates red alert', () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    const alerts = computeAlerts(
      [{ id: 42, title: 'Fix bug', ci: 'failed', reviewState: 'pending', updatedAt: oldDate }],
      [], []
    );
    const red = alerts.find(a => a.level === 'red' && a.source === 'pr');
    expect(red).toBeDefined();
    expect(red!.message).toContain('PR #42');
    expect(red!.message).toContain('failing CI');
  });

  test('PR with failed CI <24h does NOT generate alert', () => {
    const freshDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    const alerts = computeAlerts(
      [{ id: 10, title: 'Fresh fail', ci: 'failed', reviewState: 'approved', updatedAt: freshDate }],
      [], []
    );
    const red = alerts.find(a => a.level === 'red' && a.source === 'pr');
    expect(red).toBeUndefined();
  });

  test('PR pending review >48h generates yellow alert', () => {
    const oldDate = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(); // 49h ago
    const alerts = computeAlerts(
      [{ id: 55, title: 'Needs review', ci: 'passing', reviewState: 'pending', updatedAt: oldDate }],
      [], []
    );
    const yellow = alerts.find(a => a.level === 'yellow' && a.source === 'pr');
    expect(yellow).toBeDefined();
    expect(yellow!.message).toContain('PR #55');
    expect(yellow!.message).toContain('needs review');
  });

  test('PR pending review <48h does NOT generate alert', () => {
    const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24h ago
    const alerts = computeAlerts(
      [{ id: 11, title: 'Recent', ci: 'passing', reviewState: 'pending', updatedAt: recentDate }],
      [], []
    );
    const yellow = alerts.find(a => a.level === 'yellow' && a.source === 'pr');
    expect(yellow).toBeUndefined();
  });

  test('PR with passing CI and approved review generates no alerts', () => {
    const alerts = computeAlerts(
      [{ id: 12, title: 'All good', ci: 'passing', reviewState: 'approved', updatedAt: new Date().toISOString() }],
      [], []
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('all-clear');
  });

  test('PR without updatedAt generates no time-based alerts', () => {
    const alerts = computeAlerts(
      [{ id: 13, title: 'No date', ci: 'failed', reviewState: 'pending' }],
      [], []
    );
    // No time-based alerts since prAge is null
    const prAlerts = alerts.filter(a => a.source === 'pr');
    expect(prAlerts).toHaveLength(0);
  });
});

// ===========================================================================
// AGENT ALERTS (covers alerts.ts lines 119-120)
// ===========================================================================

describe('computeAlerts — agent rules', () => {
  test('failed agent with label generates red alert with label', () => {
    const alerts = computeAlerts([], [], [
      { id: 'agent-1', status: 'failed', label: 'Code Review Bot' }
    ]);
    const red = alerts.find(a => a.level === 'red' && a.source === 'agent');
    expect(red).toBeDefined();
    expect(red!.message).toContain('Code Review Bot');
  });

  test('failed agent without label uses ID in message', () => {
    const alerts = computeAlerts([], [], [
      { id: 'agent-2', status: 'failed' }
    ]);
    const red = alerts.find(a => a.level === 'red' && a.source === 'agent');
    expect(red).toBeDefined();
    expect(red!.message).toContain('agent-2');
  });

  test('non-failed agent generates no alerts', () => {
    const alerts = computeAlerts([], [], [
      { id: 'agent-3', status: 'running' },
      { id: 'agent-4', status: 'completed' },
      { id: 'agent-5', status: 'idle' },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('all-clear');
  });

  test('multiple failed agents generate multiple alerts', () => {
    const alerts = computeAlerts([], [], [
      { id: 'a1', status: 'failed', label: 'Bot A' },
      { id: 'a2', status: 'failed', label: 'Bot B' },
    ]);
    const reds = alerts.filter(a => a.level === 'red' && a.source === 'agent');
    expect(reds).toHaveLength(2);
  });
});

// ===========================================================================
// VALIDATION — additional coverage (goals.ts uncovered lines)
// ===========================================================================

describe('validateGoalBlock — additional coverage', () => {
  test('detects invalid ID format (missing leading zeros)', () => {
    // Create a block manually with an invalid ID to bypass parseGoalBlock header check
    const block = parseGoalBlock(`## 🟡 G-001: Valid Header
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🟡 IN-PROGRESS
`);
    // Manually override the ID to test validation
    const invalidIdBlock = { ...block, id: 'GOAL-1' };
    const errors = validateGoalBlock(invalidIdBlock);
    const idError = errors.find(e => e.field === 'id' && e.severity === 'error');
    expect(idError).toBeDefined();
    expect(idError!.message).toContain('Invalid goal ID');
  });

  test('detects invalid emoji', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    // Manually override emoji to test validation branch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalidEmojiBlock = { ...block, statusEmoji: '🔵' as any };
    const errors = validateGoalBlock(invalidEmojiBlock);
    const emojiError = errors.find(e => e.field === 'statusEmoji' && e.severity === 'error');
    expect(emojiError).toBeDefined();
    expect(emojiError!.message).toContain('Invalid status emoji');
  });

  test('detects invalid date format', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    // Manually override created to test validation branch
    const invalidDateBlock = { ...block, created: '02-01-2026' };
    const errors = validateGoalBlock(invalidDateBlock);
    const dateError = errors.find(e => e.field === 'created' && e.severity === 'error');
    expect(dateError).toBeDefined();
    expect(dateError!.message).toContain('Invalid created date');
  });

  test('detects completed tasks exceeding total', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    // Manually override to test validation branch
    const badCountBlock = { ...block, completedTasks: 5, totalTasks: 2 };
    const errors = validateGoalBlock(badCountBlock);
    const taskError = errors.find(e => e.field === 'tasks' && e.severity === 'error');
    expect(taskError).toBeDefined();
    expect(taskError!.message).toContain('exceeds total');
  });

  test('detects missing header in rawContent', () => {
    const block = parseGoalBlock(MINIMAL_GOAL);
    // Manually override rawContent to remove the header
    const noHeaderBlock = { ...block, rawContent: '**Owner:** Rocket\n**Created:** 2026-02-01\n' };
    const errors = validateGoalBlock(noHeaderBlock);
    const headerError = errors.find(e => e.field === 'header' && e.severity === 'error');
    expect(headerError).toBeDefined();
    expect(headerError!.message).toContain('missing valid header');
  });
});

describe('validateGoalsFile — warnings from block validation', () => {
  test('accumulates warnings from individual blocks', () => {
    // A block with missing status line produces a warning
    const blockMissingStatus = parseGoalBlock(`## 🟡 G-055: No Status
**Owner:** Rocket
**Created:** 2026-02-01
`);
    const file: GoalsFile = { header: '', goals: [blockMissingStatus], footer: '' };
    const result = validateGoalsFile(file);
    expect(result.valid).toBe(true); // warnings only
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.field === 'status')).toBe(true);
  });
});

// ===========================================================================
// BLOCKING ITEMS — PR extraction coverage (goals.ts lines 434-435)
// ===========================================================================

describe('extractBlockingItems — PR patterns', () => {
  test('detects PR review blocker and generates link', () => {
    const goalWithPR = `## 🔴 G-090: PR Blocked
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🔴 BLOCKED

### Blockers
- Waiting on PR #123 review
`;
    const goals = toGoals([parseGoalBlock(goalWithPR)]);
    const items = extractBlockingItems(goals);
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe('Review PR');
    expect(items[0].link).toContain('/pull/123');
  });

  test('detects PR merge blocker', () => {
    const goalWithMerge = `## 🔴 G-091: Merge Blocked
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🔴 BLOCKED

### Blockers
- Need to merge PR #456
`;
    const goals = toGoals([parseGoalBlock(goalWithMerge)]);
    const items = extractBlockingItems(goals);
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe('Merge PR');
    expect(items[0].link).toContain('/pull/456');
  });

  test('generic blocker gets Review action', () => {
    const goalGeneric = `## 🔴 G-092: Generic Block
**Owner:** Rocket
**Created:** 2026-02-01
**Status:** 🔴 BLOCKED

### Blockers
- Need permission from team lead
`;
    const goals = toGoals([parseGoalBlock(goalGeneric)]);
    const items = extractBlockingItems(goals);
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe('Review');
    expect(items[0].link).toBeUndefined();
  });
});

