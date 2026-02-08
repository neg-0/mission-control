'use client';

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CheckSquare, ExternalLink, GripVertical, Plus, Square, Target } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  BlockingItem,
  extractBlockingItems,
  GoalBlock,
  GoalsFile,
  GoalsValidationError,
  splitGoalBlocks,
  toggleTask,
  toGoals,
  validateAndJoin,
} from '../lib/goals';
import { cn } from '../lib/utils';

interface GoalsTrackerProps {
  className?: string;
  workspace?: string | null;
}

// ---------------------------------------------------------------------------
// Sortable goal row — stable component identity (no scroll reset)
// ---------------------------------------------------------------------------
interface SortableGoalRowProps {
  block: GoalBlock;
  onSelect: (id: string) => void;
  onToggleTask: (goalId: string, taskIndex: number) => void;
  isExpanded: boolean;
}

function SortableGoalRow({ block, onSelect, onToggleTask, isExpanded }: SortableGoalRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const statusColors: Record<string, string> = {
    '🟢': 'led-green',
    '🟡': 'led-yellow led-pulse',
    '🔴': 'led-red led-pulse',
    '⚪': 'led-gray',
  };

  // Extract tasks for checkbox UI
  const tasks = [...block.rawContent.matchAll(/^- \[(x| )\] (.+)$/gm)]
    .map((m, i) => ({ index: i, done: m[1] === 'x', text: m[2] }));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'glass-card transition-all overflow-hidden',
        isDragging && 'opacity-50 shadow-lg',
        'hover:glow-blue'
      )}
    >
      {/* Main Row */}
      <div className="flex items-center gap-2 p-3">
        {/* Drag Handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded touch-none"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </button>

        {/* Status LED */}
        <div className={cn('w-2 h-2 led flex-shrink-0', statusColors[block.statusEmoji] || 'led-gray')} />

        {/* Goal Info */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(block.id)}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{block.id}</span>
            <span className="text-sm font-medium truncate">{block.title}</span>
          </div>

          {/* Progress Bar */}
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                block.progress === 100 ? 'bg-green-500' : block.progress >= 90 ? 'bg-emerald-400' : 'bg-primary'
              )}
              style={{ width: `${block.progress}%` }}
            />
          </div>
        </div>

        {/* Progress Percentage */}
        <span className={cn(
          'text-xs font-medium tabular-nums',
          block.progress === 100 ? 'text-green-400' : 'text-muted-foreground'
        )}>
          {block.progress}%
        </span>
      </div>

      {/* Expanded: Task Checklist */}
      {isExpanded && tasks.length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-1">
          <div className="text-xs text-muted-foreground mb-1">
            {block.completedTasks}/{block.totalTasks} tasks
          </div>
          {tasks.map(task => (
            <button
              key={task.index}
              onClick={() => onToggleTask(block.id, task.index)}
              className={cn(
                'flex items-center gap-2 w-full text-left text-xs py-0.5 rounded hover:bg-accent/30 px-1 transition-colors',
                task.done && 'opacity-60'
              )}
            >
              {task.done ? (
                <CheckSquare className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
              ) : (
                <Square className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <span className={cn(task.done && 'line-through')}>{task.text}</span>
            </button>
          ))}

          {/* Blockers */}
          {block.blockers.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="text-xs text-red-400 flex items-center gap-1 mb-1">
                <AlertTriangle className="w-3 h-3" /> Blockers
              </div>
              {block.blockers.map((b, i) => (
                <div key={i} className="text-xs text-muted-foreground pl-4">• {b}</div>
              ))}
            </div>
          )}

          {/* Metadata */}
          <div className="mt-2 pt-2 border-t border-border/50 flex gap-4 text-[10px] text-muted-foreground/60">
            <span>Owner: {block.owner}</span>
            {block.created && <span>Created: {block.created}</span>}
            {block.statusText && <span>Status: {block.statusText}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocking item row
// ---------------------------------------------------------------------------
function BlockingItemRow({ item }: { item: BlockingItem }) {
  return (
    <div className="flex items-center gap-2 p-2 hover:bg-accent/50 rounded-lg transition-colors">
      <span className="text-orange-400">⚠️</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{item.description}</div>
        <div className="text-xs text-muted-foreground">{item.goalId}</div>
      </div>
      {item.link ? (
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {item.action}
          <ExternalLink className="w-3 h-3" />
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">{item.action}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalsTracker
// ---------------------------------------------------------------------------
export function GoalsTracker({ className, workspace }: GoalsTrackerProps) {
  const [goalsFile, setGoalsFile] = useState<GoalsFile | null>(null);
  const [blockingItems, setBlockingItems] = useState<BlockingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGoalDraft, setNewGoalDraft] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (workspace) {
      setGoalsFile(null);
      setBlockingItems([]);
      setLoading(true);
      fetchGoals();
    }
  }, [workspace]);

  async function fetchGoals() {
    if (!workspace) return;
    try {
      const res = await fetch(`/api/files/read?path=GOALS.md&workspace=${encodeURIComponent(workspace)}`);
      if (res.ok) {
        const data = await res.json();
        const file = splitGoalBlocks(data.content);
        setGoalsFile(file);
        setBlockingItems(extractBlockingItems(toGoals(file.goals)));
      }
    } catch (e) {
      console.error('Failed to fetch goals:', e);
    } finally {
      setLoading(false);
    }
  }

  /** Write the current goalsFile state back to GOALS.md */
  const saveGoals = useCallback(async (file: GoalsFile) => {
    if (!workspace) return;
    setSaving(true);
    try {
      // Validate before writing — prevents data corruption
      const { content, validation } = validateAndJoin(file);
      if (validation.warnings.length > 0) {
        console.warn('Goals warnings:', validation.warnings);
      }
      await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'GOALS.md', content, workspace }),
      });
    } catch (e: unknown) {
      if (e instanceof GoalsValidationError) {
        console.error('Validation failed — write aborted:', (e as GoalsValidationError).validation.errors);
      } else {
        console.error('Failed to save goals:', e);
      }
    } finally {
      setSaving(false);
    }
  }, [workspace]);

  /** Handle drag-and-drop reorder — block swap strategy */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !goalsFile) return;

    const oldIndex = goalsFile.goals.findIndex(g => g.id === active.id);
    const newIndex = goalsFile.goals.findIndex(g => g.id === over.id);

    const newGoals = arrayMove(goalsFile.goals, oldIndex, newIndex);
    const newFile = { ...goalsFile, goals: newGoals };
    setGoalsFile(newFile);
    setBlockingItems(extractBlockingItems(toGoals(newGoals)));
    saveGoals(newFile);
  }

  /** Toggle a checkbox on a goal → regex replace → save */
  function handleToggleTask(goalId: string, taskIndex: number) {
    if (!goalsFile) return;

    const newGoals = goalsFile.goals.map(block => {
      if (block.id === goalId) {
        return toggleTask(block, taskIndex);
      }
      return block;
    });

    const newFile = { ...goalsFile, goals: newGoals };
    setGoalsFile(newFile);
    setBlockingItems(extractBlockingItems(toGoals(newGoals)));
    saveGoals(newFile);
  }

  /** Add a new goal from the draft modal */
  function handleAddGoal() {
    if (!newGoalDraft.trim() || !goalsFile) return;

    // Auto-assign next ID
    const maxId = goalsFile.goals.reduce((max, g) => {
      const num = parseInt(g.id.replace('G-', ''), 10);
      return num > max ? num : max;
    }, 0);
    const newId = `G-${String(maxId + 1).padStart(3, '0')}`;
    const today = new Date().toISOString().slice(0, 10);

    const newBlock = `## ⚪ ${newId}: ${newGoalDraft.trim()}
**Owner:** Rocket
**Created:** ${today}
**Status:** ⚪ BACKLOG

- [ ] Define success criteria
- [ ] Implementation

### Blockers
`;

    const { rawContent: _, ...parsed } = {
      rawContent: newBlock,
      id: newId,
      title: newGoalDraft.trim(),
      statusEmoji: '⚪' as const,
      statusText: 'BACKLOG',
      owner: 'Rocket',
      created: today,
      progress: 0,
      totalTasks: 2,
      completedTasks: 0,
      blockers: [],
    };
    const block: GoalBlock = { rawContent: newBlock, ...parsed };

    const newGoals = [...goalsFile.goals, block];
    const newFile = { ...goalsFile, goals: newGoals };
    setGoalsFile(newFile);
    setBlockingItems(extractBlockingItems(toGoals(newGoals)));
    saveGoals(newFile);
    setNewGoalDraft('');
    setShowAddModal(false);
  }

  // Categorize goals
  const activeGoals = goalsFile?.goals.filter(g => g.statusEmoji === '🟡') || [];
  const blockedGoals = goalsFile?.goals.filter(g => g.statusEmoji === '🔴') || [];
  const backlogGoals = goalsFile?.goals.filter(g => g.statusEmoji === '⚪') || [];
  const completedGoals = goalsFile?.goals.filter(g => g.statusEmoji === '🟢') || [];

  // All draggable goals (non-completed)
  const draggableGoals = goalsFile?.goals.filter(g => g.statusEmoji !== '🟢') || [];

  return (
    <div className={cn('space-y-4', className)}>
      {/* Goals Section */}
      <div className="glass-card overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Goals</h2>
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {activeGoals.length + blockedGoals.length} active
            </span>
            {saving && (
              <span className="text-xs text-primary/60 animate-pulse">saving…</span>
            )}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 text-xs bg-primary/20 text-primary px-2 py-1 rounded hover:bg-primary/30 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>

        <div className="p-2 space-y-2">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground text-center">Loading…</div>
          ) : draggableGoals.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No active goals</div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={draggableGoals.map(g => g.id)} strategy={verticalListSortingStrategy}>
                {/* Blocked goals first */}
                {blockedGoals.length > 0 && (
                  <div className="mb-1">
                    <div className="text-[10px] uppercase tracking-wider text-red-400/70 px-1 mb-1">🔴 Blocked</div>
                    {blockedGoals.map(block => (
                      <SortableGoalRow
                        key={block.id}
                        block={block}
                        onSelect={id => setExpandedGoalId(expandedGoalId === id ? null : id)}
                        onToggleTask={handleToggleTask}
                        isExpanded={expandedGoalId === block.id}
                      />
                    ))}
                  </div>
                )}

                {/* Active goals */}
                {activeGoals.length > 0 && (
                  <div className="mb-1">
                    <div className="text-[10px] uppercase tracking-wider text-yellow-400/70 px-1 mb-1">🟡 In Progress</div>
                    {activeGoals.map(block => (
                      <SortableGoalRow
                        key={block.id}
                        block={block}
                        onSelect={id => setExpandedGoalId(expandedGoalId === id ? null : id)}
                        onToggleTask={handleToggleTask}
                        isExpanded={expandedGoalId === block.id}
                      />
                    ))}
                  </div>
                )}

                {/* Backlog */}
                {backlogGoals.length > 0 && (
                  <div className="mb-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-1 mb-1">⚪ Backlog</div>
                    {backlogGoals.map(block => (
                      <SortableGoalRow
                        key={block.id}
                        block={block}
                        onSelect={id => setExpandedGoalId(expandedGoalId === id ? null : id)}
                        onToggleTask={handleToggleTask}
                        isExpanded={expandedGoalId === block.id}
                      />
                    ))}
                  </div>
                )}
              </SortableContext>
            </DndContext>
          )}

          {/* Completed goals (collapsed) */}
          {completedGoals.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                {completedGoals.length} completed goals
              </summary>
              <div className="mt-2 space-y-1 opacity-60">
                {completedGoals.map(block => (
                  <div key={block.id} className="flex items-center gap-2 p-2 text-sm">
                    <span className="text-green-500">✓</span>
                    <span className="font-mono text-xs text-muted-foreground">{block.id}</span>
                    <span className="truncate">{block.title}</span>
                    <span className="text-xs text-muted-foreground/50 ml-auto tabular-nums">100%</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Blocking Items */}
      {blockingItems.length > 0 && (
        <div className="bg-card border border-orange-500/30 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-border flex items-center gap-2 bg-orange-500/10">
            <span>⏳</span>
            <h2 className="font-semibold text-sm">Blocking (Dustin TODO)</h2>
            <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
              {blockingItems.length}
            </span>
          </div>
          <div className="p-2">
            {blockingItems.map(item => (
              <BlockingItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Add Goal Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass-card p-4 w-full max-w-md mx-4">
            <h3 className="font-semibold mb-3">Add Goal</h3>
            <p className="text-xs text-muted-foreground mb-2">
              Creates a new ⚪ BACKLOG goal in GOALS.md. Agents will see it on their next session.
            </p>
            <textarea
              value={newGoalDraft}
              onChange={(e) => setNewGoalDraft(e.target.value)}
              placeholder="Goal title (e.g. Build payment integration)"
              className="w-full h-20 bg-muted border border-border rounded-lg p-2 text-sm resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleAddGoal}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Add to Backlog
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
