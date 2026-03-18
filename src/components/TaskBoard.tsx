'use client';

import { closestCorners, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState } from 'react';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigneeId?: string | null;
  assigneeType?: string;
  updatedAt: string;
}

const COLUMNS = ['todo', 'in_progress', 'review', 'done'];

function TaskCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isStale = new Date().getTime() - new Date(task.updatedAt).getTime() > 48 * 60 * 60 * 1000;
  const isDone = task.status === 'done';
  const assigneeLabel = task.assigneeId
    ? `${task.assigneeType === 'user' ? '👤' : '🤖'} ${task.assigneeId}`
    : 'Unassigned';

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={`bg-gray-800 p-3 rounded mb-2 border cursor-grab hover:border-blue-500 ${isStale && !isDone ? 'border-orange-500/50' : 'border-gray-700'}`}>
      <div className="font-bold text-sm flex justify-between items-start">
        <span>{task.title}</span>
        {isStale && !isDone && <span className="text-[10px] bg-orange-900/50 text-orange-200 px-1 rounded ml-2 whitespace-nowrap">Stale</span>}
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-2">
        <span>{assigneeLabel}</span>
        <span className={`px-1 rounded ${task.priority === 'high' ? 'bg-red-900 text-red-200' : 'bg-gray-700'}`}>{task.priority}</span>
      </div>
    </div>
  );
}

function Column({ id, tasks }: { id: string, tasks: Task[] }) {
  const { setNodeRef } = useSortable({ id });

  return (
    <div ref={setNodeRef} className="flex-1 bg-gray-900/50 p-4 rounded-lg min-w-[250px]">
      <h3 className="text-lg font-bold mb-4 capitalize text-gray-300">{id.replace('_', ' ')}</h3>
      <SortableContext items={tasks} strategy={verticalListSortingStrategy}>
        {tasks.map(task => <TaskCard key={task.id} task={task} />)}
      </SortableContext>
    </div>
  );
}

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [_activeId, _setActiveId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/tasks').then(res => res.json()).then(setTasks);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleDragEnd(event: any) {
    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    // Find the task
    const activeTask = tasks.find(t => t.id === activeId);
    if (!activeTask) return;

    // If dropped on a column container (which we assign ID = column name)
    if (COLUMNS.includes(overId)) {
      if (activeTask.status !== overId) {
        updateTaskStatus(activeId, overId);
      }
      return;
    }

    // If dropped on another task
    const overTask = tasks.find(t => t.id === overId);
    if (overTask && activeTask.status !== overTask.status) {
      updateTaskStatus(activeId, overTask.status);
    }
  }

  async function updateTaskStatus(taskId: string, newStatus: string) {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));

    // API call
    // We need a PATCH endpoint or reuse POST. The tasks.py creates separate UPDATE cmd.
    // Ideally UI should have PUT/PATCH route. I'll assume I can add one or use a server action.
    // For now, let's just log it. I need to add PATCH to route.ts
    await fetch('/api/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: taskId, status: newStatus })
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto h-full pb-4">
        {COLUMNS.map(col => (
          <Column key={col} id={col} tasks={tasks.filter(t => t.status === col)} />
        ))}
      </div>
    </DndContext>
  );
}
