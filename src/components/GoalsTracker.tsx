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
import { ExternalLink, GripVertical, Plus, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BlockingItem, extractBlockingItems, Goal, parseGoals } from '../lib/goals';
import { cn } from '../lib/utils';

interface GoalsTrackerProps {
  className?: string;
  workspace?: string | null;
}

function SortableGoalRow({ goal, onSelect }: { goal: Goal; onSelect: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const statusColors: Record<string, string> = {
    '🟢': 'bg-green-500',
    '🟡': 'bg-yellow-500',
    '🔴': 'bg-red-500',
    '⚪': 'bg-gray-500',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 p-3 bg-card border border-border rounded-lg transition-all',
        isDragging && 'opacity-50 shadow-lg',
        'hover:border-primary/50'
      )}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded touch-none"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Priority Number */}
      <span className="text-xs text-muted-foreground font-mono w-4">
        {goal.priority}
      </span>

      {/* Status Indicator */}
      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColors[goal.status])} />

      {/* Goal Info */}
      <div className="flex-1 min-w-0" onClick={() => onSelect(goal.id)}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{goal.id}</span>
          <span className="text-sm font-medium truncate">{goal.title}</span>
        </div>

        {/* Progress Bar */}
        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              goal.progress === 100 ? 'bg-green-500' : 'bg-primary'
            )}
            style={{ width: `${goal.progress}%` }}
          />
        </div>
      </div>

      {/* Progress Percentage */}
      <span className={cn(
        'text-xs font-medium',
        goal.progress === 100 ? 'text-green-400' : 'text-muted-foreground'
      )}>
        {goal.progress}%
      </span>
    </div>
  );
}

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

export function GoalsTracker({ className, workspace }: GoalsTrackerProps) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [blockingItems, setBlockingItems] = useState<BlockingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGoalDraft, setNewGoalDraft] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (workspace) {
      setGoals([]);
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
        const parsedGoals = parseGoals(data.content);
        setGoals(parsedGoals);
        setBlockingItems(extractBlockingItems(parsedGoals));
      }
    } catch (e) {
      console.error('Failed to fetch goals:', e);
    } finally {
      setLoading(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setGoals((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        // Update priorities
        return newItems.map((item, idx) => ({ ...item, priority: idx + 1 }));
      });
      // TODO: Save new order to GOALS.md
    }
  }

  function handleAddGoal() {
    if (!newGoalDraft.trim()) return;
    // TODO: Send to API to add goal
    console.log('New goal draft:', newGoalDraft);
    setNewGoalDraft('');
    setShowAddModal(false);
  }

  const activeGoals = goals.filter(g => g.status === '🟡');
  const completedGoals = goals.filter(g => g.status === '🟢');

  return (
    <div className={cn('space-y-4', className)}>
      {/* Goals Section */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Goals</h2>
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
              {activeGoals.length} active
            </span>
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
            <div className="p-4 text-sm text-muted-foreground text-center">Loading...</div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={activeGoals.map(g => g.id)} strategy={verticalListSortingStrategy}>
                {activeGoals.map((goal) => (
                  <SortableGoalRow key={goal.id} goal={goal} onSelect={() => { }} />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {completedGoals.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                {completedGoals.length} completed goals
              </summary>
              <div className="mt-2 space-y-2 opacity-60">
                {completedGoals.map(goal => (
                  <div key={goal.id} className="flex items-center gap-2 p-2 text-sm">
                    <span className="text-green-500">✓</span>
                    <span className="font-mono text-xs text-muted-foreground">{goal.id}</span>
                    <span className="truncate">{goal.title}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Blocking Items (Your TODOs) */}
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
          <div className="bg-card border border-border rounded-lg p-4 w-full max-w-md mx-4">
            <h3 className="font-semibold mb-3">Add Goal Draft</h3>
            <textarea
              value={newGoalDraft}
              onChange={(e) => setNewGoalDraft(e.target.value)}
              placeholder="Describe the goal... (Rocket will flesh out the details)"
              className="w-full h-24 bg-muted border border-border rounded-lg p-2 text-sm resize-none"
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
                Add Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
