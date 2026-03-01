'use client';

import { useEffect, useState } from 'react';
import { Database, Server, Cloud } from 'lucide-react';

interface Resource {
  id: string;
  name: string;
  status: string;
  project?: { name: string };
  meta: any;
}

interface ResourceGroup {
  supabase: Resource[];
  railway: Resource[];
  other: Resource[];
}

function ResourceCard({ resource, icon: Icon }: { resource: Resource, icon: any }) {
  const meta = resource.meta || {};
  // Try to parse meta if it's a string, otherwise use as is
  const details = typeof meta === 'string' ? JSON.parse(meta) : meta;
  
  // Extract useful info based on type
  const services = details.services?.edges?.length || 0;
  const region = details.region || 'us-east-1';

  return (
    <div className="glass-card p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${resource.status === 'active' || resource.status === 'claimed' ? 'bg-green-500/10 text-green-400' : 'bg-gray-800 text-gray-400'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
          <h4 className="font-semibold text-sm truncate">{resource.name}</h4>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${resource.status === 'active' ? 'border-green-500/30 text-green-400' : 'border-gray-700 text-gray-400'}`}>
            {resource.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {resource.project?.name ? `Linked: ${resource.project.name}` : 'Unlinked'}
        </p>
        <div className="flex gap-2 mt-2 text-[10px] text-gray-500 font-mono">
            {services > 0 && <span>{services} services</span>}
            {region && <span>{region}</span>}
        </div>
      </div>
    </div>
  );
}

export default function InfraMonitor() {
  const [resources, setResources] = useState<ResourceGroup | null>(null);

  useEffect(() => {
    fetch('/api/resources').then(res => res.json()).then(setResources);
  }, []);

  if (!resources) return <div className="p-4 text-sm text-muted-foreground">Loading infrastructure...</div>;

  return (
    <div className="space-y-6">
      {/* Railway Section */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Server className="w-4 h-4" /> Railway Projects ({resources.railway.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {resources.railway.map(r => <ResourceCard key={r.id} resource={r} icon={Server} />)}
        </div>
      </div>

      {/* Supabase Section */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Database className="w-4 h-4" /> Supabase Projects ({resources.supabase.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {resources.supabase.map(r => <ResourceCard key={r.id} resource={r} icon={Database} />)}
        </div>
      </div>
    </div>
  );
}
