import TaskBoard from '@/components/TaskBoard';

export default function TasksPage() {
  return (
    <div className="p-8 h-screen flex flex-col">
      <h1 className="text-3xl font-bold mb-6">Task Tracker</h1>
      <div className="flex-1 overflow-hidden">
        <TaskBoard />
      </div>
    </div>
  );
}
