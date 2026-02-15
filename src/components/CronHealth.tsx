'use client';

interface CronHealthProps {
  total: number;
  ok: number;
  errors: Array<{ name: string; lastStatus: string }>;
}

export function CronHealth({ total, ok, errors }: CronHealthProps) {
  if (total === 0) return null;

  const allOk = errors.length === 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Cron:</span>
      {allOk ? (
        <span className="text-emerald-400 font-medium">
          🟢 {ok}/{total} OK
        </span>
      ) : (
        <span className="text-red-400 font-medium">
          🔴 {errors.length} failed
          <span className="text-red-300/70 ml-1">
            ({errors.map((e) => e.name).join(', ')})
          </span>
        </span>
      )}
    </div>
  );
}
